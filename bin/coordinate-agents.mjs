#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { getAdapter } from '../skills/coordinate-agents/adapters/index.mjs';
import { redactOutput } from '../skills/coordinate-agents/adapters/executable.mjs';
import { observeAgentBus, waitForAgentActivity } from '../skills/coordinate-agents/scripts/agent-observer.mjs';
import {
  assertContained,
  atomicWrite,
  readConfig,
  validateAgentId,
  withConfigTransaction,
} from '../skills/coordinate-agents/scripts/config.mjs';
import {
  defaultUserConfig,
  getUserConfigValue,
  readUserConfig,
  resolveAgentConfig,
  setUserConfigValue,
  userConfigPath,
  writeUserConfig,
} from '../skills/coordinate-agents/scripts/user-config.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const skillName = 'coordinate-agents';
const canonicalSkillSource = join(packageRoot, 'skills', skillName);
const busToolPath = join(canonicalSkillSource, 'scripts', 'agent-bus.mjs');
const metadataFile = '.coordinate-agents.json';
const templateNames = new Set(['bug', 'feature', 'refactor']);

const messages = {
  en: {
    usage: `coordinate-agents <command> [options]

Commands:
  install       Install the skill (default: Codex and Antigravity)
  update        Reinstall the packaged version and back up the old copy
  quickstart    Initialize a project and print two copyable launch commands
  launch        Start one CLI with its generated collaboration prompt
  agent         Manage registered agents (add, list, doctor)
  config        Manage user-level executable configuration (set, get, list)
  doctor        Check prerequisites/installations and print repair commands
  uninstall     Remove installations created by this package
  help          Show this help

Options:
  --codex                 Target Codex only
  --antigravity           Target Antigravity only
  --codex-home <path>     Override CODEX_HOME (default: ~/.codex)
  --antigravity-home <p>  Override GEMINI_HOME (default: ~/.gemini)
  --root <path>           Project Git repository (default: current directory)
  --agent <id>            Launch or target agent ID (default: codex or antigravity)
  --planner <agent>       Workflow planner agent (default: codex)
  --implementer <agent>   Workflow implementer agent (default: antigravity)
  --reviewer <agent>      Workflow reviewer agent (default: codex)
  --adapter <adapter>     Adapter for agent registration (default: generic-cli)
  --command <cmd>         Executable command for agent registration
  --args <args>           Command argument template (JSON array or comma-separated)
  --template <type>       Task template: bug, feature, or refactor
  --task <text>           Task summary included in the launch prompt
  --lang <en|zh-CN>       Override output language
  --force                 Replace/remove an unrecognized existing directory
  --once                  Disable Adapter-declared durable launch supervision
  --version               Print package version
  -h, --help              Show this help

Examples:
  npx @hogancv/coordinate-agents install
  npx @hogancv/coordinate-agents quickstart --template feature --task "Build a Todo app"
  npx @hogancv/coordinate-agents agent add claude --adapter generic-cli --command claude
  npx @hogancv/coordinate-agents config set agent.antigravity.command agy-proxy
  npx @hogancv/coordinate-agents doctor`,
    installed: 'Installed {target}: {path}',
    updated: 'Updated {target}: {path}',
    current: '{target} is already current: {path}',
    backup: 'Backed up previous installation: {path}',
    healthy: '{target}: healthy ({version}) at {path}',
    missing: '{target}: not installed at {path}',
    invalid: '{target}: verification failed: {details}',
    removed: 'Removed {target}: {path}',
    skipRemove: '{target}: refusing to remove an unrecognized directory without --force: {path}',
    noInstall: 'No target installation was found.',
    summaryOk: 'All prerequisites and selected installations are healthy.',
    summaryFail: 'One or more prerequisites or installations need attention.',
    componentHealthy: '{component}: available ({version})',
    componentMissing: '{component}: missing or unusable.',
    repair: '  Fix: {command}',
    manualRepair: '  Action: back up or move the unrecognized directory, then run: {command}',
    quickstartReady: 'Collaboration workspace initialized: {root}',
    promptsWritten: 'Generated role prompts: {path}',
    codexCommand: '1. Codex terminal (copy and run):',
    antigravityCommand: '2. Antigravity terminal (copy and run):',
    plannerCommand: '1. {agent} ({roles}) terminal (copy and run):',
    implementerCommand: '2. {agent} ({roles}) terminal (copy and run):',
    launchMissing: 'Generated prompt is missing. Run quickstart first: {command}',
    launchExists: 'Launch prompts already exist at {path}. Use the previously generated launch commands; continue new tasks in Codex.',
    unsafeBusPath: 'Refusing unsafe agent-bus path (symlink, junction, or outside repository): {path}',
    notGitRepo: 'Not a Git repository: {path}',
    badTemplate: 'Unsupported template: {template}. Use bug, feature, or refactor.',
    badAgent: 'Unknown agent "{agent}". Ensure the agent is registered in .agent-bus/config.json.',
    launchFailed: 'Agent {agent} exited with status {status}.',
    unknownCommand: 'Unknown command: {command}',
    missingValue: 'Missing value for {option}',
    badLanguage: 'Unsupported language: {language}',
    configHelp: 'Use config set|get|list. Keys look like agent.<agent-id>.command or agent.<agent-id>.args.',
    configUpdated: 'Updated user configuration: {path}',
    configValueMissing: 'User configuration value is not set: {key}',
    configListTitle: 'Coordinate Agents User Configuration',
    configPathLabel: 'Path:',
    configAgentsLabel: 'Agents:',
    configNone: '  (none)',
    configCommandLabel: '  command: {value}',
    configArgsLabel: '  args: {value}',
    implementerUnavailable: 'Implementer unavailable.',
    implementerFailed: 'Implementer failed.',
    launchAgentLabel: 'Agent:',
    launchAdapterLabel: 'Adapter:',
    launchCommandLabel: 'Configured command:',
    launchErrorLabel: 'Error:',
    launchDetailsLabel: 'Details:',
    launchConfigLabel: 'User configuration:',
    launchArtifactLabel: 'Error artifact:',
    launchExitCodeLabel: 'Exit code:',
    launchStdoutLabel: 'stdout tail:',
    launchStderrLabel: 'stderr tail:',
    launchSuggestedFix: 'Suggested fix:',
    launchProjectConfigNote: 'Project configuration takes precedence; update .agent-bus/config.json if it contains an explicit command.',
    commandRepair: 'coordinate-agents config set agent.{agent}.command <working-executable>',
  },
  zh: {
    usage: `coordinate-agents <命令> [选项]

命令：
  install       安装技能（默认同时安装 Codex 和 Antigravity）
  update        备份旧副本并重新安装当前包版本
  quickstart    初始化项目并生成两条可复制的启动命令
  launch        使用已生成的协作提示词启动一个 CLI
  agent         管理注册的 Agent（add, list, doctor）
  config        管理用户级可执行文件配置（set, get, list）
  doctor        检查依赖和安装，并输出对应修复命令
  uninstall     删除由本 npm 包创建的安装
  help          显示帮助

选项：
  --codex                 只操作 Codex
  --antigravity           只操作 Antigravity
  --codex-home <路径>     覆盖 CODEX_HOME（默认：~/.codex）
  --antigravity-home <p>  覆盖 GEMINI_HOME（默认：~/.gemini）
  --root <路径>           项目 Git 仓库（默认：当前目录）
  --agent <id>            启动或操作的 Agent ID
  --planner <agent>       工作流规划者 Agent（默认：codex）
  --implementer <agent>   工作流实现者 Agent（默认：antigravity）
  --reviewer <agent>      工作流审查者 Agent（默认：codex）
  --adapter <adapter>     注册 Agent 的适配器（默认：generic-cli）
  --command <cmd>         注册 Agent 的可执行命令
  --args <args>           注册 Agent 的命令行参数模板（JSON 数组或逗号分隔）
  --template <类型>       任务模板：bug、feature 或 refactor
  --task <文本>           写入启动提示词的任务摘要
  --lang <en|zh-CN>       指定输出语言
  --force                 替换或删除无法识别的现有目录
  --once                  禁用 Adapter 声明的持久启动监督
  --version               输出包版本
  -h, --help              显示帮助

示例：
  npx @hogancv/coordinate-agents install
  npx @hogancv/coordinate-agents quickstart --template feature --task "开发 Todo 应用"
  npx @hogancv/coordinate-agents agent add claude --adapter generic-cli --command claude
  npx @hogancv/coordinate-agents config set agent.antigravity.command agy-proxy
  npx @hogancv/coordinate-agents doctor --lang zh-CN`,
    installed: '已安装 {target}：{path}',
    updated: '已更新 {target}：{path}',
    current: '{target} 已是当前版本：{path}',
    backup: '旧安装已备份：{path}',
    healthy: '{target}：正常（{version}），位置：{path}',
    missing: '{target}：尚未安装，目标位置：{path}',
    invalid: '{target}：校验失败：{details}，位置：{path}',
    removed: '已卸载 {target}：{path}',
    skipRemove: '{target}：现有目录不是本包创建的安装；未提供 --force，拒绝删除：{path}',
    noInstall: '没有发现目标安装。',
    summaryOk: '所有依赖和所选安装均验证正常。',
    summaryFail: '一个或多个依赖或安装需要处理。',
    componentHealthy: '{component}：可用（{version}）',
    componentMissing: '{component}：缺失或无法使用。',
    repair: '  修复：{command}',
    manualRepair: '  操作：先备份或移动无法识别的目录，再运行：{command}',
    quickstartReady: '协作工作区已初始化：{root}',
    promptsWritten: '已生成角色提示词：{path}',
    codexCommand: '1. Codex 终端（复制并运行）：',
    antigravityCommand: '2. Antigravity 终端（复制并运行）：',
    plannerCommand: '1. {agent}（{roles}）终端（复制并运行）：',
    implementerCommand: '2. {agent}（{roles}）终端（复制并运行）：',
    launchMissing: '找不到生成的提示词。请先运行 quickstart：{command}',
    launchExists: '启动提示词已存在：{path}。请使用之前生成的启动命令；后续新任务直接在 Codex 中继续。',
    unsafeBusPath: '拒绝使用不安全的 agent-bus 路径（符号链接、目录联接或仓库外路径）：{path}',
    notGitRepo: '不是 Git 仓库：{path}',
    badTemplate: '不支持的任务模板：{template}。请使用 bug、feature 或 refactor。',
    badAgent: '未知 Agent "{agent}"。请确保该 Agent 已在 .agent-bus/config.json 中注册。',
    launchFailed: 'Agent {agent} 退出，状态码 {status}。',
    unknownCommand: '未知命令：{command}',
    missingValue: '选项缺少参数：{option}',
    badLanguage: '不支持的语言：{language}',
    configHelp: '请使用 config set|get|list。键格式为 agent.<agent-id>.command 或 agent.<agent-id>.args。',
    configUpdated: '已更新用户配置：{path}',
    configValueMissing: '未设置用户配置项：{key}',
    configListTitle: 'Coordinate Agents 用户配置',
    configPathLabel: '路径：',
    configAgentsLabel: 'Agents：',
    configNone: '  （无）',
    configCommandLabel: '  command：{value}',
    configArgsLabel: '  args：{value}',
    implementerUnavailable: 'Implementer 不可用。',
    implementerFailed: 'Implementer 执行失败。',
    launchAgentLabel: 'Agent：',
    launchAdapterLabel: 'Adapter：',
    launchCommandLabel: '配置的命令：',
    launchErrorLabel: '错误：',
    launchDetailsLabel: '详情：',
    launchConfigLabel: '用户配置：',
    launchArtifactLabel: '错误 artifact：',
    launchExitCodeLabel: '退出码：',
    launchStdoutLabel: 'stdout 尾部：',
    launchStderrLabel: 'stderr 尾部：',
    launchSuggestedFix: '建议修复：',
    launchProjectConfigNote: '项目配置优先；如果 .agent-bus/config.json 中有显式命令，请在那里修改。',
    commandRepair: 'coordinate-agents config set agent.{agent}.command <可用的可执行文件>',
  },
};

