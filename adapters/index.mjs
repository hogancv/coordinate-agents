import { AgentAdapter } from './base.mjs';
import { CodexCliAdapter } from './codex-cli.mjs';
import { AntigravityCliAdapter } from './antigravity-cli.mjs';
import { GenericCliAdapter } from './generic-cli.mjs';

const adapterRegistry = new Map([
  ['codex-cli', CodexCliAdapter],
  ['antigravity-cli', AntigravityCliAdapter],
  ['generic-cli', GenericCliAdapter],
]);

export function registerAdapter(name, adapterClass) {
  adapterRegistry.set(name, adapterClass);
}

export function getAdapter(adapterName, config = {}) {
  const AdapterClass = adapterRegistry.get(adapterName);
  if (!AdapterClass) {
    throw new Error(`Unknown adapter: ${adapterName}. Registered adapters: ${[...adapterRegistry.keys()].join(', ')}`);
  }
  return new AdapterClass(config);
}

export function listAdapters() {
  return [...adapterRegistry.keys()];
}

export {
  AgentAdapter,
  CodexCliAdapter,
  AntigravityCliAdapter,
  GenericCliAdapter,
};
