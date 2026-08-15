import { spawnSync } from 'node:child_process';
import { AgentAdapter } from './base.mjs';

function resolveAgyExecutable(command = 'agy') {
  if (process.platform !== 'win32') return { command, prefix: [] };
  const located = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  if (located.status !== 0) return { command, prefix: [] };
  for (const path of located.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (/\.(exe|com|cmd|bat)$/i.test(path)) return { command: path, prefix: [] };
  }
  return { command, prefix: [] };
}

export class AntigravityCliAdapter extends AgentAdapter {
  detect() {
    const command = this.config.command || 'agy';
    const resolved = resolveAgyExecutable(command);
    const result = spawnSync(resolved.command, [...resolved.prefix, '--version'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32' && resolved.prefix.length === 0,
    });
    if (result.error || result.status !== 0) {
      return { available: false, details: result.error?.message || 'Antigravity CLI not available' };
    }
    const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
    return { available: true, version };
  }

  resolveLaunch({ prompt }) {
    const command = this.config.command || 'agy';
    const resolved = resolveAgyExecutable(command);
    const args = ['--prompt-interactive', prompt];
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