function parseArgs(argv) {
  const result = {
    command: 'help',
    subcommand: null,
    targetAgent: null,
    codex: false,
    antigravity: false,
    force: false,
    once: false,
    help: false,
    version: false,
    codexHome: process.env.CODEX_HOME || join(homedir(), '.codex'),
    antigravityHome: process.env.GEMINI_HOME || join(homedir(), '.gemini'),
    codexHomeBase64: null,
    antigravityHomeBase64: null,
    root: process.cwd(),
    rootBase64: null,
    agent: null,
    planner: null,
    implementer: null,
    reviewer: null,
    adapter: 'generic-cli',
    agentCommand: null,
    agentArgs: null,
    template: 'feature',
    task: '',
    language: null,
    positionals: [],
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) {
    result.command = args.shift();
    if (result.command === 'agent' && args[0] && !args[0].startsWith('-')) {
      result.subcommand = args.shift();
      if (args[0] && !args[0].startsWith('-')) {
        result.targetAgent = args.shift();
      }
    } else if (result.command === 'config' && args[0] && !args[0].startsWith('-')) {
      result.subcommand = args.shift();
    }
  }
  while (args.length) {
    const option = args.shift();
    if (!option.startsWith('-')) {
      result.positionals.push(option);
      continue;
    }
    if (option === '--codex') result.codex = true;
    else if (option === '--antigravity') result.antigravity = true;
    else if (option === '--force') result.force = true;
    else if (option === '--once') result.once = true;
    else if (option === '--help' || option === '-h') result.help = true;
    else if (option === '--version') result.version = true;
    else if ([
      '--codex-home', '--antigravity-home', '--codex-home-base64', '--antigravity-home-base64',
      '--root', '--root-base64', '--agent', '--planner', '--implementer', '--reviewer',
      '--adapter', '--command', '--args', '--template', '--task', '--lang',
    ].includes(option)) {
      if (!args.length || args[0].startsWith('-')) throw new Error(`MISSING_VALUE:${option}`);
      const value = args.shift();
      if (option === '--codex-home') result.codexHome = resolve(value);
      if (option === '--antigravity-home') result.antigravityHome = resolve(value);
      if (option === '--codex-home-base64') result.codexHomeBase64 = value;
      if (option === '--antigravity-home-base64') result.antigravityHomeBase64 = value;
      if (option === '--root') result.root = resolve(value);
      if (option === '--root-base64') result.rootBase64 = value;
      if (option === '--agent') {
        result.agent = value.toLowerCase();
      }
      if (option === '--planner') result.planner = value.toLowerCase();
      if (option === '--implementer') result.implementer = value.toLowerCase();
      if (option === '--reviewer') result.reviewer = value.toLowerCase();
      if (option === '--adapter') result.adapter = value;
      if (option === '--command') result.agentCommand = value;
      if (option === '--args') result.agentArgs = value;
      if (option === '--template') result.template = value.toLowerCase();
      if (option === '--task') result.task = value;
      if (option === '--lang') result.language = value;
    } else {
      throw new Error(`UNKNOWN_OPTION:${option}`);
    }
  }
  if (!result.codex && !result.antigravity) {
    result.codex = true;
    result.antigravity = true;
  }
  if (result.rootBase64) result.root = resolve(Buffer.from(result.rootBase64, 'base64url').toString('utf8'));
  if (result.codexHomeBase64) result.codexHome = resolve(Buffer.from(result.codexHomeBase64, 'base64url').toString('utf8'));
  if (result.antigravityHomeBase64) result.antigravityHome = resolve(Buffer.from(result.antigravityHomeBase64, 'base64url').toString('utf8'));
  return result;
}

