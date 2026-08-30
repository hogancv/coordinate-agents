import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const VALUE_OPTIONS = new Set([
  '--codex-home', '--antigravity-home', '--codex-home-base64', '--antigravity-home-base64',
  '--root', '--root-base64', '--agent', '--planner', '--implementer', '--reviewer',
  '--adapter', '--command', '--args', '--template', '--task', '--title', '--spec',
  '--id', '--task-id', '--parent-task-id', '--subtask', '--subtask-id',
  '--reason', '--error-code', '--timeout', '--timeout-ms', '--session-wait-ms', '--lang',
  '--role', '--decision', '--feedback', '--port', '--input', '--intent-map',
]);

function defaultOptions() {
  return {
    command: 'help', subcommand: null, targetAgent: null,
    codex: false, antigravity: false, force: false, once: false, help: false, version: false, json: false,
    codexHome: process.env.CODEX_HOME || join(homedir(), '.codex'),
    antigravityHome: process.env.GEMINI_HOME || join(homedir(), '.gemini'),
    codexHomeBase64: null, antigravityHomeBase64: null,
    root: process.cwd(), rootBase64: null,
    agent: null, planner: null, implementer: null, reviewer: null,
    title: '', spec: '', taskId: null, subtaskId: null, reason: '', errorCode: null,
    timeoutMs: null, sessionWaitMs: null, port: 3000,
    adapter: 'generic-cli', agentCommand: null, agentArgs: null,
    role: 'implementer', roleExplicit: false,
    decision: null, feedback: '', input: null, intentMapInput: null,
    template: 'feature', task: '', language: null, adapterExplicit: false, positionals: [],
  };
}

function takeSubcommand(result, args) {
  if (!args[0] || args[0].startsWith('-')) return;
  if (['agent', 'adapter', 'config', 'task', 'setup'].includes(result.command)) {
    result.subcommand = args.shift();
  }
  if (['agent', 'adapter'].includes(result.command) && args[0] && !args[0].startsWith('-')) {
    result.targetAgent = args.shift();
  }
}

function assignValue(result, option, value) {
  if (option === '--codex-home') result.codexHome = resolve(value);
  if (option === '--antigravity-home') result.antigravityHome = resolve(value);
  if (option === '--codex-home-base64') result.codexHomeBase64 = value;
  if (option === '--antigravity-home-base64') result.antigravityHomeBase64 = value;
  if (option === '--root') result.root = resolve(value);
  if (option === '--root-base64') result.rootBase64 = value;
  if (option === '--agent') result.agent = value.toLowerCase();
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
  if (option === '--intent-map') result.intentMapInput = value;
  if (option === '--template') result.template = value.toLowerCase();
  if (option === '--task') result.task = value;
  if (option === '--title') result.title = value;
  if (option === '--spec') result.spec = value;
  if (option === '--subtask' || option === '--subtask-id') result.subtaskId = value;
  if (option === '--id' || option === '--task-id' || option === '--parent-task-id') result.taskId = value;
  if (option === '--reason') result.reason = value;
  if (option === '--error-code') result.errorCode = value;
  if (option === '--timeout' || option === '--timeout-ms') {
    const timeoutMs = Number(value);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`INVALID_TIMEOUT:${value}`);
    result.timeoutMs = Math.floor(timeoutMs);
  }
  if (option === '--session-wait-ms') {
    const waitMs = Number(value);
    if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error(`INVALID_TIMEOUT:${value}`);
    result.sessionWaitMs = Math.floor(waitMs);
  }
  if (option === '--port') {
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`INVALID_PORT:${value}`);
    result.port = port;
  }
  if (option === '--lang') result.language = value;
}

export function parseArgs(argv) {
  const result = defaultOptions();
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) {
    result.command = args.shift();
    takeSubcommand(result, args);
  }
  while (args.length) {
    const option = args.shift();
    if (!option.startsWith('-')) {
      result.positionals.push(option);
    } else if (option === '--codex') result.codex = true;
    else if (option === '--antigravity') result.antigravity = true;
    else if (option === '--force') result.force = true;
    else if (option === '--once') result.once = true;
    else if (option === '--help' || option === '-h') result.help = true;
    else if (option === '--version') result.version = true;
    else if (option === '--json') result.json = true;
    else if (VALUE_OPTIONS.has(option)) {
      if (!args.length || args[0].startsWith('-')) throw new Error(`MISSING_VALUE:${option}`);
      assignValue(result, option, args.shift());
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
