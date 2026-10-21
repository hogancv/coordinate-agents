import { AgentAdapter } from './base.mjs';
import { defaultArgsForAdapter } from '../scripts/user-config.mjs';
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
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : defaultArgsForAdapter(this.name);
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
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : defaultArgsForAdapter(this.name);
    const promptInArguments = Boolean(initialPrompt && configuredArgs.some(arg => `${arg}`.includes('{prompt}')));
    const args = configuredArgs
      .filter(arg => initialPrompt || !`${arg}`.includes('{prompt}'))
      .map(arg => `${arg}`
        .replaceAll('{prompt}', initialPrompt)
        .replaceAll('{agent}', agent || '')
        .replaceAll('{lang}', language || ''));
    const promptFlagIndex = args.findIndex(arg => /^(--prompt-interactive|-i)(=|$)/.test(arg));
    if (promptFlagIndex === -1) {
      // Encode the required empty value in the flag itself: Windows PowerShell
      // proxy scripts drop standalone empty native arguments. The real first
      // instruction is still delivered through the PTY after startup.
      args.push('--prompt-interactive=');
    } else if (!args[promptFlagIndex].includes('=')) {
      const value = args[promptFlagIndex + 1];
      if (value === undefined || value === '' || value.startsWith('-')) {
        args.splice(promptFlagIndex, value === '' ? 2 : 1, `${args[promptFlagIndex]}=`);
      }
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
