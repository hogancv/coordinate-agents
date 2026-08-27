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
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  getAdapter,
  getAdapterContract,
  getAdapterRegistrySnapshot,
} from '../skills/coordinate-agents/adapters/index.mjs';
import {
  validateConfigurationResult,
  validateDetectionResult,
  validateLaunchPolicy,
  validateRuntimeLaunchPlan,
} from '../skills/coordinate-agents/adapters/contract-v1.mjs';
import { redactOutput } from '../skills/coordinate-agents/adapters/executable.mjs';
import {
  loadConfiguredTrustedAdapters,
  normalizeTrustedAdapterModulePath,
  prepareTrustedAdapterModules,
  registerPreparedTrustedAdapterModules,
  unregisterTrustedAdapterModule,
  trustedAdapterModuleRecords,
} from '../skills/coordinate-agents/adapters/trusted-local.mjs';
import { observeAgentBus, waitForAgentActivity } from '../skills/coordinate-agents/scripts/agent-observer.mjs';
import { discoverCodingClis, setupSnapshot } from '../skills/coordinate-agents/scripts/discovery.mjs';
import {
  assertContained,
  atomicWrite,
  readConfig,
  validateAgentId,
  withConfigTransaction,
} from '../skills/coordinate-agents/scripts/config.mjs';
import {
  defaultUserConfig,
  defaultCommandForAdapter,
  getUserConfigValue,
  readUserConfig,
  resolveAgentConfig,
  setUserConfigValue,
  userConfigPath,
  writeUserConfig,
} from '../skills/coordinate-agents/scripts/user-config.mjs';
import {
  createTask,
  ensureTaskStore,
  listTasks,
  markTaskError,
  prepareTaskForDispatch,
  recordReviewDecision,
  readTask,
  resolveTaskId,
  resumeTask,
  setTaskStatus,
  stopTask,
  syncTaskFromAgentBus,
} from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import {
  TASK_GRAPH_MAX_INPUT_BYTES,
  taskGraphDurableFacts,
  validateTaskGraphV1,
} from '../skills/coordinate-agents/scripts/task-graph-contract.mjs';
import {
  canonicalErrorCode,
  isExplicitAuthFailure,
  jsonFailure,
  jsonSuccess,
  legacyErrorCode,
  runtimeError,
  serializeRuntimeError,
} from '../skills/coordinate-agents/scripts/runtime-contract.mjs';
import {
  getExecutionSessionManager,
} from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { runtimeSessionFacts } from '../skills/coordinate-agents/scripts/session-service.mjs';
import { appendRuntimeEvent, readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const skillName = 'coordinate-agents';
const canonicalSkillSource = join(packageRoot, 'skills', skillName);
const busToolPath = join(canonicalSkillSource, 'scripts', 'agent-bus.mjs');
const metadataFile = '.coordinate-agents.json';
const templateNames = new Set(['bug', 'feature', 'refactor']);
const auxiliarySkillNames = Object.freeze(['coordinate-setup', 'coordinate-task', 'coordinate-review', 'coordinate-recover']);

async function loadConfiguredAdaptersForRuntime(userConfig = null) {
  const config = userConfig || readUserConfig();
  await loadConfiguredTrustedAdapters(config, { baseDir: dirname(userConfigPath()) });
  return getAdapterRegistrySnapshot();
}

const messages = {
  en: {
    usage: `coordinate-agents <command> [options]

Commands:
  install       Install the skill (default: Codex and Antigravity)
  update        Reinstall the packaged version and back up the old copy
  quickstart    Initialize a project and print two copyable launch commands
  launch        Start one CLI with its generated collaboration prompt
  setup         Discover coding CLIs and show configuration guidance
  status        Show the project Agent Bus and Task status
  task          Manage durable tasks (create, graph-validate, dispatch, status, list, inspect, resume, stop, review, error)
  agent         Manage registered agents (add, list, doctor)
  adapter       Manage trusted local Contract v1 adapters (register, list, remove)
  inspector     Start the local read-only Web UI Inspector
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
  --role <role>           Setup workflow role (setup configure only; default: implementer)
  --decision <decision>   Task review decision: REVIEW_APPROVED or CHANGES_REQUESTED
  --feedback <text>       Review feedback preserved for the next implementation round
  --input <path>          Task Graph v1 JSON input for task graph-validate
  --template <type>       Task template: bug, feature, or refactor
  --task <text>           Task summary included in the launch prompt
  --lang <en|zh-CN>       Override output language
  --force                 Replace/remove an unrecognized existing directory
  --once                  Disable Adapter-declared durable launch supervision
  --timeout <ms>          Stop a launch that exceeds the bounded timeout
  --port <port>           Inspector port (default: 3000)
  --json                  Emit one machine-readable JSON document on stdout
  --version               Print package version
  -h, --help              Show this help

Examples:
  npx @hogancv/coordinate-agents install
  npx @hogancv/coordinate-agents quickstart --template feature --task "Build a Todo app"
  npx @hogancv/coordinate-agents agent add claude --adapter generic-cli --command claude
  npx @hogancv/coordinate-agents adapter register "C:\\path\\to\\adapter.mjs"
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
  adapter       管理可信本地 Contract v1 适配器（register、list、remove）
  config        管理用户级可执行文件配置（set, get, list）
  doctor        检查依赖和安装，并输出对应修复命令
  setup         检测 Coding CLI 并展示配置引导
  status        显示项目 Agent Bus 和 Task 状态
  task          管理持久化任务（create、graph-validate、dispatch、status、list、inspect、resume、stop、review、error）
  inspector     启动本地只读 Web UI Inspector
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
  --role <role>           setup configure 的工作流角色（默认：implementer）
  --decision <decision>   Task 审查决策：REVIEW_APPROVED 或 CHANGES_REQUESTED
  --feedback <文本>       保存给下一轮实现的审查反馈
  --input <路径>          task graph-validate 使用的 Task Graph v1 JSON 输入
  --template <类型>       任务模板：bug、feature 或 refactor
  --task <文本>           写入启动提示词的任务摘要
  --lang <en|zh-CN>       指定输出语言
  --force                 替换或删除无法识别的现有目录
  --once                  禁用 Adapter 声明的持久启动监督
  --timeout <毫秒>        超过时限后停止启动进程
  --port <端口>           Inspector 端口（默认：3000）
  --json                  在 stdout 输出单个机器可读 JSON 文档
  --version               输出包版本
  -h, --help              显示帮助

示例：
  npx @hogancv/coordinate-agents install
  npx @hogancv/coordinate-agents quickstart --template feature --task "开发 Todo 应用"
  npx @hogancv/coordinate-agents agent add claude --adapter generic-cli --command claude
  npx @hogancv/coordinate-agents adapter register "C:\\path\\to\\adapter.mjs"
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
    json: false,
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
    title: '',
    spec: '',
    taskId: null,
    reason: '',
    errorCode: null,
    timeoutMs: null,
    port: 3000,
    adapter: 'generic-cli',
    agentCommand: null,
    agentArgs: null,
    role: 'implementer',
    roleExplicit: false,
    decision: null,
    feedback: '',
    input: null,
    template: 'feature',
    task: '',
    language: null,
    adapterExplicit: false,
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
    } else if (result.command === 'adapter' && args[0] && !args[0].startsWith('-')) {
      result.subcommand = args.shift();
      if (args[0] && !args[0].startsWith('-')) {
        result.targetAgent = args.shift();
      }
    } else if (result.command === 'config' && args[0] && !args[0].startsWith('-')) {
      result.subcommand = args.shift();
    } else if (result.command === 'task' && args[0] && !args[0].startsWith('-')) {
      result.subcommand = args.shift();
    } else if (result.command === 'setup' && args[0] && !args[0].startsWith('-')) {
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
    else if (option === '--json') result.json = true;
    else if ([
      '--codex-home', '--antigravity-home', '--codex-home-base64', '--antigravity-home-base64',
      '--root', '--root-base64', '--agent', '--planner', '--implementer', '--reviewer',
      '--adapter', '--command', '--args', '--template', '--task', '--title', '--spec',
      '--id', '--reason', '--error-code', '--timeout', '--timeout-ms', '--lang',
      '--role', '--decision', '--feedback', '--port', '--input',
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
      if (option === '--adapter') {
        result.adapter = value;
        result.adapterExplicit = true;
      }
      if (option === '--command') result.agentCommand = value;
      if (option === '--args') result.agentArgs = value;
      if (option === '--role') {
        result.role = value.toLowerCase();
        result.roleExplicit = true;
      }
      if (option === '--decision') result.decision = value.toUpperCase();
      if (option === '--feedback') result.feedback = value;
      if (option === '--input') result.input = value;
      if (option === '--template') result.template = value.toLowerCase();
      if (option === '--task') result.task = value;
      if (option === '--title') result.title = value;
      if (option === '--spec') result.spec = value;
      if (option === '--id') result.taskId = value;
      if (option === '--reason') result.reason = value;
      if (option === '--error-code') result.errorCode = value;
      if (option === '--timeout' || option === '--timeout-ms') {
        const timeoutMs = Number(value);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`INVALID_TIMEOUT:${value}`);
        result.timeoutMs = Math.floor(timeoutMs);
      }
      if (option === '--port') {
        const port = Number(value);
        if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`INVALID_PORT:${value}`);
        result.port = port;
      }
      if (option === '--lang') result.language = value;
    } else {
      throw new Error(`UNKNOWN_OPTION:${option}`);
    }
  }
  if (!result.codex && !result.antigravity) {
    result.codex = true;
    result.antigravity = true;
  }
  if (result.roleExplicit && !(result.command === 'setup' && result.subcommand === 'configure')) {
    throw new Error('UNKNOWN_OPTION:--role');
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

function installTarget(target, expectedManifest, options, t, source = canonicalSkillSource) {
  const sourceResolved = resolve(source);
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
    cpSync(source, staging, { recursive: true });
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

function installAuxiliarySkills(options, t) {
  for (const hostTarget of targets(options)) {
    for (const auxiliaryName of auxiliarySkillNames) {
      const source = join(packageRoot, 'skills', auxiliaryName);
      const target = {
        name: `${hostTarget.name} ${auxiliaryName}`,
        path: join(dirname(hostTarget.path), auxiliaryName),
      };
      installTarget(target, payloadManifest(source), options, t, source);
    }
  }
}

function uninstallAuxiliarySkills(options, t) {
  for (const hostTarget of targets(options)) {
    for (const auxiliaryName of auxiliarySkillNames) {
      const source = join(packageRoot, 'skills', auxiliaryName);
      const target = {
        name: `${hostTarget.name} ${auxiliaryName}`,
        path: join(dirname(hostTarget.path), auxiliaryName),
      };
      const manifest = payloadManifest(source);
      if (!existsSync(target.path)) continue;
      if (!isIntactManagedInstallation(target.path, manifest) && !options.force) {
        console.error(format(t.skipRemove, { target: target.name, path: target.path }));
        process.exitCode = 1;
        continue;
      }
      removePath(target.path);
      console.log(format(t.removed, { target: target.name, path: target.path }));
    }
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
    console.log(`\nTrusted local adapters`);
    const adapters = Array.isArray(config.adapters) ? config.adapters : [];
    if (adapters.length === 0) console.log(t.configNone);
    else for (const modulePath of adapters) console.log(`  ${modulePath}`);
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

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function ensureProjectBus(root) {
  const result = spawnSync(process.execPath, [busToolPath, 'init', '--root', root], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw runtimeError('TASK_STATE_CONFLICT', (result.stderr || result.stdout || result.error?.message || 'Agent Bus initialization failed').trim(), {
      recoverable: true,
      details: (result.stderr || result.stdout || result.error?.message || '').trim(),
    });
  }
  return join(root, '.agent-bus');
}

function jsonConfigCommand(options) {
  const path = userConfigPath();
  if (options.subcommand === 'list' || !options.subcommand) {
    return jsonSuccess('config.list', { path, config: readUserConfig() });
  }
  if (options.subcommand === 'get') {
    const [key, ...extra] = options.positionals;
    if (!key || extra.length > 0) throw runtimeError('INVALID_AGENT_CONFIG', 'A single configuration key is required.', { recoverable: false });
    const value = getUserConfigValue(readUserConfig(), key);
    if (value === undefined) throw runtimeError('INVALID_AGENT_CONFIG', `User configuration value is not set: ${key}`, { recoverable: false, details: key });
    return jsonSuccess('config.get', { path, key, value });
  }
  if (options.subcommand === 'set') {
    const [key, value, ...extra] = options.positionals;
    if (!key || value === undefined || extra.length > 0) throw runtimeError('INVALID_AGENT_CONFIG', 'config set requires a key and value.', { recoverable: false });
    const config = readUserConfig();
    setUserConfigValue(config, key, parseConfigValue(key, value));
    const written = writeUserConfig(config);
    return jsonSuccess('config.set', { path: written, key, value: getUserConfigValue(config, key) });
  }
  throw runtimeError('INVALID_AGENT_CONFIG', `Unknown config subcommand: ${options.subcommand}`, { recoverable: false });
}

async function adapterCommand(options, { json = false } = {}) {
  const path = userConfigPath();
  const baseDir = dirname(path);
  const subcommand = options.subcommand || 'list';
  const hadUserConfig = existsSync(path);
  const previousUserConfig = hadUserConfig ? readFileSync(path, 'utf8') : null;
  const config = readUserConfig();
  const removing = subcommand === 'remove' || subcommand === 'unregister';
  if (!removing) await loadConfiguredTrustedAdapters(config, { baseDir });
  const configured = Array.isArray(config.adapters) ? [...config.adapters] : [];

  if (subcommand === 'list') {
    const payload = jsonSuccess('adapter.list', {
      path,
      adapters: trustedAdapterModuleRecords(),
      configuredPaths: configured,
    });
    if (!json) {
      console.log(`Trusted local adapters (${path}):`);
      const records = payload.adapters;
      if (records.length === 0) console.log('  (none)');
      else for (const record of records) console.log(`  ${record.id} -> ${record.path}`);
    }
    return payload;
  }

  if (subcommand === 'register' || subcommand === 'add') {
    const [suppliedPath, ...extra] = [options.targetAgent || options.positionals[0], ...options.positionals.slice(options.targetAgent ? 0 : 1)];
    if (!suppliedPath || extra.length > 0) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', 'adapter register requires exactly one local module path.', { recoverable: false, details: 'Usage: coordinate-agents adapter register <path>' });
    }
    const normalizedPath = normalizeTrustedAdapterModulePath(suppliedPath, { baseDir: process.cwd() });
    const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (configured.some(value => pathKey(value) === pathKey(normalizedPath))) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', `Adapter module is already registered: ${normalizedPath}`, { recoverable: false, details: { path: 'module.path', modulePath: normalizedPath } });
    }

    // Prepare and validate before changing user configuration. The project
    // Bus is intentionally not opened or written by adapter registration.
    const prepared = await prepareTrustedAdapterModules([normalizedPath], { baseDir });
    const previous = [...configured];
    config.adapters = [...configured, normalizedPath];
    let written = false;
    try {
      const writtenPath = writeUserConfig(config);
      written = true;
      const committed = registerPreparedTrustedAdapterModules(prepared);
      const record = committed[0] || trustedAdapterModuleRecords().find(item => item.path === normalizedPath);
      const payload = jsonSuccess('adapter.register', {
        path: writtenPath,
        adapter: record || { path: normalizedPath },
        configuredPaths: config.adapters,
      });
      if (!json) console.log(`Registered trusted local adapter ${record?.id || '(unknown)'}: ${normalizedPath}`);
      return payload;
    } catch (error) {
      config.adapters = previous;
      if (written) {
        try { restoreUserConfigSnapshot(path, hadUserConfig, previousUserConfig); } catch { /* Preserve the original registration error. */ }
      }
      throw error;
    }
  }

  if (subcommand === 'remove' || subcommand === 'unregister') {
    const [suppliedPath, ...extra] = [options.targetAgent || options.positionals[0], ...options.positionals.slice(options.targetAgent ? 0 : 1)];
    if (!suppliedPath || extra.length > 0) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', 'adapter remove requires exactly one local module path.', { recoverable: false });
    }
    const normalizedPath = normalizeTrustedAdapterModulePath(suppliedPath, { baseDir: process.cwd(), requireExists: false });
    const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const remaining = configured.filter(value => pathKey(value) !== pathKey(normalizedPath));
    if (remaining.length === configured.length) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', `Adapter module is not registered: ${normalizedPath}`, { recoverable: false });
    }
    config.adapters = remaining;
    const writtenPath = writeUserConfig(config);
    try {
      unregisterTrustedAdapterModule(normalizedPath, { baseDir });
    } catch (error) {
      config.adapters = configured;
      try { restoreUserConfigSnapshot(path, hadUserConfig, previousUserConfig); } catch { /* Preserve the original removal error. */ }
      throw error;
    }
    const payload = jsonSuccess('adapter.remove', { path: writtenPath, removedPath: normalizedPath, configuredPaths: remaining });
    if (!json) console.log(`Removed trusted local adapter registration: ${normalizedPath}`);
    return payload;
  }

  throw runtimeError('INVALID_ADAPTER_CONFIG', `Unknown adapter subcommand: ${subcommand}. Use register, list, or remove.`, { recoverable: false });
}

function firstDoctorError(checks) {
  const failed = checks.find(check => check.ok === false);
  if (!failed) return null;
  return runtimeError(
    canonicalErrorCode(failed.code || (failed.kind === 'installation' ? 'TASK_STATE_CONFLICT' : 'EXECUTABLE_NOT_FOUND')),
    failed.message || `${failed.name || 'Doctor check'} failed.`,
    { recoverable: true, details: failed.details || null },
  );
}

function doctorJson(options, expectedManifest, selectedTargets) {
  const checks = [];
  let userConfig = defaultUserConfig();
  let projectConfig = null;
  try {
    userConfig = readUserConfig();
    projectConfig = projectConfigForRoot(resolve(options.root));
    checks.push({ name: 'configuration', ok: true, path: userConfigPath(), projectConfig: Boolean(projectConfig) });
  } catch (error) {
    checks.push({ name: 'configuration', ok: false, code: 'INVALID_AGENT_CONFIG', message: error.message || String(error) });
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'Node.js', ok: nodeMajor >= 18, version: process.version, code: nodeMajor >= 18 ? null : 'UNSUPPORTED_CAPABILITY' });
  const gitVersion = executableVersion('git');
  checks.push({ name: 'Git', ok: Boolean(gitVersion), version: gitVersion, code: gitVersion ? null : 'EXECUTABLE_NOT_FOUND' });

  for (const component of [
    { id: 'codex', name: 'Codex CLI', adapter: 'codex-cli', command: 'codex', required: options.codex },
    { id: 'antigravity', name: 'Antigravity CLI', adapter: 'antigravity-cli', command: 'agy', required: options.antigravity },
  ]) {
    const projectAgent = projectConfig?.agents?.find(agent => agent.id === component.id);
    const resolved = runtimeAgentConfig(projectAgent || { id: component.id, adapter: component.adapter }, userConfig);
    const command = resolved.command || component.command;
    let detection = null;
    try {
      detection = component.id && resolved.commandSource !== 'adapter-default'
        ? getAdapter(resolved.adapter, resolved).detect()
        : getAdapter(component.adapter, { ...resolved, command }).detect();
    } catch (error) {
      detection = { available: false, code: 'EXECUTABLE_NOT_RUNNABLE', details: error.message || String(error) };
    }
    checks.push({
      name: component.name,
      id: component.id,
      command,
      commandSource: resolved.commandSource,
      required: component.required,
      ok: Boolean(detection?.available) || !component.required,
      available: Boolean(detection?.available),
      version: detection?.version || null,
      resolvedCommand: detection?.resolvedCommand || null,
      code: detection?.available ? null : canonicalErrorCode(detection?.code || 'EXECUTABLE_NOT_FOUND', 'EXECUTABLE_NOT_FOUND'),
      details: detection?.available ? null : (detection?.details || null),
    });
  }

  let found = false;
  for (const target of selectedTargets) {
    const result = verifyTarget(target.path, expectedManifest);
    if (!result.missing) found = true;
    checks.push({
      name: target.name,
      kind: 'installation',
      path: target.path,
      ok: Boolean(result.ok),
      missing: Boolean(result.missing),
      managed: Boolean(result.managed),
      version: result.version || null,
      details: result.details || null,
      code: result.missing ? 'TASK_STATE_CONFLICT' : (result.ok ? null : 'TASK_STATE_CONFLICT'),
    });
  }
  if (!found) checks.push({ name: 'installation-summary', kind: 'installation', ok: false, code: 'TASK_STATE_CONFLICT', message: 'No target installation was found.' });

  const error = firstDoctorError(checks.filter(check => check.required !== false || check.kind === 'installation' || check.name === 'Git' || check.name === 'Node.js'));
  return error
    ? { ...jsonFailure('doctor', error), checks }
    : { ...jsonSuccess('doctor', { checks }), checks };
}

function agentDoctorJson(options) {
  const root = assertGitRepository(options.root, messages.en);
  const busPath = join(root, '.agent-bus');
  if (!existsSync(busPath)) return jsonSuccess('agent.doctor', { root, agents: [], bus: null });
  const busConfig = readConfig(busPath);
  const userConfig = readUserConfig();
  const agents = busConfig.agents.map(agent => {
    try {
      const resolvedAgent = runtimeAgentConfig(agent, userConfig);
      const adapter = getAdapter(resolvedAgent.adapter, resolvedAgent);
      const detection = adapter.detect();
      return {
        id: agent.id,
        adapter: agent.adapter,
        command: resolvedAgent.command || null,
        commandSource: resolvedAgent.commandSource,
        available: Boolean(detection.available),
        version: detection.version || null,
        resolvedCommand: detection.resolvedCommand || null,
        code: detection.available ? null : canonicalErrorCode(detection.code || 'EXECUTABLE_NOT_FOUND', 'EXECUTABLE_NOT_FOUND'),
        details: detection.available ? null : (detection.details || null),
      };
    } catch (error) {
      return { id: agent.id, adapter: agent.adapter, available: false, code: canonicalErrorCode(error.code, 'INVALID_AGENT_CONFIG'), details: error.message || String(error) };
    }
  });
  const failed = agents.find(agent => !agent.available);
  if (failed) {
    const error = runtimeError(canonicalErrorCode(failed.code, 'AGENT_RUNTIME_ERROR'), `Agent ${failed.id} is unavailable.`, {
      recoverable: true,
      agent: failed.id,
      adapter: failed.adapter,
      command: failed.command,
      details: failed.details,
    });
    return { ...jsonFailure('agent.doctor', error), root, agents };
  }
  return jsonSuccess('agent.doctor', { root, agents });
}

function statusJson(options) {
  const root = assertGitRepository(options.root, messages.en);
  const result = spawnSync(process.execPath, [busToolPath, 'status', '--root', root], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw runtimeError('AGENT_RUNTIME_ERROR', (result.stderr || result.stdout || result.error?.message || 'Unable to read Agent Bus status').trim(), { recoverable: true });
  let bus;
  try { bus = JSON.parse(result.stdout); } catch (error) {
    throw runtimeError('AGENT_RUNTIME_ERROR', `Agent Bus returned invalid JSON: ${error.message}`, { recoverable: true });
  }
  let tasks = [];
  try { tasks = listTasks(root); } catch (error) {
    if (error.code !== 'TASK_STATE_CONFLICT') tasks = [];
    else throw error;
  }
  return jsonSuccess('status', { root, bus, tasks });
}

async function inspectorCommand(options) {
  const { startInspector } = await import('../inspector/server/server.mjs');
  const root = assertGitRepository(options.root, messages.en);
  const started = await startInspector({ root, port: options.port || 3000 });
  if (options.json) emitJson(jsonSuccess('inspector.start', {
    root: started.root,
    host: started.host,
    port: started.port,
    url: started.url,
  }));
  else console.log(`Inspector running:\n\n${started.url}`);

  await new Promise(resolvePromise => {
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolvePromise();
    };
    const onSignal = () => {
      started.server.close(finish);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

function readLatestErrorArtifact(root, agentId) {
  const logsDirectory = join(root, '.agent-bus', 'logs');
  if (!existsSync(logsDirectory)) return null;
  const candidates = readdirSync(logsDirectory)
    .filter(name => name.endsWith('-ERROR.json') && (!agentId || name.includes(`-${agentId}-ERROR.json`)))
    .sort()
    .reverse();
  for (const name of candidates) {
    const path = join(logsDirectory, name);
    try {
      assertSafePath(root, path, messages.en, false);
      const record = JSON.parse(readFileSync(path, 'utf8'));
      return {
        path: resolve(path),
        artifact: {
          ...record,
          details: redactOutput(record.details || '', 2 * 1024),
          stdoutTail: redactOutput(record.stdoutTail || '', 8 * 1024),
          stderrTail: redactOutput(record.stderrTail || '', 8 * 1024),
        },
      };
    } catch {
      // Ignore malformed or unsafe artifacts; the Task error remains the
      // authoritative recovery fact.
    }
  }
  return null;
}

async function recoverInspectCommand(options) {
  await loadConfiguredAdaptersForRuntime();
  const root = assertGitRepository(options.root, messages.en);
  const id = options.taskId || options.positionals?.[0] || null;
  const taskId = resolveTaskId(root, id);
  const task = syncTaskFromAgentBus(root, taskId);
  const busPath = join(root, '.agent-bus');
  const busConfig = readConfig(busPath);
  const agentConfig = busConfig.agents.find(agent => agent.id === task.implementer) || null;
  let executable = {
    agent: task.implementer,
    adapter: agentConfig?.adapter || null,
    command: null,
    commandSource: null,
    available: false,
    code: 'INVALID_AGENT_CONFIG',
    details: agentConfig ? null : `Task implementer is not registered: ${task.implementer}`,
    resolvedCommand: null,
  };
  let agentState = null;
  let artifact = null;
  let session = null;
  if (agentConfig) {
    try {
      const resolved = runtimeAgentConfig(agentConfig, readUserConfig());
      const adapter = getAdapter(resolved.adapter, resolved);
      const detection = adapter.detect({ version: false });
      executable = {
        agent: task.implementer,
        adapter: resolved.adapter,
        command: resolved.command || null,
        commandSource: resolved.commandSource || null,
        available: Boolean(detection.available),
        code: detection.available ? null : canonicalErrorCode(detection.code || 'EXECUTABLE_NOT_FOUND', 'EXECUTABLE_NOT_FOUND'),
        details: detection.available ? null : (detection.details || null),
        resolvedCommand: detection.resolvedCommand || null,
      };
    } catch (error) {
      executable = {
        ...executable,
        code: canonicalErrorCode(error.code, 'INVALID_AGENT_CONFIG'),
        details: redactOutput(error.message || String(error), 2 * 1024),
      };
    }
    try {
      agentState = observeAgentBus(busPath, task.implementer);
    } catch (error) {
      agentState = { error: redactOutput(error.message || String(error), 2 * 1024) };
    }
    artifact = readLatestErrorArtifact(root, task.implementer);
  }
  if (task.sessionId) {
    try {
      session = await runtimeSessionFacts(root, task.sessionId);
    } catch (error) {
      session = {
        id: task.sessionId,
        state: 'failed',
        pid: null,
        error: serializeRuntimeError(error, { includeLegacy: true }),
      };
    }
  }
  const recentEventsBySequence = new Map();
  for (const event of readRuntimeEvents(root, { taskId: task.id, limit: 50 })) recentEventsBySequence.set(event.sequence, event);
  if (task.sessionId) {
    for (const event of readRuntimeEvents(root, { sessionId: task.sessionId, limit: 50 })) recentEventsBySequence.set(event.sequence, event);
  }
  const recentEvents = [...recentEventsBySequence.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-50);
  return jsonSuccess('recover.inspect', {
    root,
    task,
    lastError: task.lastError || null,
    agent: {
      id: task.implementer,
      registered: Boolean(agentConfig),
      state: agentState,
    },
    errorArtifact: artifact,
    executable,
    session,
    recentEvents,
    recommendedRecovery: {
      factsOnly: true,
      resumeRequired: ['ERROR', 'STOPPED'].includes(task.status),
      dispatchRequiredAfterResume: ['ERROR', 'STOPPED', 'CHANGES_REQUESTED'].includes(task.status),
      automaticRetry: false,
    },
  });
}

function sendTaskBusMessage(root, { from, to, type, subject, body, dedupeKey, relatedCommit = '' }) {
  const busPath = join(root, '.agent-bus');
  const temporary = join(busPath, 'tmp', `.task-${process.pid}-${randomUUID().replaceAll('-', '')}.md`);
  assertSafePath(root, temporary, messages.en, false);
  writeFileSync(temporary, `${body}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    const args = [
      busToolPath,
      'send', '--root', root,
      '--from', from, '--to', to,
      '--type', type,
      '--subject', subject,
      '--body-file', temporary,
      '--dedupe-key', dedupeKey,
    ];
    if (relatedCommit) args.push('--related-commit', relatedCommit);
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw runtimeError('AGENT_RUNTIME_ERROR', (result.stderr || result.stdout || result.error?.message || 'Agent Bus send failed').trim(), {
        recoverable: true,
        stage: 'transport',
        details: (result.stderr || result.stdout || result.error?.message || '').trim(),
      });
    }
    return result.stdout.trim();
  } finally {
    rmSync(temporary, { force: true });
  }
}

