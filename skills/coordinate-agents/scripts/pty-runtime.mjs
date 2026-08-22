import { chmodSync, existsSync } from 'node:fs';
import { spawn as spawnChild } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// The Plugin payload is intentionally runnable directly from a Git checkout,
// where npm dependencies may not have been installed. Use node-pty whenever it
// is present; keep the same owned-session contract over pipes as a degraded
// compatibility backend for setup/diagnostic flows in such payloads.
let nodePty = null;
try { nodePty = await import('node-pty'); } catch { nodePty = null; }

const require = createRequire(import.meta.url);

function ensureUnixSpawnHelper() {
  if (process.platform === 'win32' || !nodePty) return;
  try {
    const packageRoot = dirname(dirname(require.resolve('node-pty')));
    const candidates = [
      join(packageRoot, 'build', 'Release', 'spawn-helper'),
      join(packageRoot, 'prebuilds', [process.platform, process.arch].join('-'), 'spawn-helper'),
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try { chmodSync(candidate, 0o755); } catch { /* A read-only install will report its PTY error below. */ }
    }
  } catch { /* Loading node-pty itself remains the source of truth. */ }
}

export const PTY_SESSION_STATES = Object.freeze([
  'starting',
  'running',
  'idle',
  'busy',
  'exited',
  'failed',
]);

const ACTIVE_STATES = new Set(['starting', 'running', 'idle', 'busy']);

function timestamp() {
  return new Date().toISOString();
}

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

class OutputBuffer {
  constructor(maxBytes) {
    this.maxBytes = boundedInteger(maxBytes, 64 * 1024, { min: 1024, max: 4 * 1024 * 1024 });
    this.chunks = [];
    this.bytes = 0;
    this.cursor = 0;
  }

  append(value) {
    const text = `${value || ''}`;
    if (!text) return this.cursor;
    this.cursor += 1;
    let chunk = text;
    let chunkBytes = Buffer.byteLength(chunk, 'utf8');
    if (chunkBytes > this.maxBytes) {
      chunk = Buffer.from(chunk, 'utf8').subarray(-this.maxBytes).toString('utf8');
      chunkBytes = Buffer.byteLength(chunk, 'utf8');
    }
    this.chunks.push({ cursor: this.cursor, text: chunk, bytes: chunkBytes });
    this.bytes += chunkBytes;
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      this.bytes -= removed.bytes;
    }
    return this.cursor;
  }

  read({ cursor = null, maxLines = null, maxBytes = this.maxBytes } = {}) {
    const limit = boundedInteger(maxBytes, this.maxBytes, { min: 1, max: this.maxBytes });
    const firstCursor = this.chunks[0]?.cursor ?? this.cursor + 1;
    const truncated = Number.isInteger(cursor) && cursor < firstCursor - 1;
    const selected = Number.isInteger(cursor)
      ? this.chunks.filter(chunk => chunk.cursor > cursor)
      : this.chunks;
    let output = selected.map(chunk => chunk.text).join('');
    if (Buffer.byteLength(output, 'utf8') > limit) {
      output = Buffer.from(output, 'utf8').subarray(-limit).toString('utf8');
    }
    if (Number.isInteger(maxLines) && maxLines > 0) {
      const lines = output.split(/(?<=\n)/);
      if (lines.length > maxLines) output = lines.slice(-maxLines).join('');
    }
    return {
      output,
      cursor: Number.isInteger(cursor) ? cursor : null,
      nextCursor: this.cursor,
      truncated,
      bufferedBytes: this.bytes,
    };
  }
}

/**
 * Small node-pty wrapper used by the session host.  It owns only the PTY it
 * created and never resolves or kills arbitrary PIDs supplied by callers.
 */
export class PtyRuntime {
  constructor({
    id,
    command,
    args = [],
    cwd,
    env = process.env,
    cols = 120,
    rows = 30,
    maxOutputBytes = 64 * 1024,
    idleAfterMs = 350,
    onOutput = null,
    onStateChange = null,
  } = {}) {
    if (!id) throw new Error('PTY runtime requires a session id.');
    if (!command) throw new Error('PTY runtime requires an executable command.');
    if (!cwd) throw new Error('PTY runtime requires a working directory.');
    this.id = id;
    this.command = command;
    this.args = [...args].map(value => `${value}`);
    this.cwd = cwd;
    this.env = { ...env };
    this.cols = boundedInteger(cols, 120, { min: 1, max: 1000 });
    this.rows = boundedInteger(rows, 30, { min: 1, max: 1000 });
    this.idleAfterMs = boundedInteger(idleAfterMs, 350, { min: 50, max: 10_000 });
    this.output = new OutputBuffer(maxOutputBytes);
    this.pty = null;
    this.child = null;
    this.backend = nodePty?.spawn ? 'node-pty' : 'stdio-fallback';
    this.pid = null;
    this.state = 'starting';
    this.createdAt = timestamp();
    this.lastActivityAt = this.createdAt;
    this.exitCode = null;
    this.signal = null;
    this.error = null;
    this.idleTimer = null;
    this.exitPromise = null;
    this.onOutput = onOutput;
    this.onStateChange = onStateChange;
  }

  isActive() {
    return ACTIVE_STATES.has(this.state);
  }

  snapshot() {
    return {
      id: this.id,
      backend: this.backend,
      pid: this.pid,
      state: this.state,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      exitCode: this.exitCode,
      signal: this.signal,
      error: this.error,
      cols: this.cols,
      rows: this.rows,
      outputCursor: this.output.cursor,
      bufferedBytes: this.output.bytes,
    };
  }

