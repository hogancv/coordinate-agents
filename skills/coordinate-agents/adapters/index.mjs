import { AgentAdapter } from './base.mjs';
import { ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR, AntigravityCliAdapter } from './antigravity-cli.mjs';
import { CODEX_CLI_ADAPTER_DESCRIPTOR, CodexCliAdapter } from './codex-cli.mjs';
import { GENERIC_CLI_ADAPTER_DESCRIPTOR, GenericCliAdapter } from './generic-cli.mjs';
import {
  AdapterContractError,
  createAdapter,
  getAdapterContract,
  validateAdapterDescriptor,
  validateAdapterIdentity,
} from './contract-v1.mjs';
import { EXECUTABLE_CODES, checkExecutable, executableError, resolveExecutable } from './executable.mjs';

const builtinEntries = [
  ['codex-cli', CODEX_CLI_ADAPTER_DESCRIPTOR],
  ['antigravity-cli', ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR],
  ['generic-cli', GENERIC_CLI_ADAPTER_DESCRIPTOR],
];

const adapterRegistry = new Map(builtinEntries.map(([name, descriptor]) => [name, {
  builtin: true,
  descriptor,
}]));

export const BUILTIN_ADAPTER_DESCRIPTORS = Object.freeze(Object.fromEntries(builtinEntries));

function descriptorFor(adapter) {
  if (adapter && typeof adapter === 'object' && typeof adapter.create === 'function') return adapter;
  if (typeof adapter === 'function' && adapter.descriptor) return adapter.descriptor;
  return null;
}

function registrationError(path, message, details = {}) {
  return new AdapterContractError('INVALID_ADAPTER_CONFIG', `${path}: ${message}`, { path, ...details });
}

function validateRegistrationName(name) {
  try {
    validateAdapterIdentity(name, { allowReserved: false });
  } catch (error) {
    throw error;
  }
  if (adapterRegistry.has(name)) {
    throw registrationError('id', `duplicates the registered adapter "${name}".`, { adapterId: name });
  }
}

export function registerAdapter(name, adapter) {
  validateRegistrationName(name);
  const descriptor = descriptorFor(adapter);
  if (descriptor) {
    const validated = validateAdapterDescriptor(descriptor, { registeredIds: adapterRegistry.keys() });
    if (validated.id !== name) {
      throw registrationError('id', `must match descriptor.id "${validated.id}".`, { adapterId: name });
    }
    adapterRegistry.set(name, { descriptor: validated, builtin: false });
    return validated;
  }
  if (typeof adapter !== 'function') {
    throw registrationError('factory', 'must be an adapter class or Contract v1 descriptor.');
  }
  adapterRegistry.set(name, { AdapterClass: adapter, builtin: false });
  return adapter;
}

export function getAdapterDescriptor(adapterName) {
  return adapterRegistry.get(adapterName)?.descriptor || null;
}

export function getAdapter(adapterName, config = {}) {
  const entry = adapterRegistry.get(adapterName);
  if (!entry) {
    throw new Error(`Unknown adapter: ${adapterName}. Registered adapters: ${[...adapterRegistry.keys()].join(', ')}`);
  }
  if (entry.descriptor) {
    return createAdapter(entry.descriptor, config, { allowReserved: entry.builtin });
  }
  return new entry.AdapterClass(config);
}

export function listAdapters() {
  return [...adapterRegistry.keys()];
}

export {
  AgentAdapter,
  CodexCliAdapter,
  AntigravityCliAdapter,
  GenericCliAdapter,
  ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR,
  CODEX_CLI_ADAPTER_DESCRIPTOR,
  GENERIC_CLI_ADAPTER_DESCRIPTOR,
  AdapterContractError,
  getAdapterContract,
  EXECUTABLE_CODES,
  checkExecutable,
  executableError,
  resolveExecutable,
};
