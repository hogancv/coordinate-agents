import { spawnSync } from 'node:child_process';

import {
  ADAPTER_CONTRACT_VERSION,
  defineAdapter,
} from '@hogancv/coordinate-agents/adapter-sdk.mjs';

export const MINIMAL_EXTERNAL_ADAPTER_ID = 'minimal-external-adapter';
export const MINIMAL_EXTERNAL_ADAPTER_VERSION = '1.0.0';

function launchParts(config = {}) {
  const fixture = config.conformanceFixture || null;
  const configuredArgs = Array.isArray(config.args) ? config.args.map(value => `${value}`) : [];
  const command = fixture?.command || config.command || process.execPath;
  const prefix = fixture
    ? [...fixture.prefix]
    : configuredArgs.length > 0 ? [configuredArgs[0]] : [];
  const args = fixture ? configuredArgs : configuredArgs.slice(1);
  return {
    command,
    prefix,
    args,
    cwd: fixture?.root || null,
  };
}

function unavailable(parts, code, details) {
  return {
    available: false,
    command: parts.command || '',
    runtimeCommand: parts.command || '',
    resolvedCommand: parts.command || null,
    prefix: [...parts.prefix],
    code,
    details,
  };
}

function detectExecutable(config, { version = true } = {}) {
  const parts = launchParts(config);
  if (!parts.command || parts.prefix.length === 0) {
    return unavailable(
      parts,
      'INVALID_ADAPTER_CONFIG',
      'minimal-external-adapter requires command and args[0] to identify a local executable script.',
    );
  }

  const versionArgs = version ? [...parts.args, '--version'] : [...parts.args];
  const result = spawnSync(parts.command, [...parts.prefix, ...versionArgs], {
    cwd: parts.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    timeout: 2_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return unavailable(
      parts,
      'EXECUTABLE_NOT_FOUND',
      `The configured executable-backed fixture is unavailable: ${result.error?.message || `exit ${result.status}`}`,
    );
  }

  const versionLine = String(result.stdout || '').split(/\r?\n/, 1)[0].trim();
  const reportedVersion = versionLine.startsWith('COORDINATE_ADAPTER_CONFORMANCE:')
    ? `conformance-fixture/${MINIMAL_EXTERNAL_ADAPTER_VERSION}`
    : (versionLine || `minimal-external-adapter/${MINIMAL_EXTERNAL_ADAPTER_VERSION}`).slice(0, 128);
  return {
    available: true,
    command: parts.command,
    runtimeCommand: parts.command,
    resolvedCommand: parts.command,
    prefix: [...parts.prefix],
    version: version ? reportedVersion : null,
  };
}

function createMinimalExternalAdapter(config = {}) {
  const parts = launchParts(config);
  return {
    detect(options = {}) {
      return detectExecutable(config, options);
    },

    validateConfiguration() {
      if (!parts.command || parts.prefix.length === 0) {
        return {
          compatible: false,
          code: 'INVALID_ADAPTER_CONFIG',
          details: 'Provide the exact Node.js command and the local executable script as args[0].',
        };
      }
      return { compatible: true, code: null, details: null };
    },

    resolveLaunch({ root, prompt }) {
      return {
        command: parts.command,
        prefix: [...parts.prefix],
        args: [...parts.args, '--mode', 'one-shot', `${prompt || ''}`],
        cwd: root,
        resolvedCommand: parts.command,
      };
    },

    resolveSessionLaunch({ root }) {
      return {
        command: parts.command,
        prefix: [...parts.prefix],
        args: [...parts.args, '--mode', 'persistent'],
        cwd: root,
        initialInputConsumed: false,
        resolvedCommand: parts.command,
      };
    },

    launchPolicy() {
      return { mode: 'bus-supervised', pollIntervalMs: 50 };
    },
  };
}

const descriptor = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: MINIMAL_EXTERNAL_ADAPTER_ID,
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  create(config) {
    return createMinimalExternalAdapter(config);
  },
});

export default descriptor;