function detectLanguage(explicit) {
  const value = explicit || process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
  if (/^zh([_-]|$)/i.test(value)) return 'zh';
  if (/^en([_-]|$)/i.test(value)) return 'en';
  if (explicit) throw new Error(`BAD_LANGUAGE:${explicit}`);
  return 'en';
}

function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walkFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
  }
  return files.sort();
}

function payloadManifest(skillSource = canonicalSkillSource) {
  const manifest = {};
  if (!existsSync(skillSource)) throw new Error(`Canonical skill source is missing: ${skillSource}`);
  for (const file of walkFiles(skillSource)) {
    manifest[file] = hashFile(join(skillSource, file));
  }
  return manifest;
}

function targets(options) {
  const selected = [];
  if (options.codex) selected.push({ name: 'Codex', path: join(options.codexHome, 'skills', skillName) });
  if (options.antigravity) selected.push({ name: 'Antigravity', path: join(options.antigravityHome, 'skills', skillName) });
  return selected;
}

function readMetadata(targetPath) {
  const primaryPath = join(targetPath, metadataFile);
  if (existsSync(primaryPath)) {
    try {
      return JSON.parse(readFileSync(primaryPath, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function hasExpectedManagedIdentity(metadata, expectedManifest) {
  return Boolean(
    metadata
    && metadata.package === packageJson.name
    && typeof metadata.version === 'string'
    && metadata.version.length > 0
    && typeof metadata.installedAt === 'string'
    && Number.isFinite(Date.parse(metadata.installedAt))
    && metadata.manifest
    && typeof metadata.manifest === 'object'
    && !Array.isArray(metadata.manifest)
    && Object.keys(metadata.manifest).length > 0
    && Object.entries(metadata.manifest).every(([file, hash]) => (
      typeof file === 'string'
      && file.length > 0
      && typeof hash === 'string'
      && /^[0-9a-f]{64}$/.test(hash)
    ))
    && Object.keys(metadata.manifest).length === Object.keys(expectedManifest).length
    && Object.entries(expectedManifest).every(([file, hash]) => metadata.manifest[file] === hash)
  );
}

function isRecognizedManagedInstallation(targetPath) {
  if (!existsSync(targetPath)) return false;
  const metadata = readMetadata(targetPath);
  if (!metadata || metadata.package !== packageJson.name) {
    return false;
  }
  if (!metadata.manifest || typeof metadata.manifest !== 'object' || Array.isArray(metadata.manifest)) {
    return false;
  }
  const manifestEntries = Object.entries(metadata.manifest);
  if (manifestEntries.length === 0) return false;
  for (const [file, hash] of manifestEntries) {
    if (typeof file !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
    const filePath = join(targetPath, file);
    if (!existsSync(filePath) || !statSync(filePath).isFile() || hashFile(filePath) !== hash) return false;
  }
  const allowed = new Set([...Object.keys(metadata.manifest), metadataFile]);
  const diskFiles = walkFiles(targetPath);
  return diskFiles.every(file => allowed.has(file));
}

function verifyTarget(targetPath, expectedManifest) {
  if (!existsSync(targetPath)) return { ok: false, missing: true, details: 'directory missing' };
  const metadata = readMetadata(targetPath);
  if (!hasExpectedManagedIdentity(metadata, expectedManifest)) {
    return { ok: false, managed: false, details: 'installation metadata missing or unrecognized' };
  }
  const failures = [];
  for (const [file, expectedHash] of Object.entries(expectedManifest)) {
    const path = join(targetPath, file);
    if (!existsSync(path)) failures.push(`${file} missing`);
    else if (hashFile(path) !== expectedHash) failures.push(`${file} modified`);
  }
  return {
    ok: failures.length === 0,
    managed: true,
    details: failures.slice(0, 5).join(', '),
    version: metadata.version,
  };
}

function payloadMatches(targetPath, expectedManifest) {
  if (!existsSync(targetPath)) return false;
  return Object.entries(expectedManifest).every(([file, expectedHash]) => {
    const path = join(targetPath, file);
    return existsSync(path) && statSync(path).isFile() && hashFile(path) === expectedHash;
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function removePath(path) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}

function installTarget(target, expectedManifest, options, t) {
  const sourceResolved = resolve(canonicalSkillSource);
  const targetResolved = resolve(target.path);
  if (sourceResolved === targetResolved) {
    console.log(format(t.current, { target: target.name, path: target.path }));
    return;
  }

  const prior = verifyTarget(target.path, expectedManifest);

  if (prior.ok && prior.version === packageJson.version) {
    console.log(format(t.current, { target: target.name, path: target.path }));
    return;
  }

  const unmanagedGitCheckout = existsSync(join(target.path, '.git'));
  if (existsSync(target.path) && !hasExpectedManagedIdentity(readMetadata(target.path), expectedManifest) && (unmanagedGitCheckout || !payloadMatches(target.path, expectedManifest)) && !options.force) {
    throw new Error(format(t.skipRemove, { target: target.name, path: target.path }));
  }

  mkdirSync(dirname(target.path), { recursive: true });
  const staging = mkdtempSync(join(dirname(target.path), `.${skillName}-staging-`));
  try {
    cpSync(canonicalSkillSource, staging, { recursive: true });
    writeFileSync(join(staging, metadataFile), JSON.stringify({
      package: packageJson.name,
      version: packageJson.version,
      installedAt: new Date().toISOString(),
      manifest: expectedManifest,
    }, null, 2) + '\n', 'utf8');

    let backup = null;
    if (existsSync(target.path)) {
      backup = `${target.path}.backup-${timestamp()}`;
      renameSync(target.path, backup);
      console.log(format(t.backup, { path: backup }));
    }
    try {
      renameSync(staging, target.path);
    } catch (error) {
      if (backup && !existsSync(target.path)) renameSync(backup, target.path);
      throw error;
    }

    console.log(format(prior.missing ? t.installed : t.updated, { target: target.name, path: target.path }));
  } finally {
    removePath(staging);
  }
}

function isIntactManagedInstallation(targetPath, expectedManifest) {
  const metadata = readMetadata(targetPath);
  if (!hasExpectedManagedIdentity(metadata, expectedManifest) || !payloadMatches(targetPath, expectedManifest)) return false;
  const allowed = new Set([...Object.keys(expectedManifest), metadataFile]);
  return walkFiles(targetPath).every(file => allowed.has(file));
}

function executableVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
}

function repairCommands() {
  if (process.platform === 'win32') {
    return {
      node: 'winget install --id OpenJS.NodeJS.LTS -e',
      git: 'winget install --id Git.Git -e',
      codex: 'npm install --global @openai/codex@latest',
      antigravity: 'Invoke-WebRequest https://antigravity.google/cli/install.ps1 -OutFile "$env:TEMP\\antigravity-install.ps1"; Write-Host "Review the downloaded official script, then run: & $env:TEMP\\antigravity-install.ps1"',
    };
  }
  if (process.platform === 'darwin') {
    return {
      node: 'brew install node',
      git: 'xcode-select --install',
      codex: 'npm install --global @openai/codex@latest',
      antigravity: 'curl -fsSLo "${TMPDIR:-/tmp}/antigravity-install.sh" https://antigravity.google/cli/install.sh && printf \'Review the downloaded official script, then run: bash %s\\n\' "${TMPDIR:-/tmp}/antigravity-install.sh"',
    };
  }
  const has = (command) => executableVersion(command, ['--version']) !== null;
  if (has('dnf')) return {
    node: 'sudo dnf install -y nodejs npm', git: 'sudo dnf install -y git',
    codex: 'npm install --global @openai/codex@latest', antigravity: 'curl -fsSLo "${TMPDIR:-/tmp}/antigravity-install.sh" https://antigravity.google/cli/install.sh && printf \'Review the downloaded official script, then run: bash %s\\n\' "${TMPDIR:-/tmp}/antigravity-install.sh"',
  };
  if (has('pacman')) return {
    node: 'sudo pacman -S --needed nodejs npm', git: 'sudo pacman -S --needed git',
    codex: 'npm install --global @openai/codex@latest', antigravity: 'curl -fsSLo "${TMPDIR:-/tmp}/antigravity-install.sh" https://antigravity.google/cli/install.sh && printf \'Review the downloaded official script, then run: bash %s\\n\' "${TMPDIR:-/tmp}/antigravity-install.sh"',
  };
  if (has('zypper')) return {
    node: 'sudo zypper install nodejs npm', git: 'sudo zypper install git',
    codex: 'npm install --global @openai/codex@latest', antigravity: 'curl -fsSLo "${TMPDIR:-/tmp}/antigravity-install.sh" https://antigravity.google/cli/install.sh && printf \'Review the downloaded official script, then run: bash %s\\n\' "${TMPDIR:-/tmp}/antigravity-install.sh"',
  };
  return {
    node: 'sudo apt-get update && sudo apt-get install -y nodejs npm',
    git: 'sudo apt-get update && sudo apt-get install -y git',
    codex: 'npm install --global @openai/codex@latest',
    antigravity: 'curl -fsSLo "${TMPDIR:-/tmp}/antigravity-install.sh" https://antigravity.google/cli/install.sh && printf \'Review the downloaded official script, then run: bash %s\\n\' "${TMPDIR:-/tmp}/antigravity-install.sh"',
  };
}

function packageCommand(command, options) {
  let result = `npx --yes ${packageJson.name}@${packageJson.version} ${command}`;
  if (options.agent) result += ` --agent ${options.agent}`;
  if (options.root) result += ` --root-base64 ${Buffer.from(options.root, 'utf8').toString('base64url')}`;
  if (options.language) result += ` --lang ${options.language === 'zh' ? 'zh-CN' : options.language}`;
  return result;
}

function stringifyConfigValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return String(value);
}

function parseConfigValue(key, value) {
  if (key.endsWith('.args')) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
        throw new Error('args must be a JSON array of strings.');
      }
      return parsed;
    } catch (error) {
      throw new Error(`Invalid args value: ${error.message}`);
    }
  }
  return value;
}

function handleConfigCommand(options, t) {
  const path = userConfigPath();
  const subcommand = options.subcommand;
  if (subcommand === 'list' || !subcommand) {
    const config = readUserConfig();
    console.log(t.configListTitle);
    console.log(`\n${t.configPathLabel}\n${path}`);
    console.log(`\n${t.configAgentsLabel}`);
    const agents = Object.entries(config.agents);
    if (agents.length === 0) {
      console.log(t.configNone);
    } else {
      for (const [agentId, agent] of agents) {
        console.log(`\n${agentId}`);
        if (agent.command !== undefined) console.log(format(t.configCommandLabel, { value: agent.command }));
        if (agent.args !== undefined) console.log(format(t.configArgsLabel, { value: JSON.stringify(agent.args) }));
      }
    }
    return;
  }

  if (subcommand === 'set') {
    const [key, value, ...extra] = options.positionals;
    if (!key || value === undefined || extra.length > 0) {
      throw new Error(`${t.configHelp} Example: coordinate-agents config set agent.antigravity.command agy-proxy`);
    }
    const config = readUserConfig();
    setUserConfigValue(config, key, parseConfigValue(key, value));
    const written = writeUserConfig(config);
    console.log(format(t.configUpdated, { path: written }));
    return;
  }

  if (subcommand === 'get') {
    const [key, ...extra] = options.positionals;
    if (!key || extra.length > 0) throw new Error(t.configHelp);
    const value = getUserConfigValue(readUserConfig(), key);
    if (value === undefined) throw new Error(format(t.configValueMissing, { key }));
    console.log(stringifyConfigValue(value));
    return;
  }

  throw new Error(`${t.configHelp} Unknown config subcommand: ${subcommand}`);
}

function projectConfigForRoot(root) {
  const busPath = join(root, '.agent-bus');
  if (!existsSync(busPath)) return null;
  return readConfig(busPath);
}

function runtimeAgentConfig(agentConfig, userConfig) {
  return resolveAgentConfig(agentConfig, userConfig);
}

function appendTail(buffer, chunk, limit = 8 * 1024) {
  const next = `${buffer}${chunk}`;
  return next.length > limit ? next.slice(-limit) : next;
}

function compactErrorDetails(error) {
  return redactOutput(error?.message || String(error || 'Unknown error'), 2 * 1024).replace(/\r?\n/g, ' ');
}

function recordBusState(root, agentId, state, details) {
  const result = spawnSync(process.execPath, [
    busToolPath,
    'state',
    '--root', root,
    '--agent', agentId,
    '--state', state,
    '--details', `${details || ''}`.slice(0, 4 * 1024),
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error((result.stderr || result.stdout || result.error?.message || `Failed to set ${agentId} state to ${state}`).trim());
  }
  return result.stdout.trim();
}

function writeLaunchErrorArtifact(root, {
  agentId,
  agentConfig,
  resolution,
  userConfigFile,
  stage,
  code,
  error,
  result,
  details,
}) {
  const busPath = join(root, '.agent-bus');
  const logsDirectory = join(busPath, 'logs');
  assertSafePath(root, logsDirectory);
  mkdirSync(logsDirectory, { recursive: true });
  assertSafePath(root, logsDirectory);
  const timestampValue = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = join(logsDirectory, `${timestampValue}-${agentId}-ERROR.json`);
  assertContained(logsDirectory, artifactPath);
  const artifact = {
    agent: agentId,
    adapter: agentConfig.adapter,
    command: resolution?.command || agentConfig.command || '',
    commandSource: resolution?.commandSource || null,
    resolvedCommand: result?.resolvedCommand || null,
    stage,
    code,
    exitCode: result?.status ?? null,
    signal: result?.signal ?? null,
    timestamp: new Date().toISOString(),
    details: redactOutput(details || error?.message || '', 2 * 1024),
    configPath: userConfigFile,
    stdoutTail: redactOutput(result?.stdoutTail || result?.stdout || '', 8 * 1024),
    stderrTail: redactOutput(result?.stderrTail || result?.stderr || '', 8 * 1024),
  };
  atomicWrite(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, join(busPath, 'tmp'));
  return { path: artifactPath, artifact };
}

function launchFailure({ message, code, stage, details, result, resolution, agentConfig }) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  error.details = details;
  error.result = result;
  error.resolution = resolution;
  error.agentConfig = agentConfig;
  return error;
}

function suggestedCommand(agentId, language) {
  if (agentId === 'antigravity') return 'agy-proxy';
  return language === 'zh' ? '<可用的可执行文件>' : '<working-executable>';
}

function launchFailureReport(error, {
  agentId,
  agentConfig,
  resolution,
  userConfigFile,
  artifactPath,
  language,
  t,
}) {
  const lines = [
    error.code === 'COMMAND_NOT_FOUND' || error.stage === 'executable' ? t.implementerUnavailable : t.implementerFailed,
    '',
    `${t.launchAgentLabel} ${agentId}`,
    `${t.launchAdapterLabel} ${agentConfig.adapter}`,
    `${t.launchCommandLabel} ${resolution?.command || agentConfig.command || '(none)'}`,
    `${t.launchErrorLabel} ${error.code || 'LAUNCH_FAILED'}`,
  ];
  if (error.result?.status !== undefined && error.result?.status !== null) lines.push(`${t.launchExitCodeLabel} ${error.result.status}`);
  if (error.details || error.message) lines.push(`${t.launchDetailsLabel} ${redactOutput(error.details || error.message, 2 * 1024)}`);
  if (userConfigFile) lines.push(`${t.launchConfigLabel} ${userConfigFile}`);
  if (artifactPath) lines.push(`${t.launchArtifactLabel} ${artifactPath}`);
  lines.push('', t.launchSuggestedFix, `  ${format(t.commandRepair, { agent: agentId }).replace('<working-executable>', suggestedCommand(agentId, language)).replace('<可用的可执行文件>', suggestedCommand(agentId, language))}`);
  if (resolution?.commandSource === 'project') lines.push(`  ${t.launchProjectConfigNote}`);
  if (error.result?.stdoutTail) lines.push('', `${t.launchStdoutLabel}\n${redactOutput(error.result.stdoutTail)}`);
  if (error.result?.stderrTail) lines.push('', `${t.launchStderrLabel}\n${redactOutput(error.result.stderrTail)}`);
  return lines.join('\n');
}

function targetRepairCommand(action, target, options) {
  const isCodex = target.name === 'Codex';
  const targetFlag = isCodex ? '--codex' : '--antigravity';
  const homeFlag = isCodex ? '--codex-home-base64' : '--antigravity-home-base64';
  const home = isCodex ? options.codexHome : options.antigravityHome;
  let result = `npx --yes ${packageJson.name}@${packageJson.version} ${action} ${targetFlag} ${homeFlag} ${Buffer.from(home, 'utf8').toString('base64url')}`;
  if (options.language) result += ` --lang ${options.language}`;
  return result;
}

function assertGitRepository(root, t) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(format(t.notGitRepo, { path: root }));
  return resolve(result.stdout.trim());
}

function assertSafePath(root, path, t, expectDirectory = true) {
  if (!existsSync(path)) return;
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || (expectDirectory ? !entry.isDirectory() : !entry.isFile()) || (!expectDirectory && entry.nlink !== 1)) {
    throw new Error(format(t.unsafeBusPath, { path }));
  }
  const rootReal = realpathSync(root);
  const pathReal = realpathSync(path);
  const rel = relative(rootReal, pathReal);
  const resolvedAgain = resolve(rootReal, rel);
  const same = process.platform === 'win32'
    ? resolvedAgain.toLowerCase() === pathReal.toLowerCase()
    : resolvedAgain === pathReal;
  if (rel === '..' || rel.startsWith(`..${sep}`) || !same) {
    throw new Error(format(t.unsafeBusPath, { path }));
  }
}

function publishNewFile(path, content) {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    linkSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function taskGuidance(template, language) {
  const guidance = {
    en: {
      bug: 'Bug fix template: reproduce first; record expected vs actual behavior; identify root cause; make the smallest safe fix; add a regression test; verify related behavior.',
      feature: 'Feature template: clarify user value, observable behavior, UX/API, edge cases, compatibility, acceptance criteria, and validation before implementation.',
      refactor: 'Refactor template: define invariants and non-goals; capture a green baseline; preserve observable behavior; change incrementally; compare tests/build before and after.',
    },
    zh: {
      bug: 'Bug 修复模板：先复现；记录预期与实际行为；定位根因；采用最小安全修复；添加回归测试；验证关联行为。',
      feature: '功能开发模板：实施前澄清用户价值、可观察行为、UX/API、边界情况、兼容性、验收标准和验证方式。',
      refactor: '重构模板：定义不变量和非目标；记录全绿基线；保持可观察行为不变；增量修改；对比修改前后的测试与构建。',
    },
  };
  return guidance[language][template];
}

function buildAgentPrompt({ agentId, roles, options, language, planner, implementer, reviewer }) {
  const task = options.task.trim() || (language === 'zh' ? '先询问我本轮的具体需求。' : 'Ask me for the concrete task for this round.');
  const isDefaultCodex = agentId === 'codex' &&
    roles.length === 2 && roles.includes('planner') && roles.includes('reviewer') && !roles.includes('implementer') &&
    planner === 'codex' && reviewer === 'codex';
  const isDefaultAgy = agentId === 'antigravity' &&
    roles.length === 1 && roles.includes('implementer') && !roles.includes('planner') && !roles.includes('reviewer') &&
    implementer === 'antigravity';

  if (language === 'zh') {
    if (isDefaultCodex) {
      return `调用 $coordinate-agents 并以 Codex 角色恢复当前仓库的协作。你只负责需求澄清、规格、验收标准、提交与证据审查及发布门禁，不修改产品代码。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (isDefaultAgy) {
      return '调用 $coordinate-agents 并以 Antigravity 角色恢复当前仓库的协作。立即等待 Codex；你是唯一的产品代码修改者，负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE；等待 review；不得发布。';
    }
    if (roles.includes('planner') && roles.includes('implementer') && roles.includes('reviewer')) {
      return `调用 $coordinate-agents 并作为规划、实现与审查者（${agentId}）恢复当前仓库的协作。按规格实现、验证、提交并进行审查；未获明确授权不得发布。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (roles.includes('implementer') && roles.includes('reviewer')) {
      return `调用 $coordinate-agents 并作为实现与审查者（${agentId}）恢复当前仓库的协作。负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE，同时负责审查；未获明确授权不得发布。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (roles.includes('planner') && roles.includes('implementer')) {
      return `调用 $coordinate-agents 并作为规划与实现者（${agentId}）恢复当前仓库的协作。按规格实现、验证、提交并进行审查；未获明确授权不得发布。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (roles.includes('planner') || roles.includes('reviewer')) {
      const label = roles.includes('planner') && roles.includes('reviewer') ? '规划与审查者' : (roles.includes('planner') ? '规划者' : '审查者');
      return `调用 $coordinate-agents 并作为${label}（${agentId}）恢复当前仓库的协作。你负责需求澄清、规格编写、提交/证据审查与发布门禁，不修改产品代码。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    return `调用 $coordinate-agents 并作为实现者（${agentId}）恢复当前仓库的协作。立即等待任务指令；你是唯一的产品代码修改者，负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE；等待审查；不得发布。`;
  }

  // English
  if (isDefaultCodex) {
    return `Use $coordinate-agents as Codex and resume collaboration in this repository. Own only clarification, specification, acceptance criteria, commit/evidence review, and the release gate; do not edit product code. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (isDefaultAgy) {
    return 'Use $coordinate-agents as Antigravity and resume collaboration in this repository. Wait for Codex now; be the sole product-code writer; implement, validate, commit, and send IMPLEMENTATION_DONE with evidence; wait for review; never release.';
  }
  if (roles.includes('planner') && roles.includes('implementer') && roles.includes('reviewer')) {
    return `Use $coordinate-agents as planner, implementer, and reviewer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, and review according to specifications; never release without explicit approval. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (roles.includes('implementer') && roles.includes('reviewer')) {
    return `Use $coordinate-agents as implementer and reviewer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, send IMPLEMENTATION_DONE with evidence, and perform reviews; never release without explicit approval. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (roles.includes('planner') && roles.includes('implementer')) {
    return `Use $coordinate-agents as planner and implementer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, and review according to specifications; never release without explicit approval. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (roles.includes('planner') || roles.includes('reviewer')) {
    const label = roles.includes('planner') && roles.includes('reviewer') ? 'planner and reviewer' : (roles.includes('planner') ? 'planner' : 'reviewer');
    return `Use $coordinate-agents as ${label} (${agentId}) and resume collaboration in this repository. Own clarification, specification, acceptance criteria, commit/evidence review, and the release gate; do not edit product code. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  return `Use $coordinate-agents as implementer (${agentId}) and resume collaboration in this repository. Wait for instructions; be the sole product-code writer; implement, validate, commit, and send IMPLEMENTATION_DONE with evidence; wait for review; never release.`;
}

function quickstart(options, t, language) {
  if (!templateNames.has(options.template)) throw new Error(format(t.badTemplate, { template: options.template }));
  const root = assertGitRepository(options.root, t);
  const busPath = join(root, '.agent-bus');
  assertSafePath(root, busPath, t);
  const busTool = busToolPath;
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', root], { encoding: 'utf8', windowsHide: true });
  if (init.error || init.status !== 0) throw new Error(`${init.stderr || init.error?.message || 'agent-bus init failed'}`.trim());

  assertSafePath(root, busPath, t);
  const launchDir = join(busPath, 'launch');
  assertSafePath(root, launchDir, t);
  mkdirSync(launchDir, { recursive: true });
  assertSafePath(root, launchDir, t);

  const busConfig = readConfig(busPath);
  const registeredIds = new Set(busConfig.agents.map(a => a.id));

  const planner = options.planner || busConfig.workflow?.planner || 'codex';
  const implementer = options.implementer || busConfig.workflow?.implementer || 'antigravity';
  const reviewer = options.reviewer || busConfig.workflow?.reviewer || (planner === 'codex' ? 'codex' : planner);

  validateAgentId(planner);
  validateAgentId(implementer);
  validateAgentId(reviewer);

  if (!registeredIds.has(planner)) {
    throw new Error(format(t.badAgent, { agent: planner }));
  }
  if (!registeredIds.has(implementer)) {
    throw new Error(format(t.badAgent, { agent: implementer }));
  }
  if (!registeredIds.has(reviewer)) {
    throw new Error(format(t.badAgent, { agent: reviewer }));
  }

  const agentRolesMap = new Map();
  for (const [role, id] of Object.entries({ planner, implementer, reviewer })) {
    if (!agentRolesMap.has(id)) agentRolesMap.set(id, new Set());
    agentRolesMap.get(id).add(role);
  }

  const promptEntries = [];
  for (const [agentId, rolesSet] of agentRolesMap.entries()) {
    const promptText = buildAgentPrompt({
      agentId,
      roles: [...rolesSet],
      options,
      language,
      planner,
      implementer,
      reviewer,
    });
    const promptPath = join(launchDir, `${agentId}.txt`);
    assertContained(launchDir, promptPath);
    assertSafePath(launchDir, promptPath, t, false);
    promptEntries.push({ agentId, promptPath, promptText });
  }

  if (promptEntries.some(e => existsSync(e.promptPath))) {
    throw new Error(format(t.launchExists, { path: launchDir }));
  }

  const created = [];
  try {
    for (const entry of promptEntries) {
      publishNewFile(entry.promptPath, `${entry.promptText}\n`);
      created.push(entry.promptPath);
    }
  } catch (error) {
    for (const path of created) removePath(path);
    throw error;
  }

  try {
    withConfigTransaction(busPath, (cfg) => {
      cfg.workflow = { planner, implementer, reviewer };
      return cfg;
    });
  } catch (cfgError) {
    for (const path of created) removePath(path);
    throw cfgError;
  }

  const base = { root, language: language === 'zh' ? 'zh-CN' : 'en' };
  console.log(format(t.quickstartReady, { root }));
  console.log(format(t.promptsWritten, { path: launchDir }));

  if (planner === 'codex' && implementer === 'antigravity' && reviewer === 'codex') {
    console.log(`\n${t.codexCommand}\n${packageCommand('launch', { ...base, agent: 'codex' })}`);
    console.log(`\n${t.antigravityCommand}\n${packageCommand('launch', { ...base, agent: 'antigravity' })}`);
  } else {
    for (const [agentId, rolesSet] of agentRolesMap.entries()) {
      const rolesLabel = [...rolesSet].join(', ');
      console.log(`\n${format(t.plannerCommand, { agent: agentId, roles: rolesLabel })}\n${packageCommand('launch', { ...base, agent: agentId })}`);
    }
  }
}

function runLaunchChild(resolved, root, setActiveChild) {
  return new Promise((resolvePromise, reject) => {
    let stdoutTail = '';
    let stderrTail = '';
    let settled = false;
    const captureOutput = !(process.stdout.isTTY || process.stderr.isTTY);
    const child = spawn(resolved.command, [...resolved.prefix, ...resolved.args], {
      cwd: root,
      // Preserve a real terminal for interactive CLIs. Non-TTY launches (the
      // usual scripted/Codex path) are piped so the runtime can retain bounded
      // diagnostic tails without storing the complete session.
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      windowsHide: false,
    });
    setActiveChild(child);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      setActiveChild(null);
      callback(value);
    };
    child.stdout?.on('data', chunk => {
      const text = `${chunk}`;
      stdoutTail = appendTail(stdoutTail, text);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      const text = `${chunk}`;
      stderrTail = appendTail(stderrTail, text);
      process.stderr.write(chunk);
    });
    child.once('error', error => finish(reject, {
      error,
      stdoutTail,
      stderrTail,
      resolvedCommand: resolved.resolvedCommand || resolved.command,
    }));
    child.once('exit', (status, signal) => {
      finish(resolvePromise, {
        status,
        signal,
        stdoutTail,
        stderrTail,
        resolvedCommand: resolved.resolvedCommand || resolved.command,
      });
    });
  });
}

async function launchAgent(options, t) {
  const agentId = options.agent;
  if (!agentId) throw new Error(format(t.badAgent, { agent: '' }));
  validateAgentId(agentId);

  const root = assertGitRepository(options.root, t);
  const busPath = join(root, '.agent-bus');
  assertSafePath(root, busPath, t);
  const launchDir = join(busPath, 'launch');
  assertSafePath(root, launchDir, t);

  const promptPath = join(launchDir, `${agentId}.txt`);
  assertContained(launchDir, promptPath);
  if (!existsSync(promptPath)) {
    throw new Error(format(t.launchMissing, { command: packageCommand('quickstart', { root, language: options.language }) }));
  }
  assertSafePath(launchDir, promptPath, t, false);
  const prompt = readFileSync(promptPath, 'utf8').trim();

  const busConfig = readConfig(busPath);
  const projectAgentConfig = busConfig.agents.find(a => a.id === agentId);
  if (!projectAgentConfig) {
    throw new Error(format(t.badAgent, { agent: agentId }));
  }

  const userConfigFile = userConfigPath();
  let resolution = null;
  let agentConfig = projectAgentConfig;
  let adapter = null;
  try {
    const userConfig = readUserConfig();
    resolution = runtimeAgentConfig(projectAgentConfig, userConfig);
    agentConfig = resolution;
    adapter = getAdapter(resolution.adapter, resolution);
  } catch (error) {
    const failure = launchFailure({
      message: compactErrorDetails(error),
      code: 'CONFIG_RESOLUTION_FAILED',
      stage: 'resolve',
      details: compactErrorDetails(error),
      resolution,
      agentConfig,
    });
    try {
      recordBusState(root, agentId, 'ERROR', JSON.stringify({ code: failure.code, details: failure.details }));
    } catch { /* Preserve the primary configuration error. */ }
    throw new Error(launchFailureReport(failure, {
      agentId, agentConfig, resolution, userConfigFile, language: detectLanguage(options.language), t,
    }));
  }

  const policy = adapter.launchPolicy();
  if (!policy || !['one-shot', 'bus-supervised'].includes(policy.mode)) {
    throw new Error(`Adapter "${agentConfig.adapter}" returned an invalid launch policy.`);
  }
  const supervised = policy.mode === 'bus-supervised' && !options.once;
  const controller = new AbortController();
  let activeChild = null;
  let interruptedSignal = null;
  const setActiveChild = child => { activeChild = child; };
  const interrupt = signal => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    controller.abort(new Error(`Launch interrupted by ${signal}.`));
    if (activeChild && !activeChild.killed) {
      try { activeChild.kill(signal); } catch {
        try { activeChild.kill(); } catch { /* child already unavailable */ }
      }
    }
  };
  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    if (supervised) {
      const initialObservation = observeAgentBus(busPath, agentId);
      if (initialObservation.stopped) return;
      if (initialObservation.failed) {
        // A new launch invocation is an explicit user retry, not an
        // automatic supervisor retry. Clear the prior terminal marker before
        // checking the environment again.
        recordBusState(root, agentId, 'IDLE', 'Explicit launch retry after a prior ERROR state.');
      }
    }

    // Launch preflight checks the final executable only. It deliberately does
    // not run a vendor-specific auth/model probe or a version command; a CLI
    // that starts but fails during conversation must reach the runtime
    // fail-fast path below.
    const detection = adapter.detect({ version: false });
    if (!detection.available) {
      throw launchFailure({
        message: detection.details || `Command '${resolution.command || ''}' is unavailable.`,
        code: detection.code || 'COMMAND_NOT_FOUND',
        stage: 'executable',
        details: detection.details || 'Executable check failed.',
        result: detection,
        resolution,
        agentConfig,
      });
    }

    let activation = 0;
    while (true) {
      const activationPrompt = activation === 0
        ? prompt
        : adapter.resumePrompt({ agentId, root, activation });
      const resolved = adapter.resolveLaunch({
        root,
        prompt: activationPrompt,
        agent: agentId,
        language: options.language,
        activation,
      });
      let result;
      try {
        result = await runLaunchChild(resolved, root, setActiveChild);
      } catch (spawnResult) {
        const spawnError = spawnResult?.error || spawnResult;
        throw launchFailure({
          message: compactErrorDetails(spawnError),
          code: spawnError?.code === 'ENOENT' ? 'COMMAND_NOT_FOUND' : 'SPAWN_FAILED',
          stage: 'spawn',
          details: compactErrorDetails(spawnError),
          result: {
            ...spawnResult,
            resolvedCommand: resolved.resolvedCommand || resolved.command,
          },
          resolution,
          agentConfig,
        });
      }
      if (interruptedSignal) {
        process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143;
        return;
      }
      if (result.status !== 0) {
        const status = result.status ?? result.signal ?? 'unknown';
        throw launchFailure({
          message: format(t.launchFailed, { agent: agentId, status }),
          code: 'PROCESS_EXIT_NON_ZERO',
          stage: 'runtime',
          details: format(t.launchFailed, { agent: agentId, status }),
          result,
          resolution,
          agentConfig,
        });
      }
      if (!supervised) return;

      const observation = observeAgentBus(busPath, agentId);
      if (observation.stopped) return;
      if (observation.failed) {
        throw launchFailure({
          message: 'Implementer reported ERROR state.',
          code: 'AGENT_STATE_ERROR',
          stage: 'runtime',
          details: 'Implementer reported ERROR after a clean process exit.',
          result,
          resolution,
          agentConfig,
        });
      }
      if (!observation.hasWork) {
        await waitForAgentActivity(busPath, agentId, {
          pollIntervalMs: policy.pollIntervalMs || 500,
          signal: controller.signal,
        });
      }
      const nextObservation = observeAgentBus(busPath, agentId);
      if (nextObservation.stopped) return;
      if (nextObservation.failed) {
        throw launchFailure({
          message: 'Implementer reported ERROR state.',
          code: 'AGENT_STATE_ERROR',
          stage: 'runtime',
          details: 'Implementer reported ERROR while supervision was waiting.',
          resolution,
          agentConfig,
        });
      }
      activation += 1;
    }
  } catch (error) {
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143;
      return;
    }
    const failure = error.code ? error : launchFailure({
      message: compactErrorDetails(error),
      code: 'LAUNCH_FAILED',
      stage: 'runtime',
      details: compactErrorDetails(error),
      resolution,
      agentConfig,
    });
    let artifactPath = null;
    try {
      const artifact = writeLaunchErrorArtifact(root, {
        agentId,
        agentConfig,
        resolution,
        userConfigFile,
        stage: failure.stage || 'runtime',
        code: failure.code || 'LAUNCH_FAILED',
        error: failure,
        result: failure.result,
        details: failure.details || failure.message,
      });
      artifactPath = artifact.path;
      try {
        recordBusState(root, agentId, 'ERROR', JSON.stringify({
          code: failure.code || 'LAUNCH_FAILED',
          stage: failure.stage || 'runtime',
          details: compactErrorDetails(failure.details || failure.message),
          artifact: artifact.path,
        }));
      } catch (stateError) {
        failure.stateError = compactErrorDetails(stateError);
      }
    } catch (artifactError) {
      failure.artifactError = compactErrorDetails(artifactError);
      try {
        recordBusState(root, agentId, 'ERROR', JSON.stringify({
          code: failure.code || 'LAUNCH_FAILED',
          stage: failure.stage || 'runtime',
          details: compactErrorDetails(failure.details || failure.message),
        }));
      } catch { /* Preserve the original launch failure. */ }
    }
    throw new Error(launchFailureReport(failure, {
      agentId,
      agentConfig,
      resolution,
      userConfigFile,
      artifactPath,
      language: detectLanguage(options.language),
      t,
    }));
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

function handleAgentCommand(options, t) {
  const root = assertGitRepository(options.root, t);
  const busTool = busToolPath;
  if (options.subcommand === 'add') {
    const agentId = options.targetAgent || options.agent;
    if (!agentId) throw new Error('--agent <id> is required for agent add.');
    const args = ['agent-add', '--root', root, '--agent', agentId, '--adapter', options.adapter || 'generic-cli'];
    if (options.agentCommand) args.push('--command', options.agentCommand);
    if (options.agentArgs) args.push('--args', options.agentArgs);
    const result = spawnSync(process.execPath, [busTool, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'agent add failed').trim());
    console.log(result.stdout.trim());
    return;
  }
  if (options.subcommand === 'list') {
    const result = spawnSync(process.execPath, [busTool, 'agent-list', '--root', root], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'agent list failed').trim());
    console.log(result.stdout.trim());
    return;
  }
  if (options.subcommand === 'doctor') {
    const busPath = join(root, '.agent-bus');
    if (!existsSync(busPath)) {
      console.log('No .agent-bus found. Run quickstart or agent-bus init first.');
      return;
    }
    const busConfig = readConfig(busPath);
    const userConfig = readUserConfig();
    console.log(`Checking ${busConfig.agents.length} registered agents:`);
    let allHealthy = true;
    for (const agent of busConfig.agents) {
      try {
        const resolvedAgent = runtimeAgentConfig(agent, userConfig);
        const adapter = getAdapter(resolvedAgent.adapter, resolvedAgent);
        const detection = adapter.detect();
        if (detection.available) {
          console.log(`  ${agent.id} (${agent.adapter}): healthy (${detection.version || 'available'})`);
          console.log(`    Command: ${resolvedAgent.command || '(none)'}`);
          console.log(`    Executable: ✓ available${detection.resolvedCommand ? ` (${detection.resolvedCommand})` : ''}`);
          console.log(`    Version: ${detection.version || 'available'}`);
        } else {
          allHealthy = false;
          console.error(`  ${agent.id} (${agent.adapter}): missing or unavailable (${detection.code || 'UNKNOWN'}: ${detection.details || 'unknown'})`);
          console.error(`    Command: ${resolvedAgent.command || '(none)'}`);
          console.error(`    Executable: ✗ unavailable`);
          if (resolvedAgent.commandSource === 'user') console.error(`    Configured at: ${userConfigPath()}`);
        }
      } catch (err) {
        allHealthy = false;
        console.error(`  ${agent.id} (${agent.adapter}): error (${err.message})`);
      }
    }
    if (!allHealthy) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown agent subcommand: ${options.subcommand}. Use add, list, or doctor.`);
}

async function run(argv) {
  let options;
  let language = detectLanguage(null);
  try {
    options = parseArgs(argv);
    language = detectLanguage(options.language);
  } catch (error) {
    const raw = String(error.message || error);
    const t = messages[language];
    if (raw.startsWith('MISSING_VALUE:')) console.error(format(t.missingValue, { option: raw.split(':')[1] }));
    else if (raw.startsWith('BAD_LANGUAGE:')) console.error(format(t.badLanguage, { language: raw.split(':')[1] }));
    else console.error(raw.replace('UNKNOWN_OPTION:', 'Unknown option: '));
    process.exitCode = 2;
    return;
  }

  const t = messages[language];
  if (options.version) {
    console.log(packageJson.version);
    return;
  }
  if (options.help || options.command === 'help') {
    console.log(t.usage);
    return;
  }

  if (options.command === 'config') {
    try {
      handleConfigCommand(options, t);
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  const expectedManifest = payloadManifest();
  const selectedTargets = targets(options);

  if (options.command === 'agent') {
    try {
      handleAgentCommand(options, t);
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'quickstart' || options.command === 'launch') {
    try {
      if (options.command === 'quickstart') quickstart(options, t, language);
      else await launchAgent(options, t);
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'install' || options.command === 'update') {
    try {
      for (const target of selectedTargets) installTarget(target, expectedManifest, options, t);
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'doctor') {
    let healthy = true;
    let found = false;
    const repairs = repairCommands();
    let userConfig = defaultUserConfig();
    let projectConfig = null;
    try {
      userConfig = readUserConfig();
      projectConfig = projectConfigForRoot(resolve(options.root));
    } catch (error) {
      healthy = false;
      console.error(error.message || String(error));
    }
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor >= 18) console.log(format(t.componentHealthy, { component: 'Node.js', version: process.version }));
    else {
      healthy = false;
      console.error(format(t.componentMissing, { component: 'Node.js 18+' }));
      console.error(format(t.repair, { command: repairs.node }));
    }
    for (const component of [
      { id: null, name: 'Git', command: 'git', repair: repairs.git, required: true },
      { id: 'codex', name: 'Codex CLI', adapter: 'codex-cli', command: 'codex', repair: repairs.codex, required: options.codex },
      { id: 'antigravity', name: 'Antigravity CLI', adapter: 'antigravity-cli', command: 'agy', repair: repairs.antigravity, required: options.antigravity },
    ]) {
      const projectAgent = component.id && projectConfig?.agents?.find(agent => agent.id === component.id);
      const resolved = component.id
        ? runtimeAgentConfig(projectAgent || { id: component.id, adapter: component.adapter }, userConfig)
        : { command: component.command, commandSource: 'adapter-default' };
      const command = resolved.command || component.command;
      const displayName = component.id === 'antigravity'
        ? `${component.name} (${command || component.command})`
        : component.name;
      let detection = null;
      let version = null;
      if (component.id && resolved.commandSource !== 'adapter-default') {
        try {
          detection = getAdapter(resolved.adapter, resolved).detect();
        } catch (error) {
          detection = { available: false, code: 'DETECTION_FAILED', details: error.message || String(error) };
        }
        version = detection.available ? detection.version : null;
      } else {
        version = executableVersion(command);
      }
      if (version) {
        console.log(format(t.componentHealthy, { component: displayName, version }));
        if (component.id) {
          console.log(`  Command: ${command || '(none)'}`);
          console.log('  Executable: ✓ available');
          console.log(`  Version: ${version}`);
          if (resolved.commandSource === 'user') console.log(`  Configured at: ${userConfigPath()}`);
        }
      }
      else {
        if (component.required) healthy = false;
        console.error(format(t.componentMissing, { component: displayName }));
        if (component.id) {
          console.error(`  Command: ${command || '(none)'}`);
          console.error(`  Executable: ✗ ${detection?.code || 'not found'}`);
          if (resolved.commandSource === 'user') console.error(`  Configured at: ${userConfigPath()}`);
          const fix = resolved.commandSource === 'adapter-default'
            ? component.repair
            : `coordinate-agents config set agent.${component.id}.command ${suggestedCommand(component.id, language)}`;
          console.error(format(t.repair, { command: fix }));
        } else {
          console.error(format(t.repair, { command: component.repair }));
        }
      }
    }
    for (const target of selectedTargets) {
      const result = verifyTarget(target.path, expectedManifest);
      if (result.missing) {
        healthy = false;
        console.error(format(t.missing, { target: target.name, path: target.path }));
        console.error(format(t.repair, { command: targetRepairCommand('install', target, options) }));
      } else {
        found = true;
        if (result.ok) {
          console.log(format(t.healthy, { target: target.name, version: result.version, path: target.path }));
        } else {
          healthy = false;
          console.error(format(t.invalid, { target: target.name, details: result.details, path: target.path }));
          const command = targetRepairCommand(result.managed ? 'update' : 'install', target, options);
          console.error(format(result.managed ? t.repair : t.manualRepair, { command }));
        }
      }
    }
    if (!found) console.error(t.noInstall);
    console.log(healthy ? t.summaryOk : t.summaryFail);
    if (!healthy) process.exitCode = 1;
    return;
  }

  if (options.command === 'uninstall') {
    for (const target of selectedTargets) {
      if (existsSync(target.path)) {
        if (!isIntactManagedInstallation(target.path, expectedManifest) && !options.force) {
          console.error(format(t.skipRemove, { target: target.name, path: target.path }));
          process.exitCode = 1;
          continue;
        }
        removePath(target.path);
        console.log(format(t.removed, { target: target.name, path: target.path }));
      }
    }
    return;
  }

  console.error(format(t.unknownCommand, { command: options.command }));
  console.error(t.usage);
  process.exitCode = 2;
}

await run(process.argv.slice(2));
