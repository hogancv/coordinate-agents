import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AgentAdapter } from './base.mjs';

function resolveCodexExecutable(command = 'codex') {
  if (process.platform !== 'win32') return { command, prefix: [] };
  const located = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  if (located.status !== 0) return { command, prefix: [] };
  for (const path of located.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (/\.(exe|com)$/i.test(path)) return { command: path, prefix: [] };
    if (/\.cmd$/i.test(path)) {
      const entrypoint = join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(entrypoint)) return { command: process.execPath, prefix: [entrypoint] };
    }
  }
  return { command, prefix: [] };
}

export class CodexCliAdapter extends AgentAdapter {
  detect() {
    const command = this.config.command || 'codex';
    const resolved = resolveCodexExecutable(command);
    const result = spawnSync(resolved.command, [...resolved.prefix, '--version'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32' && resolved.prefix.length === 0,
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
    const args = ['-C', resolve(root), prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
    };
  }

  capabilities() {
    return { launch: true, detect: true, dispatch: false };
  }
}
