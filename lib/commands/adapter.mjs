import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  loadConfiguredTrustedAdapters,
  normalizeTrustedAdapterModulePath,
  prepareTrustedAdapterModules,
  registerPreparedTrustedAdapterModules,
  trustedAdapterModuleRecords,
  unregisterTrustedAdapterModule,
} from '../../skills/coordinate-agents/adapters/trusted-local.mjs';
import {
  readUserConfig,
  userConfigPath,
  writeUserConfig,
} from '../../skills/coordinate-agents/scripts/user-config.mjs';
import { jsonSuccess, runtimeError } from '../../skills/coordinate-agents/scripts/runtime-contract.mjs';

function restoreUserConfig(path, existed, content) {
  if (existed) writeFileSync(path, content, 'utf8');
  else if (existsSync(path)) unlinkSync(path);
}

export async function adapterCommand(options, { json = false } = {}) {
  const path = userConfigPath();
  const baseDir = dirname(path);
  const subcommand = options.subcommand || 'list';
  const hadUserConfig = existsSync(path);
  const previousUserConfig = hadUserConfig ? readFileSync(path, 'utf8') : null;
  const config = readUserConfig();
  const removing = subcommand === 'remove' || subcommand === 'unregister';
  if (!removing) await loadConfiguredTrustedAdapters(config, { baseDir });
  const configured = Array.isArray(config.adapters) ? [...config.adapters] : [];

  if (subcommand === 'list') {
    const payload = jsonSuccess('adapter.list', {
      path,
      adapters: trustedAdapterModuleRecords(),
      configuredPaths: configured,
    });
    if (!json) {
      console.log(`Trusted local adapters (${path}):`);
      if (payload.adapters.length === 0) console.log('  (none)');
      else for (const record of payload.adapters) console.log(`  ${record.id} -> ${record.path}`);
    }
    return payload;
  }

  if (subcommand === 'register' || subcommand === 'add') {
    const [suppliedPath, ...extra] = [
      options.targetAgent || options.positionals[0],
      ...options.positionals.slice(options.targetAgent ? 0 : 1),
    ];
    if (!suppliedPath || extra.length > 0) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', 'adapter register requires exactly one local module path.', {
        recoverable: false,
        details: 'Usage: coordinate-agents adapter register <path>',
      });
    }
    const normalizedPath = normalizeTrustedAdapterModulePath(suppliedPath, { baseDir: process.cwd() });
    const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (configured.some(value => pathKey(value) === pathKey(normalizedPath))) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', `Adapter module is already registered: ${normalizedPath}`, {
        recoverable: false,
        details: { path: 'module.path', modulePath: normalizedPath },
      });
    }

    const prepared = await prepareTrustedAdapterModules([normalizedPath], { baseDir });
    config.adapters = [...configured, normalizedPath];
    let written = false;
    try {
      const writtenPath = writeUserConfig(config);
      written = true;
      const committed = registerPreparedTrustedAdapterModules(prepared);
      const record = committed[0] || trustedAdapterModuleRecords().find(item => item.path === normalizedPath);
      const payload = jsonSuccess('adapter.register', {
        path: writtenPath,
        adapter: record || { path: normalizedPath },
        configuredPaths: config.adapters,
      });
      if (!json) console.log(`Registered trusted local adapter ${record?.id || '(unknown)'}: ${normalizedPath}`);
      return payload;
    } catch (error) {
      config.adapters = configured;
      if (written) {
        try { restoreUserConfig(path, hadUserConfig, previousUserConfig); } catch { /* Preserve registration error. */ }
      }
      throw error;
    }
  }

  if (subcommand === 'remove' || subcommand === 'unregister') {
    const [suppliedPath, ...extra] = [
      options.targetAgent || options.positionals[0],
      ...options.positionals.slice(options.targetAgent ? 0 : 1),
    ];
    if (!suppliedPath || extra.length > 0) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', 'adapter remove requires exactly one local module path.', { recoverable: false });
    }
    const normalizedPath = normalizeTrustedAdapterModulePath(suppliedPath, { baseDir: process.cwd(), requireExists: false });
    const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const remaining = configured.filter(value => pathKey(value) !== pathKey(normalizedPath));
    if (remaining.length === configured.length) {
      throw runtimeError('INVALID_ADAPTER_CONFIG', `Adapter module is not registered: ${normalizedPath}`, { recoverable: false });
    }
    config.adapters = remaining;
    const writtenPath = writeUserConfig(config);
    try {
      unregisterTrustedAdapterModule(normalizedPath, { baseDir });
    } catch (error) {
      config.adapters = configured;
      try { restoreUserConfig(path, hadUserConfig, previousUserConfig); } catch { /* Preserve removal error. */ }
      throw error;
    }
    const payload = jsonSuccess('adapter.remove', {
      path: writtenPath,
      removedPath: normalizedPath,
      configuredPaths: remaining,
    });
    if (!json) console.log(`Removed trusted local adapter registration: ${normalizedPath}`);
    return payload;
  }

  throw runtimeError('INVALID_ADAPTER_CONFIG', `Unknown adapter subcommand: ${subcommand}. Use register, list, or remove.`, { recoverable: false });
}

export async function executeAdapterCommand(options, context) {
  try {
    const result = await adapterCommand(options, { json: options.json });
    if (options.json) context.emitJson(result);
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure(`adapter.${options.subcommand || 'list'}`, error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
