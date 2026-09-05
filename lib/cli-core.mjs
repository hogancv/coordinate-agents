import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
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
import { tmpdir } from 'node:os';
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
} from '../skills/coordinate-agents/adapters/trusted-local.mjs';
import { observeAgentBus, waitForAgentActivity } from '../skills/coordinate-agents/scripts/agent-observer.mjs';
import { discoverCodingClis, setupSnapshot } from '../skills/coordinate-agents/scripts/discovery.mjs';
import {
  assertContained,
  assertSafePath as assertConfigSafePath,
  atomicWrite,
  DEFAULT_CONFIG,
  readConfig,
  readInternalFile,
  safeInternalStat,
  validateAgentId,
  withConfigTransaction,
  writeConfig,
} from '../skills/coordinate-agents/scripts/config.mjs';
import {
  defaultUserConfig,
  defaultCommandForAdapter,
  readUserConfig,
  resolveAgentConfig,
  setUserConfigValue,
  userConfigPath,
  writeUserConfig,
} from '../skills/coordinate-agents/scripts/user-config.mjs';
import {
  createTask,
  ensureTaskStore,
  evidenceId,
  implementationCommit,
  listTasks,
  markTaskError,
  parseBusMessage,
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
  TASK_GRAPH_MAX_ADVANCE_WAVES,
  TASK_GRAPH_MAX_INPUT_BYTES,
  TASK_GRAPH_MAX_SPEC_BYTES,
  taskGraphDurableFacts,
  validateTaskGraphV1,
} from '../skills/coordinate-agents/scripts/task-graph-contract.mjs';
import {
  INTENT_MAP_MAX_INPUT_BYTES,
  intentCoverageFacts,
  validateIntentMapV1,
} from '../skills/coordinate-agents/scripts/intent-map-contract.mjs';
import {
  captureGraphBaseCommit,
  cleanupTaskGraphIntegrationWorktree,
  cleanupTaskGraphWorktree,
  createTaskGraph,
  ensureSubtaskWorktree,
  ensureSubtaskWorktreeBus,
  hasTaskGraph,
  inspectTaskGraphIntegration,
  inspectTaskGraphRecovery,
  integrateTaskGraph,
  listTaskGraphs,
  readTaskGraph,
  readTaskGraphSchedulingSnapshot,
  setTaskGraphIntegration,
  setTaskGraphReview,
  setTaskGraphState,
  setTaskGraphSubtaskState,
  taskGraphBranchName,
  taskGraphBranchRef,
  taskGraphStatusPayload,
  taskGraphWorktreePath,
  verifyDurableImplementationCommit,
  verifyGraphImplementationCommit,
  verifyTaskGraphIntegrationSources,
  validateSubtaskId,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
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
import { auditSubtaskScope, subtaskScopeIntent } from '../skills/coordinate-agents/scripts/scope-audit.mjs';
import { parseConfigValue } from './commands/config.mjs';
import { parseArgs } from './cli/parse-args.mjs';
import { dispatchCommand } from './commands/index.mjs';
import { adapterCommand } from './commands/adapter.mjs';

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
  task          Manage durable tasks and Task Graphs (create, graph-validate, graph-create, graph-plan, graph-run, graph-advance, graph-recover, graph-resume, graph-stop, graph-cleanup, graph-dispatch, graph-integrate, graph-review, graph-status, graph-inspect, dispatch, status, list, inspect, resume, stop, review, error)
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
  --input <path>          Task Graph v1 JSON input for graph-validate/graph-create
  --intent-map <path>     Optional Intent Map v1 JSON companion for graph-create
  --subtask <id>          Selected READY subtask identifier for graph-dispatch
  --session-wait-ms <ms>  Bounded graph dispatch/run observation window (0-10000)
  --max-waves <count>      Maximum graph-advance waves (1-32)
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
  task          管理持久化任务和 Task Graph（create、graph-validate、graph-create、graph-plan、graph-run、graph-advance、graph-recover、graph-resume、graph-stop、graph-cleanup、graph-dispatch、graph-status、graph-inspect、dispatch、status、list、inspect、resume、stop、review、error）
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
  --input <路径>          graph-validate/graph-create 使用的 Task Graph v1 JSON 输入
  --intent-map <路径>     graph-create 使用的可选 Intent Map v1 JSON 配套输入
  --subtask <id>          graph-dispatch 使用的已就绪子任务标识符
  --session-wait-ms <毫秒> graph dispatch/run 的有界观察窗口（0-10000）
  --max-waves <数量>       graph-advance 最大波次数（1-32）
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

function ensureGraphBus(root) {
  const repository = resolve(root);
  const bus = assertConfigSafePath(repository, join(repository, '.agent-bus'));
  const directories = [
    'specs', 'reviews', 'evidence', 'releases', 'dedupe', 'locks', 'logs', 'tmp', 'launch',
    'tasks', 'task-graphs', 'events',
  ];
  mkdirSync(bus, { recursive: true });
  assertConfigSafePath(repository, bus);
  for (const directory of directories) {
    const path = assertConfigSafePath(repository, join(bus, directory));
    mkdirSync(path, { recursive: true });
    assertConfigSafePath(repository, path);
  }
  const cfgFile = join(bus, 'config.json');
  if (!existsSync(cfgFile)) writeConfig(bus, DEFAULT_CONFIG);
  const config = readConfig(bus);
  for (const agent of config.agents) {
    for (const directory of [
      `inbox/${agent.id}/new`,
      `inbox/${agent.id}/processing`,
      `inbox/${agent.id}/processed`,
      `quarantine/${agent.id}`,
      `state/${agent.id}`,
    ]) {
      const path = assertConfigSafePath(repository, join(bus, directory));
      mkdirSync(path, { recursive: true });
      assertConfigSafePath(repository, path);
    }
  }
  // Keep the local durable state out of ordinary Git status without invoking
  // `git rev-parse` (graph creation must not spawn a child process). A linked
  // worktree's .git marker may point outside the repository; in that case we
  // leave exclusion untouched rather than writing beyond the requested root.
  const gitDirectory = join(repository, '.git');
  try {
    const metadata = lstatSync(gitDirectory);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      const info = assertConfigSafePath(repository, join(gitDirectory, 'info'));
      mkdirSync(info, { recursive: true });
      assertConfigSafePath(repository, info);
      const exclude = join(info, 'exclude');
      if (existsSync(exclude)) assertSafePath(repository, exclude, messages.en, false);
      const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
      if (!existing.split(/\r?\n/).includes('.agent-bus/')) {
        appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}.agent-bus/\n`, 'utf8');
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return bus;
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

async function taskAgentResolution(root, task, adapterRegistry = null, { implementerOverride = false } = {}) {
  const busPath = join(root, '.agent-bus');
  const busConfig = readConfig(busPath);
  const workflowImplementer = implementerOverride
    ? task.implementer
    : (busConfig.workflow?.implementer || task.implementer);
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

function taskGraphOperation(options) {
  const subcommand = options.subcommand || '';
  if (['graph-create', 'create-graph'].includes(subcommand)) return 'create';
  if (['graph-plan', 'plan-graph'].includes(subcommand)) return 'plan';
  if (['graph-run', 'run-graph'].includes(subcommand)) return 'run';
  if (['graph-advance', 'advance-graph'].includes(subcommand)) return 'advance';
  if (['graph-recover', 'recover-graph'].includes(subcommand)) return 'recover';
  if (['graph-resume', 'resume-graph'].includes(subcommand)) return 'resume';
  if (['graph-stop', 'stop-graph'].includes(subcommand)) return 'stop';
  if (['graph-cleanup', 'cleanup-graph'].includes(subcommand)) return 'cleanup';
  if (['graph-integrate', 'integrate-graph'].includes(subcommand)) return 'integrate';
  if (['graph-review', 'review-graph'].includes(subcommand)) return 'review';
  if (['graph-status', 'status-graph'].includes(subcommand)) return 'status';
  if (['graph-inspect', 'inspect-graph'].includes(subcommand)) return 'inspect';
  if (['graph-dispatch', 'dispatch-graph'].includes(subcommand)) return 'dispatch';
  if (subcommand !== 'graph') return null;
  const nested = options.positionals?.[0];
  return ['create', 'plan', 'run', 'advance', 'recover', 'resume', 'stop', 'cleanup', 'integrate', 'review', 'status', 'inspect', 'dispatch'].includes(nested) ? nested : null;
}

function graphInput(options) {
  const hasInlineGraph = Object.prototype.hasOwnProperty.call(options, 'graph') && options.graph !== undefined;
  return hasInlineGraph ? options.graph : readTaskGraphInput(options.input);
}

function intentMapInput(options) {
  if (Object.prototype.hasOwnProperty.call(options, 'intentMap') && options.intentMap !== undefined) {
    return options.intentMap;
  }
  if (!options.intentMapInput) return null;
  return readBoundedJsonInput(options.intentMapInput, {
    label: 'Intent Map v1',
    maxBytes: INTENT_MAP_MAX_INPUT_BYTES,
    stage: 'intent-map-validation',
  });
}

function configuredGraphAgents(root) {
  const busPath = join(resolve(root), '.agent-bus');
  try {
    if (existsSync(busPath)) assertSafePath(resolve(root), busPath, messages.en);
    const config = readConfig(busPath);
    return { config, agents: config.agents.map(agent => agent.id) };
  } catch (error) {
    throw runtimeError('TASK_GRAPH_INVALID', `Unable to read configured Agents for Task Graph v1: ${error.message || error}`, {
      recoverable: false,
      stage: 'graph-validation',
      root: resolve(root),
    });
  }
}

async function taskGraphCreateCommand(options, { json = false } = {}) {
  const requestedRoot = resolve(options.root);
  const input = graphInput(options);
  const repository = assertGitRepositoryWithoutProcess(requestedRoot, messages.en);
  // Read the existing registry (or the canonical default when the Bus has not
  // been initialized) and validate before initializing the Bus or invoking
  // any Adapter, Session, or child process.
  const configured = configuredGraphAgents(repository);
  const validated = validateTaskGraphV1(input, { configuredAgents: configured.agents });
  const validatedIntentMap = validateIntentMapV1(intentMapInput(options), validated);
  ensureGraphBus(repository);
  const afterInit = configuredGraphAgents(repository);
  const effective = validateTaskGraphV1(input, { configuredAgents: afterInit.agents });
  const created = createTaskGraph(repository, effective, { validated: true, intentMap: validatedIntentMap });
  const payload = jsonSuccess('task.graph-create', {
    ...taskGraphStatusPayload(repository, created.graph),
    event: created.event,
    validation: { valid: true, sideEffects: true },
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function graphTaskId(options, root) {
  const direct = options.taskId || null;
  if (direct) return direct;
  const isGraphSubcommand = options.subcommand === 'graph';
  const nestedPos0 = options.positionals?.[0];
  const nested = isGraphSubcommand && ['status', 'inspect', 'dispatch', 'create', 'validate', 'plan', 'run', 'advance', 'recover', 'resume', 'stop', 'cleanup', 'integrate', 'review'].includes(nestedPos0)
    ? options.positionals?.[1]
    : options.positionals?.[0];
  if (nested) return nested;
  const graphs = listTaskGraphs(root);
  if (graphs.length === 0) throw runtimeError('TASK_NOT_FOUND', 'No Task Graph exists for this project.', { recoverable: false, root });
  return graphs[0].parentTaskId;
}

function taskGraphViewCommand(options, operation, { json = false, commandName = null } = {}) {
  const root = assertGitRepositoryWithoutProcess(options.root, messages.en);
  const taskId = graphTaskId(options, root);
  const graph = readTaskGraph(root, taskId);
  const command = commandName || `task.graph-${operation}`;
  const payload = jsonSuccess(command, taskGraphStatusPayload(root, graph, { inspect: operation === 'inspect' }));
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function schedulingDecision(graph, subtask, agent, eligibleIds, capacityLimitedIds, conflictById, waveReasons, intentCoverageAvailable) {
  const dependencies = subtask.dependsOn.map(id => {
    const dependency = graph.subtasks.find(candidate => candidate.id === id);
    return { id, state: dependency.state };
  });
  let decision = subtask.state;
  let reason = subtask.reason;
  if (eligibleIds.has(subtask.id)) {
    decision = 'ELIGIBLE';
    reason = intentCoverageAvailable
      ? (subtask.dependsOn.length === 0
        ? 'Eligible: no dependencies, no selected write-intent conflict, and a concurrency slot is available.'
        : 'Eligible: all dependencies succeeded, no selected write-intent conflict exists, and a concurrency slot is available.')
      : (subtask.dependsOn.length === 0
        ? 'Eligible: no dependencies and a concurrency slot is available.'
        : 'Eligible: all dependencies succeeded and a concurrency slot is available.');
  } else if (conflictById.has(subtask.id)) {
    decision = 'WRITE_INTENT_CONFLICT';
    reason = waveReasons[subtask.id];
  } else if (capacityLimitedIds.has(subtask.id)) {
    decision = 'CAPACITY_LIMITED';
    reason = waveReasons[subtask.id]
      || `Capacity-limited: ${graph.frontier.runningCount} of ${graph.maxConcurrency} slots are running and earlier READY subtasks consume the remaining slots.`;
  } else if (subtask.state === 'RUNNING') {
    reason = 'Running: this subtask already consumes one concurrency slot.';
  } else if (subtask.state === 'SUCCEEDED') {
    reason = 'Not schedulable: this subtask already succeeded.';
  } else if (subtask.state === 'FAILED') {
    reason = subtask.reason || 'Not schedulable: this subtask failed and requires explicit recovery.';
  } else if (subtask.state === 'STOPPED') {
    reason = subtask.reason || 'Not schedulable: this subtask was stopped and requires explicit recovery.';
  } else if (subtask.state === 'BLOCKED') {
    reason = subtask.reason || 'Blocked: at least one dependency did not succeed.';
  } else if (subtask.state === 'WAITING' || subtask.state === 'PENDING') {
    reason = subtask.reason || 'Waiting: not every dependency has succeeded.';
  }
  return {
    subtaskId: subtask.id,
    implementer: subtask.implementer,
    state: subtask.state,
    decision,
    reason: redactOutput(reason || 'Not schedulable.', 2 * 1024),
    dependencies,
    agent,
    ...(conflictById.has(subtask.id) ? { conflict: conflictById.get(subtask.id) } : {}),
  };
}

function graphPreflightFacts(decisions, intentCoverage) {
  const selected = decisions.filter(item => item.decision === 'ELIGIBLE');
  const conflictDeferred = decisions.filter(item => item.decision === 'WRITE_INTENT_CONFLICT');
  const capacityLimited = decisions.filter(item => item.decision === 'CAPACITY_LIMITED');
  const risks = [];
  if (!intentCoverage.available) {
    risks.push({
      code: 'INTENT_COVERAGE_UNAVAILABLE',
      severity: 'warning',
      affectedSubtasks: selected.map(item => item.subtaskId),
      message: 'No Intent Map is available; this legacy-compatible wave does not prove that concurrent writes are safe.',
    });
  }
  if (conflictDeferred.length > 0) {
    risks.push({
      code: 'WRITE_INTENT_CONFLICT',
      severity: 'warning',
      affectedSubtasks: conflictDeferred.map(item => item.subtaskId),
      message: `${conflictDeferred.length} READY subtask(s) are deferred because their declared write intents conflict with earlier selected work.`,
    });
  }
  if (capacityLimited.length > 0) {
    risks.push({
      code: 'CAPACITY_LIMITED',
      severity: 'info',
      affectedSubtasks: capacityLimited.map(item => item.subtaskId),
      message: `${capacityLimited.length} READY subtask(s) are deferred by the persisted concurrency limit.`,
    });
  }
  const selectedCount = selected.length;
  return {
    schemaVersion: 1,
    deterministic: true,
    sideEffects: false,
    scopePolicy: intentCoverage.scopePolicy,
    concurrentWriteSafety: intentCoverage.available ? 'DECLARED_NON_CONFLICTING' : 'UNVERIFIED',
    estimates: {
      basis: 'current-selected-wave',
      selectedSubtaskCount: selectedCount,
      worktreeCount: selectedCount,
      branchCount: selectedCount,
      busMessageCount: selectedCount,
      sessionCount: selectedCount,
      processCount: selectedCount,
    },
    risks,
    boundaries: {
      changesDependencies: false,
      dispatchesAgents: false,
      authorizesReview: false,
      authorizesRelease: false,
      requiresExplicitGraphRun: true,
      releaseApproval: 'RELEASE_APPROVED',
    },
  };
}

async function taskGraphPlanCommand(options, { json = false } = {}) {
  const root = assertGitRepositoryWithoutProcess(options.root, messages.en);
  const taskId = graphTaskId(options, root);
  const { graph, scheduling } = readTaskGraphSchedulingSnapshot(root, taskId);
  const userConfig = readUserConfig();
  const adapterRegistry = await loadConfiguredAdaptersForRuntime(userConfig);
  const busConfig = readConfig(join(root, '.agent-bus'));
  if (!busConfig.agents.some(agent => agent.id === graph.parentTask.planner)) {
    throw runtimeError('INVALID_AGENT_CONFIG', `Task Graph planner is not registered: ${graph.parentTask.planner}`, {
      recoverable: false,
      taskId: graph.parentTaskId,
      agent: graph.parentTask.planner,
    });
  }
  const agentFacts = new Map();

  for (const implementer of [...new Set(graph.subtasks.map(subtask => subtask.implementer))].sort()) {
    const projectAgent = busConfig.agents.find(agent => agent.id === implementer);
    if (!projectAgent) {
      throw runtimeError('INVALID_AGENT_CONFIG', `Task Graph Implementer is not registered: ${implementer}`, {
        recoverable: false,
        taskId: graph.parentTaskId,
        agent: implementer,
      });
    }
    const resolved = runtimeAgentConfig(projectAgent, userConfig);
    const registryAdapter = adapterRegistry.find(item => item.id === resolved.adapter) || null;
    if (!registryAdapter) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', `Task Graph Implementer ${implementer} references an unregistered Adapter: ${resolved.adapter}`, {
        recoverable: false,
        taskId: graph.parentTaskId,
        agent: implementer,
        adapter: resolved.adapter,
        stage: 'adapter',
      });
    }
    if (!resolved.command) {
      throw runtimeError('INVALID_AGENT_CONFIG', `No executable command is configured for Task Graph Implementer ${implementer}.`, {
        recoverable: false,
        taskId: graph.parentTaskId,
        agent: implementer,
        adapter: resolved.adapter,
        stage: 'executable',
      });
    }
    agentFacts.set(implementer, {
      id: implementer,
      registered: true,
      adapter: resolved.adapter,
      adapterContractVersion: registryAdapter.contractVersion || null,
      adapterCapabilities: registryAdapter.capabilities || null,
      command: resolved.command,
      commandSource: resolved.commandSource,
      argsSource: resolved.argsSource || null,
    });
  }

  const eligibleIds = new Set(scheduling.wave.selected);
  const capacityLimitedIds = new Set(scheduling.wave.capacityLimited);
  const conflictById = new Map(scheduling.wave.conflicts.map(conflict => {
    const deferred = conflict.subtasks.find(id => scheduling.wave.conflictDeferred.includes(id));
    return [deferred, conflict];
  }));
  const decisions = [...scheduling.subtasks]
    .sort((left, right) => (left.id < right.id ? -1 : (left.id > right.id ? 1 : 0)))
    .map(subtask => schedulingDecision(
      graph,
      subtask,
      agentFacts.get(subtask.implementer),
      eligibleIds,
      capacityLimitedIds,
      conflictById,
      scheduling.wave.reasons,
      scheduling.wave.intentCoverageAvailable,
    ));
  const intentCoverage = intentCoverageFacts(graph);
  const payload = jsonSuccess('task.graph-plan', {
    root,
    graphId: graph.parentTaskId,
    parentTaskId: graph.parentTaskId,
    graph,
    frontier: graph.frontier,
    plan: {
      schemaVersion: 1,
      deterministic: true,
      sideEffects: false,
      maxConcurrency: graph.maxConcurrency,
      runningCount: scheduling.frontier.runningCount,
      availableSlots: scheduling.frontier.availableSlots,
      eligible: decisions.filter(item => item.decision === 'ELIGIBLE'),
      capacityLimited: decisions.filter(item => item.decision === 'CAPACITY_LIMITED'),
      conflictDeferred: decisions.filter(item => item.decision === 'WRITE_INTENT_CONFLICT'),
      conflicts: scheduling.wave.conflicts,
      wave: scheduling.wave,
      decisions,
      intentCoverage,
      preflight: graphPreflightFacts(decisions, intentCoverage),
    },
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function taskGraphRunCommand(options, { json = false, planned = null } = {}) {
  const effectivePlan = planned || await taskGraphPlanCommand(options, { json: true });
  const repository = effectivePlan.root;
  const parentTaskId = effectivePlan.parentTaskId;
  const selected = effectivePlan.plan.eligible.map(item => item.subtaskId);
  const graphBaseCommit = selected.length > 0
    ? (effectivePlan.graph.baseCommit || effectivePlan.graph.parentTask?.baseCommit || captureGraphBaseCommit(repository))
    : (effectivePlan.graph.baseCommit || effectivePlan.graph.parentTask?.baseCommit || null);

  const settled = await Promise.allSettled(selected.map(subtaskId => taskGraphDispatchCommand({
    ...options,
    root: repository,
    taskId: parentTaskId,
    subtaskId,
    graphBaseCommit,
    positionals: [],
  }, { json: true })));

  const outcomes = settled.map((result, index) => {
    const subtaskId = selected[index];
    if (result.status === 'fulfilled') {
      const dispatched = result.value;
      return {
        ok: true,
        subtaskId,
        state: dispatched.subtask.state,
        worktree: dispatched.worktree,
        session: dispatched.session,
        agent: dispatched.agent,
        implementationCommit: dispatched.implementationCommit,
        evidence: dispatched.evidence,
      };
    }
    let subtask = null;
    try { subtask = readTaskGraph(repository, parentTaskId).subtasks.find(item => item.id === subtaskId) || null; } catch { /* Preserve the dispatch error. */ }
    return {
      ok: false,
      subtaskId,
      state: subtask?.state || null,
      sessionId: subtask?.sessionId || null,
      worktreePath: subtask?.worktreePath || null,
      error: serializeRuntimeError(result.reason, { includeLegacy: true }),
      evidence: subtask?.evidence || [],
    };
  });
  const latestGraph = readTaskGraph(repository, parentTaskId);
  const counts = state => outcomes.filter(outcome => outcome.state === state).length;
  const payload = jsonSuccess('task.graph-run', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    baseCommit: graphBaseCommit,
    selected,
    initialPlan: effectivePlan.plan,
    outcomes,
    summary: {
      selected: selected.length,
      succeeded: counts('SUCCEEDED'),
      running: counts('RUNNING'),
      failed: outcomes.filter(outcome => !outcome.ok || outcome.state === 'FAILED').length,
    },
    graph: latestGraph,
    frontier: latestGraph.frontier,
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function graphAdvanceStaticStop(graph) {
  if (graph.review?.decision === 'CHANGES_REQUESTED') {
    return {
      code: 'CHANGES_REQUESTED',
      reason: 'Advance stopped because aggregate review requested changes; review and recovery remain explicit.',
      subtaskIds: [],
    };
  }
  if (graph.integration?.conflict) {
    return {
      code: 'INTEGRATION_CONFLICT',
      reason: 'Advance stopped because the durable integration record contains a conflict requiring explicit resolution or cleanup.',
      subtaskIds: [],
    };
  }
  if (graph.integration?.state === 'FAILED') {
    return {
      code: 'INTEGRATION_FAILED',
      reason: 'Advance stopped because graph integration failed and requires an explicit integration recovery decision.',
      subtaskIds: [],
    };
  }
  if (graph.state === 'STOPPED') {
    return { code: 'GRAPH_STOPPED', reason: 'Advance stopped because the graph is stopped.', subtaskIds: [] };
  }
  for (const [state, code, reason] of [
    ['FAILED', 'SUBTASK_FAILED', 'Advance stopped because one or more subtasks failed and require explicit recovery.'],
    ['BLOCKED', 'SUBTASK_BLOCKED', 'Advance stopped because one or more subtasks are blocked.'],
    ['STOPPED', 'SUBTASK_STOPPED', 'Advance stopped because one or more subtasks are stopped and require an explicit resume decision.'],
  ]) {
    const subtaskIds = graph.subtasks.filter(item => item.state === state).map(item => item.id);
    if (subtaskIds.length > 0) return { code, reason, subtaskIds };
  }
  return null;
}

function graphAdvanceStop(code, reason, waveNumber, subtaskIds = []) {
  return { code, reason, waveNumber, subtaskIds };
}

async function taskGraphAdvanceCommand(options, { json = false } = {}) {
  const maxWaves = options.maxWaves;
  if (!Number.isInteger(maxWaves) || maxWaves < 1 || maxWaves > TASK_GRAPH_MAX_ADVANCE_WAVES) {
    throw runtimeError('TASK_GRAPH_INVALID', `graph-advance requires --max-waves from 1 to ${TASK_GRAPH_MAX_ADVANCE_WAVES}.`, {
      recoverable: false,
      taskId: options.taskId || null,
      root: resolve(options.root),
      stage: 'graph-advance',
      details: { maxWaves, minimum: 1, maximum: TASK_GRAPH_MAX_ADVANCE_WAVES },
    });
  }
  const root = assertGitRepositoryWithoutProcess(options.root, messages.en);
  const taskId = graphTaskId(options, root);
  const waves = [];
  let finalPlan = null;
  let stop = null;

  while (waves.length < maxWaves) {
    let graph = readTaskGraph(root, taskId);
    const staticStop = graphAdvanceStaticStop(graph);
    if (staticStop) {
      stop = graphAdvanceStop(staticStop.code, staticStop.reason, waves.length + 1, staticStop.subtaskIds);
      break;
    }

    const planned = await taskGraphPlanCommand({ ...options, root, taskId, positionals: [] }, { json: true });
    finalPlan = planned.plan;
    if (planned.plan.conflictDeferred.length > 0) {
      stop = graphAdvanceStop(
        'WRITE_INTENT_CONFLICT',
        'Advance stopped at Preflight because READY work has a declared write-intent conflict; use explicit graph-run or revise the plan.',
        waves.length + 1,
        planned.plan.conflictDeferred.map(item => item.subtaskId),
      );
      break;
    }
    const selected = planned.plan.eligible.map(item => item.subtaskId);
    if (selected.length === 0) {
      const running = graph.subtasks.filter(item => item.state === 'RUNNING').map(item => item.id);
      if (running.length > 0) {
        stop = graphAdvanceStop('SUBTASKS_RUNNING', 'Advance stopped because existing RUNNING work must finish or use explicit recovery; it was not redispatched.', waves.length + 1, running);
      } else if (graph.subtasks.every(item => item.state === 'SUCCEEDED')) {
        stop = graphAdvanceStop('COMPLETED', 'All graph subtasks succeeded; integration, review, and release remain explicit.', waves.length + 1);
      } else {
        stop = graphAdvanceStop('NO_ELIGIBLE_WORK', 'Advance stopped because Preflight found no eligible READY work.', waves.length + 1);
      }
      break;
    }

    const run = await taskGraphRunCommand({ ...options, root, taskId, positionals: [] }, { json: true, planned });
    waves.push({
      waveNumber: waves.length + 1,
      plan: run.initialPlan,
      selected: run.selected,
      outcomes: run.outcomes,
      summary: run.summary,
    });
    graph = run.graph;
    const unsuccessful = run.outcomes.filter(outcome => !outcome.ok || outcome.state !== 'SUCCEEDED');
    if (unsuccessful.length > 0) {
      const running = unsuccessful.filter(outcome => outcome.state === 'RUNNING').map(outcome => outcome.subtaskId);
      stop = running.length > 0
        ? graphAdvanceStop('SUBTASKS_RUNNING', 'Advance stopped after the bounded observation window; healthy RUNNING Sessions were left intact and were not redispatched.', waves.length, running)
        : graphAdvanceStop('WAVE_FAILED', 'Advance stopped because the wave had a non-success outcome; recovery and redispatch remain explicit.', waves.length, unsuccessful.map(outcome => outcome.subtaskId));
      break;
    }
    const afterWaveStop = graphAdvanceStaticStop(graph);
    if (afterWaveStop) {
      stop = graphAdvanceStop(afterWaveStop.code, afterWaveStop.reason, waves.length, afterWaveStop.subtaskIds);
      break;
    }
    if (graph.subtasks.every(item => item.state === 'SUCCEEDED')) {
      stop = graphAdvanceStop('COMPLETED', 'All graph subtasks succeeded; integration, review, and release remain explicit.', waves.length);
      break;
    }
  }

  const graph = readTaskGraph(root, taskId);
  if (!stop) {
    stop = graphAdvanceStop('MAX_WAVES_REACHED', `Advance reached the caller-authorized limit of ${maxWaves} wave(s).`, waves.length);
  }
  const payload = jsonSuccess('task.graph-advance', {
    root,
    graphId: taskId,
    parentTaskId: taskId,
    maxWaves,
    wavesExecuted: waves.length,
    waves,
    finalPlan,
    stop,
    graph,
    frontier: graph.frontier,
    boundaries: {
      automaticRetry: false,
      recursiveDispatch: false,
      mutatesDependencies: false,
      integrates: false,
      reviews: false,
      authorizesRelease: false,
    },
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

const GRAPH_RECOVERY_OPERATIONS = new Set(['recover', 'resume', 'stop', 'cleanup']);

function graphSubtaskOption(options) {
  if (options.subtaskId) return options.subtaskId;
  if (options.subcommand === 'graph' && GRAPH_RECOVERY_OPERATIONS.has(options.positionals?.[0])) return options.positionals?.[2] || null;
  return options.positionals?.[1] || null;
}

function graphSubtaskSelection(options, graph, { includeTerminal = false } = {}) {
  const requested = graphSubtaskOption(options);
  if (requested) {
    validateSubtaskId(requested);
    const selected = graph.subtasks.find(subtask => subtask.id === requested);
    if (!selected) throw runtimeError('TASK_NOT_FOUND', `Task Graph subtask not found: ${graph.parentTaskId}/${requested}`, {
      recoverable: false,
      taskId: graph.parentTaskId,
      subtaskId: requested,
      root: resolve(options.root),
    });
    return [selected];
  }
  return graph.subtasks
    .filter(subtask => includeTerminal || !['SUCCEEDED', 'BLOCKED'].includes(subtask.state))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function graphDescendantIds(graph, subtaskId) {
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const subtask of graph.subtasks) {
      if (descendants.has(subtask.id) || !subtask.dependsOn.some(dependency => dependency === subtaskId || descendants.has(dependency))) continue;
      descendants.add(subtask.id);
      changed = true;
    }
  }
  return descendants;
}

function graphRecoveryError(code, message, graph, subtask, recovery = null, details = null) {
  return runtimeError(code, message, {
    recoverable: true,
    taskId: graph.parentTaskId,
    subtaskId: subtask?.id || null,
    agent: subtask?.implementer || null,
    sessionId: subtask?.sessionId || recovery?.session?.id || null,
    root: recovery?.root || null,
    stage: 'graph-recovery',
    details: details || {
      parentTaskId: graph.parentTaskId,
      subtaskId: subtask?.id || null,
      worktreePath: recovery?.worktree?.path || subtask?.worktreePath || null,
      sessionId: subtask?.sessionId || recovery?.session?.id || null,
      classification: recovery?.classification || null,
    },
  });
}

function graphRecoverySummary(graph, options = {}) {
  return inspectTaskGraphRecovery(options.root, graph, { probeGit: Boolean(options.probeGit) });
}

function graphCompletionForRecovery(repository, graph, subtask, recovery) {
  const baseCommit = graph.baseCommit || graph.parentTask?.baseCommit || subtask.baseCommit || null;
  if (!baseCommit) return { error: graphRecoveryError('TASK_STATE_CONFLICT', `No captured graph base commit exists for ${graph.parentTaskId}/${subtask.id}.`, graph, subtask, recovery) };

  // Prefer completion facts already persisted on the subtask.  A coordinator
  // can be interrupted after the Agent has committed and the Runtime has
  // persisted evidence but before the normal message scan runs; re-reading
  // those durable facts must promote the existing result rather than replaying
  // a Bus message or dispatching another input.
  const durableCommit = `${subtask.implementationCommit || ''}`.trim();
  const durableEvidence = Array.isArray(subtask.evidence)
    ? [...subtask.evidence].reverse().find(item => item?.type === 'IMPLEMENTATION_DONE'
      && typeof item.relatedCommit === 'string'
      && durableCommit
      && item.relatedCommit.toLowerCase() === durableCommit.toLowerCase())
    : null;
  if (durableCommit && durableEvidence) {
    try {
      const worktreeAvailable = recovery?.worktree?.exists && recovery.worktree.safe && recovery.worktree.owned === true;
      let commit;
      if (worktreeAvailable) {
        commit = verifyGraphImplementationCommit(recovery.worktree.path, baseCommit, durableCommit);
      } else if (verifyDurableImplementationCommit(repository, graph, subtask)) {
        // The exact Runtime record and IMPLEMENTATION_DONE evidence are
        // durable even if interruption cleanup already removed the worktree;
        // verify the captured commit/base/ref chain from the repository and
        // retain the canonical full hash without replaying any message.
        commit = durableCommit.toLowerCase();
      } else {
        throw runtimeError('AGENT_RUNTIME_ERROR', `Durable implementation commit cannot be verified for ${graph.parentTaskId}/${subtask.id}: ${durableCommit}`, {
          recoverable: true,
          taskId: graph.parentTaskId,
          subtaskId: subtask.id,
          agent: subtask.implementer,
          root: repository,
          stage: 'completion',
        });
      }
      return { commit, evidence: [durableEvidence] };
    } catch (error) {
      return { error: graphRecoveryError(
        error.code || 'AGENT_RUNTIME_ERROR',
        error.message || String(error),
        graph,
        subtask,
        recovery,
        { parentTaskId: graph.parentTaskId, subtaskId: subtask.id, worktreePath: recovery?.worktree?.path || null, sessionId: subtask.sessionId || null, cause: serializeRuntimeError(error, { includeLegacy: true }) },
      ) };
    }
  }

  // Message bodies are only readable from the exact Runtime-owned worktree;
  // an unregistered or mismatched user path must never promote a subtask. A
  // verified durable commit/evidence pair above remains valid even when the
  // worktree has already disappeared after a coordinator interruption.
  if (!recovery?.worktree?.exists || !recovery.worktree.safe || recovery.worktree.owned !== true) return null;

  const message = findSubtaskImplementationMessages(
    recovery.worktree.path,
    graph.parentTaskId,
    subtask.id,
    subtask.implementer,
    graph.parentTask.planner,
  ).at(-1);
  if (!message) return null;
  try {
    return graphCompletionFromMessage(message, recovery.worktree.path, baseCommit);
  } catch (error) {
    return { error: graphRecoveryError(
      error.code || 'AGENT_RUNTIME_ERROR',
      error.message || String(error),
      graph,
      subtask,
      recovery,
      { parentTaskId: graph.parentTaskId, subtaskId: subtask.id, worktreePath: recovery?.worktree?.path || null, sessionId: subtask.sessionId || null, cause: serializeRuntimeError(error, { includeLegacy: true }) },
    ) };
  }
}

async function observeGraphSubtask(repository, graph, subtask, recovery, expectedState = 'RUNNING') {
  const completion = graphCompletionForRecovery(repository, graph, subtask, recovery);
  if (completion?.error) return { state: subtask.state, completed: false, error: completion.error };
  if (!completion) return { state: subtask.state, completed: false, error: null };

  // Post-execution scope audit on the recovery path.
  const baseCommitForAudit = graph.baseCommit || graph.parentTask?.baseCommit;
  const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, subtask.id);
  let scopeEvidence = null;
  let auditDrift = false;
  if (scopePolicy !== null) {
    const auditWorktreeExists = recovery?.worktree?.exists === true
      && recovery.worktree.safe === true
      && recovery.worktree.owned === true;
    scopeEvidence = auditSubtaskScope({
      parentTaskId: graph.parentTaskId,
      subtaskId: subtask.id,
      graphBaseCommit: baseCommitForAudit,
      implementationCommit: completion.commit,
      worktreePath: auditWorktreeExists ? recovery.worktree.path : repository,
      writeIntent,
      scopePolicy,
      inspectDirty: auditWorktreeExists,
    });
    auditDrift = scopeEvidence.drift === true;
  }

  if (auditDrift && scopePolicy === 'strict') {
    const driftPaths = (scopeEvidence.outsideIntentPaths || []);
    const driftMessage = `Subtask ${graph.parentTaskId}/${subtask.id} has INTENT_SCOPE_DRIFT under strict policy: ${driftPaths.slice(0, 4).join(', ')}${driftPaths.length > 4 ? '…' : ''}`;
    setTaskGraphSubtaskState(repository, graph.parentTaskId, subtask.id, 'FAILED', {
      expectedState,
      implementationCommit: completion.commit,
      evidence: completion.evidence,
      ...(recovery?.worktree?.path ? { worktreePath: recovery.worktree.path } : {}),
      ...(recovery?.worktree?.branch ? { branch: recovery.worktree.branch } : {}),
      ...(recovery?.worktree?.ref ? { ref: recovery.worktree.ref } : {}),
      baseCommit: baseCommitForAudit,
      sessionId: subtask.sessionId || null,
      lastError: { code: 'INTENT_SCOPE_DRIFT', message: driftMessage, recoverable: true },
      recoverBlockedIds: [],
      scopeEvidence,
    });
    return { state: 'FAILED', completed: false, error: { code: 'INTENT_SCOPE_DRIFT', message: driftMessage, recoverable: true }, commit: completion.commit, evidence: completion.evidence, scopeEvidence };
  }

  const warnReason = (auditDrift && scopePolicy === 'warn')
    ? `INTENT_SCOPE_DRIFT: ${(scopeEvidence.outsideIntentPaths || []).slice(0, 4).join(', ')}${(scopeEvidence.outsideIntentPaths || []).length > 4 ? '…' : ''}`
    : null;

  const updated = setTaskGraphSubtaskState(repository, graph.parentTaskId, subtask.id, 'SUCCEEDED', {
    expectedState,
    implementationCommit: completion.commit,
    evidence: completion.evidence,
    ...(recovery?.worktree?.path ? { worktreePath: recovery.worktree.path } : {}),
    ...(recovery?.worktree?.branch ? { branch: recovery.worktree.branch } : {}),
    ...(recovery?.worktree?.ref ? { ref: recovery.worktree.ref } : {}),
    baseCommit: baseCommitForAudit,
    sessionId: subtask.sessionId || null,
    lastError: null,
    // A verified completion is an explicit valid recovery path. Reconcile
    // blocked descendants in the same locked transition so they cannot stay
    // permanently BLOCKED after their prerequisite has succeeded.
    recoverBlockedIds: [...graphDescendantIds(graph, subtask.id)],
    recovery: {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      operation: 'graph-recover',
      classification: 'completed',
      completedAt: new Date().toISOString(),
    },
    ...(warnReason ? { reason: warnReason } : {}),
    ...(scopeEvidence !== null ? { scopeEvidence } : {}),
  });
  return { state: updated.graph.subtasks.find(item => item.id === subtask.id)?.state || 'SUCCEEDED', completed: true, error: null, commit: completion.commit, evidence: completion.evidence, scopeEvidence };
}

function serializedGraphError(error, graph, subtask, recovery) {
  const normalized = error?.code ? error : graphRecoveryError('TASK_STATE_CONFLICT', error?.message || String(error), graph, subtask, recovery);
  const output = serializeRuntimeError(normalized, { includeLegacy: true });
  if (!output.taskId) output.taskId = graph.parentTaskId;
  if (!output.subtaskId) output.subtaskId = subtask?.id || null;
  if (!output.agent) output.agent = subtask?.implementer || null;
  if (!output.sessionId && (subtask?.sessionId || recovery?.session?.id)) output.sessionId = subtask?.sessionId || recovery.session.id;
  if (!output.root) output.root = recovery?.root || null;
  if (!output.worktreePath && (subtask?.worktreePath || recovery?.worktree?.path)) output.worktreePath = subtask?.worktreePath || recovery.worktree.path;
  if (!output.branch && (subtask?.branch || recovery?.worktree?.branch)) output.branch = subtask?.branch || recovery.worktree.branch;
  if (!output.ref && (subtask?.ref || recovery?.worktree?.ref)) output.ref = subtask?.ref || recovery.worktree.ref;
  return output;
}

function graphIdentityFacts(repository, graph, subtask, recovery = null) {
  return {
    root: repository,
    parentTaskId: graph.parentTaskId,
    subtaskId: subtask?.id || null,
    agent: subtask?.implementer || null,
    sessionId: subtask?.sessionId || recovery?.session?.id || null,
    worktreePath: subtask?.worktreePath || recovery?.worktree?.path || null,
    branch: subtask?.branch || recovery?.worktree?.branch || null,
    ref: subtask?.ref || recovery?.worktree?.ref || null,
  };
}

function scopedStopParentState(graph, subtaskId) {
  const remaining = graph.subtasks.filter(subtask => subtask.id !== subtaskId);
  if (remaining.some(subtask => ['FAILED', 'BLOCKED'].includes(subtask.state))) return 'ERROR';
  if (remaining.some(subtask => ['RUNNING', 'READY', 'WAITING'].includes(subtask.state))) {
    return graph.state === 'CREATED' ? 'CREATED' : 'RUNNING';
  }
  return 'STOPPED';
}

async function taskGraphRecoverCommand(options, { json = false } = {}) {
  const repository = assertGitRepository(options.root, messages.en);
  const parentTaskId = graphTaskId(options, repository);
  let graph = readTaskGraph(repository, parentTaskId);
  const selected = graphSubtaskSelection(options, graph);
  const before = graphRecoverySummary(graph, { root: repository, probeGit: true });
  const outcomes = [];
  for (const original of selected) {
    let currentGraph = readTaskGraph(repository, parentTaskId);
    const subtask = currentGraph.subtasks.find(item => item.id === original.id);
    const recovery = inspectTaskGraphRecovery(repository, currentGraph, { probeGit: true }).find(item => item.subtaskId === original.id);
    if (!subtask || !recovery) continue;
    if (!['RUNNING', 'FAILED', 'STOPPED'].includes(subtask.state)) {
      outcomes.push({ ...graphIdentityFacts(repository, currentGraph, subtask, recovery), state: subtask.state, classification: recovery.classification, recoverable: recovery.recoverable, changed: false, session: recovery.session, worktree: recovery.worktree, error: subtask.lastError ? serializedGraphError(subtask.lastError, currentGraph, subtask, recovery) : null });
      continue;
    }
    const observed = await observeGraphSubtask(repository, currentGraph, subtask, recovery, subtask.state);
    if (observed.completed) {
      outcomes.push({ ...graphIdentityFacts(repository, currentGraph, subtask, recovery), state: 'SUCCEEDED', classification: 'completed', recoverable: false, changed: true, session: recovery.session, worktree: recovery.worktree, implementationCommit: observed.commit, evidence: observed.evidence, error: null });
      continue;
    }
    if (subtask.state !== 'RUNNING') {
      outcomes.push({ ...graphIdentityFacts(repository, currentGraph, subtask, recovery), state: subtask.state, classification: recovery.classification, recoverable: recovery.recoverable, changed: false, session: recovery.session, worktree: recovery.worktree, error: observed.error ? serializedGraphError(observed.error, currentGraph, subtask, recovery) : (subtask.lastError ? serializedGraphError(subtask.lastError, currentGraph, subtask, recovery) : null) });
      continue;
    }
    const latestRecovery = inspectTaskGraphRecovery(repository, readTaskGraph(repository, parentTaskId), { probeGit: true }).find(item => item.subtaskId === subtask.id) || recovery;
    const healthy = latestRecovery.sessionHealthy && latestRecovery.worktree.safe && latestRecovery.worktree.owned;
    if (healthy) {
      outcomes.push({ ...graphIdentityFacts(repository, currentGraph, subtask, latestRecovery), state: 'RUNNING', classification: 'running', recoverable: true, changed: false, session: latestRecovery.session, worktree: latestRecovery.worktree, error: observed.error ? serializedGraphError(observed.error, currentGraph, subtask, latestRecovery) : null });
      continue;
    }
    const failure = latestRecovery.session?.error
      ? graphRecoveryError('AGENT_RUNTIME_ERROR', `Subtask ${parentTaskId}/${subtask.id} was interrupted: ${latestRecovery.session.error}`, currentGraph, subtask, latestRecovery)
      : graphRecoveryError('TASK_STATE_CONFLICT', `Subtask ${parentTaskId}/${subtask.id} has no healthy Runtime Session after interruption.`, currentGraph, subtask, latestRecovery);
    const failed = setTaskGraphSubtaskState(repository, parentTaskId, subtask.id, 'FAILED', {
      expectedState: 'RUNNING',
      reason: failure.message,
      lastError: serializeRuntimeError(failure, { includeLegacy: true }),
      worktreePath: latestRecovery.worktree.path,
      branch: latestRecovery.worktree.branch,
      ref: latestRecovery.worktree.ref,
      ...(subtask.sessionId ? { sessionId: subtask.sessionId } : {}),
      recovery: {
        ...graphIdentityFacts(repository, currentGraph, subtask, latestRecovery),
        operation: 'graph-recover',
        classification: 'interrupted',
        recoveredAt: new Date().toISOString(),
      },
    });
    const stored = failed.graph.subtasks.find(item => item.id === subtask.id);
    outcomes.push({ ...graphIdentityFacts(repository, currentGraph, subtask, latestRecovery), state: stored?.state || 'FAILED', classification: 'interrupted', recoverable: true, changed: true, session: latestRecovery.session, worktree: latestRecovery.worktree, error: stored?.lastError || serializeRuntimeError(failure, { includeLegacy: true }) });
  }
  graph = readTaskGraph(repository, parentTaskId);
  const payload = jsonSuccess('task.graph-recover', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    graph,
    before,
    outcomes,
    recovery: inspectTaskGraphRecovery(repository, graph, { probeGit: true }),
    automaticRetry: false,
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function taskGraphResumeCommand(options, { json = false } = {}) {
  const repository = assertGitRepository(options.root, messages.en);
  const parentTaskId = graphTaskId(options, repository);
  let graph = readTaskGraph(repository, parentTaskId);
  if (graph.state === 'APPROVED') throw runtimeError('TASK_STATE_CONFLICT', `Approved Task Graph cannot be resumed: ${parentTaskId}`, { recoverable: false, taskId: parentTaskId, root: repository });
  const selected = graphSubtaskSelection(options, graph);
  const outcomes = [];
  const recoveryMap = new Map();
  for (const item of inspectTaskGraphRecovery(repository, graph, { probeGit: true })) {
    recoveryMap.set(item.subtaskId, item);
  }
  for (const original of selected) {
    graph = readTaskGraph(repository, parentTaskId);
    const subtaskMap = new Map();
    for (const item of graph.subtasks) subtaskMap.set(item.id, item);
    const subtask = subtaskMap.get(original.id);
    const recovery = recoveryMap.get(original.id);
    if (!subtask || !recovery) continue;
    if (['RUNNING', 'FAILED', 'STOPPED'].includes(subtask.state)) {
      const observed = await observeGraphSubtask(repository, graph, subtask, recovery, subtask.state);
      if (observed.completed) {
        outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: 'SUCCEEDED', action: 'completed-existing-session', changed: true, session: recovery.session, worktree: recovery.worktree, implementationCommit: observed.commit, evidence: observed.evidence, error: null });
        continue;
      }
      if (subtask.state === 'RUNNING' && recovery.sessionHealthy && recovery.worktree.safe && recovery.worktree.owned) {
        outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: 'RUNNING', action: 'reused-healthy-session', changed: false, session: recovery.session, worktree: recovery.worktree, error: observed.error ? serializedGraphError(observed.error, graph, subtask, recovery) : null });
        continue;
      }
    }
    const activeSession = recovery.session
      && ['starting', 'running', 'idle', 'busy'].includes(recovery.session.state);
    if (activeSession && !(recovery.session.state === 'exited' || recovery.session.state === 'failed')) {
      const error = graphRecoveryError('SESSION_NOT_HEALTHY', `Subtask ${parentTaskId}/${subtask.id} still references an active but unverified Session; close or reconcile that Session before replacement.`, graph, subtask, recovery, {
        parentTaskId,
        subtaskId: subtask.id,
        sessionId: recovery.session.id,
        sessionState: recovery.session.state,
        sessionHealthy: recovery.sessionHealthy,
        worktree: recovery.worktree,
        replacementAllowed: false,
      });
      outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: subtask.state, action: 'reconcile-session-first', changed: false, session: recovery.session, worktree: recovery.worktree, error: serializedGraphError(error, graph, subtask, recovery) });
      continue;
    }
    // A RUNNING record without a durable terminal Session is ambiguous: the
    // coordinator may have been interrupted before Session creation, or a
    // record may have been lost. Never create replacement state from that
    // unknown condition; an explicit recover pass must first classify it as
    // FAILED (or the operator must restore a verifiable Session record).
    if (subtask.state === 'RUNNING' && (!recovery.session || !['exited', 'failed'].includes(recovery.session.state))) {
      const error = graphRecoveryError('SESSION_NOT_HEALTHY', `Subtask ${parentTaskId}/${subtask.id} has no durable exited or failed Session to replace; reconcile recovery facts first.`, graph, subtask, recovery, {
        parentTaskId,
        subtaskId: subtask.id,
        sessionId: recovery.session?.id || null,
        sessionState: recovery.session?.state || null,
        replacementAllowed: false,
      });
      outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: subtask.state, action: 'reconcile-session-first', changed: false, session: recovery.session, worktree: recovery.worktree, error: serializedGraphError(error, graph, subtask, recovery) });
      continue;
    }
    if (!['FAILED', 'STOPPED', 'RUNNING'].includes(subtask.state)) {
      const error = graphRecoveryError('TASK_STATE_CONFLICT', `Subtask ${parentTaskId}/${subtask.id} is ${subtask.state}; explicit resume requires FAILED, STOPPED, or interrupted RUNNING state.`, graph, subtask, recovery);
      outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: subtask.state, action: 'none', changed: false, session: recovery.session, worktree: recovery.worktree, error: serializedGraphError(error, graph, subtask, recovery) });
      continue;
    }
    const dependencies = subtask.dependsOn.map(id => subtaskMap.get(id));
    if (dependencies.some(dependency => dependency?.state !== 'SUCCEEDED')) {
      const error = graphRecoveryError('TASK_STATE_CONFLICT', `Subtask ${parentTaskId}/${subtask.id} cannot resume until every dependency succeeds.`, graph, subtask, recovery, {
        parentTaskId,
        subtaskId: subtask.id,
        dependencies: dependencies.map(dependency => ({ id: dependency?.id || null, state: dependency?.state || 'MISSING' })),
      });
      outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: subtask.state, action: 'recover-dependency-first', changed: false, session: recovery.session, worktree: recovery.worktree, error: serializedGraphError(error, graph, subtask, recovery) });
      continue;
    }
    const blockedIds = graphDescendantIds(graph, subtask.id);
    const resumed = setTaskGraphSubtaskState(repository, parentTaskId, subtask.id, 'READY', {
      expectedState: subtask.state,
      reason: `Explicit recovery approved for subtask ${subtask.id}; dispatch is required separately.`,
      lastError: null,
      sessionId: null,
      recoverBlockedIds: [...blockedIds],
      recovery: {
        ...graphIdentityFacts(repository, graph, subtask, recovery),
        operation: 'graph-resume',
        priorState: subtask.state,
        priorSessionId: subtask.sessionId || null,
        priorWorktreePath: subtask.worktreePath || recovery.worktree.path,
        resumedAt: new Date().toISOString(),
        replacementSessionRequired: recovery.session?.state === 'failed' || recovery.session?.state === 'exited' || !recovery.session,
      },
    });
    graph = resumed.graph;
    const stored = graph.subtasks.find(item => item.id === subtask.id);
    outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: stored?.state || 'READY', action: 'ready-for-explicit-dispatch', changed: Boolean(resumed.changed), session: recovery.session, worktree: recovery.worktree, error: null });
  }
  if (graph.state === 'STOPPED' || graph.state === 'ERROR') {
    const active = graph.subtasks.some(subtask => ['RUNNING', 'READY', 'WAITING'].includes(subtask.state));
    const unrecovered = graph.subtasks.some(subtask => ['FAILED', 'BLOCKED', 'STOPPED'].includes(subtask.state));
    if (active && !unrecovered) graph = setTaskGraphState(repository, parentTaskId, 'RUNNING', { expectedState: graph.state, operation: 'graph-resume', reason: 'Task Graph explicitly resumed; dispatch remains a separate operation.' }).graph;
  }
  const payload = jsonSuccess('task.graph-resume', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    graph,
    outcomes,
    recovery: inspectTaskGraphRecovery(repository, graph, { probeGit: true }),
    dispatchRequired: true,
    automaticRetry: false,
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function cleanupTimeout(options) {
  const value = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 2_000;
  return Math.max(100, Math.min(10_000, value));
}

function cleanupFactsChanged(previous, recovery) {
  const worktree = value => value && {
    path: value.path || null,
    recordedPath: value.recordedPath || null,
    branch: value.branch || null,
    ref: value.ref || null,
    recordedBranch: value.recordedBranch || null,
    recordedRef: value.recordedRef || null,
    matchesRecord: value.matchesRecord ?? null,
    exists: Boolean(value.exists),
    safe: Boolean(value.safe),
    registered: Boolean(value.registered),
    owned: Boolean(value.owned),
    ownershipKnown: Boolean(value.ownershipKnown),
    head: value.head || null,
    registeredBranch: value.registeredBranch || null,
    error: value.error || null,
  };
  const session = value => value && {
    id: value.id || null,
    state: value.state || null,
    error: value.error || null,
  };
  const previousSession = session(previous?.session) || null;
  const currentSession = session(recovery?.session) || null;
  // A successful cleanup removes the worktree (and therefore its local
  // Session record). Treat that missing record as the same terminal Session
  // fact that was persisted in the cleanup result; otherwise a repeated
  // cleanup would look like a changed resource and re-run forever.
  const comparableCurrentSession = currentSession || (
    previousSession && ['exited', 'failed'].includes(previousSession.state)
      ? previousSession
      : null
  );
  return JSON.stringify({ worktree: worktree(previous?.worktree) || null, session: previousSession })
    !== JSON.stringify({ worktree: worktree(recovery?.worktree) || null, session: comparableCurrentSession });
}

function graphCleanupSummary(repository, graph) {
  const recovery = inspectTaskGraphRecovery(repository, graph, { probeGit: true });
  return recovery.map(item => ({
    subtaskId: item.subtaskId,
    worktree: item.worktree,
    session: item.session,
    status: graph.subtasks.find(subtask => subtask.id === item.subtaskId)?.cleanup?.status || null,
    error: graph.subtasks.find(subtask => subtask.id === item.subtaskId)?.cleanup?.error || null,
  }));
}

function integrationCleanupFactsChanged(previous, current) {
  const worktree = value => value && {
    path: value.path || null,
    recordedPath: value.recordedPath || null,
    branch: value.branch || null,
    ref: value.ref || null,
    recordedBranch: value.recordedBranch || null,
    recordedRef: value.recordedRef || null,
    matchesRecord: value.matchesRecord ?? null,
    exists: Boolean(value.exists),
    safe: Boolean(value.safe),
    registered: Boolean(value.registered),
    owned: Boolean(value.owned),
    ownershipKnown: Boolean(value.ownershipKnown),
    head: value.head || null,
    registeredBranch: value.registeredBranch || null,
    error: value.error || null,
  };
  // After a successful removal the next inspection has no directory to
  // describe. Treat that stable absence as the same terminal cleanup fact.
  if (previous?.status === 'CLEANED' && current?.worktree
    && !current.worktree.exists && !current.worktree.registered && !current.worktree.error) return false;
  return JSON.stringify(worktree(previous?.worktree) || null) !== JSON.stringify(worktree(current?.worktree) || null);
}

function graphIntegrationCleanup(repository, graph, { timeoutMs = 2_000, allowRunning = false } = {}) {
  const integration = graph.integration;
  if (!integration) return null;
  const current = inspectTaskGraphIntegration(repository, graph, { probeGit: true, timeoutMs });
  const prior = integration.cleanup;
  if (prior?.status === 'CLEANED' && !integrationCleanupFactsChanged(prior, current)) {
    return {
      root: repository,
      parentTaskId: graph.parentTaskId,
      status: 'CLEANED',
      idempotent: true,
      integrationState: integration.state,
      worktree: current?.worktree || prior.worktree || null,
      error: null,
    };
  }
  if (integration.state === 'RUNNING' && !allowRunning) {
    const error = runtimeError('TASK_STATE_CONFLICT', 'Task Graph integration for ' + graph.parentTaskId + ' is RUNNING; stop or reconcile it before cleanup.', {
      recoverable: true,
      taskId: graph.parentTaskId,
      root: repository,
      stage: 'integration-cleanup',
      details: { integration: current || integration },
    });
    const cleanup = {
      status: 'SKIPPED',
      attemptedAt: prior?.attemptedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      worktree: current?.worktree || null,
      error: serializeRuntimeError(error, { includeLegacy: true }),
    };
    try {
      setTaskGraphIntegration(repository, graph.parentTaskId, integration.state, {
        expectedState: integration.state,
        cleanup,
        operation: 'graph-cleanup',
      });
    } catch {
      // Preserve the primary non-destructive cleanup decision.
    }
    return {
      root: repository,
      parentTaskId: graph.parentTaskId,
      status: 'SKIPPED',
      idempotent: false,
      integrationState: integration.state,
      worktree: current?.worktree || null,
      error: cleanup.error,
    };
  }
  const worktreeResult = cleanupTaskGraphIntegrationWorktree(repository, graph.parentTaskId, {
    recordedPath: integration.worktreePath || null,
    recordedBranch: integration.branch || null,
    recordedRef: integration.ref || null,
    timeoutMs,
  });
  const cleanup = {
    status: worktreeResult.status,
    attemptedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    worktree: worktreeResult.worktree || current?.worktree || null,
    error: worktreeResult.error || null,
  };
  let persistenceError = null;
  try {
    setTaskGraphIntegration(repository, graph.parentTaskId, integration.state, {
      expectedState: integration.state,
      cleanup,
      operation: 'graph-cleanup',
    });
  } catch (error) {
    persistenceError = serializeRuntimeError(error, { includeLegacy: true });
  }
  return {
    root: repository,
    parentTaskId: graph.parentTaskId,
    status: persistenceError ? 'FAILED' : worktreeResult.status,
    idempotent: persistenceError ? false : Boolean(worktreeResult.idempotent),
    integrationState: integration.state,
    worktree: worktreeResult.worktree || current?.worktree || null,
    error: persistenceError || worktreeResult.error || null,
  };
}

async function taskGraphIntegrateCommand(options, { json = false } = {}) {
  const repository = assertGitRepository(options.root, messages.en);
  const parentTaskId = graphTaskId(options, repository);
  const result = integrateTaskGraph(repository, parentTaskId, { timeoutMs: cleanupTimeout(options) });
  const latestGraph = readTaskGraph(repository, parentTaskId);
  const payload = jsonSuccess('task.graph-integrate', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    baseCommit: result.integration?.baseCommit || null,
    sources: result.sources || [],
    integration: result.integration || inspectTaskGraphIntegration(repository, latestGraph, { probeGit: true }),
    graph: latestGraph,
    idempotent: Boolean(result.idempotent),
    release: { authorized: false, required: 'explicit user release authorization' },
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function taskGraphReviewCommand(options, { json = false } = {}) {
  const repository = assertGitRepository(options.root, messages.en);
  const parentTaskId = graphTaskId(options, repository);
  const graph = readTaskGraph(repository, parentTaskId);
  // Re-verify source facts at the review boundary so a reviewer never
  // approves an aggregate whose required subtask evidence or refs changed.
  const verified = verifyTaskGraphIntegrationSources(repository, graph);
  const integration = inspectTaskGraphIntegration(repository, graph, { probeGit: true, timeoutMs: cleanupTimeout(options) });
  const expectedAppliedRefs = verified.sources.map(source => ({
    subtaskId: source.subtaskId,
    ref: source.ref,
    commit: source.commit,
  }));
  const actualAppliedRefs = (integration?.appliedRefs || []).map(source => ({
    subtaskId: source.subtaskId,
    ref: source.ref,
    commit: source.commit,
  }));
  if (integration?.state !== 'SUCCEEDED'
    || integration.sourceFingerprint !== verified.sourceFingerprint
    || integration.baseCommit?.toLowerCase() !== verified.baseCommit.toLowerCase()
    || JSON.stringify(actualAppliedRefs) !== JSON.stringify(expectedAppliedRefs)) {
    throw runtimeError('TASK_STATE_CONFLICT', 'Task Graph ' + parentTaskId + ' integration does not match the currently verified source commits.', {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'graph-review',
      details: {
        integrationState: integration?.state || null,
        expectedBaseCommit: verified.baseCommit,
        integrationBaseCommit: integration?.baseCommit || null,
        expectedSourceFingerprint: verified.sourceFingerprint,
        integrationSourceFingerprint: integration?.sourceFingerprint || null,
        expectedAppliedRefs,
        actualAppliedRefs,
      },
    });
  }
  if (!integration?.worktree?.owned || !integration.worktree.safe || !integration.worktree.exists) {
    throw runtimeError('TASK_STATE_CONFLICT', 'Task Graph ' + parentTaskId + ' integration worktree is not Runtime-owned and inspectable.', {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'graph-review',
      details: { integration },
    });
  }
  if (!integration.aggregateCommit || integration.worktree.head?.toLowerCase() !== integration.aggregateCommit.toLowerCase()) {
    throw runtimeError('TASK_STATE_CONFLICT', 'Task Graph ' + parentTaskId + ' integration aggregate commit is not stable for review.', {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'graph-review',
      details: { aggregateCommit: integration.aggregateCommit, worktreeHead: integration.worktree.head || null },
    });
  }
  if (integration.clean !== true) {
    throw runtimeError('WORKTREE_CONFLICT', 'Task Graph ' + parentTaskId + ' integration worktree has uncommitted changes and cannot be approved.', {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'graph-review',
      details: { worktree: integration.worktree, diff: integration.diff },
    });
  }
  const result = setTaskGraphReview(repository, parentTaskId, options.decision, {
    feedback: options.feedback || options.reason || '',
    evidence: options.evidence,
  });
  const latestGraph = result.graph || readTaskGraph(repository, parentTaskId);
  const payload = jsonSuccess('task.graph-review', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    decision: result.review?.decision || options.decision,
    review: result.review,
    graph: latestGraph,
    integration: inspectTaskGraphIntegration(repository, latestGraph, { probeGit: true, timeoutMs: cleanupTimeout(options) }),
    changed: Boolean(result.changed),
    event: result.event || null,
    release: { authorized: false, required: 'explicit user release authorization' },
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function cleanupGraphSubtask(repository, graph, subtask, {
  timeoutMs = 2_000,
  allowRunning = false,
  retry = false,
  parentStateOverride = null,
} = {}) {
  const recovery = inspectTaskGraphRecovery(repository, graph, { probeGit: true }).find(item => item.subtaskId === subtask.id);
  const prior = subtask.cleanup;
  if (prior?.status === 'CLEANED' && !cleanupFactsChanged(prior, recovery)) {
    return { ...graphIdentityFacts(repository, graph, subtask, recovery), status: 'CLEANED', idempotent: true, session: recovery?.session || prior.session || null, worktree: recovery?.worktree || prior.worktree || null, error: null };
  }
  if (prior?.status === 'FAILED' && !retry && !cleanupFactsChanged(prior, recovery)) {
    return {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      status: 'FAILED',
      idempotent: true,
      session: prior.session || recovery?.session || null,
      worktree: prior.worktree || recovery?.worktree || null,
      error: prior.error || null,
    };
  }
  // A cleanup attempt against a still-running subtask is deliberately skipped
  // rather than destructive.  Repeating that observation must not rewrite the
  // aggregate record or append another event until an explicit stop changes
  // the subtask state and makes cleanup safe to retry.
  if (prior?.status === 'SKIPPED' && subtask.state === 'RUNNING' && !allowRunning && !retry && !cleanupFactsChanged(prior, recovery)) {
    return {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      status: 'SKIPPED',
      idempotent: true,
      session: prior.session || recovery?.session || null,
      worktree: prior.worktree || recovery?.worktree || null,
      error: prior.error || null,
    };
  }
  if (subtask.state === 'RUNNING' && !allowRunning) {
    const error = graphRecoveryError('TASK_STATE_CONFLICT', `Subtask ${graph.parentTaskId}/${subtask.id} is RUNNING; stop the graph before cleanup.`, graph, subtask, recovery);
    const cleanup = {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      status: 'SKIPPED',
      attemptedAt: prior?.attemptedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      session: recovery?.session || null,
      worktree: recovery?.worktree || null,
      error: serializedGraphError(error, graph, subtask, recovery),
    };
    try {
      setTaskGraphSubtaskState(repository, graph.parentTaskId, subtask.id, subtask.state, {
        expectedState: subtask.state,
        cleanup,
        ...(parentStateOverride ? { parentStateOverride } : {}),
      });
    } catch (persistError) {
      const persistence = serializedGraphError(persistError, graph, subtask, recovery);
      return {
        ...graphIdentityFacts(repository, graph, subtask, recovery),
        status: 'FAILED',
        idempotent: false,
        session: recovery?.session || null,
        worktree: recovery?.worktree || null,
        error: persistence,
      };
    }
    return { ...graphIdentityFacts(repository, graph, subtask, recovery), status: 'SKIPPED', idempotent: false, session: recovery?.session || null, worktree: recovery?.worktree || null, error: cleanup.error };
  }
  // A subtask that still names a Session but has no readable durable Session
  // record is an ownership ambiguity. Preserve the worktree until an
  // operator/runtime reconciliation restores terminal facts; never remove a
  // path while an unknown host may still be attached to it.
  const hasWorktreeResource = Boolean(recovery?.worktree?.exists || recovery?.worktree?.registered);
  if (subtask.sessionId && !recovery?.session && hasWorktreeResource) {
    const error = graphRecoveryError('SESSION_STATE_CONFLICT', `Session record is unavailable for ${graph.parentTaskId}/${subtask.id}; refusing cleanup until ownership is reconciled.`, graph, subtask, recovery, {
      parentTaskId: graph.parentTaskId,
      subtaskId: subtask.id,
      sessionId: subtask.sessionId,
      sessionRecord: 'missing-or-invalid',
      worktree: recovery?.worktree || null,
    });
    const cleanup = {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      status: 'FAILED',
      attemptedAt: prior?.attemptedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      session: null,
      worktree: recovery?.worktree || null,
      error: serializedGraphError(error, graph, subtask, recovery),
    };
    try {
      setTaskGraphSubtaskState(repository, graph.parentTaskId, subtask.id, subtask.state, {
        expectedState: subtask.state,
        cleanup,
        ...(parentStateOverride ? { parentStateOverride } : {}),
      });
    } catch (persistError) {
      cleanup.persistenceError = serializedGraphError(persistError, graph, subtask, recovery);
    }
    return {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      status: 'FAILED',
      idempotent: false,
      session: null,
      worktree: recovery?.worktree || null,
      error: cleanup.persistenceError || cleanup.error,
    };
  }
  let sessionResult = { status: 'ABSENT', session: recovery?.session || null };
  const activeSession = recovery?.session && ['starting', 'running', 'idle', 'busy'].includes(recovery.session.state);
  // Session Hosts are detached child processes. Never let a forged or stale
  // record identify the coordinator itself as the host that cleanup may kill.
  const runtimeOwnedSession = recovery?.sessionOwned === true
    && recovery?.worktree?.owned === true
    && recovery.session.hostPid !== process.pid;
  if (activeSession && !runtimeOwnedSession) {
    const error = graphRecoveryError(
      'SESSION_STATE_CONFLICT',
      `Refusing to close an active Session that is not proven Runtime-owned for ${graph.parentTaskId}/${subtask.id}.`,
      graph,
      subtask,
      recovery,
      {
        parentTaskId: graph.parentTaskId,
        subtaskId: subtask.id,
        sessionId: recovery.session.id,
        sessionOwned: recovery.sessionOwned,
        worktreeOwned: recovery.worktree?.owned === true,
      },
    );
    sessionResult = { status: 'FAILED', session: recovery.session, error: serializedGraphError(error, graph, subtask, recovery) };
  } else if (activeSession) {
    try {
      const closed = await getExecutionSessionManager().close(recovery.worktree.path, recovery.session.id, { graceful: false, timeoutMs });
      sessionResult = { status: ['starting', 'running', 'idle', 'busy'].includes(closed.state) ? 'FAILED' : 'CLOSED', session: closed };
    } catch (error) {
      sessionResult = { status: 'FAILED', session: recovery.session, error: serializedGraphError(error, graph, subtask, recovery) };
    }
  } else if (recovery?.session) {
    sessionResult = { status: 'CLOSED', session: recovery.session };
  }
  if (sessionResult.status === 'FAILED') {
    const cleanup = {
      ...graphIdentityFacts(repository, graph, subtask, recovery),
      status: 'FAILED',
      attemptedAt: prior?.attemptedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      session: sessionResult.session || null,
      worktree: recovery?.worktree || null,
      error: sessionResult.error || { code: 'SESSION_CLOSE_FAILED', message: 'Runtime Session did not close.', recoverable: true },
    };
    try {
      setTaskGraphSubtaskState(repository, graph.parentTaskId, subtask.id, subtask.state, {
        expectedState: subtask.state,
        cleanup,
        ...(parentStateOverride ? { parentStateOverride } : {}),
      });
    } catch (persistError) {
      cleanup.persistenceError = serializedGraphError(persistError, graph, subtask, recovery);
    }
    return { ...graphIdentityFacts(repository, graph, subtask, recovery), status: 'FAILED', idempotent: false, session: sessionResult.session, worktree: recovery?.worktree || null, error: cleanup.persistenceError || cleanup.error };
  }
  const worktreeResult = cleanupTaskGraphWorktree(repository, graph.parentTaskId, subtask.id, {
    recordedPath: subtask.worktreePath || null,
    recordedBranch: subtask.branch || null,
    recordedRef: subtask.ref || null,
    timeoutMs,
  });
  const worktreeError = worktreeResult.error
    ? serializedGraphError(worktreeResult.error, graph, subtask, recovery)
    : null;
  const cleanup = {
    ...graphIdentityFacts(repository, graph, subtask, recovery),
    status: worktreeResult.status,
    attemptedAt: prior?.attemptedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    session: sessionResult.session || null,
    worktree: worktreeResult.worktree || recovery?.worktree || null,
    error: worktreeError,
  };
  try {
    setTaskGraphSubtaskState(repository, graph.parentTaskId, subtask.id, subtask.state, {
      expectedState: subtask.state,
      cleanup,
      ...(parentStateOverride ? { parentStateOverride } : {}),
    });
  } catch (persistError) {
    cleanup.persistenceError = serializedGraphError(persistError, graph, subtask, recovery);
  }
  return {
    ...graphIdentityFacts(repository, graph, subtask, recovery),
    status: cleanup.persistenceError ? 'FAILED' : worktreeResult.status,
    idempotent: cleanup.persistenceError ? false : Boolean(worktreeResult.idempotent),
    session: sessionResult.session || null,
    worktree: worktreeResult.worktree || recovery?.worktree || null,
    error: cleanup.persistenceError || worktreeError,
  };
}

async function taskGraphCleanupCommand(options, { json = false } = {}) {
  const repository = assertGitRepository(options.root, messages.en);
  const parentTaskId = graphTaskId(options, repository);
  const graph = readTaskGraph(repository, parentTaskId);
  const scopedSubtask = Boolean(graphSubtaskOption(options));
  const selected = graphSubtaskSelection(options, graph, { includeTerminal: true });
  const outcomes = [];
  for (const subtask of selected) {
    const currentGraph = readTaskGraph(repository, parentTaskId);
    outcomes.push(await cleanupGraphSubtask(repository, currentGraph, currentGraph.subtasks.find(item => item.id === subtask.id) || subtask, {
      timeoutMs: cleanupTimeout(options),
      parentStateOverride: currentGraph.state,
    }));
  }
  let latestGraph = readTaskGraph(repository, parentTaskId);
  const integrationCleanup = !scopedSubtask
    ? graphIntegrationCleanup(repository, latestGraph, { timeoutMs: cleanupTimeout(options) })
    : null;
  latestGraph = readTaskGraph(repository, parentTaskId);
  const payload = jsonSuccess('task.graph-cleanup', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    graph: latestGraph,
    outcomes,
    cleanup: graphCleanupSummary(repository, latestGraph),
    integrationCleanup,
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function taskGraphStopCommand(options, { json = false } = {}) {
  const repository = assertGitRepository(options.root, messages.en);
  const parentTaskId = graphTaskId(options, repository);
  let graph = readTaskGraph(repository, parentTaskId);
  if (graph.state === 'APPROVED') throw runtimeError('TASK_STATE_CONFLICT', `Approved Task Graph cannot be stopped: ${parentTaskId}`, { recoverable: false, taskId: parentTaskId, root: repository });
  const scopedSubtask = Boolean(graphSubtaskOption(options));
  const selected = graphSubtaskSelection(options, graph, { includeTerminal: true });
  const outcomes = [];
  for (const original of selected) {
    graph = readTaskGraph(repository, parentTaskId);
    const subtask = graph.subtasks.find(item => item.id === original.id);
    if (!subtask || ['SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED'].includes(subtask.state)) {
      const recovery = inspectTaskGraphRecovery(repository, graph, { probeGit: true }).find(item => item.subtaskId === original.id);
      const cleaned = subtask ? await cleanupGraphSubtask(repository, graph, subtask, {
        timeoutMs: cleanupTimeout(options),
        parentStateOverride: scopedSubtask ? scopedStopParentState(graph, subtask.id) : graph.state,
      }) : null;
      outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: subtask?.state || null, changed: false, cleanup: cleaned, session: recovery?.session || null, worktree: recovery?.worktree || null, error: cleaned?.error || null });
      continue;
    }
    const recovery = inspectTaskGraphRecovery(repository, graph, { probeGit: true }).find(item => item.subtaskId === subtask.id);
    const stopped = setTaskGraphSubtaskState(repository, parentTaskId, subtask.id, 'STOPPED', {
      expectedState: subtask.state,
      reason: options.reason || `Explicitly stopped subtask ${subtask.id}.`,
      lastError: null,
      recovery: {
        ...graphIdentityFacts(repository, graph, subtask, recovery),
        operation: 'graph-stop',
        priorState: subtask.state,
        priorSessionId: subtask.sessionId || recovery?.session?.id || null,
        priorWorktreePath: subtask.worktreePath || recovery?.worktree?.path || null,
        stoppedAt: new Date().toISOString(),
      },
      ...(scopedSubtask ? { parentStateOverride: scopedStopParentState(graph, subtask.id) } : {}),
    });
    graph = stopped.graph;
    const stoppedSubtask = graph.subtasks.find(item => item.id === subtask.id);
    const cleaned = await cleanupGraphSubtask(repository, graph, stoppedSubtask, {
      timeoutMs: cleanupTimeout(options),
      allowRunning: false,
      parentStateOverride: graph.state,
    });
    outcomes.push({ ...graphIdentityFacts(repository, graph, subtask, recovery), state: 'STOPPED', changed: Boolean(stopped.changed), cleanup: cleaned, session: recovery?.session || null, worktree: recovery?.worktree || null, error: cleaned.error || null });
  }
  graph = readTaskGraph(repository, parentTaskId);
  if (!scopedSubtask && graph.state !== 'STOPPED') {
    graph = setTaskGraphState(repository, parentTaskId, 'STOPPED', { operation: 'graph-stop', reason: options.reason || 'Task Graph explicitly stopped.' }).graph;
  }
  let integrationCleanup = null;
  if (!scopedSubtask) {
    graph = readTaskGraph(repository, parentTaskId);
    if (graph.integration?.state === 'RUNNING') {
      const stoppedIntegration = runtimeError('TASK_STATE_CONFLICT', 'Task Graph integration was interrupted by an explicit graph stop.', {
        recoverable: true,
        taskId: parentTaskId,
        root: repository,
        stage: 'graph-stop',
      });
      graph = setTaskGraphIntegration(repository, parentTaskId, 'FAILED', {
        expectedState: 'RUNNING',
        reason: stoppedIntegration.message,
        lastError: serializeRuntimeError(stoppedIntegration, { includeLegacy: true }),
        operation: 'graph-stop',
      }).graph;
    }
    integrationCleanup = graphIntegrationCleanup(repository, readTaskGraph(repository, parentTaskId), {
      timeoutMs: cleanupTimeout(options),
      allowRunning: true,
    });
    graph = readTaskGraph(repository, parentTaskId);
  }
  const payload = jsonSuccess('task.graph-stop', {
    root: repository,
    graphId: parentTaskId,
    parentTaskId,
    graph,
    outcomes,
    cleanup: graphCleanupSummary(repository, graph),
    integrationCleanup,
  });
  if (!json) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function subtaskImplementationPrompt(graph, subtask, baseCommit) {
  const previousEvidence = Array.isArray(subtask.evidence) && subtask.evidence.length > 0
    ? JSON.stringify(subtask.evidence.at(-1))
    : '(none)';
  return [
    'Use $coordinate-agents as the external Implementer for this Subtask.',
    'Do not create a second planner and do not release, merge, push, tag, deploy, or publish.',
    `Parent Task ID: ${graph.parentTaskId}`,
    `Subtask ID: ${subtask.id}`,
    `Task ID: ${graph.parentTaskId}`,
    `Round: 1`,
    `Base Commit: ${baseCommit}`,
    `Approved specification:\n${subtask.spec}`,
    subtask.reason ? `Subtask notes:\n${subtask.reason}` : '',
    `Previous implementation commit/evidence reference: ${subtask.implementationCommit || previousEvidence}`,
    'Implement only the approved specification in this isolated worktree, run the required validation, commit the product changes, and send one IMPLEMENTATION_DONE message to the Planner with the commit and bounded evidence.',
  ].filter(Boolean).join('\n\n');
}

function escapeRegex(value) {
  return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSubtaskImplementationMessages(busRoot, parentTaskId, subtaskId, implementer, planner) {
  const bus = join(busRoot, '.agent-bus');
  if (!existsSync(bus)) return [];
  const inbox = join(bus, 'inbox', planner);
  const messages = [];
  for (const stage of ['new', 'processing', 'processed']) {
    const directory = join(inbox, stage);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter(item => item.endsWith('.md')).sort()) {
      const path = join(directory, name);
      try {
        safeInternalStat(bus, path);
        const parsed = parseBusMessage(readInternalFile(bus, path));
        if (!parsed || parsed.fields.type !== 'IMPLEMENTATION_DONE') continue;
        if (parsed.fields.from !== implementer || parsed.fields.to !== planner) continue;
        const exactDedupeKey = `task:${parentTaskId}:subtask:${subtaskId}:done`;
        const refersToSubtask = parsed.fields.dedupe_key === exactDedupeKey
          || (new RegExp(`(?:^|\\r?\\n)Parent Task ID\\s*:\\s*${escapeRegex(parentTaskId)}\\s*$`, 'im').test(parsed.body)
            && new RegExp(`(?:^|\\r?\\n)Subtask ID\\s*:\\s*${escapeRegex(subtaskId)}\\s*$`, 'im').test(parsed.body));
        if (!refersToSubtask) continue;
        messages.push({ path, ...parsed });
      } catch {
        // Ignore unreadable or quarantined messages
      }
    }
  }
  return messages.sort((a, b) => `${a.fields.created_at || ''}`.localeCompare(`${b.fields.created_at || ''}`));
}

function graphCompletionFromMessage(message, worktreePath, baseCommit) {
  const reportedCommit = implementationCommit(message.fields, message.body);
  const commit = verifyGraphImplementationCommit(worktreePath, baseCommit, reportedCommit);
  return {
    commit,
    evidence: [{
      type: 'IMPLEMENTATION_DONE',
      id: evidenceId(message.path, message.fields),
      path: resolve(message.path),
      relatedCommit: commit,
      details: redactOutput(message.body, 8 * 1024),
      createdAt: message.fields.created_at || new Date().toISOString(),
    }],
  };
}

function graphSessionFailure(session, parentTaskId, subtaskId, agentId, resolution, root) {
  const nonZero = Number.isInteger(session?.exitCode) && session.exitCode !== 0;
  const message = session?.state === 'exited' && !nonZero
    ? `Execution session ${session.id} exited without an IMPLEMENTATION_DONE message.`
    : `Execution session ${session?.id || '(unknown)'} failed after dispatch.`;
  return runtimeError(nonZero ? 'AGENT_EXIT_NONZERO' : 'AGENT_RUNTIME_ERROR', message, {
    recoverable: true,
    taskId: parentTaskId,
    subtaskId,
    agent: agentId,
    adapter: resolution?.resolved?.adapter || null,
    command: resolution?.resolved?.command || null,
    sessionId: session?.id || null,
    root,
    stage: 'runtime',
    details: session?.error || null,
    result: {
      status: session?.exitCode ?? null,
      signal: session?.signal || null,
      resolvedCommand: session?.resolvedCommand || null,
    },
  });
}

async function taskGraphDispatchCommand(options, { json = false } = {}) {
  const requestedRoot = resolve(options.root);
  const repository = assertGitRepository(requestedRoot, messages.en);
  ensureProjectBus(repository);
  const parentTaskId = graphTaskId(options, repository);
  const subtaskId = options.subtaskId
    || (options.subcommand === 'graph' && options.positionals?.[0] === 'dispatch' ? options.positionals?.[2] : null)
    || (options.subcommand === 'graph-dispatch' ? options.positionals?.[1] : null)
    || (options.subcommand === 'dispatch' ? options.positionals?.[1] : null)
    || (options.subcommand === 'graph' ? options.positionals?.[1] : null)
    || options.positionals?.[0];
  if (!subtaskId) {
    throw runtimeError('TASK_GRAPH_INVALID', 'task graph-dispatch requires --subtask <subtaskId>.', {
      recoverable: false,
      taskId: parentTaskId,
      stage: 'graph-validation',
    });
  }
  validateSubtaskId(subtaskId);

  // Validate the derived Runtime-owned location before claiming the graph
  // state. This keeps an unsafe pre-existing path (including a symlink or
  // junction) from turning into a durable FAILED transition merely because
  // the dispatch reached the filesystem phase.
  let plannedWorktree;
  try {
    plannedWorktree = {
      path: taskGraphWorktreePath(repository, parentTaskId, subtaskId),
      branch: taskGraphBranchName(parentTaskId, subtaskId),
      ref: taskGraphBranchRef(parentTaskId, subtaskId),
    };
  } catch (error) {
    if (error?.code) throw error;
    throw runtimeError('TASK_STATE_CONFLICT', error?.message || String(error), {
      recoverable: false,
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      stage: 'worktree',
    });
  }

  const currentGraph = readTaskGraph(repository, parentTaskId);
  const subtask = currentGraph.subtasks.find(s => s.id === subtaskId);
  if (!subtask) {
    throw runtimeError('TASK_NOT_FOUND', `Task Graph subtask not found: ${parentTaskId}/${subtaskId}`, {
      recoverable: false,
      taskId: parentTaskId,
      details: { parentTaskId, subtaskId },
    });
  }

  if (['APPROVED', 'STOPPED'].includes(currentGraph.state)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} is in ${currentGraph.state} and cannot dispatch subtasks.`, {
      recoverable: false,
      taskId: parentTaskId,
      subtaskId,
    });
  }

  if (subtask.state !== 'READY') {
    if (subtask.state === 'WAITING') {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask "${subtaskId}" is WAITING for dependencies; only READY subtasks can be dispatched.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
        details: { state: subtask.state, reason: subtask.reason },
      });
    }
    if (subtask.state === 'RUNNING') {
      throw runtimeError('TASK_ALREADY_RUNNING', `Subtask "${subtaskId}" is already RUNNING.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
      });
    }
    if (subtask.state === 'BLOCKED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask "${subtaskId}" is BLOCKED; only READY subtasks can be dispatched.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
        details: { state: subtask.state, reason: subtask.reason },
      });
    }
    if (subtask.state === 'SUCCEEDED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask "${subtaskId}" has already SUCCEEDED.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
      });
    }
    throw runtimeError('TASK_STATE_CONFLICT', `Subtask "${subtaskId}" is in ${subtask.state}; resume required before dispatch.`, {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
    });
  }

  let effectiveSpec = subtask.spec;
  if (options.spec !== undefined && options.spec !== null && options.spec !== '') {
    const nextSpec = `${options.spec}`.trim();
    if (!nextSpec) {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${subtaskId} requires a non-empty specification.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
      });
    }
    if (Buffer.byteLength(nextSpec, 'utf8') > TASK_GRAPH_MAX_SPEC_BYTES) {
      throw runtimeError('TASK_GRAPH_INVALID', `Subtask ${subtaskId} specification exceeds ${TASK_GRAPH_MAX_SPEC_BYTES} bytes.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
        stage: 'graph-validation',
      });
    }
    effectiveSpec = nextSpec;
  }

  let adapterRegistry = null;
  let resolution;
  let detection = null;
  let agentId = subtask.implementer;
  let worktreeInfo = null;
  let baseCommit = null;
  let session = null;
  let opened = null;
  let claimed = false;
  let dispatchMessagePath = null;
  try {
    // Claim the selected frontier item before any Adapter, worktree, or
    // Session side effect.  The expected-state check is performed under the
    // graph lock, so a concurrent dispatch cannot launch the same subtask or
    // accidentally fail the first caller's RUNNING record.
    baseCommit = options.graphBaseCommit
      || currentGraph.baseCommit
      || currentGraph.parentTask?.baseCommit
      || captureGraphBaseCommit(repository);
    setTaskGraphSubtaskState(repository, parentTaskId, subtaskId, 'RUNNING', {
      expectedState: 'READY',
      requireAvailableSlot: true,
      requireIntentCompatible: true,
      baseCommit,
      spec: effectiveSpec,
      reason: `Dispatching subtask ${subtaskId}.`,
      lastError: null,
      dispatch: {
        parentTaskId,
        subtaskId,
        baseCommit,
        startedAt: new Date().toISOString(),
      },
    });
    claimed = true;

    adapterRegistry = await loadConfiguredAdaptersForRuntime();
    resolution = await taskAgentResolution(repository, {
      id: parentTaskId,
      planner: currentGraph.parentTask.planner,
      implementer: subtask.implementer,
      round: 1,
    }, adapterRegistry, { implementerOverride: true });
    agentId = resolution.workflowImplementer;

    if (resolution.contract && !resolution.contract.capabilities.detection) {
      throw runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${resolution.contract.id}" does not support executable detection.`, {
        recoverable: false,
        taskId: parentTaskId,
        subtaskId,
        agent: agentId,
        adapter: resolution.contract.id,
      });
    }
    detection = resolution.contract
      ? validateDetectionResult(resolution.adapter.detect({ version: false }))
      : resolution.adapter.detect({ version: false });
    if (!detection.available) {
      throw runtimeError(canonicalErrorCode(detection.code, 'EXECUTABLE_NOT_FOUND'), detection.details || `Executable is unavailable: ${resolution.resolved.command}`, {
        recoverable: true,
        taskId: parentTaskId,
        subtaskId,
        agent: agentId,
        adapter: resolution.resolved.adapter,
        command: resolution.resolved.command,
        stage: 'executable',
        result: detection,
      });
    }

    worktreeInfo = { worktreePath: plannedWorktree.path, branch: plannedWorktree.branch, ref: plannedWorktree.ref };
    worktreeInfo = ensureSubtaskWorktree(repository, parentTaskId, subtaskId, baseCommit);
    ensureSubtaskWorktreeBus(repository, worktreeInfo.worktreePath);

    const body = subtaskImplementationPrompt(currentGraph, { ...subtask, spec: effectiveSpec }, baseCommit);
    dispatchMessagePath = sendTaskBusMessage(worktreeInfo.worktreePath, {
      from: currentGraph.parentTask.planner,
      to: agentId,
      type: 'IMPLEMENT',
      subject: `Implement ${parentTaskId}/${subtaskId}`,
      body,
      dedupeKey: `task:${parentTaskId}:subtask:${subtaskId}:implement`,
    });

    setTaskGraphSubtaskState(repository, parentTaskId, subtaskId, 'RUNNING', {
      expectedState: 'RUNNING',
      baseCommit,
      worktreePath: worktreeInfo.worktreePath,
      branch: worktreeInfo.branch,
      ref: worktreeInfo.ref,
      command: resolution.resolved.command,
      effectiveCommand: detection.resolvedCommand || resolution.resolved.command,
      resolvedCommand: detection.resolvedCommand || null,
      spec: effectiveSpec,
      dispatch: {
        ...(readTaskGraph(repository, parentTaskId).subtasks.find(s => s.id === subtaskId)?.dispatch || {}),
        implementer: agentId,
        adapter: resolution.resolved.adapter,
        command: resolution.resolved.command,
        commandSource: resolution.resolved.commandSource,
        resolvedCommand: detection.resolvedCommand || null,
        baseCommit,
        worktreePath: worktreeInfo.worktreePath,
        branch: worktreeInfo.branch,
        ref: worktreeInfo.ref,
        messagePath: dispatchMessagePath,
        dispatchedAt: new Date().toISOString(),
      },
    });

    const sessionManager = getExecutionSessionManager();
    opened = await sessionManager.open({
      root: worktreeInfo.worktreePath,
      agent: agentId,
      sessionId: subtask.sessionId,
      resolved: {
        ...resolution.resolved,
        resolvedCommand: detection.resolvedCommand || null,
      },
      adapter: resolution.adapter,
      initialPrompt: body,
      language: options.language || 'en',
      taskId: parentTaskId,
      subtaskId,
    });
    session = opened.session;
    if (!opened.initialInputConsumed) {
      session = await sessionManager.write(worktreeInfo.worktreePath, session.id, body, { taskId: parentTaskId, subtaskId });
    }

    setTaskGraphSubtaskState(repository, parentTaskId, subtaskId, 'RUNNING', {
      expectedState: 'RUNNING',
      baseCommit,
      worktreePath: worktreeInfo.worktreePath,
      branch: worktreeInfo.branch,
      ref: worktreeInfo.ref,
      command: resolution.resolved.command,
      effectiveCommand: detection.resolvedCommand || resolution.resolved.command,
      resolvedCommand: detection.resolvedCommand || null,
      sessionId: session.id,
      dispatch: {
        ...(readTaskGraph(repository, parentTaskId).subtasks.find(s => s.id === subtaskId)?.dispatch || {}),
        sessionId: session.id,
        reusedSession: Boolean(opened.reused),
      },
    });

    const graceMs = Number.isInteger(options.sessionWaitMs) && options.sessionWaitMs >= 0
      ? Math.min(options.sessionWaitMs, 10_000)
      : 10_000;
    const deadline = Date.now() + graceMs;
    let finalSubtaskResult = null;
    let statusProbeError = null;

    const completeFromLatestMessage = () => {
      const message = findSubtaskImplementationMessages(
        worktreeInfo.worktreePath,
        parentTaskId,
        subtaskId,
        agentId,
        currentGraph.parentTask.planner,
      ).at(-1);
      if (!message) return null;
      const completion = graphCompletionFromMessage(message, worktreeInfo.worktreePath, baseCommit);

      // Post-execution scope audit: compare declared writeIntent against
      // actual changes before dependent eligibility is derived. The audit
      // never mutates the worktree, retries, resets, or removes work.
      const graphForAudit = readTaskGraph(repository, parentTaskId);
      const { writeIntent, scopePolicy } = subtaskScopeIntent(graphForAudit, subtaskId);
      let scopeEvidence = null;
      let auditDrift = false;
      if (scopePolicy !== null) {
        scopeEvidence = auditSubtaskScope({
          parentTaskId,
          subtaskId,
          graphBaseCommit: baseCommit,
          implementationCommit: completion.commit,
          worktreePath: worktreeInfo.worktreePath,
          writeIntent,
          scopePolicy,
        });
        auditDrift = scopeEvidence.drift === true;
      }

      // Under strict policy with drift, block successful prerequisite
      // eligibility. The commit and worktree are preserved (recoverable).
      if (auditDrift && scopePolicy === 'strict') {
        const driftPaths = (scopeEvidence.outsideIntentPaths || []);
        const driftMessage = `Subtask ${parentTaskId}/${subtaskId} has INTENT_SCOPE_DRIFT under strict policy: ${driftPaths.slice(0, 4).join(', ')}${driftPaths.length > 4 ? '…' : ''}`;
        setTaskGraphSubtaskState(repository, parentTaskId, subtaskId, 'FAILED', {
          expectedState: 'RUNNING',
          implementationCommit: completion.commit,
          evidence: completion.evidence,
          worktreePath: worktreeInfo.worktreePath,
          branch: worktreeInfo.branch,
          ref: worktreeInfo.ref,
          baseCommit,
          command: resolution.resolved.command,
          effectiveCommand: detection.resolvedCommand || resolution.resolved.command,
          resolvedCommand: detection.resolvedCommand || null,
          sessionId: session.id,
          lastError: { code: 'INTENT_SCOPE_DRIFT', message: driftMessage, recoverable: true },
          scopeEvidence,
        });
        throw runtimeError('INTENT_SCOPE_DRIFT', driftMessage, {
          recoverable: true,
          taskId: parentTaskId,
          subtaskId,
          root: repository,
          stage: 'scope-audit',
          details: { scopePolicy, outsideIntentPaths: driftPaths.slice(0, 8) },
        });
      }

      // Under warn policy with drift, emit a visible warning but keep SUCCEEDED.
      const warnReason = (auditDrift && scopePolicy === 'warn')
        ? `INTENT_SCOPE_DRIFT: ${(scopeEvidence.outsideIntentPaths || []).slice(0, 4).join(', ')}${(scopeEvidence.outsideIntentPaths || []).length > 4 ? '…' : ''}`
        : null;

      const updated = setTaskGraphSubtaskState(repository, parentTaskId, subtaskId, 'SUCCEEDED', {
        expectedState: 'RUNNING',
        implementationCommit: completion.commit,
        evidence: completion.evidence,
        worktreePath: worktreeInfo.worktreePath,
        branch: worktreeInfo.branch,
        ref: worktreeInfo.ref,
        baseCommit,
        command: resolution.resolved.command,
        effectiveCommand: detection.resolvedCommand || resolution.resolved.command,
        resolvedCommand: detection.resolvedCommand || null,
        sessionId: session.id,
        lastError: null,
        ...(warnReason ? { reason: warnReason } : {}),
        ...(scopeEvidence !== null ? { scopeEvidence } : {}),
      });
      return { graph: updated.graph, commit: completion.commit, evidence: completion.evidence, scopeEvidence };
    };

    while (!finalSubtaskResult) {
      finalSubtaskResult = completeFromLatestMessage();
      if (finalSubtaskResult || ['failed', 'exited'].includes(session?.state)) break;
      if (Date.now() >= deadline) break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
      try {
        session = await sessionManager.status(worktreeInfo.worktreePath, session.id);
        statusProbeError = null;
      } catch (error) {
        statusProbeError = error;
      }
    }

    // A completion may have been written immediately after the last status
    // probe. Check once more before treating a terminal Session as a failure
    // or returning a bounded RUNNING observation.
    if (!finalSubtaskResult) finalSubtaskResult = completeFromLatestMessage();
    if (!finalSubtaskResult && ['failed', 'exited'].includes(session?.state)) {
      throw graphSessionFailure(session, parentTaskId, subtaskId, agentId, resolution, repository);
    }
    if (!finalSubtaskResult && statusProbeError && Date.now() >= deadline) {
      throw runtimeError(statusProbeError.code || 'SESSION_NOT_ATTACHED', `Unable to observe execution session ${session.id}: ${statusProbeError.message || statusProbeError}`, {
        recoverable: true,
        taskId: parentTaskId,
        subtaskId,
        agent: agentId,
        adapter: resolution.resolved.adapter,
        command: resolution.resolved.command,
        sessionId: session.id,
        root: repository,
        stage: 'runtime',
      });
    }

    const latestGraph = readTaskGraph(repository, parentTaskId);
    const updatedSubtask = latestGraph.subtasks.find(s => s.id === subtaskId);

    const payload = jsonSuccess('task.graph-dispatch', {
      root: repository,
      graphId: parentTaskId,
      parentTaskId,
      subtaskId,
      graph: latestGraph,
      subtask: updatedSubtask,
      worktree: {
        path: worktreeInfo.worktreePath,
        branch: worktreeInfo.branch,
        ref: worktreeInfo.ref,
        baseCommit,
      },
      session: {
        ...session,
        reused: Boolean(opened?.reused),
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
      frontier: latestGraph.frontier,
      implementationCommit: updatedSubtask?.implementationCommit || null,
      evidence: updatedSubtask?.evidence || [],
      scopeEvidence: finalSubtaskResult?.scopeEvidence || updatedSubtask?.scopeEvidence || null,
    });

    if (!json) console.log(JSON.stringify(payload, null, 2));
    return payload;
  } catch (error) {
    const normalized = error?.code ? error : runtimeError('AGENT_RUNTIME_ERROR', error?.message || String(error), {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
    });
    // Some Session/Adapter errors are already canonical but were created
    // below the graph layer. Enrich them in place so the durable graph error
    // always retains the complete parent/subtask/Agent/Session/root identity.
    if (!normalized.taskId) normalized.taskId = parentTaskId;
    if (!normalized.subtaskId) normalized.subtaskId = subtaskId;
    if (!normalized.agent) normalized.agent = agentId || subtask.implementer;
    if (!normalized.root) normalized.root = repository;
    if (!normalized.sessionId && session?.id) normalized.sessionId = session.id;
    if (claimed) try {
      setTaskGraphSubtaskState(repository, parentTaskId, subtaskId, 'FAILED', {
        expectedState: 'RUNNING',
        reason: normalized.message,
        lastError: serializeRuntimeError(normalized, { includeLegacy: true }),
        ...(worktreeInfo ? { worktreePath: worktreeInfo.worktreePath, branch: worktreeInfo.branch, ref: worktreeInfo.ref } : {}),
        ...(baseCommit ? { baseCommit } : {}),
        ...(session?.id ? { sessionId: session.id } : {}),
        ...(resolution?.resolved?.command ? {
          command: resolution.resolved.command,
          effectiveCommand: detection?.resolvedCommand || resolution.resolved.command,
          resolvedCommand: detection?.resolvedCommand || null,
        } : {}),
      });
    } catch { /* Preserve primary error */ }
    throw normalized;
  }
}

