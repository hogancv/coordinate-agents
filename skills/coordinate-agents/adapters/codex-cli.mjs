import { dirname, join, resolve } from 'node:path';
import { AgentAdapter } from './base.mjs';
import { ADAPTER_CONTRACT_VERSION, defineAdapter } from './contract-v1.mjs';
import { checkAdapterExecutable, executableError, resolveAdapterExecutable } from './executable.mjs';

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
    return checkAdapterExecutable(command, {
      versionArgs: version ? ['--version'] : null,
      windowsEntrypoint: codexWindowsEntrypoint,
      conformanceFixture: this.config.conformanceFixture,
    });
  }

  resolveLaunch({ root, prompt }) {
    const command = this.config.command || 'codex';
    const resolved = resolveAdapterExecutable(command, {
      windowsEntrypoint: codexWindowsEntrypoint,
      conformanceFixture: this.config.conformanceFixture,
    });
    if (!resolved.available) throw executableError(resolved, 'Cannot launch Codex safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const args = [...configuredArgs, '-C', resolve(root), prompt];
    return {
      command: resolved.command,
      prefix: resolved.prefix,
      args,
      resolvedCommand: resolved.resolvedCommand,
    };
  }

  resolveSessionLaunch({ root, initialPrompt = '', workspace = false }) {
    const command = this.config.command || 'codex';
    const resolved = resolveAdapterExecutable(command, {
      windowsEntrypoint: codexWindowsEntrypoint,
      conformanceFixture: this.config.conformanceFixture,
    });
    if (!resolved.available) throw executableError(resolved, 'Cannot open Codex session safely');
    const configuredArgs = Array.isArray(this.config.args) ? this.config.args : [];
    const promptInArguments = Boolean(initialPrompt && configuredArgs.some(arg => `${arg}`.includes('{prompt}')));
    const args = configuredArgs
      .filter(arg => initialPrompt || !`${arg}`.includes('{prompt}'))
      .map(arg => `${arg}`.replaceAll('{prompt}', initialPrompt));
    // The Web Workspace is an explicitly user-started local PTY. Codex's
    // hook-review screen otherwise blocks the first role prompt whenever the
    // repository has hooks that changed since the last interactive launch.
    // Disable hooks for this session instead of auto-approving them; standard
    // session_open keeps the user's normal hook policy unchanged.
    if (workspace) args.push('-c', 'features.hooks=false');
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

export const CODEX_CLI_ADAPTER_DESCRIPTOR = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: 'codex-cli',
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  create(config) {
    return new CodexCliAdapter(config);
  },
}, { allowReserved: true });

CodexCliAdapter.descriptor = CODEX_CLI_ADAPTER_DESCRIPTOR;
