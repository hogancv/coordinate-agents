import { resolve } from 'node:path';

export const ADAPTER_CONTRACT_VERSION = 1;

export const ADAPTER_CONTRACT_ERROR_CODES = Object.freeze({
  INVALID_ADAPTER_CONFIG: 'INVALID_ADAPTER_CONFIG',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
});

export const ADAPTER_CAPABILITY_KEYS = Object.freeze([
  'detection',
  'configuration',
  'oneShotLaunch',
  'persistentSession',
]);

export const ADAPTER_CAPABILITIES = Object.freeze({
  DETECTION: 'detection',
  CONFIGURATION: 'configuration',
  ONE_SHOT_LAUNCH: 'oneShotLaunch',
  PERSISTENT_SESSION: 'persistentSession',
});

export const RESERVED_ADAPTER_IDS = Object.freeze([
  'codex-cli',
  'antigravity-cli',
  'generic-cli',
]);

const RESERVED_ID_SET = new Set(RESERVED_ADAPTER_IDS);
const CAPABILITY_KEY_SET = new Set(ADAPTER_CAPABILITY_KEYS);
const DESCRIPTOR_KEY_SET = new Set(['contractVersion', 'id', 'capabilities', 'create']);
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LAUNCH_POLICY_MODES = new Set(['one-shot', 'bus-supervised']);
const INSTANCE_CONTRACTS = new WeakMap();

export class AdapterContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdapterContractError';
    this.code = code;
    this.recoverable = false;
    this.details = Object.freeze({ ...details });
  }
}

function contractError(code, path, message, details = {}) {
  throw new AdapterContractError(code, `${path}: ${message}`, { path, ...details });
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    contractError('INVALID_ADAPTER_CONFIG', path, 'must be an object.');
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    contractError('INVALID_ADAPTER_CONFIG', path, 'must be a non-empty string.');
  }
}

function assertOptionalString(value, path) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    contractError('INVALID_ADAPTER_CONFIG', path, 'must be a string, null, or undefined.');
  }
}

function assertStringArray(value, path, { required = true } = {}) {
  if (!required && value === undefined) return;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    contractError('INVALID_ADAPTER_CONFIG', path, 'must be an array of strings.');
  }
}

function registeredIdSet(registeredIds) {
  if (registeredIds === undefined || registeredIds === null) return new Set();
  if (typeof registeredIds === 'string' || typeof registeredIds[Symbol.iterator] !== 'function') {
    contractError('INVALID_ADAPTER_CONFIG', 'registeredIds', 'must be an iterable of adapter IDs.');
  }
  return new Set(registeredIds);
}

export function validateAdapterIdentity(id, options = {}) {
  assertNonEmptyString(id, 'id');
  if (id.length > 64 || !ID_PATTERN.test(id)) {
    contractError(
      'INVALID_ADAPTER_CONFIG',
      'id',
      'must be at most 64 characters and use lowercase kebab-case.',
      { adapterId: id },
    );
  }
  if (!options.allowReserved && RESERVED_ID_SET.has(id)) {
    contractError('INVALID_ADAPTER_CONFIG', 'id', `is reserved by the built-in adapter "${id}".`, { adapterId: id });
  }
  if (registeredIdSet(options.registeredIds).has(id)) {
    contractError('INVALID_ADAPTER_CONFIG', 'id', `duplicates the registered adapter "${id}".`, { adapterId: id });
  }
  return id;
}

export function validateAdapterCapabilities(capabilities) {
  assertRecord(capabilities, 'capabilities');
  for (const key of Object.keys(capabilities)) {
    if (!CAPABILITY_KEY_SET.has(key)) {
      contractError('INVALID_ADAPTER_CONFIG', `capabilities.${key}`, 'is not part of Adapter Contract v1.');
    }
  }
  for (const key of ADAPTER_CAPABILITY_KEYS) {
    if (typeof capabilities[key] !== 'boolean') {
      contractError('INVALID_ADAPTER_CONFIG', `capabilities.${key}`, 'must be a boolean.');
    }
  }
  if (!capabilities.oneShotLaunch && !capabilities.persistentSession) {
    contractError(
      'UNSUPPORTED_CAPABILITY',
      'capabilities',
      'must enable oneShotLaunch, persistentSession, or both.',
    );
  }
  return Object.freeze(Object.fromEntries(ADAPTER_CAPABILITY_KEYS.map(key => [key, capabilities[key]])));
}

