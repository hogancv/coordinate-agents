import { stripVTControlCharacters } from 'node:util';

const STATUSES = new Set(['SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED', 'FAILED']);
const CODEX_STATUSES = new Set(['SENT', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED']);
export const collaborationAgent = status => CODEX_STATUSES.has(status) ? 'codex' : 'antigravity';

// Sanitize before shortening so a truncated credential never escapes redaction.
// This is a receipt preview, never a terminal transcript or dispatch prompt.
export function collaborationSummary(value) {
  const text = stripVTControlCharacters(String(value || ''))
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi, '[REDACTED]')
    .replace(/\b(?:gh[pousr]_[a-z0-9_]{16,}|github_pat_[a-z0-9_]{16,}|sk-(?:proj-)?[a-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/gi, '[REDACTED]')
    .replace(/\b(authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[REDACTED]')
    .replace(/\b(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b((?:[\w.-]*(?:token|password|passwd|secret|api[_-]?key|credential|cookie)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length > 240 ? `${chars.slice(0, 239).join('')}…` : text;
}

export function validateCollaborationEvents(value, taskId, revision) {
  if (value === undefined) return []; // No synthetic history for legacy records.
  if (!Array.isArray(value)) throw new Error('Invalid Workspace collaboration history.');
  let previousRevision = 0;
  return value.map(event => {
    if (!event || event.taskId !== taskId || !STATUSES.has(event.status)
      || !['IDLE', ...STATUSES].includes(event.fromStatus)
      || !/^round-[a-zA-Z0-9_-]{1,128}$/.test(event.roundId || '')
      || !Number.isSafeInteger(event.revision) || event.revision <= previousRevision || event.revision > revision
      || event.agent !== collaborationAgent(event.status)
      || typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))
      || typeof event.summary !== 'string') throw new Error('Invalid Workspace collaboration event.');
    previousRevision = event.revision;
    return { taskId, roundId: event.roundId, revision: event.revision, timestamp: event.timestamp,
      agent: event.agent, fromStatus: event.fromStatus, status: event.status, summary: collaborationSummary(event.summary) };
  });
}

export function collaborationTransition(taskId, previous, current) {
  if (previous.status === current.status && previous.roundId === current.roundId) return null;
  return { taskId, roundId: current.roundId, revision: current.revision, timestamp: current.updatedAt,
    agent: collaborationAgent(current.status), fromStatus: previous.status, status: current.status,
    summary: collaborationSummary(current.summary) };
}