  _setState(state, error = null) {
    if (!PTY_SESSION_STATES.includes(state)) throw new Error(`Invalid PTY state: ${state}`);
    this.state = state;
    this.error = error ? `${error.message || error}`.slice(0, 2 * 1024) : this.error;
    this.lastActivityAt = timestamp();
    try { this.onStateChange?.(this.snapshot()); } catch { /* Metadata observers are best effort. */ }
  }

  _scheduleIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (['running', 'busy'].includes(this.state) && this.isActive()) this._setState('idle');
    }, this.idleAfterMs);
  }

  _appendOutput(data) {
    this.output.append(data);
    this.lastActivityAt = timestamp();
    if (this.state === 'starting') this._setState('running');
    this._scheduleIdle();
    try { this.onOutput?.(data, this.snapshot()); } catch { /* Output observers cannot break the session. */ }
  }

  open() {
    if (this.pty || this.child) return this.snapshot();
    try {
      ensureUnixSpawnHelper();
      this._setState('starting');
      const env = {
        ...this.env,
        TERM: this.env.TERM || 'xterm-256color',
      };
      if (nodePty?.spawn) {
        this.pty = nodePty.spawn(this.command, this.args, {
          name: 'xterm-256color',
          cols: this.cols,
          rows: this.rows,
          cwd: this.cwd,
          env,
          useConpty: true,
        });
      } else {
        this.child = spawnChild(this.command, this.args, {
          cwd: this.cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: false,
        });
      }
      const processHandle = this.pty || this.child;
      this.pid = processHandle.pid || null;
      this.exitPromise = new Promise(resolve => {
        let settled = false;
        const finish = (exitCode, signal, error = null) => {
          if (settled) return;
          settled = true;
          this.exitCode = Number.isInteger(exitCode) ? exitCode : null;
          this.signal = signal || null;
          this.error = error ? `${error.message || error}`.slice(0, 2 * 1024) : this.error;
          this.pid = null;
          const failed = Boolean(error) || (this.exitCode !== null && this.exitCode !== 0);
          this._setState(failed ? 'failed' : 'exited', error);
          resolve(this.snapshot());
        };
        if (this.pty) this.pty.onExit(event => finish(event?.exitCode, event?.signal));
        else {
          this.child.once('error', error => finish(null, null, error));
          this.child.once('exit', (code, signal) => finish(code, signal));
        }
      });
      // Attach lifecycle and output listeners immediately after spawn. A
      // short-lived CLI can exit or emit its readiness line before the rest
      // of the session setup is complete; both facts must remain observable.
      if (this.pty) this.pty.onData(data => this._appendOutput(data));
      else {
        this.child.stdout?.on('data', data => this._appendOutput(`${data}`));
        this.child.stderr?.on('data', data => this._appendOutput(`${data}`));
      }
      if (this.isActive()) this._setState('running');
      return this.snapshot();
    } catch (error) {
      this.pty = null;
      this.child = null;
      this.pid = null;
      this._setState('failed', error);
      throw error;
    }
  }

  write(input, { submit = true } = {}) {
    if ((!this.pty && !this.child) || !this.isActive()) throw new Error(`PTY session ${this.id} is not writable in state ${this.state}.`);
    const value = `${input ?? ''}`;
    if (!value) return this.snapshot();
    const suffix = submit && !/[\r\n]$/.test(value) ? (this.pty ? '\r' : '\n') : '';
    if (this.pty) this.pty.write(`${value}${suffix}`);
    else this.child.stdin.write(`${value}${suffix}`);
    this.lastActivityAt = timestamp();
    this._setState('busy');
    this._scheduleIdle();
    return this.snapshot();
  }

  read(options = {}) {
    return {
      ...this.output.read(options),
      state: this.state,
      lastActivityAt: this.lastActivityAt,
    };
  }

  status() {
    return this.snapshot();
  }

  resize(cols, rows) {
    if ((!this.pty && !this.child) || !this.isActive()) throw new Error(`PTY session ${this.id} is not resizable in state ${this.state}.`);
    this.cols = boundedInteger(cols, this.cols, { min: 1, max: 1000 });
    this.rows = boundedInteger(rows, this.rows, { min: 1, max: 1000 });
    if (this.pty) this.pty.resize(this.cols, this.rows);
    this.lastActivityAt = timestamp();
    return this.snapshot();
  }

  interrupt() {
    if ((!this.pty && !this.child) || !this.isActive()) return this.snapshot();
    if (this.pty) this.pty.write('\u0003');
    else {
      try { this.child.kill('SIGINT'); } catch { /* The owned child may already be gone. */ }
    }
    this.lastActivityAt = timestamp();
    return this.snapshot();
  }

  async close({ graceful = true, timeoutMs = 2_000 } = {}) {
    if (!this.pty && !this.child) return this.snapshot();
    if (!this.isActive()) return this.snapshot();
    if (graceful) {
      try {
        if (this.pty) this.pty.write('\u0003');
        else this.child.kill('SIGINT');
      } catch { /* The owned process may already be exiting. */ }
    }
    const waitMs = boundedInteger(timeoutMs, 2_000, { min: 100, max: 30_000 });
    let timer;
    await Promise.race([
      this.exitPromise,
      new Promise(resolve => { timer = setTimeout(resolve, waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
    if (this.isActive()) {
      try {
        if (this.pty) this.pty.kill();
        else this.child.kill();
      } catch { /* The owned process may already be gone. */ }
      await Promise.race([
        this.exitPromise,
        new Promise(resolve => setTimeout(resolve, Math.min(2_000, waitMs))),
      ]);
    }
    return this.snapshot();
  }
}

export { ACTIVE_STATES };
