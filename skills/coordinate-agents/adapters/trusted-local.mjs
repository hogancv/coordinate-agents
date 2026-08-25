import {
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { extname, dirname, isAbsolute, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ADAPTER_CONTRACT_VERSION,
  AdapterContractError,
  validateAdapterDescriptor,
} from './contract-v1.mjs';
import {
  getAdapterDescriptor,
  getAdapterSourcePath,
  listAdapters,
  registerAdapter,
  unregisterAdapter,
} from './index.mjs';

export const TRUSTED_ADAPTER_MODULE_EXTENSIONS = Object.freeze(['.cjs', '.js', '.mjs']);

const EXTENSION_SET = new Set(TRUSTED_ADAPTER_MODULE_EXTENSIONS);
const LOADED_MODULES = new Map();

function bounded(value, limit = 1_024) {
  return `${value || ''}`.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, limit);
}

function moduleError(path, message, details = {}) {
  throw new AdapterContractError(
    'INVALID_ADAPTER_CONFIG',
    `module.${path}: ${message}`,
    { path: `module.${path}`, ...details },
  );
}

function isUrlLike(value) {
  // Keep Windows drive-letter paths local while rejecting file:, http:, data:,
  // node:, and every other URL/import scheme.
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value);
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function moduleKey(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function assertNoLinkedParent(path) {
  let cursor = path;
  while (true) {
    let metadata;
    try {
      metadata = lstatSync(cursor);
    } catch (error) {
      moduleError('path', `cannot inspect the local module path: ${bounded(error.message || error)}`, { modulePath: path });
    }
    if (metadata.isSymbolicLink()) {
      moduleError('path', 'must not contain a symbolic link or junction.', { modulePath: path });
    }
    if (cursor === parse(cursor).root) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

/**
 * Resolve and validate one explicitly supplied local adapter module path.
 * This function never scans a directory and never accepts a URL.
 */
export function normalizeTrustedAdapterModulePath(modulePath, { baseDir = process.cwd(), requireExists = true } = {}) {
  if (typeof modulePath !== 'string' || modulePath.trim() === '') {
    moduleError('path', 'must be a non-empty local file path.');
  }
  const supplied = modulePath.trim();
  if (isUrlLike(supplied)) {
    moduleError('path', 'must be a local filesystem path, not a URL or import specifier.', { modulePath: supplied });
  }
  if (typeof baseDir !== 'string' || baseDir.trim() === '' || !isAbsolute(baseDir)) {
    moduleError('path', 'baseDir must be an absolute local directory.', { baseDir });
  }
  const absolute = resolve(baseDir, supplied);
  const extension = extname(absolute).toLowerCase();
  if (!EXTENSION_SET.has(extension)) {
    moduleError('path', `must use one of ${TRUSTED_ADAPTER_MODULE_EXTENSIONS.join(', ')}.`, { modulePath: supplied });
  }
  if (!requireExists && !existsSync(absolute)) return absolute;
  if (!existsSync(absolute)) {
    moduleError('path', `does not exist: ${absolute}`, { modulePath: absolute });
  }
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch (error) {
    moduleError('path', `cannot inspect the local module: ${bounded(error.message || error)}`, { modulePath: absolute });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    moduleError('path', 'must be a regular, non-symlink file.', { modulePath: absolute });
  }
  if (metadata.nlink !== 1) {
    moduleError('path', 'must not be a hard-linked file.', { modulePath: absolute });
  }
  assertNoLinkedParent(absolute);
  let canonical;
  try {
    canonical = realpathSync(absolute);
  } catch (error) {
    moduleError('path', `cannot resolve the local module: ${bounded(error.message || error)}`, { modulePath: absolute });
  }
  if (!samePath(canonical, absolute)) {
    moduleError('path', 'must resolve without a symbolic-link or junction path.', { modulePath: absolute });
  }
  return canonical;
}

function descriptorExport(namespace, modulePath) {
  const named = ['default', 'descriptor', 'adapter'].filter(key => namespace[key] !== undefined);
  if (named.length === 0) {
    moduleError('export', 'must expose one Contract v1 descriptor as the default, descriptor, or adapter export.', { modulePath });
  }
  if (named.length > 1) {
    moduleError('export', `is ambiguous; expose only one descriptor export (found ${named.join(', ')}).`, { modulePath });
  }
  const candidate = namespace[named[0]];
  const descriptor = typeof candidate === 'function' && candidate.descriptor
    ? candidate.descriptor
    : candidate;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    moduleError('export', 'must be a Contract v1 descriptor object.', { modulePath });
  }
  return descriptor;
}

async function prepareOne(modulePath, options) {
  const normalizedPath = normalizeTrustedAdapterModulePath(modulePath, options);
  const alreadyLoaded = LOADED_MODULES.get(moduleKey(normalizedPath));
  if (alreadyLoaded) return { ...alreadyLoaded, alreadyLoaded: true };
  let namespace;
  try {
    // pathToFileURL is constructed only from the validated local path. No
    // user-provided URL or import specifier reaches import().
    namespace = await import(pathToFileURL(normalizedPath).href);
  } catch (error) {
    moduleError('load', `failed to load ${bounded(error.message || error)}`, { modulePath: normalizedPath });
  }
  const descriptor = descriptorExport(namespace, normalizedPath);
  const registeredIds = new Set([
    ...listAdapters(),
    ...(options.pendingIds || []),
  ]);
  let validated;
  try {
    validated = validateAdapterDescriptor(descriptor, { registeredIds });
  } catch (error) {
    if (error instanceof AdapterContractError) {
      throw new AdapterContractError(error.code, error.message, {
        ...error.details,
        modulePath: normalizedPath,
      });
    }
    moduleError('descriptor', bounded(error.message || error), { modulePath: normalizedPath });
  }
  if (validated.contractVersion !== ADAPTER_CONTRACT_VERSION) {
    moduleError('contractVersion', `must equal ${ADAPTER_CONTRACT_VERSION}.`, { modulePath: normalizedPath });
  }
  return {
    path: normalizedPath,
    descriptor: validated,
    alreadyLoaded: false,
  };
}

/** Prepare descriptors without mutating the in-memory registry. */
export async function prepareTrustedAdapterModules(modulePaths, options = {}) {
  if (!Array.isArray(modulePaths)) moduleError('paths', 'must be an array of local module paths.');
  const baseDir = options.baseDir || process.cwd();
  const prepared = [];
  const seenPaths = new Set();
  const pendingIds = [];
  for (const reference of modulePaths) {
    const modulePath = typeof reference === 'string' ? reference : reference?.path;
    const normalizedPath = normalizeTrustedAdapterModulePath(modulePath, { baseDir });
    const key = moduleKey(normalizedPath);
    if (seenPaths.has(key)) {
      moduleError('paths', `contains the duplicate module path: ${normalizedPath}`, { modulePath: normalizedPath });
    }
    seenPaths.add(key);
    const candidate = await prepareOne(normalizedPath, { baseDir, pendingIds });
    if (!candidate.alreadyLoaded) {
      pendingIds.push(candidate.descriptor.id);
      prepared.push(candidate);
    }
  }
  return prepared;
}

/** Commit a previously prepared, fully validated set of descriptors. */
export function registerPreparedTrustedAdapterModules(prepared) {
  if (!Array.isArray(prepared)) moduleError('prepared', 'must be an array.');
  const pendingIds = new Set(listAdapters());
  const plan = [];
  for (const item of prepared) {
    if (!item || typeof item.path !== 'string' || !item.descriptor) moduleError('prepared', 'contains an invalid prepared module.');
    if (LOADED_MODULES.has(moduleKey(item.path))) continue;
    let descriptor;
    try {
      descriptor = validateAdapterDescriptor(item.descriptor, { registeredIds: pendingIds });
    } catch (error) {
      if (error instanceof AdapterContractError) {
        throw new AdapterContractError(error.code, error.message, {
          ...error.details,
          modulePath: item.path,
        });
      }
      moduleError('descriptor', bounded(error.message || error), { modulePath: item.path });
    }
    pendingIds.add(descriptor.id);
    plan.push({ ...item, descriptor });
  }
  const committed = [];
  try {
    for (const item of plan) {
      const descriptor = registerAdapter(item.descriptor.id, item.descriptor, { sourcePath: item.path });
      const record = { path: item.path, descriptor };
      LOADED_MODULES.set(moduleKey(item.path), record);
      committed.push(record);
    }
  } catch (error) {
    // Registration is validated before this function is normally called. If
    // a concurrent in-process caller changed the registry, keep the durable
    // configuration untouched and surface the canonical failure.
    throw error;
  }
  return committed;
}

/** Load and register explicitly configured local modules in deterministic order. */
export async function loadTrustedAdapterModules(modulePaths, options = {}) {
  const prepared = await prepareTrustedAdapterModules(modulePaths, options);
  return registerPreparedTrustedAdapterModules(prepared);
}

export async function loadTrustedAdapterModule(modulePath, options = {}) {
  const loaded = await loadTrustedAdapterModules([modulePath], options);
  return loaded[0] || LOADED_MODULES.get(moduleKey(normalizeTrustedAdapterModulePath(modulePath, options))) || null;
}

export async function loadConfiguredTrustedAdapters(userConfig, { baseDir = process.cwd() } = {}) {
  const paths = Array.isArray(userConfig?.adapters) ? userConfig.adapters : [];
  return loadTrustedAdapterModules(paths, { baseDir });
}

export function unregisterTrustedAdapterModule(modulePath, { baseDir = process.cwd() } = {}) {
  const normalizedPath = normalizeTrustedAdapterModulePath(modulePath, { baseDir, requireExists: false });
  const record = LOADED_MODULES.get(moduleKey(normalizedPath));
  if (!record) return false;
  const sourcePath = getAdapterSourcePath(record.descriptor.id);
  if (sourcePath !== normalizedPath) {
    throw new AdapterContractError('INVALID_ADAPTER_CONFIG', 'module.unregister: registered adapter source does not match the requested module.', {
      path: 'module.unregister',
      modulePath: normalizedPath,
      adapterId: record.descriptor.id,
    });
  }
  unregisterAdapter(record.descriptor.id, { sourcePath: normalizedPath });
  LOADED_MODULES.delete(moduleKey(normalizedPath));
  return true;
}

export function trustedAdapterModuleRecords() {
  return [...LOADED_MODULES.values()].map(item => ({
    path: item.path,
    id: item.descriptor.id,
    contractVersion: item.descriptor.contractVersion,
    capabilities: item.descriptor.capabilities,
  }));
}

export function trustedAdapterModulePathFor(id) {
  const descriptor = getAdapterDescriptor(id);
  return trustedAdapterModuleRecords().find(item => item.id === descriptor?.id)?.path || null;
}
