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
import { getAdapter } from '../adapters/index.mjs';
import { observeAgentBus, waitForAgentActivity } from '../scripts/agent-observer.mjs';
import {
  assertContained,
  assertSafePath as assertSafePathUtil,
  readConfig,
  validateAgentId,
  validateConfig,
  withConfigTransaction,
  writeConfig,
} from '../scripts/config.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const skillName = 'coordinate-cli-agents';
const payloadEntries = ['SKILL.md', 'adapters', 'agents', 'references', 'scripts'];
const metadataFile = '.coordinate-cli-agents.json';
const templateNames = new Set(['bug', 'feature', 'refactor']);

const messages = {
  en: {
    usage: `coordinate-cli-agents <command> [options]

Commands:
  install       Install the skill (default: Codex and Antigravity)
  update        Reinstall the packaged version and back up the old copy
  quickstart    Initialize a project and print two copyable launch commands
  launch        Start one CLI with its generated collaboration prompt
  agent         Manage registered agents (add, list, doctor)
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
  --role <role>           (Alias for --agent) Launch role: codex or antigravity
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
  npx @hogancv/coordinate-cli-agents install
  npx @hogancv/coordinate-cli-agents quickstart --template feature --task "Build a Todo app"
  npx @hogancv/coordinate-cli-agents agent add claude --adapter generic-cli --command claude
  npx @hogancv/coordinate-cli-agents doctor`,
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
    plannerCommand: '1. {agent} ({role}) terminal (copy and run):',
    implementerCommand: '2. {agent} ({role}) terminal (copy and run):',
    launchMissing: 'Generated prompt is missing. Run quickstart first: {command}',
    launchExists: 'Launch prompts already exist at {path}. Use the previously generated launch commands; continue new tasks in Codex.',
    unsafeBusPath: 'Refusing unsafe agent-bus path (symlink, junction, or outside repository): {path}',
    notGitRepo: 'Not a Git repository: {path}',
    badTemplate: 'Unsupported template: {template}. Use bug, feature, or refactor.',
    badRole: 'Unsupported role: {role}. Use codex or antigravity.',
    badAgent: 'Unknown agent "{agent}". Ensure the agent is registered in .agent-bus/config.json.',
    launchFailed: '{role} exited with status {status}.',
    unknownCommand: 'Unknown command: {command}',
    missingValue: 'Missing value for {option}',
    badLanguage: 'Unsupported language: {language}',
  },
  zh: {
    usage: `coordinate-cli-agents <命令> [选项]

命令：
  install       安装技能（默认同时安装 Codex 和 Antigravity）
  update        备份旧副本并重新安装当前包版本
  quickstart    初始化项目并生成两条可复制的启动命令
  launch        使用已生成的协作提示词启动一个 CLI
  agent         管理注册的 Agent（add, list, doctor）
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
  --role <角色>           （--agent 的别名）启动角色：codex 或 antigravity
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
  npx @hogancv/coordinate-cli-agents install
  npx @hogancv/coordinate-cli-agents quickstart --template feature --task "开发 Todo 应用"
  npx @hogancv/coordinate-cli-agents agent add claude --adapter generic-cli --command claude
  npx @hogancv/coordinate-cli-agents doctor --lang zh-CN`,
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
    plannerCommand: '1. {agent}（{role}）终端（复制并运行）：',
    implementerCommand: '2. {agent}（{role}）终端（复制并运行）：',
    launchMissing: '找不到生成的提示词。请先运行 quickstart：{command}',
    launchExists: '启动提示词已存在：{path}。请使用之前生成的启动命令；后续新任务直接在 Codex 中继续。',
    unsafeBusPath: '拒绝使用不安全的 agent-bus 路径（符号链接、目录联接或仓库外路径）：{path}',
    notGitRepo: '不是 Git 仓库：{path}',
    badTemplate: '不支持的任务模板：{template}。请使用 bug、feature 或 refactor。',
    badRole: '不支持的角色：{role}。请使用 codex 或 antigravity。',
    badAgent: '未知 Agent "{agent}"。请确保该 Agent 已在 .agent-bus/config.json 中注册。',
    launchFailed: '{role} 退出，状态码 {status}。',
    unknownCommand: '未知命令：{command}',
    missingValue: '选项缺少参数：{option}',
    badLanguage: '不支持的语言：{language}',
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
    role: null,
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
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) {
    result.command = args.shift();
    if (result.command === 'agent' && args[0] && !args[0].startsWith('-')) {
      result.subcommand = args.shift();
      if (args[0] && !args[0].startsWith('-')) {
        result.targetAgent = args.shift();
      }
    }
  }
  while (args.length) {
    const option = args.shift();
    if (option === '--codex') result.codex = true;
    else if (option === '--antigravity') result.antigravity = true;
    else if (option === '--force') result.force = true;
    else if (option === '--once') result.once = true;
    else if (option === '--help' || option === '-h') result.help = true;
    else if (option === '--version') result.version = true;
    else if ([
      '--codex-home', '--antigravity-home', '--codex-home-base64', '--antigravity-home-base64',
      '--root', '--root-base64', '--role', '--agent', '--planner', '--implementer', '--reviewer',
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
      if (option === '--role') {
        const val = value.toLowerCase();
        result.role = val;
      }
      if (option === '--agent') {
        const val = value.toLowerCase();
        result.agent = val;
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
  if (result.agent && result.role && result.agent !== result.role) {
    throw new Error(`Conflicting options: --agent "${result.agent}" and --role "${result.role}" must match.`);
  }
  if (!result.codex && !result.antigravity) {
    result.codex = true;
    result.antigravity = true;
  }
  if (result.rootBase64) result.root = resolve(Buffer.from(result.rootBase64, 'base64url').toString('utf8'));
  if (result.codexHomeBase64) result.codexHome = resolve(Buffer.from(result.codexHomeBase64, 'base64url').toString('utf8'));
  if (result.antigravityHomeBase64) result.antigravityHome = resolve(Buffer.from(result.antigravityHomeBase64, 'base64url').toString('utf8'));
  if (!result.agent && result.role) result.agent = result.role;
  if (!result.role && result.agent) result.role = result.agent;
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

function payloadManifest(root = packageRoot) {
  const manifest = {};
  for (const entry of payloadEntries) {
    const source = join(root, entry);
    if (!existsSync(source)) throw new Error(`Package payload is missing: ${entry}`);
    if (statSync(source).isDirectory()) {
      for (const file of walkFiles(root, source)) manifest[file] = hashFile(join(root, file));
    } else {
      manifest[entry] = hashFile(source);
    }
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
  const path = join(targetPath, metadataFile);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
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
  const sourceResolved = resolve(packageRoot);
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
    for (const entry of payloadEntries) {
      cpSync(join(packageRoot, entry), join(staging, entry), { recursive: true });
    }
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
  if (options.role) result += ` --role ${options.role}`;
  else if (options.agent) result += ` --agent ${options.agent}`;
  if (options.root) result += ` --root-base64 ${Buffer.from(options.root, 'utf8').toString('base64url')}`;
  if (options.language) result += ` --lang ${options.language === 'zh' ? 'zh-CN' : options.language}`;
  return result;
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
      return `调用 $coordinate-cli-agents 并以 Codex 角色恢复当前仓库的协作。你只负责需求澄清、规格、验收标准、提交与证据审查及发布门禁，不修改产品代码。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (isDefaultAgy) {
      return '调用 $coordinate-cli-agents 并以 Antigravity 角色恢复当前仓库的协作。立即等待 Codex；你是唯一的产品代码修改者，负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE；等待 review；不得发布。';
    }
    if (roles.includes('planner') && roles.includes('implementer') && roles.includes('reviewer')) {
      return `调用 $coordinate-cli-agents 并作为规划、实现与审查者（${agentId}）恢复当前仓库的协作。按规格实现、验证、提交并进行审查；未获明确授权不得发布。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (roles.includes('implementer') && roles.includes('reviewer')) {
      return `调用 $coordinate-cli-agents 并作为实现与审查者（${agentId}）恢复当前仓库的协作。负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE，同时负责审查；未获明确授权不得发布。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (roles.includes('planner') && roles.includes('implementer')) {
      return `调用 $coordinate-cli-agents 并作为规划与实现者（${agentId}）恢复当前仓库的协作。按规格实现、验证、提交并进行审查；未获明确授权不得发布。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    if (roles.includes('planner') || roles.includes('reviewer')) {
      const label = roles.includes('planner') && roles.includes('reviewer') ? '规划与审查者' : (roles.includes('planner') ? '规划者' : '审查者');
      return `调用 $coordinate-cli-agents 并作为${label}（${agentId}）恢复当前仓库的协作。你负责需求澄清、规格编写、提交/证据审查与发布门禁，不修改产品代码。${taskGuidance(options.template, language)}\n\n本轮任务：${task}`;
    }
    return `调用 $coordinate-cli-agents 并作为实现者（${agentId}）恢复当前仓库的协作。立即等待任务指令；你是唯一的产品代码修改者，负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE；等待审查；不得发布。`;
  }

  // English
  if (isDefaultCodex) {
    return `Use $coordinate-cli-agents as Codex and resume collaboration in this repository. Own only clarification, specification, acceptance criteria, commit/evidence review, and the release gate; do not edit product code. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (isDefaultAgy) {
    return 'Use $coordinate-cli-agents as Antigravity and resume collaboration in this repository. Wait for Codex now; be the sole product-code writer; implement, validate, commit, and send IMPLEMENTATION_DONE with evidence; wait for review; never release.';
  }
  if (roles.includes('planner') && roles.includes('implementer') && roles.includes('reviewer')) {
    return `Use $coordinate-cli-agents as planner, implementer, and reviewer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, and review according to specifications; never release without explicit approval. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (roles.includes('implementer') && roles.includes('reviewer')) {
    return `Use $coordinate-cli-agents as implementer and reviewer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, send IMPLEMENTATION_DONE with evidence, and perform reviews; never release without explicit approval. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (roles.includes('planner') && roles.includes('implementer')) {
    return `Use $coordinate-cli-agents as planner and implementer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, and review according to specifications; never release without explicit approval. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  if (roles.includes('planner') || roles.includes('reviewer')) {
    const label = roles.includes('planner') && roles.includes('reviewer') ? 'planner and reviewer' : (roles.includes('planner') ? 'planner' : 'reviewer');
    return `Use $coordinate-cli-agents as ${label} (${agentId}) and resume collaboration in this repository. Own clarification, specification, acceptance criteria, commit/evidence review, and the release gate; do not edit product code. ${taskGuidance(options.template, language)}\n\nTask: ${task}`;
  }
  return `Use $coordinate-cli-agents as implementer (${agentId}) and resume collaboration in this repository. Wait for instructions; be the sole product-code writer; implement, validate, commit, and send IMPLEMENTATION_DONE with evidence; wait for review; never release.`;
}

function quickstart(options, t, language) {
  if (!templateNames.has(options.template)) throw new Error(format(t.badTemplate, { template: options.template }));
  const root = assertGitRepository(options.root, t);
  const busPath = join(root, '.agent-bus');
  assertSafePath(root, busPath, t);
  const busTool = join(packageRoot, 'scripts', 'agent-bus.mjs');
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
    console.log(`\n${t.codexCommand}\n${packageCommand('launch', { ...base, role: 'codex' })}`);
    console.log(`\n${t.antigravityCommand}\n${packageCommand('launch', { ...base, role: 'antigravity' })}`);
  } else {
    for (const [agentId, rolesSet] of agentRolesMap.entries()) {
      const rolesLabel = [...rolesSet].join(', ');
      console.log(`\n${format(t.plannerCommand, { agent: agentId, role: rolesLabel })}\n${packageCommand('launch', { ...base, agent: agentId })}`);
    }
  }
}

function runLaunchChild(resolved, root, setActiveChild) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolved.command, [...resolved.prefix, ...resolved.args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: false,
    });
    setActiveChild(child);
    child.once('error', error => {
      setActiveChild(null);
      reject(error);
    });
    child.once('exit', (status, signal) => {
      setActiveChild(null);
      resolvePromise({ status, signal });
    });
  });
}

async function launchRole(options, t) {
  const agentOption = options.agent;
  const roleOption = options.role;
  if (agentOption && roleOption && agentOption !== roleOption) {
    throw new Error(`Conflicting options: --agent "${agentOption}" and --role "${roleOption}" must match.`);
  }
  const agentId = agentOption || roleOption;
  if (!agentId) throw new Error(format(t.badRole, { role: '' }));
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
  const agentConfig = busConfig.agents.find(a => a.id === agentId);
  if (!agentConfig) {
    throw new Error(format(t.badAgent, { agent: agentId }));
  }

  const adapter = getAdapter(agentConfig.adapter, agentConfig);
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
    if (supervised && observeAgentBus(busPath, agentId).stopped) return;
    let activation = 0;
    while (true) {
      const activationPrompt = activation === 0
        ? prompt
        : adapter.resumePrompt({ agentId, root, activation });
      const resolved = adapter.resolveLaunch({
        root,
        prompt: activationPrompt,
        role: agentId,
        language: options.language,
        activation,
      });
      const result = await runLaunchChild(resolved, root, setActiveChild);
      if (interruptedSignal) {
        process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143;
        return;
      }
      if (result.status !== 0) {
        const status = result.status ?? result.signal ?? 'unknown';
        throw new Error(format(t.launchFailed, { role: agentId, status }));
      }
      if (!supervised) return;

      const observation = observeAgentBus(busPath, agentId);
      if (observation.stopped) return;
      if (!observation.hasWork) {
        await waitForAgentActivity(busPath, agentId, {
          pollIntervalMs: policy.pollIntervalMs || 500,
          signal: controller.signal,
        });
      }
      if (observeAgentBus(busPath, agentId).stopped) return;
      activation += 1;
    }
  } catch (error) {
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143;
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

function handleAgentCommand(options, t) {
  const root = assertGitRepository(options.root, t);
  const busTool = join(packageRoot, 'scripts', 'agent-bus.mjs');
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
    console.log(`Checking ${busConfig.agents.length} registered agents:`);
    let allHealthy = true;
    for (const agent of busConfig.agents) {
      try {
        const adapter = getAdapter(agent.adapter, agent);
        const detection = adapter.detect();
        if (detection.available) {
          console.log(`  ${agent.id} (${agent.adapter}): healthy (${detection.version || 'available'})`);
        } else {
          allHealthy = false;
          console.error(`  ${agent.id} (${agent.adapter}): missing or unavailable (${detection.details || 'unknown'})`);
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
      else await launchRole(options, t);
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
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor >= 18) console.log(format(t.componentHealthy, { component: 'Node.js', version: process.version }));
    else {
      healthy = false;
      console.error(format(t.componentMissing, { component: 'Node.js 18+' }));
      console.error(format(t.repair, { command: repairs.node }));
    }
    for (const component of [
      { name: 'Git', command: 'git', repair: repairs.git, required: true },
      { name: 'Codex CLI', command: 'codex', repair: repairs.codex, required: options.codex },
      { name: 'Antigravity CLI (agy)', command: 'agy', repair: repairs.antigravity, required: options.antigravity },
    ]) {
      const version = executableVersion(component.command);
      if (version) console.log(format(t.componentHealthy, { component: component.name, version }));
      else {
        if (component.required) healthy = false;
        console.error(format(t.componentMissing, { component: component.name }));
        console.error(format(t.repair, { command: component.repair }));
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
        if (result.ok) console.log(format(t.healthy, { target: target.name, version: result.version, path: target.path }));
        else {
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
      if (!existsSync(target.path)) continue;
      if (!isIntactManagedInstallation(target.path, expectedManifest) && !options.force) {
        console.error(format(t.skipRemove, { target: target.name, path: target.path }));
        process.exitCode = 1;
        continue;
      }
      removePath(target.path);
      console.log(format(t.removed, { target: target.name, path: target.path }));
    }
    return;
  }

  console.error(format(t.unknownCommand, { command: options.command }));
  console.error(t.usage);
  process.exitCode = 2;
}

await run(process.argv.slice(2));
