/**
 * Scope Audit v1 — deterministic post-execution intent drift detection.
 * Git is queried with argument arrays and NUL-delimited output. Audit failures
 * are fail-closed: callers must not turn an unavailable audit into success.
 */
import { execFileSync } from 'node:child_process';
import { runtimeError } from './runtime-contract.mjs';

export const SCOPE_AUDIT_SCHEMA_VERSION = 1;
export const SCOPE_AUDIT_MAX_EVIDENCE_ITEMS = 64;
export const SCOPE_AUDIT_MAX_PATH_BYTES = 4096;
export const SCOPE_AUDIT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const POLICY_SET = new Set(['observe', 'warn', 'strict']);
const COVERAGE_SET = new Set(['declared', 'explicit-empty']);
const CHANGE_STATUS_PATTERN = /^[A-Z?]{1,2}$/;

function auditError(message, details = null) {
  return runtimeError('TASK_STATE_CONFLICT', message, { recoverable: true, stage: 'scope-audit', details });
}

function runGit(args, cwd, operation) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw auditError(`Scope audit cannot ${operation}: worktree path is missing.`);
  }
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: SCOPE_AUDIT_MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    throw auditError(`Scope audit could not ${operation}.`, {
      status: Number.isInteger(error?.status) ? error.status : null,
      stderr: `${error?.stderr || ''}`.trim().slice(0, 2048),
    });
  }
}

function byteLength(value) {
  return Buffer.byteLength(`${value}`, 'utf8');
}

export function normalizeAuditPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\uFFFD')) {
    throw auditError('Scope audit received an invalid Git path.');
  }
  if (byteLength(value) > SCOPE_AUDIT_MAX_PATH_BYTES) {
    throw auditError('Scope audit received a path that exceeds the evidence limit.', { maxPathBytes: SCOPE_AUDIT_MAX_PATH_BYTES });
  }
  if (value.includes('\\')) {
    throw auditError('Scope audit received a non-portable Git path separator.');
  }
  const normalized = value;
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw auditError('Scope audit received an absolute Git path.');
  }
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw auditError('Scope audit received a non-normalized Git path.');
  }
  return normalized;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function patternToRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return /$a/;
  const hasSlash = pattern.includes('/');
  let body = '';
  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index += 2;
      if (pattern[index] === '/') {
        body += '(?:.*/)?';
        index += 1;
      } else body += '.*';
      continue;
    }
    if (char === '*') {
      body += '[^/]*';
      index += 1;
      continue;
    }
    if (char === '?') {
      body += '[^/]';
      index += 1;
      continue;
    }
    if (char === '[') {
      const close = pattern.indexOf(']', index + 1);
      if (close > index + 1) {
        let content = pattern.slice(index + 1, close);
        if (content[0] === '!') content = `^${content.slice(1)}`;
        else if (content[0] === '^') content = `\\${content}`;
        body += `[${content.replaceAll('\\', '\\\\')}]`;
        index = close + 1;
        continue;
      }
    }
    body += escapeRegex(char);
    index += 1;
  }
  return new RegExp(hasSlash ? `^${body}$` : `(?:^|/)${body}$`);
}

export function pathMatchesPattern(path, pattern) {
  try { return patternToRegex(pattern).test(path); } catch { return false; }
}

export function pathCoveredByIntent(path, writeIntent) {
  return Array.isArray(writeIntent) && writeIntent.some(pattern => pathMatchesPattern(path, pattern));
}

function nulFields(output) {
  if (typeof output !== 'string') throw auditError('Scope audit received non-text Git output.');
  if (output.length === 0) return [];
  if (!output.endsWith('\0')) throw auditError('Scope audit received incomplete Git output.');
  return output.slice(0, -1).split('\0');
}

export function parseNameStatus(output) {
  const fields = nulFields(output);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const statusField = fields[index++];
    const status = statusField?.[0]?.toUpperCase();
    if (!status || !/^[A-Z]$/.test(status) || index >= fields.length) {
      throw auditError('Scope audit received malformed committed-diff output.');
    }
    if (status === 'R' || status === 'C') {
      if (index + 1 >= fields.length) throw auditError('Scope audit received an incomplete rename or copy record.');
      changes.push({ status, oldPath: normalizeAuditPath(fields[index++]), path: normalizeAuditPath(fields[index++]) });
    } else changes.push({ status, path: normalizeAuditPath(fields[index++]) });
  }
  return changes;
}

