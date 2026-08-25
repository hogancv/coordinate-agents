import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateAgentId } from './config.mjs';

export const USER_CONFIG_VERSION = 1;
export const USER_CONFIG_DIRECTORY = '.coordinate-agents';
export const USER_CONFIG_FILE = 'config.json';

const ADAPTER_DEFAULT_COMMANDS = Object.freeze({
  'codex-cli': 'codex',
  'antigravity-cli': 'agy',
});

function optionsWithHome(options) {
  if (typeof options === 'string') return { home: options };
  return options || {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function syncFile(path) {
  const fd = openSync(path, 'r');
  try {
    try { fsyncSync(fd); } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
    }
  } finally {
    closeSync(fd);
  }
}

function assertSafeUserPath(path, expectDirectory) {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || (expectDirectory ? !metadata.isDirectory() : !metadata.isFile())) {
    throw new Error(`Refusing unsafe user configuration path: ${path}`);
  }
}

export function userConfigPath(options) {
  const supplied = optionsWithHome(options);
  const home = supplied.home || process.env.COORDINATE_AGENTS_HOME || process.env.HOME || homedir();
  return join(home, USER_CONFIG_DIRECTORY, USER_CONFIG_FILE);
}

export function defaultUserConfig() {
  return { version: USER_CONFIG_VERSION, agents: {}, adapters: [] };
}

export function validateUserConfig(config) {
  if (!isPlainObject(config)) throw new Error('User configuration must be a JSON object.');
  if (config.version !== USER_CONFIG_VERSION) {
    throw new Error(`Unsupported user configuration version: ${config.version}. Expected ${USER_CONFIG_VERSION}.`);
  }
  if (!isPlainObject(config.agents)) {
    throw new Error('User configuration must define an "agents" object.');
  }
  if (config.adapters !== undefined) {
    if (!Array.isArray(config.adapters)) {
      throw new Error('User configuration "adapters" must be an array of local module paths.');
    }
    const adapterPaths = new Set();
    for (const modulePath of config.adapters) {
      if (typeof modulePath !== 'string' || modulePath.trim() === '') {
        throw new Error('User configuration adapter paths must be non-empty strings.');
      }
      if (adapterPaths.has(modulePath)) {
        throw new Error(`Duplicate user adapter module path: ${modulePath}`);
      }
      adapterPaths.add(modulePath);
    }
  }

  for (const [agentId, agent] of Object.entries(config.agents)) {
    validateAgentId(agentId);
    if (!isPlainObject(agent)) throw new Error(`User configuration for agent "${agentId}" must be an object.`);
    if (agent.command !== undefined && (typeof agent.command !== 'string' || agent.command.trim() === '')) {
      throw new Error(`User configuration command for agent "${agentId}" must be a non-empty string.`);
    }
    if (agent.args !== undefined && (!Array.isArray(agent.args) || !agent.args.every(value => typeof value === 'string'))) {
      throw new Error(`User configuration args for agent "${agentId}" must be an array of strings.`);
    }
  }
  return config;
}

export function readUserConfig(options) {
  const path = userConfigPath(options);
  if (!existsSync(path)) return defaultUserConfig();
  try {
    assertSafeUserPath(path, false);
    return validateUserConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    throw new Error(`Failed to load ${path}: ${error.message}`);
  }
}

export function writeUserConfig(config, options) {
  validateUserConfig(config);
  const path = userConfigPath(options);
  const directory = dirname(path);
  assertSafeUserPath(directory, true);
  mkdirSync(directory, { recursive: true });
  assertSafeUserPath(directory, true);

  const temporary = join(directory, `.config-${process.pid}-${randomUUID().replaceAll('-', '')}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    syncFile(temporary);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return path;
}

function getUserAgentConfig(userConfig, agentId) {
  const value = userConfig?.agents?.[agentId];
  return isPlainObject(value) ? value : {};
}

function hasOwnValue(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

export function defaultCommandForAdapter(adapterName) {
  return ADAPTER_DEFAULT_COMMANDS[adapterName];
}

/**
 * Resolve the project/user/default runtime settings without silently replacing
 * an explicit command. A missing project command is intentionally different
 * from a project command set to a concrete value.
 */
export function resolveAgentConfig(projectAgent, userConfig = defaultUserConfig()) {
  if (!isPlainObject(projectAgent)) throw new Error('Project agent configuration must be an object.');
  validateAgentId(projectAgent.id);
  validateUserConfig(userConfig);
  const userAgent = getUserAgentConfig(userConfig, projectAgent.id);

  let command;
  let commandSource;
  if (hasOwnValue(projectAgent, 'command')) {
    command = projectAgent.command;
    commandSource = 'project';
  } else if (hasOwnValue(userAgent, 'command')) {
    command = userAgent.command;
    commandSource = 'user';
  } else {
    command = defaultCommandForAdapter(projectAgent.adapter);
    commandSource = 'adapter-default';
  }

  let args;
  let argsSource;
  if (hasOwnValue(projectAgent, 'args')) {
    args = projectAgent.args;
    argsSource = 'project';
  } else if (hasOwnValue(userAgent, 'args')) {
    args = userAgent.args;
    argsSource = 'user';
  }

  return {
    ...projectAgent,
    ...(command === undefined ? { command: undefined } : { command }),
    ...(args === undefined ? {} : { args }),
    commandSource,
    argsSource: argsSource || null,
  };
}

function parseKey(key) {
  if (typeof key !== 'string') throw new Error('Configuration key must be a string.');
  const match = key.match(/^agent\.([a-z][a-z0-9_-]{0,63})\.(command|args)$/);
  if (!match) throw new Error('Configuration key must look like agent.<agent-id>.command or agent.<agent-id>.args.');
  validateAgentId(match[1]);
  return { agentId: match[1], field: match[2] };
}

export function getUserConfigValue(config, key) {
  validateUserConfig(config);
  const { agentId, field } = parseKey(key);
  return config.agents[agentId]?.[field];
}

export function setUserConfigValue(config, key, value) {
  validateUserConfig(config);
  const { agentId, field } = parseKey(key);
  if (field === 'command' && (typeof value !== 'string' || value.trim() === '')) {
    throw new Error('The command value must be a non-empty string.');
  }
  if (field === 'args' && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))) {
    throw new Error('The args value must be a JSON array of strings.');
  }
  if (!config.agents[agentId]) config.agents[agentId] = {};
  config.agents[agentId][field] = value;
  return config;
}

export { ADAPTER_DEFAULT_COMMANDS };
