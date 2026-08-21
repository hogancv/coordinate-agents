import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkExecutable, resolveExecutable } from '../adapters/executable.mjs';
import { readConfig } from './config.mjs';
import { canonicalErrorCode } from './runtime-contract.mjs';
import { resolveAgentConfig } from './user-config.mjs';

export const COMMON_CODING_CLIS = Object.freeze([
  'codex',
  'claude',
  'agy',
  'agy-proxy',
  'gemini',
]);

const KNOWN_ADAPTERS = new Map([
  ['codex', 'codex-cli'],
  ['agy', 'antigravity-cli'],
  ['agy-proxy', 'antigravity-cli'],
  ['claude', 'generic-cli'],
  ['gemini', 'generic-cli'],
]);

function safeVersion(command) {
  try {
    const result = checkExecutable(command, { versionArgs: ['--version'] });
    return result.available
      ? { version: result.version || 'available', resolvedCommand: result.resolvedCommand || result.command }
      : { code: result.code, details: result.details, resolvedCommand: result.resolvedCommand || null };
  } catch (error) {
    return { code: 'DETECTION_FAILED', details: error.message || String(error), resolvedCommand: null };
  }
}

function configuredCommands(root, userConfig) {
  const configured = new Map();
  const busPath = join(root, '.agent-bus');
  if (!existsSync(busPath)) return configured;
  let config;
  try {
    config = readConfig(busPath);
  } catch {
    return configured;
  }
  for (const agent of config.agents) {
    try {
      const resolved = resolveAgentConfig(agent, userConfig);
      const command = resolved.command || KNOWN_ADAPTERS.get(agent.id) || null;
      if (command) configured.set(command.toLowerCase(), { agent: agent.id, adapter: agent.adapter, source: resolved.commandSource });
    } catch {
      configured.set(agent.id.toLowerCase(), { agent: agent.id, adapter: agent.adapter, source: 'invalid' });
    }
  }
  return configured;
}

/**
 * Detects executable facts only. It never writes user or project configuration.
 * An entry can be available while still being detected-but-not-configured.
 */
export function discoverCodingClis({ root = process.cwd(), commands = COMMON_CODING_CLIS, userConfig = null } = {}) {
  const configured = configuredCommands(root, userConfig || { version: 1, agents: {} });
  return commands.map(command => {
    const resolved = resolveExecutable(command);
    const version = resolved.available ? safeVersion(command) : null;
    const configuredRecord = configured.get(command.toLowerCase()) || null;
    const available = Boolean(resolved.available);
    return {
      command,
      available,
      resolvedCommand: resolved.resolvedCommand || null,
      version: version?.version || null,
      code: available ? null : canonicalErrorCode(resolved.code || version?.code || 'EXECUTABLE_NOT_FOUND', 'EXECUTABLE_NOT_FOUND'),
      details: available ? null : (resolved.details || version?.details || null),
      configured: Boolean(configuredRecord),
      configuredAgent: configuredRecord?.agent || null,
      adapter: configuredRecord?.adapter || KNOWN_ADAPTERS.get(command) || null,
      status: available
        ? (configuredRecord ? 'available' : 'detected-but-not-configured')
        : 'unavailable',
    };
  });
}

export function setupSnapshot({ root = process.cwd(), userConfig = null } = {}) {
  const agents = discoverCodingClis({ root, userConfig });
  const available = agents.filter(agent => agent.available);
  return {
    root,
    agents,
    availableCommands: available.map(agent => agent.command),
    configuredAgents: available.filter(agent => agent.configured).map(agent => agent.configuredAgent),
    detectedButNotConfigured: available.filter(agent => !agent.configured).map(agent => agent.command),
  };
}
