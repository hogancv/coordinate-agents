import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { AgentAdapter } from './base.mjs';

function resolveGenericExecutable(command) {
  if (process.platform !== 'win32') return { command, prefix: [] };
  const located = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  if (located.status !== 0) return { command, prefix: [] };
  for (const path of located.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (/\.(exe|com)$/i.test(path)) return { command: path, prefix: [] };
    if (/\.js$/i.test(path)) return { command: process.execPath, prefix: [path] };
    if (/\.(cmd|bat)$/i.test(path)) {
      const jsSibling = path.replace(/\.(cmd|bat)$/i, '.js');
      const cjsSibling = path.replace(/\.(cmd|bat)$/i, '.cjs');
      if (existsSync(jsSibling)) return { command: process.execPath, prefix: [jsSibling] };
      if (existsSync(cjsSibling)) return { command: process.execPath, prefix: [cjsSibling] };
      return { command: path, prefix: [] };
    }
  }
  return { command, prefix: [] };
}

export class GenericCliAdapter extends AgentAdapter {
  detect() {
    const command = this.config.command;
    if (!command) return { available: false, details: 'No command configured' };
    const resolved = resolveGenericExecutable(command);
    const versionArgs = Array.isArray(this.config.versionArgs) && this.config.versionArgs.length > 0
      ? this.config.versionArgs
      : ['--version'];
    const result = spawnSync(resolved.command, [...resolved.prefix, ...versionArgs], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32' && resolved.prefix.length === 0,
    });
    if (result.error || result.status !== 0) {
      return { available: false, details: result.error?.message || `${command} not available` };
    }
    const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
    return { available: true, version };
  }

  resolveLaunch({ root, prompt, role, language }) {
    const command = this.config.command;
    if (!command) throw new Error('Cannot launch generic CLI without configured command');
    const resolved = resolveGenericExecutable(command);
    const templateArgs = Array.isArray(this.config.args) && this.config.args.length > 0
      ? this.config.args
      : ['{prompt}'];

    const resolvedArgs = templateArgs.map(arg => {
      if (typeof arg !== 'string') return String(arg);
      return arg
        .replaceAll('{prompt}', prompt)
        .replaceAll('{root}', resolve(root || process.cwd()))
        .replaceAll('{role}', role || '')
        .replaceAll('{lang}', language || '');
    });

    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args: resolvedArgs,
    };
  }

  capabilities() {
    return { launch: true, detect: true, dispatch: false };
  }
}
