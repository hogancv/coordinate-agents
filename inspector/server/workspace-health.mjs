import { execFile } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getAdapter } from '../../skills/coordinate-agents/adapters/index.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

const PROBE_TIMEOUT = 3000;
const ACTIVE_SESSION_STATES = new Set(['starting', 'running', 'idle', 'busy']);

// Adapter discovery includes synchronous Windows executable lookup. Keep it
// off the HTTP event loop; version execution below is asynchronous and bounded.
if (!isMainThread && workerData?.workspaceHealth) {
  try {
    const result = getAdapter(workerData.adapter, { command: workerData.command }).detect({ version: false });
    parentPort.postMessage(result);
  } catch {
    parentPort.postMessage({ available: false, code: 'DETECTION_FAILED' });
  }
}

function discover(settings, timeout) {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { workspaceHealth: true, adapter: settings.adapter, command: settings.command },
      execArgv: [],
    });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ available: false, code: 'DETECTION_TIMEOUT' }), Math.max(1000, timeout));
    worker.once('message', finish);
    worker.once('error', () => finish({ available: false, code: 'DETECTION_FAILED' }));
    worker.once('exit', () => finish({ available: false, code: 'DETECTION_FAILED' }));
  });
}

function probeVersion(command, args, root, timeout) {
  return new Promise(resolve => {
    execFile(command, args, { cwd: root, timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024,
      encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const reason = error.killed ? 'VERSION_CHECK_TIMEOUT'
          : error.code === 'ENOENT' ? 'COMMAND_NOT_FOUND'
            : ['EACCES', 'ENOEXEC', 'EPERM'].includes(error.code) ? 'COMMAND_NOT_EXECUTABLE' : 'VERSION_CHECK_FAILED';
        resolve({ status: reason === 'VERSION_CHECK_TIMEOUT' ? 'pending'
          : ['COMMAND_NOT_FOUND', 'COMMAND_NOT_EXECUTABLE'].includes(reason) ? 'missing' : 'warning', version: null, reason });
        return;
      }
      // Return only a numeric version from the first line, never arbitrary
      // wrapper output, authentication data, environment or stderr diagnostics.
      const line = `${stdout || stderr}`.trim().split(/\r?\n/, 1)[0];
      const version = /^[\w .-]*?\bv?(\d+\.\d+(?:\.\d+){0,2}(?:[-+][\w.-]+)?)\b[\w ().+-]*$/.exec(line)?.[1] || null;
      resolve(version ? { status: 'ok', version } : { status: 'warning', version: null, reason: 'VERSION_UNAVAILABLE' });
    });
  });
}

async function checkCli(settings, timeout, root) {
  const base = { command: redactOutput(settings.command, 512), version: null, authenticated: 'unknown' };
  try {
    const detected = await discover(settings, timeout);
    if (!detected.available) return { ...base,
      status: ['DETECTION_TIMEOUT', 'DETECTION_FAILED'].includes(detected.code) ? 'pending' : 'missing', reason: detected.code };
    return { ...base, ...await probeVersion(detected.runtimeCommand, [...detected.prefix, '--version'], root, timeout) };
  } catch {
    return { ...base, status: 'pending', reason: 'DETECTION_FAILED' };
  }
}

export function terminalHealth(sessions = [], nodeVersion = process.version) {
  const backends = sessions.filter(session => (session?.sessionId || session?.id)
    && ACTIVE_SESSION_STATES.has(`${session.status || session.state || ''}`.toLowerCase())).map(session => session.backend);
  if (backends.includes('stdio-fallback')) return { status: 'warning', backend: 'stdio-fallback', reason: 'STDIO_FALLBACK' };
  if (backends.includes('node-pty')) return { status: 'ok', backend: 'node-pty' };
  return { status: 'pending', backend: null,
    ...(Number(nodeVersion.replace(/^v/, '').split('.')[0]) === 18 ? { reason: 'NODE18_STDIO_COMPATIBILITY' } : {}) };
}

export async function readWorkspaceHealth({ root, settings, sessions = [], timeout = PROBE_TIMEOUT }) {
  const [git, codex, antigravity] = await Promise.all([
    probeVersion('git', ['--version'], root, timeout),
    checkCli(settings.codex, timeout, root),
    checkCli(settings.antigravity, timeout, root),
  ]);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const checks = {
    node: { status: nodeMajor >= 18 ? 'ok' : 'missing', version: process.version,
      ...(nodeMajor < 18 ? { reason: 'NODE_VERSION_UNSUPPORTED' } : {}) },
    git, codex, antigravity, terminal: terminalHealth(sessions),
  };
  return { ok: true, checkedAt: new Date().toISOString(),
    ready: ['node', 'git', 'codex', 'antigravity'].every(id => ['ok', 'warning'].includes(checks[id].status)), checks };
}
