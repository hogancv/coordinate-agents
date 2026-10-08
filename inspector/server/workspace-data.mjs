import { homedir } from 'node:os';
import { existsSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { assertSafePath, readConfig } from '../../skills/coordinate-agents/scripts/config.mjs';
import { readUserConfig, resolveAgentConfig } from '../../skills/coordinate-agents/scripts/user-config.mjs';
import { runtimeSessionRead } from '../../skills/coordinate-agents/scripts/session-service.mjs';
import { readWorkspaceTask, readWorkspaceTasks } from '../../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { assertWorkspaceSession } from '../../skills/coordinate-agents/scripts/workspace-services.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';
import { readRuntimeEvents } from '../../skills/coordinate-agents/scripts/runtime-events.mjs';
const MAX_EVENT_DETAILS = 4 * 1024;
const MAX_TERMINAL_READ_BYTES = 32 * 1024;
const MAX_TERMINAL_READ_LINES = 200;
const WORKSPACE_AGENT_DEFAULTS = Object.freeze([
  Object.freeze({ id: 'codex', adapter: 'codex-cli', command: 'codex' }),
  Object.freeze({ id: 'antigravity', adapter: 'antigravity-cli', command: 'agy' }),
]);
function canonicalRoot(root) {
  const candidate = resolve(`${root || process.cwd()}`);
  const metadata = lstatSync(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Inspector root is not a regular directory: ${candidate}`);
  }
  return realpathSync(candidate);
}


function busFor(root) {
  const bus = join(root, '.agent-bus');
  if (!existsSync(bus)) return null;
  assertSafePath(root, bus);
  const metadata = lstatSync(bus);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe Agent Bus root: ${bus}`);
  }
  return bus;
}


function bounded(value, limit = MAX_EVENT_DETAILS) {
  if (value === null || value === undefined) return '';
  return redactOutput(`${value}`, limit);
}


function safeWorkspaceCommand(value, fallback) {
  const command = bounded(value || fallback, 512)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim();
  return command || fallback;
}


function readCodexModels() {
  try {
    const cache = JSON.parse(readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8'));
    return (cache.models || []).filter(model => model.visibility !== 'hide' && typeof model.slug === 'string').map(model => ({
      id: model.slug,
      name: model.display_name || model.slug,
      efforts: (model.supported_reasoning_levels || []).map(level => level.effort).filter(effort => typeof effort === 'string'),
    }));
  } catch { return []; }
}


function readWorkspaceSettings(root) {
  const bus = busFor(root);
  let projectAgents = [];
  try {
    if (bus) projectAgents = readConfig(bus).agents;
  } catch {
    projectAgents = [];
  }
  let userConfig;
  try {
    userConfig = readUserConfig();
  } catch {
    userConfig = { version: 1, agents: {} };
  }
  const projectAgentsById = new Map(projectAgents.map(agent => [agent.id, agent]));
  return Object.fromEntries(WORKSPACE_AGENT_DEFAULTS.map(({ id, adapter, command: fallback }) => {
    const projectAgent = projectAgentsById.get(id) || { id, adapter };
    try {
      const resolved = resolveAgentConfig(projectAgent, userConfig);
      return [id, {
        command: safeWorkspaceCommand(resolved.command, fallback),
        adapter: resolved.adapter || adapter,
        source: resolved.commandSource || 'adapter-default',
        args: resolved.args || [],
        ...(id === 'codex' ? { models: readCodexModels() } : {}),
        argsSource: resolved.argsSource,
      }];
    } catch {
      return [id, {
        command: fallback,
        adapter,
        source: 'adapter-default',
      }];
    }
  }));
}


function gitFact(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 512 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}


function repositoryFacts(root) {
  const headLine = gitFact(root, ['log', '-1', '--format=%h%x1f%s%x1f%cI']);
  const head = headLine
    ? (() => {
      const [shortSha, subject, committedAtRaw] = headLine.split('\x1f');
      const committedAt = typeof committedAtRaw === 'string' && !Number.isNaN(Date.parse(committedAtRaw))
        ? committedAtRaw
        : null;
      return {
        short: bounded(shortSha, 64) || null,
        subject: bounded(subject, 2 * 1024) || null,
        committedAt,
      };
    })()
    : null;
  const branch = bounded(gitFact(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']), 256) || null;
  return {
    root,
    name: bounded(basename(root), 256),
    branch,
    detached: Boolean(head && !branch),
    head,
    remoteUrl: bounded(gitFact(root, ['remote', 'get-url', 'origin']), 2 * 1024) || null,
  };
}


async function readSessionOutput(root, sessionId, {
  cursor = null,
  maxLines = MAX_TERMINAL_READ_LINES,
  maxBytes = MAX_TERMINAL_READ_BYTES,
} = {}) {
  const result = await runtimeSessionRead({
    root,
    sessionId,
    cursor,
    maxLines: Math.min(MAX_TERMINAL_READ_LINES, Math.max(1, Number.isInteger(maxLines) ? maxLines : MAX_TERMINAL_READ_LINES)),
    maxBytes: Math.min(MAX_TERMINAL_READ_BYTES, Math.max(1, Number.isInteger(maxBytes) ? maxBytes : MAX_TERMINAL_READ_BYTES)),
  });
  const output = typeof result.output === 'string' ? result.output : '';
  const session = result.session
    ? {
      ...result.session,
      status: result.session.status || result.session.state || null,
    }
    : null;
  return {
    session,
    output: {
      output: redactOutput(output, MAX_TERMINAL_READ_BYTES),
      nextCursor: Number.isInteger(result.nextCursor) ? result.nextCursor : null,
      truncated: result.truncated === true,
    },
  };
}

export { canonicalRoot, busFor, bounded, readWorkspaceSettings, repositoryFacts, readSessionOutput };
export function createWorkspaceData(root) {
  const repository = canonicalRoot(root);
  return {
    root: repository,
    readRepository: () => repositoryFacts(repository),
    readWorkspaceSettings: () => readWorkspaceSettings(repository),
    readWorkspaceTasks: () => readWorkspaceTasks(repository),
    readWorkspaceTask: id => readWorkspaceTask(repository, id),
    async readSessionOutput(sessionId, options) {
      await assertWorkspaceSession({ root: repository, sessionId });
      return readSessionOutput(repository, sessionId, options);
    },
    async readSessions() {
      const tasks = await readWorkspaceTasks(repository);
      return tasks.flatMap(task => Object.values(task.sessions).filter(session => session.sessionId).map(session => ({ ...session, id: session.sessionId, taskIds: [task.id] })));
    },
    readEvents: options => readRuntimeEvents(repository, options),
  };
}
