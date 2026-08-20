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
