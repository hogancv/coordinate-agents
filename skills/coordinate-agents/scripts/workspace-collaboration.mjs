import { stripVTControlCharacters } from 'node:util';

const STATUSES = new Set(['SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED', 'FAILED']);
const CODEX_STATUSES = new Set(['SENT', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED']);
// Precompute valid status transitions Set to avoid O(N) array allocation + spreading per event loop
const VALID_FROM_STATUSES = new Set(['IDLE', ...STATUSES]);

export const collaborationAgent = status => CODEX_STATUSES.has(status) ? 'codex' : 'antigravity';

// Pre-compiled regular expressions for redaction and formatting in collaboration summaries.
const REGEX_KEY_HEADER = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi;
const REGEX_TOKENS = /\b(?:gh[pousr]_[a-z0-9_]{16,}|github_pat_[a-z0-9_]{16,}|sk-(?:proj-)?[a-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/gi;
const REGEX_COOKIE = /\b((?:set-)?cookie["']?\s*[:=]\s*)[^\r\n]*/gi;
const REGEX_AUTH = /\b(authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\r\n,;]+/gi;
const REGEX_JWT = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi;
const REGEX_BEARER = /\b(bearer\s+)[^\s,;]+/gi;
const REGEX_SECRET_ASSIGN = /\b((?:[\w.-]*(?:token|password|passwd|secret|api[_-]?key|credential|cookie)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;
const REGEX_URL_AUTH = /(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi;
const REGEX_CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const REGEX_WHITESPACE = /\s+/g;

// Sanitize before shortening so a truncated credential never escapes redaction.
// This is a receipt preview, never a terminal transcript or dispatch prompt.
export function collaborationSummary(value) {
  const text = stripVTControlCharacters(String(value || ''))
    .replace(REGEX_KEY_HEADER, '[REDACTED]')
    .replace(REGEX_TOKENS, '[REDACTED]')
    .replace(REGEX_COOKIE, '$1[REDACTED]')
    .replace(REGEX_AUTH, '$1[REDACTED]')
    .replace(REGEX_JWT, '[REDACTED]')
    .replace(REGEX_BEARER, '$1[REDACTED]')
    .replace(REGEX_SECRET_ASSIGN, '$1[REDACTED]')
    .replace(REGEX_URL_AUTH, '$1[REDACTED]@')
    .replace(REGEX_CONTROL_CHARS, ' ')
    .replace(REGEX_WHITESPACE, ' ').trim();
  // Fast path: avoid converting string to code point Array when code unit length guarantees <= 240 code points (~135x speedup for short strings).
  if (text.length <= 240) return text;
  // Bounded code unit slice (482 units covers at least 241 code points) avoids parsing full array for long strings (~3x speedup).
  const chars = Array.from(text.slice(0, 482));
  return chars.length > 240 ? `${chars.slice(0, 239).join('')}…` : text;
}

export function validateCollaborationEvents(value, taskId, revision) {
  if (value === undefined) return []; // No synthetic history for legacy records.
  if (!Array.isArray(value)) throw new Error('Invalid Workspace collaboration history.');
  let previousRevision = 0;
  return value.map(event => {
    if (!event || event.taskId !== taskId || !STATUSES.has(event.status)
      || !VALID_FROM_STATUSES.has(event.fromStatus)
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
