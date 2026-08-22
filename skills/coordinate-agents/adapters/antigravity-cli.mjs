import { AgentAdapter } from './base.mjs';
import { checkExecutable, executableError, resolveExecutable } from './executable.mjs';

export class AntigravityCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'antigravity-cli', ...config });
    this.name = 'antigravity-cli';
  }

  detect({ version = true } = {}) {
    const command = this.config.command || 'agy';
    return checkExecutable(command, { versionArgs: version ? ['--version'] : null });
  }

  resolveLaunch({ prompt }) {
    const command = this.config.command || 'agy';
    const resolved = resolveExecutable(command);
    if (!resolved.available) throw executableError(resolved, 'Cannot launch Antigravity safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const args = [...configuredArgs, '--prompt-interactive', prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
    };
  }

  resolveSessionLaunch({ initialPrompt = '', agent, language }) {
    const command = this.config.command || 'agy';
    const resolved = resolveExecutable(command);
    if (!resolved.available) throw executableError(resolved, 'Cannot open Antigravity session safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const promptInArguments = Boolean(initialPrompt && configuredArgs.some(arg => `${arg}`.includes('{prompt}')));
    const args = configuredArgs
      .filter(arg => initialPrompt || !`${arg}`.includes('{prompt}'))
      .map(arg => `${arg}`
        .replaceAll('{prompt}', initialPrompt)
        .replaceAll('{agent}', agent || '')
        .replaceAll('{lang}', language || ''));
    if (!args.some(arg => arg === '--prompt-interactive')) args.push('--prompt-interactive');
    // Persistent sessions deliver the first instruction through the PTY unless
    // the configured argument template explicitly consumes {prompt}. The
    // legacy one-shot resolveLaunch contract below still passes the prompt as
    // an argument for compatibility wrappers.
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
      initialInputConsumed: promptInArguments,
      resolvedCommand: resolved.resolvedCommand,
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