function taskImplementationPrompt(task) {
  const feedback = `${task.reviewFeedback || ''}`.trim();
  const previousEvidence = Array.isArray(task.evidence) && task.evidence.length > 0
    ? JSON.stringify(task.evidence.at(-1))
    : '(none)';
  return [
    'Use $coordinate-agents as the external Implementer for this Task.',
    'Do not create a second planner and do not release, merge, push, tag, deploy, or publish.',
    `Task ID: ${task.id}`,
    `Round: ${task.round}`,
    `Approved specification:\n${task.spec}`,
    feedback ? `Review feedback from the previous round:\n${feedback}` : '',
    `Previous implementation commit/evidence reference: ${task.implementationCommit || previousEvidence}`,
    'Implement only the approved specification, run the required validation, commit the product changes, and send one IMPLEMENTATION_DONE message to the Planner with the commit and bounded evidence.',
  ].filter(Boolean).join('\n\n');
}

async function taskAgentResolution(root, task, adapterRegistry = null) {
  const busPath = join(root, '.agent-bus');
  const busConfig = readConfig(busPath);
  const workflowImplementer = busConfig.workflow?.implementer || task.implementer;
  const projectAgent = busConfig.agents.find(agent => agent.id === workflowImplementer);
  if (!projectAgent) {
    throw runtimeError('INVALID_AGENT_CONFIG', `Workflow implementer is not registered: ${workflowImplementer}`, {
      recoverable: false,
      agent: workflowImplementer,
      taskId: task.id,
    });
  }
  if (!busConfig.agents.some(agent => agent.id === task.planner)) {
    throw runtimeError('INVALID_AGENT_CONFIG', `Task planner is not registered: ${task.planner}`, {
      recoverable: false,
      agent: task.planner,
      taskId: task.id,
    });
  }
  const userConfig = readUserConfig();
  const registry = adapterRegistry || await loadConfiguredAdaptersForRuntime(userConfig);
  const resolved = runtimeAgentConfig(projectAgent, userConfig);
  const adapter = getAdapter(resolved.adapter, resolved);
  const contract = getAdapterContract(adapter);
  const compatibility = contract && contract.capabilities.configuration
    ? validateConfigurationResult(adapter.validateConfiguration({ setup: true }))
    : adapter.validateConfiguration({ setup: true });
  if (!compatibility.compatible) {
    throw runtimeError(compatibility.code || 'UNSUPPORTED_CAPABILITY', compatibility.details || `Adapter ${resolved.adapter} cannot drive the configured Implementer.`, {
      recoverable: false,
      taskId: task.id,
      agent: workflowImplementer,
      adapter: resolved.adapter,
      command: resolved.command,
      stage: 'adapter',
      details: compatibility.details,
    });
  }
  return {
    busConfig,
    workflowImplementer,
    projectAgent,
    resolved,
    adapter,
    contract,
    registryAdapter: registry.find(item => item.id === resolved.adapter) || null,
  };
}