async function taskCommand(options, { json = false } = {}) {
  const subcommand = options.subcommand || 'status';
  const graphValidate = subcommand === 'graph-validate'
    || subcommand === 'validate-graph'
    || (subcommand === 'graph' && options.positionals?.[0] === 'validate');
  const graphOperation = taskGraphOperation(options);
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
  if (graphOperation === 'create') return await taskGraphCreateCommand(options, { json });
  if (graphOperation === 'plan') return await taskGraphPlanCommand(options, { json });
  if (graphOperation === 'run') return await taskGraphRunCommand(options, { json });
  if (graphOperation === 'advance') return await taskGraphAdvanceCommand(options, { json });
  if (graphOperation === 'recover') return await taskGraphRecoverCommand(options, { json });
  if (graphOperation === 'resume') return await taskGraphResumeCommand(options, { json });
  if (graphOperation === 'stop') return await taskGraphStopCommand(options, { json });
  if (graphOperation === 'cleanup') return await taskGraphCleanupCommand(options, { json });
  if (graphOperation === 'integrate') return await taskGraphIntegrateCommand(options, { json });
  if (graphOperation === 'review') return await taskGraphReviewCommand(options, { json });
  if (graphOperation === 'dispatch') return await taskGraphDispatchCommand(options, { json });
  if (graphOperation === 'status' || graphOperation === 'inspect') {
    return taskGraphViewCommand(options, graphOperation, { json });
  }

  // Existing Task status/inspect calls are graph-aware when the requested
  // Task ID is a persisted parent graph. This preserves the original Task
  // response for ordinary schema-version-1 Tasks while making the graph path
  // discoverable through the established operations.
  if (['status', 'inspect'].includes(subcommand)) {
    const requestedId = options.taskId || options.positionals?.[0] || null;
    if (requestedId && hasTaskGraph(resolve(options.root), requestedId)) {
      return taskGraphViewCommand({ ...options, taskId: requestedId }, subcommand, { json, commandName: `task.${subcommand}` });
    }
    if (!requestedId) {
      try {
        const graphs = listTaskGraphs(resolve(options.root));
        if (graphs[0]) {
          return taskGraphViewCommand({ ...options, taskId: graphs[0].parentTaskId }, subcommand, { json, commandName: `task.${subcommand}` });
        }
      } catch {
        // Preserve the existing single-Task error when no graph store exists.
      }
    }
  }
  if (subcommand === 'review') {
    const requestedId = options.taskId || options.positionals?.[0] || null;
    if (requestedId && hasTaskGraph(resolve(options.root), requestedId)) {
      return await taskGraphReviewCommand({ ...options, taskId: requestedId }, { json });
    }
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
      if (options.subtaskId) {
        return await taskGraphDispatchCommand(options, { json });
      }
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
  return readBoundedJsonInput(path, {
    label: 'Task Graph v1',
    maxBytes: TASK_GRAPH_MAX_INPUT_BYTES,
    stage: 'graph-validation',
  });
}

function readBoundedJsonInput(path, { label, maxBytes, stage }) {
  const inputPath = resolve(path);
  let content;
  try {
    const metadata = lstatSync(inputPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) {
      throw new Error(`input must be a regular, non-symlink JSON file no larger than ${maxBytes} bytes`);
    }
    content = readFileSync(inputPath, 'utf8');
  } catch (error) {
    throw runtimeError('TASK_GRAPH_INVALID', `Unable to read ${label} input: ${error.message || error}`, {
      recoverable: false,
      stage,
    });
  }
  try { return JSON.parse(content); } catch (error) {
    throw runtimeError('TASK_GRAPH_INVALID', `${label} input is not valid JSON: ${error.message}`, {
      recoverable: false,
      stage,
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

// Graph persistence is deliberately a read/write-only Runtime operation. It
// must not resolve an Adapter, open a Session, or spawn even a Git helper
// process merely to discover the repository root. Walk the filesystem for a
// regular .git directory/file instead; normal Task operations retain the
// existing Git-backed check above.
function assertGitRepositoryWithoutProcess(root, t) {
  const requested = resolve(root || process.cwd());
  let metadata;
  try {
    metadata = lstatSync(requested);
  } catch {
    throw new Error(format(t.notGitRepo, { path: requested }));
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(format(t.notGitRepo, { path: requested }));
  }
  let cursor = requested;
  while (true) {
    const marker = join(cursor, '.git');
    try {
      const markerMetadata = lstatSync(marker);
      if (markerMetadata.isSymbolicLink()) {
        throw new Error(format(t.unsafeBusPath, { path: marker }));
      }
      if (markerMetadata.isDirectory()) return resolve(realpathSync(cursor));
      if (markerMetadata.isFile()) {
        // Linked worktrees use a text .git marker. We only need to prove the
        // requested path is a Git worktree; no marker target is followed.
        const contents = readFileSync(marker, 'utf8');
        if (/^\s*gitdir\s*:/im.test(contents)) return resolve(realpathSync(cursor));
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(format(t.notGitRepo, { path: requested }));
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
      windowsHide: true,
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

export async function runCli(argv) {
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

  const dispatched = await dispatchCommand(options, {
    agentCommandJson,
    defaultUserConfig,
    doctorJson,
    emitJson,
    executableVersion,
    existsSync,
    format,
    getAdapter,
    handleAgentCommand,
    installAuxiliarySkills,
    installTarget,
    inspectorCommand,
    isIntactManagedInstallation,
    jsonFailure,
    jsonSuccess,
    language,
    launchAgent,
    loadConfiguredAdaptersForRuntime,
    messages: t,
    payloadManifest,
    projectConfigForRoot,
    quickstart,
    readUserConfig,
    removePath,
    repairCommands,
    resolve,
    runtimeAgentConfig,
    setupCommand,
    setupConfigureCommand,
    statusJson,
    suggestedCommand,
    taskCommand,
    taskGraphOperation,
    targetRepairCommand,
    targets,
    uninstallAuxiliarySkills,
    userConfigPath,
    verifyTarget,
  });
  if (dispatched) return;

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
    taskId: input.taskId || input.parentTaskId || input.id || null,
    subtaskId: input.subtaskId || input.subtask || null,
    sessionWaitMs: input.sessionWaitMs ?? null,
    maxWaves: input.maxWaves ?? null,
    reason: '',
    decision: null,
    feedback: '',
    input: null,
    intentMapInput: null,
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

export async function runtimeTaskGraphCreate(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-create',
    graph: input.graph !== undefined
      ? input.graph
      : (input.input && typeof input.input === 'object' ? input.input : undefined),
    intentMap: input.intentMap,
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

export async function runtimeTaskGraphStatus(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-status',
    taskId: input.taskId || input.id || null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphInspect(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-inspect',
    taskId: input.taskId || input.id || null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphPlan(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-plan',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphRun(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-run',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    sessionWaitMs: input.sessionWaitMs ?? null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphAdvance(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-advance',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    maxWaves: input.maxWaves ?? null,
    sessionWaitMs: input.sessionWaitMs ?? null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphRecover(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-recover',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    subtaskId: input.subtaskId || input.subtask || null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphResume(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-resume',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    subtaskId: input.subtaskId || input.subtask || null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphStop(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-stop',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    subtaskId: input.subtaskId || input.subtask || null,
    timeoutMs: input.timeoutMs ?? null,
    reason: input.reason || '',
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphCleanup(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-cleanup',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    subtaskId: input.subtaskId || input.subtask || null,
    timeoutMs: input.timeoutMs ?? null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphIntegrate(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-integrate',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    timeoutMs: input.timeoutMs ?? null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphReview(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-review',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    decision: input.decision || null,
    feedback: input.feedback || input.reason || '',
    evidence: input.evidence === undefined ? null : input.evidence,
    timeoutMs: input.timeoutMs ?? null,
    positionals: [],
  }), { json: true });
}

export async function runtimeTaskGraphDispatch(input = {}) {
  return taskCommand(serviceOptions({
    ...input,
    command: 'task',
    subcommand: 'graph-dispatch',
    taskId: input.taskId || input.parentTaskId || input.id || null,
    subtaskId: input.subtaskId || input.subtask || null,
    spec: input.spec !== undefined ? input.spec : undefined,
    sessionWaitMs: input.sessionWaitMs ?? null,
    positionals: [],
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
