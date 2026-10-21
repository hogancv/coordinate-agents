import { isAbsolute } from 'node:path';
import { runtimeError } from './runtime-contract.mjs';

const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SESSION = /^session_[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const TASK = /^workspace-[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const ADAPTERS = Object.freeze({ codex: 'codex-cli', antigravity: 'antigravity-cli' });
const ACTIVE = new Set(['starting', 'running', 'idle', 'busy']);
const EVIDENCE_KEYS = ['conversationId', 'sessionId', 'runtimeGeneration', 'source', 'observedAt'];

export function nativeIdentityError(reason) {
  // Diagnostics never interpolate an untrusted payload, UUID, prompt or credential.
  return runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Native identity event rejected: ${reason}.`, {
    recoverable: false, details: { reason },
  });
}

function requireValue(condition, reason = 'INVALID_OBSERVATION') {
  if (!condition) throw nativeIdentityError(reason);
}

function object(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.keys(value).every(key => keys.includes(key)));
}

export function validateRuntimeGeneration(value) {
  requireValue(typeof value === 'string' && UUID.test(value));
  return value.toLowerCase();
}

function uuid(value) {
  requireValue(typeof value === 'string' && UUID.test(value));
  return value.toLowerCase();
}

function timestamp(value) {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)));
  requireValue(new Date(value).toISOString() === value);
  return value;
}

function source(value) {
  object(value, ['id', 'version']);
  requireValue(typeof value.id === 'string' && TOKEN.test(value.id));
  requireValue(typeof value.version === 'string' && TOKEN.test(value.version));
  return { id: value.id, version: value.version };
}

function evidence(value, { sequence = false } = {}) {
  object(value, sequence ? [...EVIDENCE_KEYS, 'sequence'] : EVIDENCE_KEYS);
  requireValue(typeof value.sessionId === 'string' && SESSION.test(value.sessionId));
  if (sequence) requireValue(Number.isSafeInteger(value.sequence) && value.sequence > 0);
  return { conversationId: uuid(value.conversationId), sessionId: value.sessionId,
    runtimeGeneration: validateRuntimeGeneration(value.runtimeGeneration), source: source(value.source),
    observedAt: timestamp(value.observedAt), ...(sequence ? { sequence: value.sequence } : {}) };
}

export function validateNativeConversations(value, { projectRoot, taskId, mode } = {}) {
  if (value === undefined) return undefined; // No migration on reads of legacy Tasks.
  requireValue(mode !== 'custom');
  object(value, Object.keys(ADAPTERS));
  return Object.fromEntries(Object.entries(value).map(([slot, entry]) => {
    object(entry, ['schemaVersion', 'projectRoot', 'taskId', 'slot', 'adapter', 'revision', 'binding', 'firstConflict', 'lastObservation']);
    requireValue(entry.schemaVersion === 1 && entry.slot === slot && entry.adapter === ADAPTERS[slot]);
    requireValue(typeof entry.projectRoot === 'string' && isAbsolute(entry.projectRoot));
    requireValue(typeof entry.taskId === 'string' && TASK.test(entry.taskId) && entry.taskId === taskId);
    requireValue(!projectRoot || entry.projectRoot === projectRoot, 'PROJECT_MISMATCH');
    requireValue(Number.isSafeInteger(entry.revision) && entry.revision > 0);
    const binding = evidence(entry.binding);
    const firstConflict = entry.firstConflict === null ? null : evidence(entry.firstConflict);
    const lastObservation = evidence(entry.lastObservation, { sequence: true });
    requireValue(!firstConflict || firstConflict.conversationId !== binding.conversationId);
    requireValue(firstConflict || lastObservation.conversationId === binding.conversationId);
    return [slot, { schemaVersion: 1, projectRoot: entry.projectRoot, taskId, slot, adapter: entry.adapter,
      revision: entry.revision, binding, firstConflict, lastObservation }];
  }));
}

function validateObservation(value) {
  object(value, ['schemaVersion', 'projectRoot', 'taskId', 'slot', 'adapter', 'conversationId', 'sessionId',
    'runtimeGeneration', 'source', 'observedAt', 'sequence', 'expectedRevision']);
  requireValue(value.schemaVersion === 1 && typeof value.slot === 'string' && Object.hasOwn(ADAPTERS, value.slot) && value.adapter === ADAPTERS[value.slot]);
  requireValue(typeof value.projectRoot === 'string' && isAbsolute(value.projectRoot));
  requireValue(typeof value.taskId === 'string' && TASK.test(value.taskId));
  requireValue(Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0);
  const selected = evidence(Object.fromEntries([...EVIDENCE_KEYS, 'sequence'].map(key => [key, value[key]])), { sequence: true });
  const age = Date.now() - Date.parse(selected.observedAt);
  requireValue(age >= -1_000 && age <= 15_000);
  return { schemaVersion: 1, projectRoot: value.projectRoot, taskId: value.taskId, slot: value.slot,
    adapter: value.adapter, expectedRevision: value.expectedRevision, ...selected };
}

// This constructor is a trusted-code composition boundary, NOT a source registry
// exposed to project configuration or RPC. The owned Codex Host authenticates
// its private native-event context before returning claims to this receiver.
export function createNativeIdentityReceiver({ projectRoot, verifyAttestation, commit }) {
  requireValue(verifyAttestation === undefined || typeof verifyAttestation === 'function');
  return Object.freeze({
    async observe(attestation) {
      let claims;
      try { claims = await verifyAttestation?.(attestation); }
      catch { throw nativeIdentityError('UNTRUSTED_SOURCE'); }
      requireValue(claims, 'UNTRUSTED_SOURCE');
      const observation = validateObservation(claims);
      requireValue(observation.projectRoot === projectRoot, 'PROJECT_MISMATCH');
      // Verification may be asynchronous; ownership/CAS is checked AFTER it,
      // inside a short synchronous transaction. No lock spans source I/O.
      return commit(observation);
    },
  });
}

export function applyNativeIdentityObservation(task, session, value, allTasks) {
  const observation = validateObservation(value); // Also recheck age after lock acquisition.
  const { slot, sessionId, runtimeGeneration, adapter } = observation;
  requireValue(task.id === observation.taskId, 'RUNTIME_MISMATCH');
  requireValue(task.mode !== 'custom' && !task.archivedAt && ['STARTING', 'AWAITING_INPUT', 'RUNNING', 'DEGRADED'].includes(task.status), 'TASK_UNAVAILABLE');
  const association = task.sessions[slot];
  requireValue(association?.sessionId === sessionId && association.runtimeGeneration === runtimeGeneration
    && session.id === sessionId && session.runtimeGeneration === runtimeGeneration
    && session.taskId === task.id && session.subtaskId === slot && session.agent === slot
    && session.adapter === adapter && session.cwd === observation.projectRoot, 'RUNTIME_MISMATCH');
  requireValue(ACTIVE.has(session.state), 'RUNTIME_UNAVAILABLE');
  const previous = task.nativeConversations?.[slot];
  requireValue((previous?.revision || 0) === observation.expectedRevision, 'REVISION_MISMATCH');
  const last = previous?.lastObservation;
  if (last?.sessionId === sessionId && last.runtimeGeneration === runtimeGeneration) {
    requireValue(observation.sequence > last.sequence && observation.observedAt >= last.observedAt, 'OUT_OF_ORDER');
  }
  if (!previous) {
    requireValue(slot !== 'codex' || !task.resume || task.resume.conversationId === observation.conversationId, 'RESUME_TARGET_MISMATCH');
    requireValue(!allTasks.some(other => other.id !== task.id && ((slot === 'codex' && other.resume?.conversationId === observation.conversationId)
      || Object.values(other.nativeConversations || {}).some(entry => entry.adapter === adapter && entry.binding.conversationId === observation.conversationId))), 'CONVERSATION_ALREADY_BOUND');
  }
  const selected = Object.fromEntries(EVIDENCE_KEYS.map(key => [key, observation[key]]));
  const binding = previous?.binding || selected;
  const next = { schemaVersion: 1, projectRoot: observation.projectRoot, taskId: task.id, slot, adapter,
    revision: (previous?.revision || 0) + 1, binding,
    firstConflict: previous?.firstConflict || (binding.conversationId !== selected.conversationId ? selected : null),
    lastObservation: { ...selected, sequence: observation.sequence } };
  return { ...task, nativeConversations: { ...task.nativeConversations, [slot]: next } };
}

export function nativeIdentityView(record) {
  return {
    binding: record?.binding || null,
    firstConflict: record?.firstConflict || null,
    lastObservation: record?.lastObservation || null,
    revision: record?.revision || 0,
    bindingState: record?.firstConflict ? 'IDENTITY_CHANGED' : record?.binding ? 'BOUND' : 'UNBOUND',
    // A historical attestation is not a live source lease or an input fence.
    // Never deserialize VERIFIED or promote an old binding after a refresh.
    verification: { state: 'UNAVAILABLE', reason: 'NO_LIVE_SOURCE' },
  };
}
