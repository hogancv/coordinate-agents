import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  lstatSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  agents: [
    { id: 'codex', adapter: 'codex-cli' },
    { id: 'antigravity', adapter: 'antigravity-cli' },
  ],
  workflow: {
    planner: 'codex',
    implementer: 'antigravity',
    reviewer: 'codex',
  },
});

export const RESERVED_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export function validateAgentId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Agent ID must be a non-empty string.');
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`Invalid agent ID "${id}". Agent ID must be 1-64 lowercase alphanumeric characters, underscores, or hyphens, starting with a lowercase letter.`);
  }
  const base = id.toLowerCase().split('.')[0];
  if (RESERVED_DEVICE_NAMES.has(base) || RESERVED_DEVICE_NAMES.has(id.toLowerCase())) {
    throw new Error(`Invalid agent ID "${id}". Cannot use reserved device name.`);
  }
  return id;
}

export function assertContained(root, candidate) {
  const relation = relative(root, candidate);
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Refusing path outside root directory: ${candidate}`);
  }
}

export function assertSafePath(root, candidate) {
  assertContained(root, candidate);
  let cursor = candidate;
  while (cursor !== root) {
    if (existsSync(cursor)) {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic link or junction in agent-bus path: ${cursor}`);
      const canonical = realpathSync(cursor);
      assertContained(root, canonical);
    }
    cursor = dirname(cursor);
  }
  return candidate;
}

export function safeInternalStat(bus, path) {
  assertContained(bus, path);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Refusing linked or non-regular agent-bus file: ${path}`);
  }
  assertContained(bus, realpathSync(path));
  return metadata;
}

export function readInternalFile(bus, path) {
  safeInternalStat(bus, path);
  return readFileSync(path, 'utf8');
}

function syncFile(path) {
  const fd = openSync(path, 'r');
  try {
    try { fsyncSync(fd); } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
    }
  } finally { closeSync(fd); }
}

export function atomicWrite(destination, content, tempDirectory) {
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(tempDirectory, { recursive: true });
  const temp = join(tempDirectory, `.tmp-${process.pid}-${randomUUID().replaceAll('-', '')}`);
  writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
  syncFile(temp);
  try {
    renameSync(temp, destination);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must be a JSON object.');
  }
  if (config.version !== 1) {
    throw new Error(`Unsupported config version: ${config.version}. Expected 1.`);
  }
  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error('Config must define a non-empty "agents" array.');
  }
  const ids = new Set();
  for (const agent of config.agents) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error('Invalid agent record in config.');
    validateAgentId(agent.id);
    if (ids.has(agent.id)) throw new Error(`Duplicate agent ID in config: ${agent.id}`);
    ids.add(agent.id);
    if (!agent.adapter || typeof agent.adapter !== 'string') {
      throw new Error(`Agent "${agent.id}" is missing required "adapter" string.`);
    }
    if (agent.command !== undefined && (typeof agent.command !== 'string' || agent.command.trim() === '')) {
      throw new Error(`Agent "${agent.id}" command must be a non-empty string when provided.`);
    }
    if (agent.args !== undefined) {
      if (!Array.isArray(agent.args) || !agent.args.every(a => typeof a === 'string')) {
        throw new Error(`Agent "${agent.id}" args must be an array of strings.`);
      }
    }
    if (agent.versionArgs !== undefined) {
      if (!Array.isArray(agent.versionArgs) || !agent.versionArgs.every(a => typeof a === 'string')) {
        throw new Error(`Agent "${agent.id}" versionArgs must be an array of strings.`);
      }
    }
  }
  if (config.workflow !== undefined) {
    if (!config.workflow || typeof config.workflow !== 'object' || Array.isArray(config.workflow)) {
      throw new Error('Config workflow must be an object.');
    }
    for (const [role, agentId] of Object.entries(config.workflow)) {
      if (typeof agentId !== 'string' || !ids.has(agentId)) {
        throw new Error(`Workflow role "${role}" references unregistered agent "${agentId}".`);
      }
    }
  }
  return config;
}

export function configPath(bus) {
  return join(bus, 'config.json');
}

export function readConfig(bus) {
  const cfgFile = configPath(bus);
  if (!existsSync(cfgFile)) {
    return DEFAULT_CONFIG;
  }
  try {
    const content = readInternalFile(bus, cfgFile);
    const parsed = JSON.parse(content);
    return validateConfig(parsed);
  } catch (err) {
    throw new Error(`Failed to load valid .agent-bus/config.json: ${err.message}`);
  }
}

export function writeConfig(bus, config) {
  validateConfig(config);
  const destination = configPath(bus);
  atomicWrite(destination, `${JSON.stringify(config, null, 2)}\n`, join(bus, 'tmp'));
}

export function acquireConfigLock(bus, { timeoutMs = 10_000, staleMs = 30_000 } = {}) {
  const locksDir = join(bus, 'locks');
  mkdirSync(locksDir, { recursive: true });
  const lock = join(locksDir, 'config');
  const owner = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({ owner, pid: process.pid, host: hostname(), acquired_at: new Date().toISOString() })}\n`, 'utf8');
      return () => {
        try {
          const content = readFileSync(join(lock, 'owner.json'), 'utf8');
          const current = JSON.parse(content);
          if (current.owner === owner) rmSync(lock, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stats = statSync(lock);
        const ownerPath = join(lock, 'owner.json');
        let isAlive = false;
        if (existsSync(ownerPath)) {
          const ownerInfo = JSON.parse(readFileSync(ownerPath, 'utf8'));
          if (ownerInfo.host === hostname() && Number.isInteger(ownerInfo.pid)) {
            try {
              process.kill(ownerInfo.pid, 0);
              isAlive = true;
            } catch { isAlive = false; }
          }
        }
        if (!isAlive || (Date.now() - stats.mtimeMs > staleMs)) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch { /* ignore */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  throw new Error(`Failed to acquire config lock on ${lock}: timeout after ${timeoutMs}ms`);
}

export function withConfigTransaction(bus, updateFn) {
  assertSafePath(bus, bus);
  const release = acquireConfigLock(bus);
  try {
    const current = readConfig(bus);
    const updated = updateFn(JSON.parse(JSON.stringify(current)));
    if (updated !== undefined) {
      writeConfig(bus, updated);
      return updated;
    }
    return current;
  } finally {
    release();
  }
}
