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

  resolveSessionLaunch({ root, initialPrompt = '', agent, language }) {
    const command = this.config.command;
    if (!command) throw new Error('Cannot open generic CLI session without configured command');
    const resolved = resolveExecutable(command);
    if (!resolved.available) throw executableError(resolved, 'Cannot open generic CLI session safely');
    const templateArgs = Array.isArray(this.config.args) && this.config.args.length > 0
      ? this.config.args
      : [];
    for (const arg of templateArgs) {
      if (typeof arg === 'string' && arg.includes('{role}')) {
        throw new Error('Unsupported template placeholder: {role}. Use {agent}.');
      }
    }
    const resolvedArgs = templateArgs.flatMap(arg => {
      if (typeof arg !== 'string') return [String(arg)];
      if (arg.includes('{prompt}') && !initialPrompt) return [];
      return [arg
        .replaceAll('{prompt}', initialPrompt)
        .replaceAll('{root}', resolve(root || process.cwd()))
        .replaceAll('{agent}', agent || '')
        .replaceAll('{lang}', language || '')];
    });
    const promptInArguments = Boolean(initialPrompt && templateArgs.some(arg => `${arg}`.includes('{prompt}')));
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args: resolvedArgs,
      initialInputConsumed: promptInArguments,
      resolvedCommand: resolved.resolvedCommand,
    };
  }

  validateConfiguration({ setup = false } = {}) {
    if (!setup) return { compatible: true, code: null, details: null };
    const args = this.config.args;
    if (!Array.isArray(args) || args.length === 0) {
      return {
        compatible: false,
        code: 'UNSUPPORTED_CAPABILITY',
        details: 'generic-cli requires a non-empty args template; include {prompt} for one-shot mode or interactive flags for a persistent PTY session.',
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
