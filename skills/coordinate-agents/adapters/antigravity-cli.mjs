import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AgentAdapter, NORMALIZED_STATUSES } from './base.mjs';

function runFile(command, args) {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, { encoding: 'utf8', windowsHide: true }),
      stderr: '',
    };
  } catch (error) {
    return {
      status: Number.isInteger(error.status) ? error.status : 1,
      stdout: `${error.stdout || ''}`,
      stderr: `${error.stderr || ''}`,
      error,
    };
  }
}

function resolveAgyExecutable(command = 'agy') {
  if (process.platform !== 'win32') return { command, prefix: [], safe: true };
  const located = runFile('where.exe', [command]);
  if (located.status !== 0) return { command, prefix: [], safe: false };
  for (const path of located.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (/\.(exe|com)$/i.test(path)) return { command: path, prefix: [], safe: true };
    if (/\.js$/i.test(path)) return { command: process.execPath, prefix: [path], safe: true };
    if (/\.(cmd|bat)$/i.test(path)) {
      const jsSibling = path.replace(/\.(cmd|bat)$/i, '.js');
      const cjsSibling = path.replace(/\.(cmd|bat)$/i, '.cjs');
      if (existsSync(jsSibling)) return { command: process.execPath, prefix: [jsSibling], safe: true };
      if (existsSync(cjsSibling)) return { command: process.execPath, prefix: [cjsSibling], safe: true };
      return { command: path, prefix: [], safe: false };
    }
  }
  return { command, prefix: [], safe: false };
}

export class AntigravityCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'antigravity-cli', ...config });
    this.name = 'antigravity-cli';
  }

  detect() {
    const command = this.config.command || 'agy';
    const resolved = resolveAgyExecutable(command);
    if (process.platform === 'win32' && !resolved.safe) {
      return { available: false, details: `Antigravity command '${command}' resolved to a Windows batch script without a safe JS entrypoint` };
    }
    const result = runFile(resolved.command, [...resolved.prefix, '--version']);
    if (result.error || result.status !== 0) {
      return { available: false, details: result.error?.message || 'Antigravity CLI not available' };
    }
    const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
    return { available: true, version };
  }

  resolveLaunch({ prompt }) {
    const command = this.config.command || 'agy';
    const resolved = resolveAgyExecutable(command);
    if (process.platform === 'win32' && !resolved.safe) {
      throw new Error(`Cannot launch Antigravity safely: '${command}' resolved to a Windows batch script without a safe JS entrypoint.`);
    }
    const args = ['--prompt-interactive', prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
    };
  }

  launchPolicy() {
    return { mode: 'bus-supervised', pollIntervalMs: 500 };
  }

  capabilities() {
    return {
      ...super.capabilities(),
      name: 'antigravity-cli',
      launch: true,
      detect: true,
    };
  }
}