export function validateAdapterDescriptor(descriptor, options = {}) {
  assertRecord(descriptor, 'adapter');
  for (const key of Object.keys(descriptor)) {
    if (!DESCRIPTOR_KEY_SET.has(key)) {
      contractError('INVALID_ADAPTER_CONFIG', `adapter.${key}`, 'is not part of Adapter Contract v1.');
    }
  }
  if (descriptor.contractVersion !== ADAPTER_CONTRACT_VERSION) {
    contractError(
      'INVALID_ADAPTER_CONFIG',
      'contractVersion',
      `must equal supported Adapter Contract version ${ADAPTER_CONTRACT_VERSION}.`,
      { received: descriptor.contractVersion, supported: ADAPTER_CONTRACT_VERSION },
    );
  }
  const id = validateAdapterIdentity(descriptor.id, options);
  const capabilities = validateAdapterCapabilities(descriptor.capabilities);
  if (typeof descriptor.create !== 'function') {
    contractError('INVALID_ADAPTER_CONFIG', 'create', 'must be an adapter factory function.');
  }
  return Object.freeze({
    contractVersion: ADAPTER_CONTRACT_VERSION,
    id,
    capabilities,
    create: descriptor.create,
  });
}

export function defineAdapter(descriptor, options = {}) {
  return validateAdapterDescriptor(descriptor, options);
}

export function validateAdapterInstance(descriptor, instance, options = {}) {
  const validated = validateAdapterDescriptor(descriptor, options);
  assertRecord(instance, 'instance');
  const requiredMethods = [
    ['detection', 'detect'],
    ['configuration', 'validateConfiguration'],
    ['oneShotLaunch', 'resolveLaunch'],
    ['persistentSession', 'resolveSessionLaunch'],
  ];
  for (const [capability, method] of requiredMethods) {
    if (validated.capabilities[capability] && typeof instance[method] !== 'function') {
      contractError(
        'UNSUPPORTED_CAPABILITY',
        `instance.${method}`,
        `is required when capabilities.${capability} is true.`,
        { adapterId: validated.id, capability },
      );
    }
  }
  if (typeof instance.launchPolicy !== 'function') {
    contractError('UNSUPPORTED_CAPABILITY', 'instance.launchPolicy', 'is required by executable-backed adapters.', {
      adapterId: validated.id,
    });
  }
  return instance;
}

export function getAdapterContract(instance) {
  return INSTANCE_CONTRACTS.get(instance) || null;
}

