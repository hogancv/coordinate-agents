import {
  getUserConfigValue,
  readUserConfig,
  setUserConfigValue,
  userConfigPath,
  writeUserConfig,
} from '../../skills/coordinate-agents/scripts/user-config.mjs';
import { jsonSuccess, runtimeError } from '../../skills/coordinate-agents/scripts/runtime-contract.mjs';

function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function stringifyConfigValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return String(value);
}

export function parseConfigValue(key, value) {
  if (key.endsWith('.args')) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
        throw new Error('args must be a JSON array of strings.');
      }
      return parsed;
    } catch (error) {
      throw new Error(`Invalid args value: ${error.message}`);
    }
  }
  return value;
}

export function handleConfigCommand(options, messages) {
  const path = userConfigPath();
  const subcommand = options.subcommand;
  if (subcommand === 'list' || !subcommand) {
    const config = readUserConfig();
    console.log(messages.configListTitle);
    console.log(`\n${messages.configPathLabel}\n${path}`);
    console.log(`\n${messages.configAgentsLabel}`);
    const agents = Object.entries(config.agents);
    if (agents.length === 0) {
      console.log(messages.configNone);
    } else {
      for (const [agentId, agent] of agents) {
        console.log(`\n${agentId}`);
        if (agent.command !== undefined) console.log(format(messages.configCommandLabel, { value: agent.command }));
        if (agent.args !== undefined) console.log(format(messages.configArgsLabel, { value: JSON.stringify(agent.args) }));
      }
    }
    console.log('\nTrusted local adapters');
    const adapters = Array.isArray(config.adapters) ? config.adapters : [];
    if (adapters.length === 0) console.log(messages.configNone);
    else for (const modulePath of adapters) console.log(`  ${modulePath}`);
    return;
  }

  if (subcommand === 'set') {
    const [key, value, ...extra] = options.positionals;
    if (!key || value === undefined || extra.length > 0) {
      throw new Error(`${messages.configHelp} Example: coordinate-agents config set agent.antigravity.command agy-proxy`);
    }
    const config = readUserConfig();
    setUserConfigValue(config, key, parseConfigValue(key, value));
    const written = writeUserConfig(config);
    console.log(format(messages.configUpdated, { path: written }));
    return;
  }

  if (subcommand === 'get') {
    const [key, ...extra] = options.positionals;
    if (!key || extra.length > 0) throw new Error(messages.configHelp);
    const value = getUserConfigValue(readUserConfig(), key);
    if (value === undefined) throw new Error(format(messages.configValueMissing, { key }));
    console.log(stringifyConfigValue(value));
    return;
  }

  throw new Error(`${messages.configHelp} Unknown config subcommand: ${subcommand}`);
}

export function jsonConfigCommand(options) {
  const path = userConfigPath();
  if (options.subcommand === 'list' || !options.subcommand) {
    return jsonSuccess('config.list', { path, config: readUserConfig() });
  }
  if (options.subcommand === 'get') {
    const [key, ...extra] = options.positionals;
    if (!key || extra.length > 0) throw runtimeError('INVALID_AGENT_CONFIG', 'A single configuration key is required.', { recoverable: false });
    const value = getUserConfigValue(readUserConfig(), key);
    if (value === undefined) throw runtimeError('INVALID_AGENT_CONFIG', `User configuration value is not set: ${key}`, { recoverable: false, details: key });
    return jsonSuccess('config.get', { path, key, value });
  }
  if (options.subcommand === 'set') {
    const [key, value, ...extra] = options.positionals;
    if (!key || value === undefined || extra.length > 0) throw runtimeError('INVALID_AGENT_CONFIG', 'config set requires a key and value.', { recoverable: false });
    const config = readUserConfig();
    setUserConfigValue(config, key, parseConfigValue(key, value));
    const written = writeUserConfig(config);
    return jsonSuccess('config.set', { path: written, key, value: getUserConfigValue(config, key) });
  }
  throw runtimeError('INVALID_AGENT_CONFIG', `Unknown config subcommand: ${options.subcommand}`, { recoverable: false });
}

export async function executeConfigCommand(options, context) {
  try {
    if (options.json) context.emitJson(jsonConfigCommand(options));
    else handleConfigCommand(options, context.messages);
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure(`config.${options.subcommand || 'list'}`, error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
