import { codexConversationId } from './codex-conversation.mjs';
import { validateRuntimeGeneration } from './workspace-native-identity.mjs';

const STATES = new Set(['STARTING', 'AWAITING_CONFIRMATION', 'READY', 'PARTIAL', 'FAILED', 'CLOSED']);
export function validateWorkspaceResume(value) {
  if (value === undefined || value === null) return null;
  if (value.schemaVersion !== 1 || !STATES.has(value.state)) throw new Error('Invalid Workspace resume state.');
  const verification = value.verification;
  if (verification && (verification.mode !== 'MANUAL' || !/^session_[a-zA-Z0-9_-]{8,128}$/.test(verification.sessionId || '')
    || !Number.isFinite(Date.parse(verification.confirmedAt)))) throw new Error('Invalid manual conversation confirmation.');
  const interruption = value.interruption;
  if (interruption && (!/^round-[a-zA-Z0-9_-]{1,128}$/.test(interruption.roundId || '')
    || !Number.isSafeInteger(interruption.revision) || typeof interruption.status !== 'string')) throw new Error('Invalid interrupted collaboration round.');
  return { schemaVersion: 1, conversationId: codexConversationId(value.conversationId), state: value.state,
    verification: verification ? { mode: 'MANUAL', sessionId: verification.sessionId,
      runtimeGeneration: validateRuntimeGeneration(verification.runtimeGeneration), confirmedAt: verification.confirmedAt } : null,
    interruption: interruption ? { roundId: interruption.roundId, revision: interruption.revision, status: interruption.status } : null };
}

export function manualConfirmationCurrent(record, session) {
  const proof = record.resume?.verification;
  return Boolean(proof && record.status !== 'CLOSED' && !record.archivedAt
    && proof.sessionId === record.sessions.codex.sessionId && proof.runtimeGeneration === record.sessions.codex.runtimeGeneration
    && session?.id === proof.sessionId && session.runtimeGeneration === proof.runtimeGeneration
    && ['starting', 'running', 'idle', 'busy'].includes(session.state));
}

export function validateRoundRuntime(value) {
  if (value === undefined || value === null) return null;
  if (!/^round-[a-zA-Z0-9_-]{1,128}$/.test(value.roundId || '') || !/^session_[a-zA-Z0-9_-]{8,128}$/.test(value.sessionId || '')) throw new Error('Invalid collaboration round runtime.');
  return { roundId: value.roundId, sessionId: value.sessionId, runtimeGeneration: validateRuntimeGeneration(value.runtimeGeneration) };
}