export function parsePorcelainStatus(output) {
  const fields = nulFields(output);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const field = fields[index++];
    if (field.length < 4 || field[2] !== ' ') throw auditError('Scope audit received malformed worktree-status output.');
    const xy = field.slice(0, 2);
    const path = normalizeAuditPath(field.slice(3));
    if (xy.includes('R') || xy.includes('C')) {
      if (index >= fields.length) throw auditError('Scope audit received an incomplete dirty rename or copy record.');
      const oldPath = normalizeAuditPath(fields[index++]);
      changes.push({ status: xy.includes('R') ? 'R' : 'C', oldPath, path });
    } else changes.push({ status: xy === '??' ? '?' : xy.trim().toUpperCase() || 'M', path });
  }
  return changes;
}

export function collectCommittedChanges(worktreePath, baseCommit, implementationCommit) {
  if (!COMMIT_PATTERN.test(`${baseCommit || ''}`) || !COMMIT_PATTERN.test(`${implementationCommit || ''}`)) {
    throw auditError('Scope audit requires valid graph base and implementation commits.');
  }
  return parseNameStatus(runGit(
    ['diff', '--name-status', '-z', '--find-renames=50%', baseCommit, implementationCommit, '--'],
    worktreePath,
    'compare the graph base and implementation commits',
  ));
}

export function collectDirtyChanges(worktreePath) {
  return parsePorcelainStatus(runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    worktreePath,
    'inspect uncommitted worktree changes',
  ));
}

function uniquePaths(changes) {
  return [...new Set(changes.flatMap(change => [change.oldPath, change.path]).filter(Boolean))].sort();
}

function normalizeChange(change) {
  return Object.freeze({ status: change.status, ...(change.oldPath ? { oldPath: change.oldPath } : {}), path: change.path });
}

function boundedList(values) {
  return values.slice(0, SCOPE_AUDIT_MAX_EVIDENCE_ITEMS);
}

function changeIsOutside(change, writeIntent) {
  return !pathCoveredByIntent(change.path, writeIntent)
    || Boolean(change.oldPath && !pathCoveredByIntent(change.oldPath, writeIntent));
}

export function auditSubtaskScope({ parentTaskId, subtaskId, graphBaseCommit, implementationCommit, worktreePath, writeIntent, scopePolicy, inspectDirty = true }) {
  if (!POLICY_SET.has(scopePolicy) || !Array.isArray(writeIntent) || writeIntent.some(pattern => typeof pattern !== 'string')) {
    throw auditError('Scope audit requires a normalized Intent Map declaration.', { parentTaskId, subtaskId });
  }
  const committed = collectCommittedChanges(worktreePath, graphBaseCommit, implementationCommit);
  const dirty = inspectDirty ? collectDirtyChanges(worktreePath) : [];
  const actualPaths = uniquePaths([...committed, ...dirty]);
  const outsidePaths = actualPaths.filter(path => !pathCoveredByIntent(path, writeIntent));
  const committedOutside = committed.filter(change => changeIsOutside(change, writeIntent));
  const dirtyOutside = dirty.filter(change => changeIsOutside(change, writeIntent));
  const drift = outsidePaths.length > 0;
  const evidence = {
    schemaVersion: SCOPE_AUDIT_SCHEMA_VERSION,
    parentTaskId,
    subtaskId,
    graphBaseCommit: `${graphBaseCommit}`.toLowerCase(),
    implementationCommit: `${implementationCommit}`.toLowerCase(),
    scopePolicy,
    coverage: writeIntent.length === 0 ? 'explicit-empty' : 'declared',
    writeIntent: [...writeIntent],
    actualPathCount: actualPaths.length,
    actualPaths: boundedList(actualPaths),
    actualPathsTruncated: actualPaths.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS,
    outsideIntentPathCount: outsidePaths.length,
    outsideIntentPaths: boundedList(outsidePaths),
    outsideIntentPathsTruncated: outsidePaths.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS,
    committedChangeCount: committed.length,
    committedChanges: boundedList(committed.map(normalizeChange)),
    committedChangesTruncated: committed.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS,
    dirtyChangeCount: dirty.length,
    dirtyChanges: boundedList(dirty.map(normalizeChange)),
    dirtyChangesTruncated: dirty.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS,
    dirtyWorktreeAvailable: Boolean(inspectDirty),
    hasDirty: dirty.length > 0,
    drift,
    driftEvidence: drift ? {
      code: 'INTENT_SCOPE_DRIFT',
      outsideIntentPathCount: outsidePaths.length,
      outsideIntentPaths: boundedList(outsidePaths),
      committedOutsideCount: committedOutside.length,
      committedOutside: boundedList(committedOutside.map(normalizeChange)),
      dirtyOutsideCount: dirtyOutside.length,
      dirtyOutside: boundedList(dirtyOutside.map(normalizeChange)),
      truncated: outsidePaths.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS
        || committedOutside.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS
        || dirtyOutside.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS,
    } : null,
  };
  return validateScopeAuditEvidence(evidence, { parentTaskId, subtaskId });
}