function markDispatchFailure(root, task, error, agentId = null) {
  const normalized = error?.code ? error : runtimeError('AGENT_RUNTIME_ERROR', error?.message || String(error), {
    recoverable: true,
    taskId: task.id,
  });
  if (agentId) {
    try {
      recordBusState(root, agentId, 'ERROR', JSON.stringify({
        code: canonicalErrorCode(normalized.code),
        stage: normalized.stage || 'dispatch',
        details: compactErrorDetails(normalized.details || normalized.message),
      }));
    } catch { /* Preserve the primary Task error. */ }
  }
  try { markTaskError(root, task.id, normalized); } catch { /* Preserve the primary Task error. */ }
  return normalized;
}

async function taskDispatch(root, task, options, t, adapterRegistry = null) {
  let resolution;
  let agentId = null;
  try {
    resolution = await taskAgentResolution(root, task, adapterRegistry);
    agentId = resolution.workflowImplementer;
    if (task.implementer !== agentId) {
      task = setTaskStatus(root, task.id, task.status, { implementer: agentId });
    }
    if (resolution.contract && !resolution.contract.capabilities.detection) {
      throw runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${resolution.contract.id}" does not support executable detection.`, {
        recoverable: false,
        taskId: task.id,
        agent: agentId,
        adapter: resolution.contract.id,
      });
    }
    const detection = resolution.contract
      ? validateDetectionResult(resolution.adapter.detect({ version: false }))
      : resolution.adapter.detect({ version: false });
    if (!detection.available) {
      throw runtimeError(canonicalErrorCode(detection.code, 'EXECUTABLE_NOT_FOUND'), detection.details || `Executable is unavailable: ${resolution.resolved.command}`, {
        recoverable: true,
        taskId: task.id,
        agent: agentId,
        adapter: resolution.resolved.adapter,
        command: resolution.resolved.command,
        stage: 'executable',
        result: detection,
      });
    }

    task = setTaskStatus(root, task.id, 'IMPLEMENTING', {
      dispatch: {
        round: task.round,
        implementer: agentId,
        adapter: resolution.resolved.adapter,
        command: resolution.resolved.command,
        commandSource: resolution.resolved.commandSource,
        dispatchedAt: new Date().toISOString(),
      },
      lastError: null,
    });
    appendRuntimeEvent(root, {
      type: 'TASK_DISPATCHED',
      taskId: task.id,
      sessionId: task.sessionId || undefined,
      agentId,
      role: 'implementer',
      data: {
        round: task.round,
        adapter: resolution.resolved.adapter,
        commandSource: resolution.resolved.commandSource,
      },
    });
    try {
      recordBusState(root, agentId, 'IMPLEMENTING', `Task ${task.id} round ${task.round} dispatched by ${task.planner}.`);
    } catch (error) {
      throw runtimeError('AGENT_RUNTIME_ERROR', `Unable to record Implementer state: ${error.message || error}`, {
        recoverable: true,
        taskId: task.id,
        agent: agentId,
        adapter: resolution.resolved.adapter,
        stage: 'transport',
      });
    }

    const body = taskImplementationPrompt(task);
    const messagePath = sendTaskBusMessage(root, {
      from: task.planner,
      to: agentId,
      type: 'IMPLEMENT',
      subject: `Implement ${task.id} round ${task.round}`,
      body,
      dedupeKey: `task:${task.id}:round:${task.round}:implement`,
    });

    const sessionManager = getExecutionSessionManager();
    const opened = await sessionManager.open({
      root,
      agent: agentId,
      sessionId: task.sessionId,
      resolved: resolution.resolved,
      adapter: resolution.adapter,
      initialPrompt: body,
      language: options.language || 'en',
      taskId: task.id,
    });
    let session = opened.session;
    if (!opened.initialInputConsumed) {
      session = await sessionManager.write(root, session.id, body, { taskId: task.id });
    }
    task = setTaskStatus(root, task.id, 'IMPLEMENTING', {
      sessionId: session.id,
      dispatch: {
        ...(task.dispatch || {}),
        sessionId: session.id,
        reusedSession: Boolean(opened.reused),
      },
    });

    let finalTask = syncTaskFromAgentBus(root, task.id);
    const graceMs = Number.isInteger(options.sessionWaitMs) && options.sessionWaitMs >= 0
      ? Math.min(options.sessionWaitMs, 10_000)
      : 10_000;
    const deadline = Date.now() + graceMs;
    let sessionState = session;
    while (finalTask.status !== 'REVIEWING' && Date.now() < deadline) {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
      finalTask = syncTaskFromAgentBus(root, task.id);
      try { sessionState = await sessionManager.status(root, session.id); } catch { /* Task facts remain authoritative. */ }
      if (['failed', 'exited'].includes(sessionState.state)) break;
    }
    if (finalTask.status !== 'REVIEWING' && ['failed'].includes(sessionState.state)) {
      throw runtimeError(sessionState.exitCode ? 'AGENT_EXIT_NONZERO' : 'AGENT_RUNTIME_ERROR', `Execution session ${session.id} failed after dispatch.`, {
        recoverable: true,
        taskId: task.id,
        agent: agentId,
        adapter: resolution.resolved.adapter,
        command: resolution.resolved.command,
        sessionId: session.id,
        root,
        stage: 'runtime',
        details: sessionState.error || null,
        result: { status: sessionState.exitCode, signal: sessionState.signal, resolvedCommand: sessionState.resolvedCommand },
      });
    }
    if (finalTask.status === 'REVIEWING') {
      try { recordBusState(root, agentId, 'REVIEWING', `Task ${task.id} implementation evidence received.`); } catch { /* Task is authoritative for the product surface. */ }
    } else if (finalTask.status === 'IMPLEMENTING') {
      finalTask = setTaskStatus(root, task.id, 'WAITING_IMPLEMENTER');
      try { recordBusState(root, agentId, 'WAITING', `Task ${task.id} is waiting for IMPLEMENTATION_DONE.`); } catch { /* Best-effort Bus state mirror. */ }
    }
    return {
      root,
      task: finalTask,
      session: {
        ...sessionState,
        reused: Boolean(opened.reused),
      },
      workflow: { implementer: agentId },
      agent: {
        id: agentId,
        adapter: resolution.resolved.adapter,
        adapterCapabilities: resolution.registryAdapter?.capabilities || null,
        adapterContractVersion: resolution.registryAdapter?.contractVersion || null,
        command: resolution.resolved.command,
        commandSource: resolution.resolved.commandSource,
        available: true,
        resolvedCommand: detection.resolvedCommand || null,
      },
      transport: { type: 'IMPLEMENT', messagePath, dedupeKey: `task:${task.id}:round:${task.round}:implement` },
      launch: {
        type: 'persistent-pty-session',
        reused: Boolean(opened.reused),
        sessionId: session.id,
      },
    };
  } catch (error) {
    const normalized = markDispatchFailure(root, task, error, agentId);
    throw normalized;
  }
}

