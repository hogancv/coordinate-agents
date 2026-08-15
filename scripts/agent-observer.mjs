import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertSafePath,
  readConfig,
  readInternalFile,
  safeInternalStat,
  validateAgentId,
} from './config.mjs';

const BUS_STATES = new Set([
  'IDLE', 'CLARIFYING', 'SPEC_READY', 'IMPLEMENTING', 'WAITING', 'REVIEWING',
  'CHANGES_REQUESTED', 'APPROVED', 'RELEASING', 'STOPPED', 'ERROR',
]);

function safeMessageCount(bus, directory) {
  assertSafePath(bus, directory);
  if (!existsSync(directory)) return 0;
  let count = 0;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.md')) continue;
    safeInternalStat(bus, join(directory, name));
    count += 1;
  }
  return count;
}

function currentState(bus, agentId) {
  const directory = join(bus, 'state', agentId);
  assertSafePath(bus, directory);
  if (!existsSync(directory)) return null;
  const newest = readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse()[0];
  if (!newest) return null;
  const record = JSON.parse(readInternalFile(bus, join(directory, newest)));
  if (record.agent !== agentId || !BUS_STATES.has(record.state) || Number.isNaN(Date.parse(record.updated_at))) {
    throw new Error(`Invalid latest state record for supervised agent "${agentId}".`);
  }
  return record;
}

export function observeAgentBus(bus, agentId) {
  validateAgentId(agentId);
  const busMetadata = lstatSync(bus);
  if (!busMetadata.isDirectory() || busMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe Agent Bus root: ${bus}`);
  }
  const config = readConfig(bus);
  if (!config.agents.some(agent => agent.id === agentId)) {
    throw new Error(`Cannot observe unregistered agent "${agentId}".`);
  }
  const inbox = join(bus, 'inbox', agentId);
  const pendingNew = safeMessageCount(bus, join(inbox, 'new'));
  const pendingProcessing = safeMessageCount(bus, join(inbox, 'processing'));
  const state = currentState(bus, agentId);
  return {
    state,
    stopped: state?.state === 'STOPPED',
    pendingNew,
    pendingProcessing,
    hasWork: pendingNew + pendingProcessing > 0,
  };
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Launch supervision interrupted.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Launch supervision interrupted.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function waitForAgentActivity(bus, agentId, { pollIntervalMs = 500, signal } = {}) {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100) {
    throw new Error('Supervision poll interval must be an integer of at least 100ms.');
  }
  while (true) {
    const observation = observeAgentBus(bus, agentId);
    if (observation.stopped || observation.hasWork) return observation;
    await delay(pollIntervalMs, signal);
  }
}
