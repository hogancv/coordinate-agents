import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkExecutable, resolveExecutable } from '../adapters/executable.mjs';
import {
  getAdapter,
  getAdapterContract,
  getAdapterRegistrySnapshot,
} from '../adapters/index.mjs';
import {
  validateDetectionResult,
} from '../adapters/contract-v1.mjs';
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

function boundedDetails(value) {
  return `${value || ''}`.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 2 * 1024);
}

function configuredAgentRecords(root, userConfig) {
  const busPath = join(root, '.agent-bus');
  if (!existsSync(busPath)) return [];
  let config;
  try {
    config = readConfig(busPath);
  } catch {
    return [];
  }
  return config.agents.map(agent => {
    try {
      return {
        agent,
        resolved: resolveAgentConfig(agent, userConfig),
        error: null,
      };
    } catch (error) {
      return { agent, resolved: null, error };
    }
  });
}

function configuredCommands(records) {
  const configured = new Map();
  for (const record of records) {
    if (record.resolved) {
      const command = record.resolved.command || KNOWN_ADAPTERS.get(record.agent.id) || null;
      if (command) {
        configured.set(command.toLowerCase(), {
          agent: record.agent.id,
          adapter: record.agent.adapter,
          source: record.resolved.commandSource,
        });
      }
    } else {
      configured.set(record.agent.id.toLowerCase(), {
        agent: record.agent.id,
        adapter: record.agent.adapter,
        source: 'invalid',
      });
    }
  }
  return configured;
}

function detectConfiguredAdapter(record) {
  if (!record.resolved) {
    return {
      available: false,
      code: 'INVALID_AGENT_CONFIG',
      details: boundedDetails(record.error?.message || 'Configured Agent cannot be resolved.'),
    };
  }
  try {
    const adapter = getAdapter(record.resolved.adapter, record.resolved);
    const contract = getAdapterContract(adapter);
    if (contract && !contract.capabilities.detection) {
      return {
        available: false,
        code: 'UNSUPPORTED_CAPABILITY',
        details: `Adapter "${contract.id}" does not support executable detection.`,
      };
    }
    const result = adapter.detect({ version: true });
    return contract ? validateDetectionResult(result) : result;
  } catch (error) {
    return {
      available: false,
      code: canonicalErrorCode(error?.code || 'DETECTION_FAILED', 'DETECTION_FAILED'),
      details: boundedDetails(error?.message || error),
    };
  }
}

function configuredAdapterFact(record, { detection = null } = {}) {
  const resolved = record.resolved;
  const available = detection ? detection.available === true : null;
  return {
    id: record.agent.id,
    adapter: record.agent.adapter,
    command: resolved?.command || null,
    commandSource: resolved?.commandSource || (record.error ? 'invalid' : null),
    args: Array.isArray(resolved?.args) ? [...resolved.args] : [],
    available,
    resolvedCommand: detection?.resolvedCommand || null,
    version: detection?.version || null,
    code: available === true ? null : (detection ? canonicalErrorCode(detection.code || 'EXECUTABLE_NOT_FOUND', 'EXECUTABLE_NOT_FOUND') : null),
    details: available === true ? null : (detection ? (boundedDetails(detection.details || '') || null) : null),
    status: available === true ? 'available' : (available === false ? 'unavailable' : 'configured'),
  };
}

function externalAgentRecord(record, detection = null) {
  const adapterDetection = detection || detectConfiguredAdapter(record);
  const available = adapterDetection.available === true;
  return {
    command: record.resolved?.command || null,
    available,
    resolvedCommand: adapterDetection.resolvedCommand || null,
    version: adapterDetection.version || null,
    code: available ? null : canonicalErrorCode(adapterDetection.code || 'EXECUTABLE_NOT_FOUND', 'EXECUTABLE_NOT_FOUND'),
    details: available ? null : (boundedDetails(adapterDetection.details || '') || null),
    configured: true,
    configuredAgent: record.agent.id,
    adapter: record.agent.adapter,
    commandSource: record.resolved?.commandSource || 'invalid',
    status: available ? 'available' : 'unavailable',
  };
}

function adapterRecordsWithUsage(registry, records, detections = new Map()) {
  const byAdapter = new Map();
  for (const record of records) {
    const list = byAdapter.get(record.agent.adapter) || [];
    const registryRecord = registry.find(adapter => adapter.id === record.agent.adapter);
    list.push(configuredAdapterFact(record, {
      detection: registryRecord && !registryRecord.builtin
        ? detections.get(record.agent.id) || detectConfiguredAdapter(record)
        : null,
    }));
    byAdapter.set(record.agent.adapter, list);
  }
  return registry.map(adapter => ({
    ...adapter,
    configuredAgents: byAdapter.get(adapter.id) || [],
  }));
}

/**
 * Detects executable facts only. It never writes user or project configuration.
 * An entry can be available while still being detected-but-not-configured.
 */
export function discoverCodingClis({
  root = process.cwd(),
  commands = COMMON_CODING_CLIS,
  userConfig = null,
  adapterRegistry = null,
  configuredRecords = null,
  adapterDetections = null,
} = {}) {
  const records = configuredRecords || configuredAgentRecords(root, userConfig || { version: 1, agents: {} });
  const configured = configuredCommands(records);
  const registry = Array.isArray(adapterRegistry) ? adapterRegistry : getAdapterRegistrySnapshot();
  const agents = commands.map(command => {
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
  const knownCommands = new Set(commands.map(command => command.toLowerCase()));
  for (const record of records) {
    const registered = registry.find(adapter => adapter.id === record.agent.adapter);
    if (!registered || registered.builtin) continue;
    const command = record.resolved?.command;
    if (typeof command === 'string' && knownCommands.has(command.toLowerCase())) continue;
    agents.push(externalAgentRecord(record, adapterDetections?.get(record.agent.id) || null));
  }
  return agents;
}

export function setupSnapshot({ root = process.cwd(), userConfig = null, adapterRegistry = null } = {}) {
  const registry = Array.isArray(adapterRegistry) ? adapterRegistry : getAdapterRegistrySnapshot();
  const records = configuredAgentRecords(root, userConfig || { version: 1, agents: {} });
  const adapterDetections = new Map();
  for (const record of records) {
    const registered = registry.find(adapter => adapter.id === record.agent.adapter);
    if (registered && !registered.builtin) adapterDetections.set(record.agent.id, detectConfiguredAdapter(record));
  }
  const agents = discoverCodingClis({
    root,
    userConfig,
    adapterRegistry: registry,
    configuredRecords: records,
    adapterDetections,
  });
  const available = agents.filter(agent => agent.available);
  return {
    root,
    agents,
    adapters: adapterRecordsWithUsage(registry, records, adapterDetections),
    availableCommands: available.map(agent => agent.command),
    configuredAgents: available.filter(agent => agent.configured).map(agent => agent.configuredAgent),
    detectedButNotConfigured: available.filter(agent => !agent.configured).map(agent => agent.command),
  };
}
