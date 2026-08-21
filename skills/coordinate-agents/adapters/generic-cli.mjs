import { resolve } from 'node:path';
import { AgentAdapter } from './base.mjs';
import { checkExecutable, executableError, resolveExecutable } from './executable.mjs';

export class GenericCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'generic-cli', ...config });
    this.name = 'generic-cli';
  }

  detect({ version = true } = {}) {
    const command = this.config.command;
    if (!command) return { available: false, code: 'COMMAND_NOT_FOUND', command: '', details: 'No command configured' };
    const versionArgs = Array.isArray(this.config.versionArgs) && this.config.versionArgs.length > 0
      ? this.config.versionArgs
      : ['--version'];
    return checkExecutable(command, { versionArgs: version ? versionArgs : null });
  }

  resolveLaunch({ root, prompt, agent, language }) {
    const command = this.config.command;
    if (!command) throw new Error('Cannot launch generic CLI without configured command');
    const resolved = resolveExecutable(command);
    if (!resolved.available) throw executableError(resolved, 'Cannot launch generic CLI safely');
    const templateArgs = Array.isArray(this.config.args) && this.config.args.length > 0
      ? this.config.args
      : ['{prompt}'];

    for (const arg of templateArgs) {
      if (typeof arg === 'string' && arg.includes('{role}')) {
        throw new Error('Unsupported template placeholder: {role}. Use {agent}.');
      }
    }

    const agentId = agent || '';
    const resolvedArgs = templateArgs.map(arg => {
      if (typeof arg !== 'string') return String(arg);
      return arg
        .replaceAll('{prompt}', prompt)
        .replaceAll('{root}', resolve(root || process.cwd()))
        .replaceAll('{agent}', agentId)
        .replaceAll('{lang}', language || '');
    });

    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args: resolvedArgs,
    };
  }

  validateConfiguration({ setup = false } = {}) {
    if (!setup) return { compatible: true, code: null, details: null };
    const args = this.config.args;
    if (!Array.isArray(args) || !args.some(value => typeof value === 'string' && value.includes('{prompt}'))) {
      return {
        compatible: false,
        code: 'UNSUPPORTED_CAPABILITY',
        details: 'generic-cli requires an explicit args template containing {prompt}; inspect the CLI --help output before configuring it.',
      };
    }
    return { compatible: true, code: null, details: null };
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
