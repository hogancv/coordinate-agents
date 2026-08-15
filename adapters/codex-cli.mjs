import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AgentAdapter, NORMALIZED_STATUSES } from './base.mjs';

function resolveCodexExecutable(command = 'codex') {
  if (process.platform !== 'win32') return { command, prefix: [], safe: true };
  const located = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  if (located.status !== 0) return { command, prefix: [], safe: false };
  for (const path of located.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (/\.(exe|com)$/i.test(path)) return { command: path, prefix: [], safe: true };
    if (/\.js$/i.test(path)) return { command: process.execPath, prefix: [path], safe: true };
    if (/\.(cmd|bat)$/i.test(path)) {
      const entrypoint = join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(entrypoint)) return { command: process.execPath, prefix: [entrypoint], safe: true };
      const jsSibling = path.replace(/\.(cmd|bat)$/i, '.js');
      const cjsSibling = path.replace(/\.(cmd|bat)$/i, '.cjs');
      if (existsSync(jsSibling)) return { command: process.execPath, prefix: [jsSibling], safe: true };
      if (existsSync(cjsSibling)) return { command: process.execPath, prefix: [cjsSibling], safe: true };
      return { command: path, prefix: [], safe: false };
    }
  }
  return { command, prefix: [], safe: false };
}

export class CodexCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'codex-cli', ...config });
    this.name = 'codex-cli';
  }

  detect() {
    const command = this.config.command || 'codex';
    const resolved = resolveCodexExecutable(command);
    if (process.platform === 'win32' && !resolved.safe) {
      return { available: false, details: `Codex command '${command}' resolved to a Windows batch script without a safe JS entrypoint` };
    }
    const result = spawnSync(resolved.command, [...resolved.prefix, '--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      return { available: false, details: result.error?.message || 'Codex CLI not available' };
    }
    const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
    return { available: true, version };
  }

  resolveLaunch({ root, prompt }) {
    const command = this.config.command || 'codex';
    const resolved = resolveCodexExecutable(command);
    if (process.platform === 'win32' && !resolved.safe) {
      throw new Error(`Cannot launch Codex safely: '${command}' resolved to a Windows batch script without a safe JS entrypoint.`);
    }
    const args = ['-C', resolve(root), prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
    };
  }

  capabilities() {
    return {
      ...super.capabilities(),
      name: 'codex-cli',
      launch: true,
      detect: true,
    };
  }
}