function taskReview(root, task, options) {
  const decision = `${options.decision || ''}`.trim().toUpperCase();
  const feedback = `${options.feedback || options.reason || ''}`.trim();
  if (task.status !== 'REVIEWING') {
    throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} must be REVIEWING before review.`, { recoverable: false, taskId: task.id });
  }
  if (!['REVIEW_APPROVED', 'CHANGES_REQUESTED'].includes(decision)) {
    throw runtimeError('TASK_STATE_CONFLICT', 'task review requires --decision REVIEW_APPROVED or CHANGES_REQUESTED.', { recoverable: false, taskId: task.id });
  }
  if (decision === 'CHANGES_REQUESTED' && !feedback) {
    throw runtimeError('TASK_STATE_CONFLICT', 'CHANGES_REQUESTED requires --feedback.', { recoverable: false, taskId: task.id });
  }
  const busConfig = readConfig(join(root, '.agent-bus'));
  for (const agentId of [task.reviewer, task.implementer]) {
    if (!busConfig.agents.some(agent => agent.id === agentId)) {
      throw runtimeError('INVALID_AGENT_CONFIG', `Review Agent is not registered: ${agentId}`, { recoverable: false, taskId: task.id, agent: agentId });
    }
  }
  const body = [
    `Task ID: ${task.id}`,
    `Round: ${task.round}`,
    `Decision: ${decision}`,
    `Implementation commit: ${task.implementationCommit || '(not supplied)'}`,
    feedback ? `Review feedback:\n${feedback}` : 'Review feedback: none',
    'REVIEW_APPROVED is not release authorization. Only the user release gate can authorize release actions.',
  ].join('\n\n');
  const messagePath = sendTaskBusMessage(root, {
    from: task.reviewer,
    to: task.implementer,
    type: decision,
    subject: `${decision} ${task.id} round ${task.round}`,
    body,
    dedupeKey: `task:${task.id}:round:${task.round}:review:${decision}`,
    relatedCommit: task.implementationCommit || '',
  });
  const updated = recordReviewDecision(root, task.id, decision, {
    feedback,
    evidence: options.evidence || { messagePath },
  });
  try { recordBusState(root, task.reviewer, decision === 'REVIEW_APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED', `Task ${task.id}: ${decision}`); } catch { /* Task decision remains authoritative. */ }
  return { root, task: updated, review: { decision, feedback, messagePath } };
}

async function taskCommand(options, { json = false } = {}) {
  const subcommand = options.subcommand || 'status';
  const graphValidate = subcommand === 'graph-validate'
    || subcommand === 'validate-graph'
    || (subcommand === 'graph' && options.positionals?.[0] === 'validate');
  const commandName = graphValidate ? 'task.graph-validate' : `task.${subcommand}`;
  if (graphValidate) {
    const hasInlineGraph = Object.prototype.hasOwnProperty.call(options, 'graph') && options.graph !== undefined;
    const graphInput = hasInlineGraph ? options.graph : readTaskGraphInput(options.input);
    const requestedRoot = resolve(options.root);
    const busPath = join(requestedRoot, '.agent-bus');
    let busConfig;
    try {
      if (existsSync(busPath)) assertSafePath(requestedRoot, busPath, messages.en);
      busConfig = readConfig(busPath);
    } catch (error) {
      throw runtimeError('TASK_GRAPH_INVALID', `Unable to read configured Agents for Task Graph v1: ${error.message || error}`, {
        recoverable: false,
        stage: 'graph-validation',
        root: requestedRoot,
      });
    }
    const graph = validateTaskGraphV1(graphInput, {
      configuredAgents: busConfig.agents.map(agent => agent.id),
    });
    // Repository discovery uses Git and therefore may spawn a process. Keep it
    // after complete graph and configured-Agent validation so malformed input
    // cannot cross the graph side-effect boundary.
    const root = assertGitRepository(requestedRoot, messages.en);
    const result = jsonSuccess(commandName, {
      root,
      graph,
      facts: taskGraphDurableFacts(graph),
      validation: { valid: true, sideEffects: false },
    });
    if (!json) console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const adapterRegistry = await loadConfiguredAdaptersForRuntime();
  const root = assertGitRepository(options.root, messages.en);
  ensureProjectBus(root);
  ensureTaskStore(root);
  const busConfig = readConfig(join(root, '.agent-bus'));
  const workflow = busConfig.workflow || {};
  let task;
  let tasks;
  if (subcommand === 'create') {
    task = createTask(root, {
      id: options.taskId,
      title: options.title || options.task || options.positionals.join(' '),
      planner: options.planner || workflow.planner,
      implementer: options.implementer || workflow.implementer,
      reviewer: options.reviewer || workflow.reviewer,
      spec: options.spec || '',
    });
  } else if (subcommand === 'list') {
    tasks = listTasks(root);
  } else {
    const id = resolveTaskId(root, options.taskId || options.positionals[0] || null);
    if (subcommand === 'status' || subcommand === 'inspect') task = syncTaskFromAgentBus(root, id);
    else if (subcommand === 'resume') task = resumeTask(root, id);
    else if (subcommand === 'stop') task = stopTask(root, id, options.reason || null);
    else if (subcommand === 'error') task = markTaskError(root, id, runtimeError(options.errorCode || 'AGENT_RUNTIME_ERROR', options.reason || 'Task runtime error.', { recoverable: true, taskId: id }));
    else if (subcommand === 'dispatch') {
      task = syncTaskFromAgentBus(root, id);
      task = prepareTaskForDispatch(root, id, options.spec || undefined);
      const payload = await taskDispatch(root, task, options, messages[detectLanguage(options.language)], adapterRegistry);
      const result = jsonSuccess(commandName, payload);
      if (!json) console.log(JSON.stringify(payload, null, 2));
      return result;
    } else if (subcommand === 'review') {
      task = syncTaskFromAgentBus(root, id);
      const payload = taskReview(root, task, options);
      const result = jsonSuccess(commandName, payload);
      if (!json) console.log(JSON.stringify(payload, null, 2));
      return result;
    }
    else throw runtimeError('UNSUPPORTED_CAPABILITY', `Unknown task subcommand: ${subcommand}`, { recoverable: false });
  }
  const payload = subcommand === 'list' ? { root, tasks } : { root, task };
  const result = jsonSuccess(commandName, payload);
  if (json) return result;
  if (subcommand === 'list') console.log(JSON.stringify(tasks, null, 2));
  else console.log(JSON.stringify(task, null, 2));
  return result;
}

function readTaskGraphInput(path) {
  if (!path) {
    throw runtimeError('TASK_GRAPH_INVALID', 'task graph-validate requires --input <graph.json>.', {
      recoverable: false,
      stage: 'graph-validation',
    });
  }
  const inputPath = resolve(path);
  let content;
  try {
    const metadata = lstatSync(inputPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > TASK_GRAPH_MAX_INPUT_BYTES) {
      throw new Error(`input must be a regular, non-symlink JSON file no larger than ${TASK_GRAPH_MAX_INPUT_BYTES / 1024 / 1024} MiB`);
    }
    content = readFileSync(inputPath, 'utf8');
  } catch (error) {
    throw runtimeError('TASK_GRAPH_INVALID', `Unable to read Task Graph v1 input: ${error.message || error}`, {
      recoverable: false,
      stage: 'graph-validation',
    });
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw runtimeError('TASK_GRAPH_INVALID', `Task Graph v1 input is not valid JSON: ${error.message}`, {
      recoverable: false,
      stage: 'graph-validation',
    });
  }
}

async function setupCommand(options, { json = false } = {}) {
  let root = resolve(options.root);
  if (options.requireRepository) {
    root = assertGitRepository(options.root, messages.en);
  } else {
    try { root = assertGitRepository(options.root, messages.en); } catch { /* Discovery is also useful before a project is selected. */ }
  }
  const userConfig = readUserConfig();
  const adapterRegistry = await loadConfiguredAdaptersForRuntime(userConfig);
  const snapshot = setupSnapshot({ root, userConfig, adapterRegistry });
  const result = jsonSuccess('setup', {
    ...snapshot,
    userConfigPath: userConfigPath(),
    projectConfigPath: existsSync(join(root, '.agent-bus', 'config.json')) ? join(root, '.agent-bus', 'config.json') : null,
  });
  if (json) return result;
  console.log(`Coding CLIs available on this computer for ${root}:`);
  for (const agent of snapshot.agents) {
    const suffix = agent.available
      ? (agent.configured ? `configured as ${agent.configuredAgent}` : 'detected but not configured')
      : `unavailable (${agent.code || 'EXECUTABLE_NOT_FOUND'})`;
    console.log(`  ${agent.command}: ${suffix}`);
  }
  console.log(`User configuration: ${userConfigPath()}`);
  console.log('Use setup configure --agent <id> --command <executable> --root <repository> --json to configure the Implementer transaction.');
  return result;
}

const SETUP_ADAPTERS = Object.freeze({
  codex: 'codex-cli',
  antigravity: 'antigravity-cli',
  agy: 'antigravity-cli',
  'agy-proxy': 'antigravity-cli',
  claude: 'generic-cli',
  gemini: 'generic-cli',
});

function inferSetupIdentity(options) {
  const supplied = `${options.agent || options.positionals[0] || ''}`.trim().toLowerCase();
  const command = `${options.agentCommand || supplied}`.trim();
  if (!supplied && !command) {
    throw runtimeError('INVALID_AGENT_CONFIG', 'setup configure requires --agent or --command.', { recoverable: false });
  }
  const commandName = basename(command).replace(/\.(cmd|bat|exe|com|ps1)$/i, '').toLowerCase();
  const identity = supplied || commandName;
  // An explicitly supplied Agent identity is authoritative even when its
  // executable has a different name.  This keeps Agent, Adapter, and
  // executable identities separate for external adapters as well as the
  // built-in aliases (for example antigravity -> agy-proxy).
  const knownIdentity = (SETUP_ADAPTERS[identity] || supplied) ? identity : commandName;
  const id = ['agy', 'agy-proxy'].includes(knownIdentity) ? 'antigravity' : knownIdentity;
  validateAgentId(id);
  const adapter = options.adapterExplicit
    ? options.adapter
    : (SETUP_ADAPTERS[id] || SETUP_ADAPTERS[knownIdentity] || 'generic-cli');
  const executable = options.agentCommand
    || (['codex', 'antigravity'].includes(supplied)
      ? defaultCommandForAdapter(adapter)
      : (SETUP_ADAPTERS[identity] ? identity : command));
  if (!executable) {
    throw runtimeError('INVALID_AGENT_CONFIG', `No executable command was resolved for Agent ${id}.`, {
      recoverable: false,
      agent: id,
      adapter,
    });
  }
  return { id, adapter, command: executable };
}

function parseSetupArgs(agentId, value) {
  if (value === null || value === undefined) return undefined;
  return parseConfigValue(`agent.${agentId}.args`, value);
}

function ensureProjectAgentDirectories(root, busPath, agentId, t) {
  const directories = [
    join(busPath, 'inbox', agentId, 'new'),
    join(busPath, 'inbox', agentId, 'processing'),
    join(busPath, 'inbox', agentId, 'processed'),
    join(busPath, 'quarantine', agentId),
    join(busPath, 'state', agentId),
  ];
  const created = [];
  for (const directory of directories) {
    const existed = existsSync(directory);
    assertSafePath(root, directory, t);
    mkdirSync(directory, { recursive: true });
    assertSafePath(root, directory, t);
    if (!existed) created.push(directory);
  }
  return created;
}

function restoreUserConfigSnapshot(path, existed, content) {
  if (existed) {
    writeFileSync(path, content, 'utf8');
  } else if (existsSync(path)) {
    unlinkSync(path);
  }
}

async function setupConfigureCommand(options, { json = false } = {}) {
  const t = messages[detectLanguage(options.language)];
  const root = assertGitRepository(options.root, t);
  const identity = inferSetupIdentity(options);
  const role = `${options.role || 'implementer'}`.toLowerCase();
  if (!['implementer', 'planner', 'reviewer'].includes(role)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported workflow role: ${role}`, { recoverable: false, agent: identity.id });
  }
  const args = parseSetupArgs(identity.id, options.agentArgs);
  const configPath = userConfigPath();
  const hadUserConfig = existsSync(configPath);
  const previousUserConfig = hadUserConfig ? readFileSync(configPath, 'utf8') : null;
  const originalUserConfig = readUserConfig();
  const adapterRegistry = await loadConfiguredAdaptersForRuntime(originalUserConfig);
  const candidateUserConfig = JSON.parse(JSON.stringify(originalUserConfig));
  setUserConfigValue(candidateUserConfig, `agent.${identity.id}.command`, identity.command);
  if (args !== undefined) setUserConfigValue(candidateUserConfig, `agent.${identity.id}.args`, args);

  // Validate the adapter and executable before writing either configuration.
  // Generic CLI is intentionally conservative: detection alone is not an
  // adapter compatibility claim.
  let projectBefore = null;
  let projectConfigPath = null;
  let busPath = null;
  let createdDirectories = [];
  let projectAgentBefore = null;
  try {
    const existingBus = join(root, '.agent-bus');
    if (existsSync(existingBus)) {
      projectBefore = JSON.stringify(readConfig(existingBus));
      projectConfigPath = join(existingBus, 'config.json');
      projectAgentBefore = readConfig(existingBus).agents.find(agent => agent.id === identity.id) || null;
    }

    const candidateProjectAgent = projectAgentBefore
      ? { ...projectAgentBefore, adapter: identity.adapter }
      : { id: identity.id, adapter: identity.adapter };
    if (projectAgentBefore?.command !== undefined && projectAgentBefore.command !== identity.command) {
      throw runtimeError('TASK_STATE_CONFLICT', `Project Agent ${identity.id} has an explicit command override; setup configure will not replace it.`, {
        recoverable: false,
        agent: identity.id,
        adapter: identity.adapter,
        command: projectAgentBefore.command,
        details: 'Remove or intentionally update the project-level command before using the machine-level setup transaction.',
      });
    }
    const candidateResolution = resolveAgentConfig(candidateProjectAgent, candidateUserConfig);
    const adapter = getAdapter(identity.adapter, candidateResolution);
    const adapterContract = getAdapterContract(adapter);
    const compatibility = adapterContract && adapterContract.capabilities.configuration
      ? validateConfigurationResult(adapter.validateConfiguration({ setup: true }))
      : adapter.validateConfiguration({ setup: true });
    if (!compatibility.compatible) {
      throw runtimeError(compatibility.code || 'UNSUPPORTED_CAPABILITY', compatibility.details || `Adapter ${identity.adapter} cannot drive this executable.`, {
        recoverable: false,
        agent: identity.id,
        adapter: identity.adapter,
        command: candidateResolution.command,
        details: compatibility.details,
      });
    }
    if (adapterContract && !adapterContract.capabilities.detection) {
      throw runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${adapterContract.id}" does not support executable detection.`, {
        recoverable: false,
        agent: identity.id,
        adapter: adapterContract.id,
        command: candidateResolution.command,
      });
    }
    const detection = adapterContract
      ? validateDetectionResult(adapter.detect({ version: true }))
      : adapter.detect({ version: true });
    if (!detection.available) {
      throw runtimeError(canonicalErrorCode(detection.code, 'EXECUTABLE_NOT_FOUND'), detection.details || `Executable is unavailable: ${identity.command}`, {
        recoverable: true,
        agent: identity.id,
        adapter: identity.adapter,
        command: candidateResolution.command,
        details: detection.details || null,
        stage: 'executable',
        result: detection,
      });
    }

    busPath = ensureProjectBus(root);
    if (!projectBefore) {
      projectBefore = JSON.stringify(readConfig(busPath));
      projectConfigPath = join(busPath, 'config.json');
    }
    createdDirectories = ensureProjectAgentDirectories(root, busPath, identity.id, t);
    const projectAgent = withConfigTransaction(busPath, cfg => {
      const existing = cfg.agents.find(agent => agent.id === identity.id);
      if (existing) {
        Object.assign(existing, { adapter: identity.adapter });
      } else {
        cfg.agents.push({ id: identity.id, adapter: identity.adapter });
      }
      cfg.workflow = { ...(cfg.workflow || {}), [role]: identity.id };
      return cfg;
    }).agents.find(agent => agent.id === identity.id);

    // Machine-specific command/args live in the user file.  No absolute
    // executable path is written to .agent-bus unless it was already an
    // explicit project override.
    writeUserConfig(candidateUserConfig);

    const resolved = resolveAgentConfig(projectAgent, readUserConfig());
    const finalAdapter = getAdapter(resolved.adapter, resolved);
    const finalContract = getAdapterContract(finalAdapter);
    const finalCompatibility = finalContract && finalContract.capabilities.configuration
      ? validateConfigurationResult(finalAdapter.validateConfiguration({ setup: true }))
      : finalAdapter.validateConfiguration({ setup: true });
    if (!finalCompatibility.compatible) {
      throw runtimeError(finalCompatibility.code || 'UNSUPPORTED_CAPABILITY', finalCompatibility.details || 'Adapter compatibility check failed after configuration.', {
        recoverable: false,
        agent: identity.id,
        adapter: resolved.adapter,
        command: resolved.command,
        details: finalCompatibility.details,
      });
    }
    if (finalContract && !finalContract.capabilities.detection) {
      throw runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${finalContract.id}" does not support executable detection.`, {
        recoverable: false,
        agent: identity.id,
        adapter: finalContract.id,
        command: resolved.command,
      });
    }
    const finalDetection = finalContract
      ? validateDetectionResult(finalAdapter.detect({ version: true }))
      : finalAdapter.detect({ version: true });
    if (!finalDetection.available) {
      throw runtimeError(canonicalErrorCode(finalDetection.code, 'EXECUTABLE_NOT_FOUND'), finalDetection.details || `Executable is unavailable: ${resolved.command}`, {
        recoverable: true,
        agent: identity.id,
        adapter: resolved.adapter,
        command: resolved.command,
        details: finalDetection.details || null,
        stage: 'executable',
        result: finalDetection,
      });
    }

    const payload = jsonSuccess('setup.configure', {
      root,
      adapters: adapterRegistry,
      agent: {
        id: identity.id,
        adapter: resolved.adapter,
        command: resolved.command,
        commandSource: resolved.commandSource,
        args: resolved.args || [],
        available: true,
        version: finalDetection.version || null,
        resolvedCommand: finalDetection.resolvedCommand || null,
      },
      project: {
        registered: true,
        configPath: projectConfigPath,
        commandStoredInProject: Object.prototype.hasOwnProperty.call(projectAgent, 'command'),
      },
      workflow: { [role]: identity.id },
      doctor: {
        ok: true,
        checks: [{
          name: identity.id,
          adapter: resolved.adapter,
          command: resolved.command,
          commandSource: resolved.commandSource,
          available: true,
          compatible: true,
          version: finalDetection.version || null,
          resolvedCommand: finalDetection.resolvedCommand || null,
        }],
      },
      userConfigPath: configPath,
    });
    if (!json) {
      console.log(`Setup ready: ${identity.id} (${resolved.adapter}) -> ${resolved.command}`);
      console.log(`Workflow ${role}: ${identity.id}`);
      console.log(`Doctor: READY (${finalDetection.version || 'available'})`);
    }
    return payload;
  } catch (error) {
    try {
      if (projectBefore && busPath) {
        withConfigTransaction(busPath, () => JSON.parse(projectBefore));
      }
      restoreUserConfigSnapshot(configPath, hadUserConfig, previousUserConfig);
      for (const directory of createdDirectories.sort((a, b) => b.length - a.length)) {
        if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
      }
    } catch (rollbackError) {
      error.details = `${error.details || error.message || error}; rollback failed: ${rollbackError.message || rollbackError}`;
    }
    throw error;
  }
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
    canonicalCode: canonicalErrorCode(code),
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
    `${t.launchErrorLabel} ${canonicalErrorCode(error.code || 'LAUNCH_FAILED')}\n${error.code && error.code !== canonicalErrorCode(error.code) ? `Legacy code: ${error.code}` : ''}`.trimEnd(),
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

