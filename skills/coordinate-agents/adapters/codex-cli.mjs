import { dirname, join, resolve } from 'node:path';
import { AgentAdapter } from './base.mjs';
import { checkExecutable, executableError, resolveExecutable } from './executable.mjs';

function codexWindowsEntrypoint(path) {
  return join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
}

export class CodexCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'codex-cli', ...config });
    this.name = 'codex-cli';
  }

  detect({ version = true } = {}) {
    const command = this.config.command || 'codex';
    return checkExecutable(command, {
      versionArgs: version ? ['--version'] : null,
      windowsEntrypoint: codexWindowsEntrypoint,
    });
  }

  resolveLaunch({ root, prompt }) {
    const command = this.config.command || 'codex';
    const resolved = resolveExecutable(command, { windowsEntrypoint: codexWindowsEntrypoint });
    if (!resolved.available) throw executableError(resolved, 'Cannot launch Codex safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const args = [...configuredArgs, '-C', resolve(root), prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
    };
  }

  resolveSessionLaunch({ root, initialPrompt = '' }) {
    const command = this.config.command || 'codex';
    const resolved = resolveExecutable(command, { windowsEntrypoint: codexWindowsEntrypoint });
    if (!resolved.available) throw executableError(resolved, 'Cannot open Codex session safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const promptInArguments = Boolean(initialPrompt && configuredArgs.some(arg => `${arg}`.includes('{prompt}')));
    const args = configuredArgs
      .filter(arg => initialPrompt || !`${arg}`.includes('{prompt}'))
      .map(arg => `${arg}`.replaceAll('{prompt}', initialPrompt));
    args.push('-C', resolve(root));
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
      initialInputConsumed: promptInArguments,
      resolvedCommand: resolved.resolvedCommand,
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
