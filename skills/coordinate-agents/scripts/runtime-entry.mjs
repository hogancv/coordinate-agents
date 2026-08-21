#!/usr/bin/env node

/**
 * The one Plugin-facing launcher for the canonical Coordinate Agents Runtime.
 *
 * Codex installs a Plugin by materialising the complete plugin directory into
 * a cache such as:
 *
 *   <CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/<version>/
 *
 * The `skills/` tree is therefore not a reliable working directory and the
 * `coordinate-agents` npm bin is not guaranteed to be on PATH.  This entry
 * point starts the one canonical `bin/coordinate-agents.mjs` found beside the
 * active Plugin payload.  It is intentionally a small resolver/launcher, not
 * a second Runtime implementation.
 */

import { createRequire } from 'node:module';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonFailure, runtimeError } from './runtime-contract.mjs';

export const RUNTIME_ENTRY_ERROR = 'PLUGIN_RUNTIME_NOT_FOUND';
export const RUNTIME_FILE_NAME = 'coordinate-agents.mjs';

function isDirectory(path) {
  try {
    const metadata = lstatSync(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRegularFile(path) {
  try {
    const metadata = lstatSync(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function hasCanonicalRuntime(root) {
  const runtime = join(root, 'bin', RUNTIME_FILE_NAME);
  if (!isRegularFile(runtime)) return false;

  // A package manifest or Plugin manifest makes the candidate unambiguous and
  // prevents an unrelated ancestor `bin/coordinate-agents.mjs` from winning.
  const packageJson = readJson(join(root, 'package.json'));
  if (packageJson?.name === '@hogancv/coordinate-agents') return true;
  const pluginJson = readJson(join(root, '.codex-plugin', 'plugin.json'));
  return pluginJson?.name === 'coordinate-agents';
}

function ancestors(start) {
  const result = [];
  let current = resolve(start);
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function candidateFromAncestor(start) {
  for (const directory of ancestors(start)) {
    if (hasCanonicalRuntime(directory)) return directory;
  }
  return null;
}

function codexHomeCandidates(env) {
  const homes = new Set();
  for (const value of [
    env.CODEX_HOME,
    env.HOME ? join(env.HOME, '.codex') : null,
    env.USERPROFILE ? join(env.USERPROFILE, '.codex') : null,
    join(homedir(), '.codex'),
  ]) {
    if (value) homes.add(resolve(value));
  }
  return [...homes];
}

function cachedPluginRoots(env) {
  const roots = [];
  for (const home of codexHomeCandidates(env)) {
    const cache = join(home, 'plugins', 'cache');
    if (!isDirectory(cache)) continue;
    let marketplaces;
    try { marketplaces = readdirSync(cache, { withFileTypes: true }); } catch { continue; }
    for (const marketplace of marketplaces) {
      if (!marketplace.isDirectory() || marketplace.isSymbolicLink()) continue;
      const pluginDirectory = join(cache, marketplace.name, 'coordinate-agents');
      if (!isDirectory(pluginDirectory)) continue;
      let versions;
      try { versions = readdirSync(pluginDirectory, { withFileTypes: true }); } catch { continue; }
      for (const version of versions.sort((a, b) => b.name.localeCompare(a.name))) {
        if (!version.isDirectory() || version.isSymbolicLink()) continue;
        const root = join(pluginDirectory, version.name);
        if (hasCanonicalRuntime(root)) roots.push(root);
      }
    }
  }
  return roots;
}

function personalMarketplaceRoots(env) {
  const roots = [];
  const home = env.HOME || env.USERPROFILE || homedir();
  const marketplacePath = join(home, '.agents', 'plugins', 'marketplace.json');
  const marketplace = readJson(marketplacePath);
  if (!marketplace || !Array.isArray(marketplace.plugins)) return roots;
  const marketplaceRoot = dirname(marketplacePath);
  // Marketplace implementations have used both the marketplace directory and
  // the containing checkout as the base for a relative local source.  Try the
  // small, deterministic set of bases without weakening canonical-manifest
  // validation in hasCanonicalRuntime().
  const sourceBases = [
    marketplaceRoot,
    dirname(marketplaceRoot),
    dirname(dirname(marketplaceRoot)),
  ];
  for (const entry of marketplace.plugins) {
    if (entry?.name !== 'coordinate-agents') continue;
    const source = entry.source || {};
    if (source.source !== 'local' || typeof source.path !== 'string') continue;
    for (const base of sourceBases) {
      const sourceRoot = resolve(base, source.path);
      if (hasCanonicalRuntime(sourceRoot)) roots.push(sourceRoot);
    }
  }
  return roots;
}

function globalPackageRoots(env) {
  const prefixes = new Set([
    env.NPM_CONFIG_PREFIX,
    env.npm_config_prefix,
    env.PREFIX,
    process.platform === 'win32' && env.APPDATA ? join(env.APPDATA, 'npm') : null,
    process.platform !== 'win32' ? '/usr/local' : null,
    process.platform !== 'win32' ? '/usr' : null,
  ].filter(Boolean));
  const roots = [];
  for (const prefix of prefixes) {
    const candidates = [
      join(prefix, 'node_modules', '@hogancv', 'coordinate-agents'),
      join(prefix, 'lib', 'node_modules', '@hogancv', 'coordinate-agents'),
    ];
    for (const root of candidates) if (hasCanonicalRuntime(root)) roots.push(root);
  }
  for (const nodePath of `${env.NODE_PATH || ''}`.split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const root = join(nodePath, '@hogancv', 'coordinate-agents');
    if (hasCanonicalRuntime(root)) roots.push(root);
  }
  return roots;
}

function packageRequireRoot(entryPath) {
  try {
    const require = createRequire(entryPath);
    const resolved = require.resolve('@hogancv/coordinate-agents/bin/coordinate-agents.mjs');
    const root = dirname(dirname(resolve(resolved)));
    return hasCanonicalRuntime(root) ? root : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical Runtime without consulting PATH.  `entryPath` is
 * injectable for tests and represents the installed resolver's absolute path.
 */
export function resolveCanonicalRuntime({ entryPath = fileURLToPath(import.meta.url), env = process.env } = {}) {
  const explicit = env.COORDINATE_AGENTS_RUNTIME_PATH || env.COORDINATE_AGENTS_RUNTIME_ROOT;
  const explicitRoot = explicit
    ? (explicit.endsWith('.mjs') ? dirname(dirname(resolve(explicit))) : resolve(explicit))
    : null;
  const roots = [
    explicitRoot,
    candidateFromAncestor(dirname(entryPath)),
    packageRequireRoot(entryPath),
    ...personalMarketplaceRoots(env),
    ...cachedPluginRoots(env),
    ...globalPackageRoots(env),
  ].filter(Boolean);

  const seen = new Set();
  for (const root of roots) {
    const canonicalRoot = resolve(root);
    if (seen.has(canonicalRoot)) continue;
    seen.add(canonicalRoot);
    const runtimePath = join(canonicalRoot, 'bin', RUNTIME_FILE_NAME);
    if (hasCanonicalRuntime(canonicalRoot)) {
      return {
        kind: 'file',
        root: canonicalRoot,
        path: runtimePath,
        source: canonicalRoot === explicitRoot ? 'explicit' : 'plugin-payload',
      };
    }
  }
  return null;
}

function resolverError(entryPath) {
  return runtimeError(
    RUNTIME_ENTRY_ERROR,
    'The bundled Coordinate Agents Runtime could not be found from the active Plugin payload.',
    {
      recoverable: false,
      details: `Resolver: ${entryPath}. Install the Plugin again or use the standalone npm Runtime for debugging.`,
      stage: 'resolve',
    },
  );
}

function emitFailure(args, error) {
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(jsonFailure('runtime.resolve', error))}\n`);
  } else {
    process.stderr.write(`${error.message || String(error)}\n`);
  }
  process.exitCode = 1;
}

export async function launchCanonicalRuntime(args = process.argv.slice(2), options = {}) {
  const entryPath = options.entryPath || fileURLToPath(import.meta.url);
  const resolved = resolveCanonicalRuntime({ entryPath, env: options.env || process.env });
  if (!resolved) {
    const error = resolverError(entryPath);
    emitFailure(args, error);
    return 1;
  }

  return await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolved.path, ...args], {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: 'inherit',
      windowsHide: false,
    });
    const forwardSignal = signal => {
      if (!child.killed) {
        try { child.kill(signal); } catch { /* child may already have exited */ }
      }
    };
    const onSigint = () => forwardSignal('SIGINT');
    const onSigterm = () => forwardSignal('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    child.once('error', error => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      const wrapped = runtimeError('SPAWN_FAILED', error.message || String(error), { recoverable: true, stage: 'spawn' });
      emitFailure(args, wrapped);
      resolvePromise(1);
    });
    child.once('exit', (code, signal) => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      if (signal) {
        process.exitCode = process.platform === 'win32' ? 1 : 128 + (signal === 'SIGINT' ? 2 : 15);
      } else if (Number.isInteger(code)) {
        process.exitCode = code;
      }
      resolvePromise(Number.isInteger(code) ? code : 1);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await launchCanonicalRuntime();
}
