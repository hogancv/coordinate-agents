import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { AgentAdapter, NORMALIZED_STATUSES } from './base.mjs';

function resolveGenericExecutable(command) {
  if (process.platform !== 'win32') return { command, prefix: [], safe: true };
  const located = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
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

export class GenericCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'generic-cli', ...config });
    this.name = 'generic-cli';
  }

  detect() {
    const command = this.config.command;
    if (!command) return { available: false, details: 'No command configured' };
    const resolved = resolveGenericExecutable(command);
    if (process.platform === 'win32' && !resolved.safe) {
      return { available: false, details: `Command '${command}' resolved to a Windows batch script without a safe JS entrypoint` };
    }
    const versionArgs = Array.isArray(this.config.versionArgs) && this.config.versionArgs.length > 0
      ? this.config.versionArgs
      : ['--version'];
    const result = spawnSync(resolved.command, [...resolved.prefix, ...versionArgs], {
      encoding: 'utf8',
      windowsHide: true,
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
    if (process.platform === 'win32' && !resolved.safe) {
      throw new Error(`Cannot launch generic CLI safely: '${command}' resolved to a Windows batch script without a safe JS entrypoint.`);
    }
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
    return {
      ...super.capabilities(),
      name: 'generic-cli',
      launch: true,
      detect: true,
    };
  }
}