function validPathList(value) {
  return Array.isArray(value) && value.length <= SCOPE_AUDIT_MAX_EVIDENCE_ITEMS && value.every(path => {
    try { return normalizeAuditPath(path) === path; } catch { return false; }
  });
}

function validChange(change) {
  return change && typeof change === 'object' && !Array.isArray(change)
    && CHANGE_STATUS_PATTERN.test(change.status) && validPathList([change.path])
    && (change.oldPath === undefined || validPathList([change.oldPath]));
}

function validBoundedFacts(count, values, truncated) {
  return Number.isInteger(count) && count >= 0
    && Array.isArray(values)
    && (count > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS
      ? values.length === SCOPE_AUDIT_MAX_EVIDENCE_ITEMS && truncated === true
      : values.length === count && truncated === false);
}

export function validateScopeAuditEvidence(value, expected = {}) {
  const fail = () => { throw auditError('Persisted Scope Audit evidence is malformed.', expected); };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== SCOPE_AUDIT_SCHEMA_VERSION
    || typeof value.parentTaskId !== 'string' || typeof value.subtaskId !== 'string'
    || (expected.parentTaskId && value.parentTaskId !== expected.parentTaskId)
    || (expected.subtaskId && value.subtaskId !== expected.subtaskId)
    || !COMMIT_PATTERN.test(value.graphBaseCommit) || !COMMIT_PATTERN.test(value.implementationCommit)
    || !POLICY_SET.has(value.scopePolicy) || !COVERAGE_SET.has(value.coverage)
    || !Array.isArray(value.writeIntent) || value.writeIntent.some(pattern => typeof pattern !== 'string')
    || !validPathList(value.actualPaths) || !validPathList(value.outsideIntentPaths)
    || !validBoundedFacts(value.actualPathCount, value.actualPaths, value.actualPathsTruncated)
    || !validBoundedFacts(value.outsideIntentPathCount, value.outsideIntentPaths, value.outsideIntentPathsTruncated)
    || !Array.isArray(value.committedChanges) || value.committedChanges.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS || !value.committedChanges.every(validChange)
    || !Array.isArray(value.dirtyChanges) || value.dirtyChanges.length > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS || !value.dirtyChanges.every(validChange)
    || !validBoundedFacts(value.committedChangeCount, value.committedChanges, value.committedChangesTruncated)
    || !validBoundedFacts(value.dirtyChangeCount, value.dirtyChanges, value.dirtyChangesTruncated)
    || typeof value.actualPathsTruncated !== 'boolean' || typeof value.outsideIntentPathsTruncated !== 'boolean'
    || typeof value.committedChangesTruncated !== 'boolean' || typeof value.dirtyChangesTruncated !== 'boolean'
    || typeof value.dirtyWorktreeAvailable !== 'boolean'
    || typeof value.hasDirty !== 'boolean' || value.hasDirty !== (value.dirtyChangeCount > 0)
    || typeof value.drift !== 'boolean' || value.drift !== (value.outsideIntentPathCount > 0)) fail();
  if (!value.drift && value.driftEvidence !== null) fail();
  if (value.drift && (!value.driftEvidence || value.driftEvidence.code !== 'INTENT_SCOPE_DRIFT'
    || !validPathList(value.driftEvidence.outsideIntentPaths)
    || !validBoundedFacts(value.driftEvidence.outsideIntentPathCount, value.driftEvidence.outsideIntentPaths, value.driftEvidence.outsideIntentPathCount > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS)
    || !Array.isArray(value.driftEvidence.committedOutside) || !value.driftEvidence.committedOutside.every(validChange)
    || !validBoundedFacts(value.driftEvidence.committedOutsideCount, value.driftEvidence.committedOutside, value.driftEvidence.committedOutsideCount > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS)
    || !Array.isArray(value.driftEvidence.dirtyOutside) || !value.driftEvidence.dirtyOutside.every(validChange)
    || !validBoundedFacts(value.driftEvidence.dirtyOutsideCount, value.driftEvidence.dirtyOutside, value.driftEvidence.dirtyOutsideCount > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS)
    || value.driftEvidence.truncated !== (
      value.driftEvidence.outsideIntentPathCount > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS
      || value.driftEvidence.committedOutsideCount > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS
      || value.driftEvidence.dirtyOutsideCount > SCOPE_AUDIT_MAX_EVIDENCE_ITEMS
    ))) fail();
  return Object.freeze(value);
}

export function subtaskScopeIntent(graph, subtaskId) {
  if (!graph?.intentMap) return { writeIntent: null, scopePolicy: null };
  const declaration = graph.intentMap.subtasks?.find(subtask => subtask.id === subtaskId);
  if (!declaration) throw auditError(`Intent Map has no scope declaration for subtask ${subtaskId}.`);
  return { writeIntent: declaration.writeIntent, scopePolicy: graph.intentMap.scopePolicy || 'warn' };
}