function runLaunchChild(resolved, root, setActiveChild, { json = false, timeoutMs = null } = {}) {
  return new Promise((resolvePromise, reject) => {
    let stdoutTail = '';
    let stderrTail = '';
    let settled = false;
    let timedOut = false;
    let timeoutHandle = null;
    const captureOutput = json || !(process.stdout.isTTY || process.stderr.isTTY);
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
      if (timeoutHandle) clearTimeout(timeoutHandle);
      setActiveChild(null);
      callback(value);
    };
    child.stdout?.on('data', chunk => {
      const text = `${chunk}`;
      stdoutTail = appendTail(stdoutTail, text);
      if (!json) process.stdout.write(chunk);
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
      timedOut,
    }));
    child.once('exit', (status, signal) => {
      finish(resolvePromise, {
        status,
        signal,
        stdoutTail,
        stderrTail,
        resolvedCommand: resolved.resolvedCommand || resolved.command,
        timedOut,
      });
    });
    if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch { /* child may already be gone */ }
        setTimeout(() => {
          if (!settled && !child.killed) {
            try { child.kill(); } catch { /* child may already be gone */ }
          }
        }, Math.min(1000, Math.max(100, Math.floor(timeoutMs / 4))));
      }, timeoutMs);
    }
  });
}

async function launchAgent(options, t) {
  const agentId = options.agent;
  if (!agentId) throw new Error(format(t.badAgent, { agent: '' }));
  validateAgentId(agentId);

  const root = assertGitRepository(options.root, t);
  const busPath = join(root, '.agent-bus');
  assertSafePath(root, busPath, t);
  const associatedTaskId = options.taskId || null;
  const markAssociatedTaskError = error => {
    if (!associatedTaskId) return;
    try { markTaskError(root, associatedTaskId, error); } catch { /* Preserve the primary runtime error. */ }
  };
  if (associatedTaskId) {
    ensureProjectBus(root);
    ensureTaskStore(root);
    const associatedTask = readTask(root, associatedTaskId);
    if (associatedTask.status === 'APPROVED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Approved task cannot launch: ${associatedTaskId}`, { recoverable: false, taskId: associatedTaskId });
    }
    setTaskStatus(root, associatedTaskId, 'IMPLEMENTING');
  }
  const launchDir = join(busPath, 'launch');
  assertSafePath(root, launchDir, t);

  const promptPath = join(launchDir, `${agentId}.txt`);
  assertContained(launchDir, promptPath);
  if (!options.promptText && !existsSync(promptPath)) {
    const error = runtimeError('TASK_STATE_CONFLICT', format(t.launchMissing, { command: packageCommand('quickstart', { root, language: options.language }) }), { recoverable: true, taskId: associatedTaskId });
    markAssociatedTaskError(error);
    throw error;
  }
  if (!options.promptText) assertSafePath(launchDir, promptPath, t, false);
  const prompt = options.promptText ? `${options.promptText}`.trim() : readFileSync(promptPath, 'utf8').trim();

  const busConfig = readConfig(busPath);
  const projectAgentConfig = busConfig.agents.find(a => a.id === agentId);
  if (!projectAgentConfig) {
    const error = runtimeError('INVALID_AGENT_CONFIG', format(t.badAgent, { agent: agentId }), { recoverable: false, agent: agentId, taskId: associatedTaskId });
    markAssociatedTaskError(error);
    throw error;
  }

  const userConfigFile = userConfigPath();
  let resolution = null;
  let agentConfig = projectAgentConfig;
  let adapter = null;
  let adapterContract = null;
  try {
    const userConfig = readUserConfig();
    await loadConfiguredAdaptersForRuntime(userConfig);
    resolution = runtimeAgentConfig(projectAgentConfig, userConfig);
    agentConfig = resolution;
    adapter = getAdapter(resolution.adapter, resolution);
    adapterContract = getAdapterContract(adapter);
  } catch (error) {
    const failure = launchFailure({
      message: compactErrorDetails(error),
      code: /Unknown adapter/i.test(compactErrorDetails(error)) ? 'INVALID_ADAPTER_CONFIG' : 'CONFIG_RESOLUTION_FAILED',
      stage: 'resolve',
      details: compactErrorDetails(error),
      resolution,
      agentConfig,
    });
    try {
      recordBusState(root, agentId, 'ERROR', JSON.stringify({ code: failure.code, details: failure.details }));
    } catch { /* Preserve the primary configuration error. */ }
    markAssociatedTaskError(failure);
    const reportError = new Error(launchFailureReport(failure, {
      agentId, agentConfig, resolution, userConfigFile, language: detectLanguage(options.language), t,
    }));
    Object.assign(reportError, {
      code: failure.code,
      legacyCode: legacyErrorCode(failure.code),
      stage: failure.stage,
      details: failure.details,
      result: failure.result,
      resolution,
      agentConfig,
      recoverable: true,
    });
    throw reportError;
  }

  if (adapterContract && !adapterContract.capabilities.oneShotLaunch) {
    const error = runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${adapterContract.id}" does not support one-shot launches.`, {
      recoverable: false,
      adapter: adapterContract.id,
      agent: agentId,
      taskId: associatedTaskId,
    });
    markAssociatedTaskError(error);
    throw error;
  }
  if (adapterContract && !adapterContract.capabilities.detection) {
    const error = runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${adapterContract.id}" does not support executable detection.`, {
      recoverable: false,
      adapter: adapterContract.id,
      agent: agentId,
      taskId: associatedTaskId,
    });
    markAssociatedTaskError(error);
    throw error;
  }
  const policy = adapterContract
    ? validateLaunchPolicy(adapter.launchPolicy())
    : adapter.launchPolicy();
  if (!policy || !['one-shot', 'bus-supervised'].includes(policy.mode)) {
    const error = runtimeError('INVALID_ADAPTER_CONFIG', `Adapter "${agentConfig.adapter}" returned an invalid launch policy.`, { recoverable: false, adapter: agentConfig.adapter, taskId: associatedTaskId });
    markAssociatedTaskError(error);
    throw error;
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
      if (initialObservation.stopped) {
        if (associatedTaskId) setTaskStatus(root, associatedTaskId, 'STOPPED');
        return { root, agent: agentId, adapter: agentConfig.adapter, status: 'STOPPED' };
      }
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
    const detection = adapterContract
      ? validateDetectionResult(adapter.detect({ version: false }))
      : adapter.detect({ version: false });
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
      let resolved = adapter.resolveLaunch({
        root,
        prompt: activationPrompt,
        agent: agentId,
        language: options.language,
        activation,
      });
      if (adapterContract) {
        resolved = validateRuntimeLaunchPlan(resolved, {
          detection,
          root,
          kind: 'one-shot',
          initialPrompt: activationPrompt,
        });
      }
      let result;
      try {
        result = await runLaunchChild(resolved, root, setActiveChild, { json: options.json, timeoutMs: options.timeoutMs });
      } catch (spawnResult) {
        const spawnError = spawnResult?.error || spawnResult;
        throw launchFailure({
          message: compactErrorDetails(spawnError),
          code: 'SPAWN_FAILED',
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
      if (result.timedOut) {
        throw launchFailure({
          message: format(t.launchFailed, { agent: agentId, status: 'timeout' }),
          code: 'AGENT_TIMEOUT',
          stage: 'runtime',
          details: `Agent ${agentId} exceeded the configured timeout of ${options.timeoutMs}ms.`,
          result,
          resolution,
          agentConfig,
        });
      }
      if (result.status !== 0) {
        const status = result.status ?? result.signal ?? 'unknown';
        const output = `${result.stdoutTail || ''}\n${result.stderrTail || ''}`;
        throw launchFailure({
          message: format(t.launchFailed, { agent: agentId, status }),
          code: isExplicitAuthFailure(output) ? 'AUTH_REQUIRED' : 'PROCESS_EXIT_NON_ZERO',
          stage: 'runtime',
          details: format(t.launchFailed, { agent: agentId, status }),
          result,
          resolution,
          agentConfig,
        });
      }
      if (!supervised) {
        if (associatedTaskId) setTaskStatus(root, associatedTaskId, 'WAITING_IMPLEMENTER');
        return {
          root,
          agent: agentId,
          adapter: agentConfig.adapter,
          command: resolution.command || null,
          supervised: false,
          exitCode: result.status,
        };
      }

      const observation = observeAgentBus(busPath, agentId);
      if (observation.stopped) {
        if (associatedTaskId) setTaskStatus(root, associatedTaskId, 'STOPPED');
        return { root, agent: agentId, adapter: agentConfig.adapter, status: 'STOPPED', supervised: true };
      }
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
      if (nextObservation.stopped) {
        if (associatedTaskId) setTaskStatus(root, associatedTaskId, 'STOPPED');
        return { root, agent: agentId, adapter: agentConfig.adapter, status: 'STOPPED', supervised: true };
      }
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
    if (associatedTaskId) {
      try {
        markAssociatedTaskError(failure);
      } catch { /* Preserve the primary launch failure and artifact. */ }
    }
    const reportError = new Error(launchFailureReport(failure, {
      agentId,
      agentConfig,
      resolution,
      userConfigFile,
      artifactPath,
      language: detectLanguage(options.language),
      t,
    }));
    Object.assign(reportError, {
      code: failure.code || 'LAUNCH_FAILED',
      legacyCode: legacyErrorCode(failure.code || 'LAUNCH_FAILED'),
      stage: failure.stage || 'runtime',
      details: failure.details || failure.message,
      result: failure.result,
      resolution,
      agentConfig,
      artifactPath,
      recoverable: true,
    });
    throw reportError;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

async function handleAgentCommand(options, t) {
  const root = assertGitRepository(options.root, t);
  const busTool = busToolPath;
  if (options.subcommand === 'discover') {
    await setupCommand(options, { json: false });
    return;
  }
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

async function agentCommandJson(options) {
  if (options.subcommand === 'discover') {
    const result = await setupCommand(options, { json: true });
    return { ...result, command: 'agent.discover' };
  }
  if (options.subcommand === 'doctor') return agentDoctorJson(options);
  const root = assertGitRepository(options.root, messages.en);
  if (options.subcommand === 'list') {
    const result = spawnSync(process.execPath, [busToolPath, 'agent-list', '--root', root], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw runtimeError('AGENT_RUNTIME_ERROR', (result.stderr || result.stdout || result.error?.message || 'Agent list failed').trim(), { recoverable: true });
    let agents;
    try { agents = JSON.parse(result.stdout).agents || []; } catch (error) {
      throw runtimeError('AGENT_RUNTIME_ERROR', `Agent list returned invalid JSON: ${error.message}`, { recoverable: true });
    }
    return jsonSuccess('agent.list', { root, agents });
  }
  if (options.subcommand === 'add') {
    const agentId = options.targetAgent || options.agent;
    if (!agentId) throw runtimeError('INVALID_AGENT_CONFIG', '--agent <id> is required for agent add.', { recoverable: false });
    const args = ['agent-add', '--root', root, '--agent', agentId, '--adapter', options.adapter || 'generic-cli'];
    if (options.agentCommand) args.push('--command', options.agentCommand);
    if (options.agentArgs) args.push('--args', options.agentArgs);
    const result = spawnSync(process.execPath, [busToolPath, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
      const details = (result.stderr || result.stdout || result.error?.message || 'Agent add failed').trim();
      throw runtimeError(/Unknown adapter/i.test(details) ? 'INVALID_ADAPTER_CONFIG' : 'INVALID_AGENT_CONFIG', details, { recoverable: false });
    }
    try { return jsonSuccess('agent.add', JSON.parse(result.stdout)); } catch { return jsonSuccess('agent.add', { output: result.stdout.trim() }); }
  }
  throw runtimeError('INVALID_AGENT_CONFIG', `Unknown agent subcommand: ${options.subcommand}`, { recoverable: false });
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
    if (argv.includes('--json')) {
      emitJson(jsonFailure('parse', runtimeError('INVALID_AGENT_CONFIG', raw, { recoverable: false })));
    } else if (raw.startsWith('MISSING_VALUE:')) console.error(format(t.missingValue, { option: raw.split(':')[1] }));
    else if (raw.startsWith('BAD_LANGUAGE:')) console.error(format(t.badLanguage, { language: raw.split(':')[1] }));
    else console.error(raw.replace('UNKNOWN_OPTION:', 'Unknown option: '));
    process.exitCode = 2;
    return;
  }

  const t = messages[language];
  if (options.version) {
    if (options.json) emitJson(jsonSuccess('version', { version: packageJson.version }));
    else console.log(packageJson.version);
    return;
  }
  if (options.help || options.command === 'help') {
    if (options.json) emitJson(jsonSuccess('help', { usage: t.usage }));
    else console.log(t.usage);
    return;
  }

  if (options.command === 'adapter') {
    try {
      const result = await adapterCommand(options, { json: options.json });
      if (options.json) emitJson(result);
    } catch (error) {
      if (options.json) emitJson(jsonFailure(`adapter.${options.subcommand || 'list'}`, error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'config') {
    try {
      if (options.json) emitJson(jsonConfigCommand(options));
      else handleConfigCommand(options, t);
    } catch (error) {
      if (options.json) emitJson(jsonFailure(`config.${options.subcommand || 'list'}`, error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'setup' || options.command === 'discover') {
    try {
      const setupResult = options.command === 'setup' && options.subcommand === 'configure'
        ? await setupConfigureCommand(options, { json: options.json })
        : await setupCommand(options, { json: options.json });
      if (options.json) emitJson(setupResult);
    } catch (error) {
      if (options.json) emitJson(jsonFailure(
        options.command === 'discover' ? 'discover' : (options.subcommand === 'configure' ? 'setup.configure' : 'setup'),
        error,
      ));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'status') {
    try {
      if (options.json) emitJson(statusJson(options));
      else {
        const result = statusJson(options);
        console.log(JSON.stringify(result.bus, null, 2));
        if (result.tasks.length > 0) console.log(JSON.stringify(result.tasks, null, 2));
      }
    } catch (error) {
      if (options.json) emitJson(jsonFailure('status', error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'task') {
    try {
      const result = await taskCommand(options, { json: options.json });
      if (options.json) emitJson(result);
    } catch (error) {
      const graphCommand = ['graph-validate', 'validate-graph'].includes(options.subcommand)
        || (options.subcommand === 'graph' && options.positionals?.[0] === 'validate');
      if (options.json) emitJson(jsonFailure(graphCommand ? 'task.graph-validate' : `task.${options.subcommand || 'status'}`, error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'inspector') {
    try {
      await inspectorCommand(options);
    } catch (error) {
      if (options.json) emitJson(jsonFailure('inspector.start', error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  const expectedManifest = payloadManifest();
  const selectedTargets = targets(options);

  if (options.command === 'agent') {
    try {
      await loadConfiguredAdaptersForRuntime();
      if (options.json) emitJson(await agentCommandJson(options));
      else await handleAgentCommand(options, t);
    } catch (error) {
      if (options.json) emitJson(jsonFailure(`agent.${options.subcommand || 'list'}`, error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'quickstart' || options.command === 'launch') {
    try {
      if (options.command === 'quickstart') quickstart(options, t, language);
      else {
        const result = await launchAgent(options, t);
        if (options.json) emitJson(jsonSuccess('launch', result || { agent: options.agent, root: resolve(options.root) }));
      }
    } catch (error) {
      if (options.json) emitJson(jsonFailure(options.command, error));
      else console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'install' || options.command === 'update') {
    try {
      for (const target of selectedTargets) installTarget(target, expectedManifest, options, t);
      installAuxiliarySkills(options, t);
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'doctor') {
    if (options.json) {
      try {
        const result = doctorJson(options, expectedManifest, selectedTargets);
        emitJson(result);
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        emitJson(jsonFailure('doctor', error));
        process.exitCode = 1;
      }
      return;
    }
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
    uninstallAuxiliarySkills(options, t);
    return;
  }

  console.error(format(t.unknownCommand, { command: options.command }));
  console.error(t.usage);
  process.exitCode = 2;
}

function serviceOptions(input = {}) {
  return {
    command: 'help',
    subcommand: null,
    targetAgent: null,
    root: resolve(`${input.root || process.cwd()}`),
    language: 'en',
    json: true,
    codex: false,
    antigravity: false,
    once: false,
    force: false,
    role: 'implementer',
    roleExplicit: false,
    adapter: 'generic-cli',
    adapterExplicit: false,
    agent: null,
    agentCommand: null,
    agentArgs: null,
    planner: null,
    implementer: null,
    reviewer: null,
    title: '',
    spec: '',
    taskId: null,
    reason: '',
    decision: null,
    feedback: '',
    input: null,
    evidence: null,
    positionals: [],
    ...input,
  };
}

/**
 * Reusable high-level Runtime operations for non-CLI transports.  The CLI
 * handlers above remain the canonical implementation; these adapters only
 * supply their structured options and never spawn the CLI or parse stdout.
 */
export function runtimeSetupDiscover(input = {}) {
  return setupCommand(serviceOptions({ ...input, requireRepository: true }), { json: true });
}

export function runtimeSetupConfigure(input = {}) {
  const options = serviceOptions({
    ...input,
    agent: `${input.agent || ''}`.trim().toLowerCase(),
    agentCommand: `${input.command || ''}`.trim(),
    adapter: input.adapter || 'generic-cli',
    adapterExplicit: input.adapter !== undefined,
    role: `${input.role || 'implementer'}`.trim().toLowerCase(),
    roleExplicit: true,
    agentArgs: input.args === undefined ? null : JSON.stringify(input.args),
  });
  return setupConfigureCommand(options, { json: true });
}

export async function runtimeAdapterRegister(input = {}) {
  return adapterCommand(serviceOptions({
    ...input,
    command: 'adapter',
    subcommand: 'register',
    targetAgent: input.path || input.modulePath || input.targetAgent || null,
  }), { json: true });
}

export async function runtimeAdapterList(input = {}) {
  return adapterCommand(serviceOptions({ ...input, command: 'adapter', subcommand: 'list' }), { json: true });
}

export async function runtimeAdapterRemove(input = {}) {
  return adapterCommand(serviceOptions({
    ...input,
    command: 'adapter',
    subcommand: 'remove',
    targetAgent: input.path || input.modulePath || input.targetAgent || null,
  }), { json: true });
}

export async function runtimeTaskCreate(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'create',
    title: input.title || '',
    spec: input.spec || '',
    taskId: input.id || null,
  }), { json: true });
}

export async function runtimeTaskGraphValidate(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-validate',
    graph: input.graph !== undefined
      ? input.graph
      : (input.input && typeof input.input === 'object' ? input.input : undefined),
  }), { json: true });
}

export async function runtimeTaskOperation(subcommand, input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand,
    taskId: input.taskId || null,
    positionals: [],
  }), { json: true });
}

export async function runtimeRecoverInspect(input = {}) {
  return recoverInspectCommand(serviceOptions({
    ...input,
    command: 'recover',
    subcommand: 'inspect',
    taskId: input.taskId || null,
  }));
}

export { recoverInspectCommand };

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)); }
}

if (isInvokedDirectly()) {
  await run(process.argv.slice(2));
}