export function createAdapter(descriptor, config = {}, options = {}) {
  const validated = validateAdapterDescriptor(descriptor, options);
  let instance;
  try {
    instance = validated.create(Object.freeze({ ...config }));
  } catch (error) {
    if (error instanceof AdapterContractError) throw error;
    const message = `${error?.message || error}`.slice(0, 1024);
    contractError('INVALID_ADAPTER_CONFIG', 'create', `adapter factory failed: ${message}`, {
      adapterId: validated.id,
    });
  }
  const checked = validateAdapterInstance(validated, instance, { allowReserved: true });
  INSTANCE_CONTRACTS.set(checked, validated);
  if (Object.isExtensible(checked) && !Object.prototype.hasOwnProperty.call(checked, 'contract')) {
    Object.defineProperty(checked, 'contract', {
      value: validated,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return checked;
}

export function validateDetectionResult(result) {
  assertRecord(result, 'detection');
  if (typeof result.available !== 'boolean') {
    contractError('INVALID_ADAPTER_CONFIG', 'detection.available', 'must be a boolean.');
  }
  for (const key of ['command', 'runtimeCommand', 'resolvedCommand', 'version', 'code', 'details']) {
    assertOptionalString(result[key], `detection.${key}`);
  }
  assertStringArray(result.prefix, 'detection.prefix', { required: false });
  if (!result.available) {
    assertNonEmptyString(result.code, 'detection.code');
    assertNonEmptyString(result.details, 'detection.details');
  }
  return result;
}

export function validateConfigurationResult(result) {
  assertRecord(result, 'configuration');
  if (typeof result.compatible !== 'boolean') {
    contractError('INVALID_ADAPTER_CONFIG', 'configuration.compatible', 'must be a boolean.');
  }
  assertOptionalString(result.code, 'configuration.code');
  assertOptionalString(result.details, 'configuration.details');
  if (!result.compatible) {
    assertNonEmptyString(result.code, 'configuration.code');
    assertNonEmptyString(result.details, 'configuration.details');
  }
  return result;
}

export function validateLaunchResult(result, options = {}) {
  const kind = options.kind || 'one-shot';
  if (!['one-shot', 'persistent-session'].includes(kind)) {
    contractError('INVALID_ADAPTER_CONFIG', 'launch.kind', 'must be "one-shot" or "persistent-session".');
  }
  assertRecord(result, 'launch');
  assertNonEmptyString(result.command, 'launch.command');
  assertStringArray(result.prefix, 'launch.prefix', { required: false });
  assertStringArray(result.args, 'launch.args');
  assertOptionalString(result.resolvedCommand, 'launch.resolvedCommand');
  assertOptionalString(result.cwd, 'launch.cwd');
  if (kind === 'persistent-session' && typeof result.initialInputConsumed !== 'boolean') {
    contractError('INVALID_ADAPTER_CONFIG', 'launch.initialInputConsumed', 'must be a boolean for persistent sessions.');
  }
  return result;
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/**
 * Revalidate a Contract v1 launch plan against the Runtime's fresh
 * executable detection facts. Shape validation alone is intentionally not
 * enough: the adapter cannot replace the configured executable, wrapper
 * prefix, repository root, or initial-input delivery contract.
 */
export function validateRuntimeLaunchPlan(result, options = {}) {
  const kind = options.kind || 'one-shot';
  const launch = validateLaunchResult(result, { kind });
  const detection = options.detection || null;
  if (detection) {
    const expectedCommand = detection.runtimeCommand || detection.command;
    if (typeof expectedCommand === 'string' && launch.command !== expectedCommand) {
      contractError('INVALID_ADAPTER_CONFIG', 'launch.command', 'must match the executable selected by detection.', {
        expected: expectedCommand,
        received: launch.command,
      });
    }
    if (Array.isArray(detection.prefix) && !sameStringArray(launch.prefix || [], detection.prefix)) {
      contractError('INVALID_ADAPTER_CONFIG', 'launch.prefix', 'must match the safe executable prefix selected by detection.');
    }
    if ((launch.prefix || []).length > 0 && !Array.isArray(detection.prefix)) {
      contractError('INVALID_ADAPTER_CONFIG', 'detection.prefix', 'must be reported when the launch plan uses an executable prefix.');
    }
    if (typeof detection.resolvedCommand === 'string' && launch.resolvedCommand !== detection.resolvedCommand) {
      contractError('INVALID_ADAPTER_CONFIG', 'launch.resolvedCommand', 'must match the exact configured executable identity selected by detection.', {
        expected: detection.resolvedCommand,
        received: launch.resolvedCommand,
      });
    }
    if (launch.resolvedCommand !== undefined && typeof detection.resolvedCommand !== 'string') {
      contractError('INVALID_ADAPTER_CONFIG', 'detection.resolvedCommand', 'must be reported when the launch plan provides an exact executable identity.');
    }
  }
  if (options.root && launch.cwd !== undefined && resolve(launch.cwd) !== resolve(options.root)) {
    contractError('INVALID_ADAPTER_CONFIG', 'launch.cwd', 'must equal the Runtime repository root when provided.', {
      root: resolve(options.root),
      cwd: resolve(launch.cwd),
    });
  }
  if (kind === 'persistent-session'
    && options.initialPrompt
    && launch.initialInputConsumed
    && !launch.args.some(value => value.includes(options.initialPrompt))) {
    contractError('INVALID_ADAPTER_CONFIG', 'launch.initialInputConsumed', 'cannot claim argv consumption when the initial prompt is absent from launch.args.');
  }
  return launch;
}

export function validateLaunchPolicy(result) {
  assertRecord(result, 'launchPolicy');
  if (!LAUNCH_POLICY_MODES.has(result.mode)) {
    contractError('INVALID_ADAPTER_CONFIG', 'launchPolicy.mode', 'must be "one-shot" or "bus-supervised".');
  }
  if (result.pollIntervalMs !== undefined
    && (!Number.isInteger(result.pollIntervalMs) || result.pollIntervalMs <= 0)) {
    contractError('INVALID_ADAPTER_CONFIG', 'launchPolicy.pollIntervalMs', 'must be a positive integer when provided.');
  }
  return result;
}
