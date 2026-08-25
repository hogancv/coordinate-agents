import { AgentAdapter } from './base.mjs';
import { ADAPTER_CONTRACT_VERSION, defineAdapter } from './contract-v1.mjs';
import { checkAdapterExecutable, executableError, resolveAdapterExecutable } from './executable.mjs';

export class AntigravityCliAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ adapter: 'antigravity-cli', ...config });
    this.name = 'antigravity-cli';
  }

  detect({ version = true } = {}) {
    const command = this.config.command || 'agy';
    return checkAdapterExecutable(command, {
      versionArgs: version ? ['--version'] : null,
      conformanceFixture: this.config.conformanceFixture,
    });
  }

  resolveLaunch({ prompt }) {
    const command = this.config.command || 'agy';
    const resolved = resolveAdapterExecutable(command, { conformanceFixture: this.config.conformanceFixture });
    if (!resolved.available) throw executableError(resolved, 'Cannot launch Antigravity safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const args = [...configuredArgs, '--prompt-interactive', prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
      resolvedCommand: resolved.resolvedCommand,
    };
  }

  resolveSessionLaunch({ initialPrompt = '', agent, language }) {
    const command = this.config.command || 'agy';
    const resolved = resolveAdapterExecutable(command, { conformanceFixture: this.config.conformanceFixture });
    if (!resolved.available) throw executableError(resolved, 'Cannot open Antigravity session safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const promptInArguments = Boolean(initialPrompt && configuredArgs.some(arg => `${arg}`.includes('{prompt}')));
    const args = configuredArgs
      .filter(arg => initialPrompt || !`${arg}`.includes('{prompt}'))
      .map(arg => `${arg}`
        .replaceAll('{prompt}', initialPrompt)
        .replaceAll('{agent}', agent || '')
        .replaceAll('{lang}', language || ''));
    const promptFlagIndex = args.findIndex(arg => arg === '--prompt-interactive' || arg === '-i');
    if (promptFlagIndex === -1) {
      // Current agy/agy-proxy builds parse --prompt-interactive as an option
      // that requires a value. An empty value starts the interactive session
      // without consuming the first instruction; the PTY receives that
      // instruction immediately after startup.
      args.push('--prompt-interactive', '');
    } else if (args[promptFlagIndex + 1] === undefined || `${args[promptFlagIndex + 1]}`.startsWith('-')) {
      args.splice(promptFlagIndex + 1, 0, '');
    }
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

export const ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: 'antigravity-cli',
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  create(config) {
    return new AntigravityCliAdapter(config);
  },
}, { allowReserved: true });

AntigravityCliAdapter.descriptor = ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR;
