import { runtimeError } from './runtime-contract.mjs';

export const INTENT_MAP_SCHEMA_VERSION = 1;
export const INTENT_MAP_SCOPE_POLICIES = Object.freeze(['observe', 'warn', 'strict']);
export const INTENT_MAP_DEFAULT_SCOPE_POLICY = 'warn';
export const INTENT_MAP_MAX_INPUT_BYTES = 1024 * 1024;
export const INTENT_MAP_MAX_PATTERNS = 4096;
export const INTENT_MAP_MAX_PATTERN_BYTES = 4096;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const WINDOWS_DRIVE = /^[A-Za-z]:/;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, limit = 256) {
  return `${value ?? ''}`.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, limit);
}

function invalid(message, parentTaskId = null, subtaskId = null) {
  throw runtimeError('TASK_GRAPH_INVALID', `${message}`.slice(0, 2 * 1024), {
    recoverable: false,
    taskId: parentTaskId,
    stage: 'intent-map-validation',
    details: subtaskId ? { parentTaskId, subtaskId } : { parentTaskId },
  });
}

function rejectUnknownFields(value, allowed, label, parentTaskId = null, subtaskId = null) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key)).sort();
  if (unknown.length > 0) {
    invalid(`Intent Map v1 ${label} contains unknown field "${bounded(unknown[0])}".`, parentTaskId, subtaskId);
  }
}

/**
 * Normalize one repository-relative path/glob pattern without resolving it
 * against the host filesystem. Backslashes are separators, repeated and dot
 * segments collapse, and parent traversal is always rejected.
 */
export function normalizeWriteIntentPattern(value, { parentTaskId = null, subtaskId = null } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid('Intent Map v1 writeIntent patterns must be non-empty strings.', parentTaskId, subtaskId);
  }
  if (Buffer.byteLength(value, 'utf8') > INTENT_MAP_MAX_PATTERN_BYTES) {
    invalid(`Intent Map v1 writeIntent pattern exceeds ${INTENT_MAP_MAX_PATTERN_BYTES} bytes.`, parentTaskId, subtaskId);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    invalid('Intent Map v1 writeIntent pattern contains a control character.', parentTaskId, subtaskId);
  }
  if (value.startsWith('/') || value.startsWith('\\') || WINDOWS_DRIVE.test(value)) {
    invalid(`Intent Map v1 writeIntent pattern must be repository-relative: "${bounded(value)}".`, parentTaskId, subtaskId);
  }
  if (value.startsWith('!')) {
    invalid(`Intent Map v1 writeIntent pattern cannot use negation: "${bounded(value)}".`, parentTaskId, subtaskId);
  }
  const segments = value.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) {
    invalid(`Intent Map v1 writeIntent pattern cannot escape the repository: "${bounded(value)}".`, parentTaskId, subtaskId);
  }
  const normalized = segments.filter(segment => segment !== '' && segment !== '.').join('/');
  if (!normalized || normalized === '.') {
    invalid(`Intent Map v1 writeIntent pattern is malformed: "${bounded(value)}".`, parentTaskId, subtaskId);
  }
  return normalized;
}

/** Validate and deterministically normalize an optional Intent Map v1. */
export function validateIntentMapV1(input, graph) {
  if (input === undefined || input === null) return null;
  if (!plainObject(graph) || !Array.isArray(graph.subtasks) || typeof graph.parentTaskId !== 'string') {
    invalid('Intent Map v1 requires a validated Task Graph v1 companion.');
  }
  const parentTaskId = graph.parentTaskId;
  if (!plainObject(input)) invalid('Intent Map v1 input must be a JSON object.', parentTaskId);
  let serializedBytes;
  try { serializedBytes = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch {
    invalid('Intent Map v1 input must be JSON-serializable.', parentTaskId);
  }
  if (serializedBytes > INTENT_MAP_MAX_INPUT_BYTES) {
    invalid(`Intent Map v1 exceeds the ${INTENT_MAP_MAX_INPUT_BYTES} byte limit.`, parentTaskId);
  }
  rejectUnknownFields(input, ['schemaVersion', 'parentTaskId', 'scopePolicy', 'subtasks'], 'input', parentTaskId);
  if (input.schemaVersion !== INTENT_MAP_SCHEMA_VERSION) {
    invalid(`Unsupported Intent Map schemaVersion: ${bounded(input.schemaVersion ?? '(missing)')}. Expected 1.`, parentTaskId);
  }
  if (input.parentTaskId !== parentTaskId) {
    invalid(`Intent Map v1 parentTaskId must match Task Graph ${parentTaskId}.`, parentTaskId);
  }
  const scopePolicy = input.scopePolicy === undefined ? INTENT_MAP_DEFAULT_SCOPE_POLICY : input.scopePolicy;
  if (!INTENT_MAP_SCOPE_POLICIES.includes(scopePolicy)) {
    invalid(`Unsupported Intent Map scopePolicy: ${bounded(scopePolicy)}.`, parentTaskId);
  }
  if (!Array.isArray(input.subtasks)) {
    invalid('Intent Map v1 subtasks must be an array.', parentTaskId);
  }

  const graphIds = new Set(graph.subtasks.map(subtask => subtask.id));
  const declarations = new Map();
  const declaredPatterns = new Map();
  let totalPatterns = 0;
  for (let index = 0; index < input.subtasks.length; index += 1) {
    const declaration = input.subtasks[index];
    if (!plainObject(declaration)) {
      invalid(`Intent Map v1 subtask at index ${index} must be an object.`, parentTaskId);
    }
    rejectUnknownFields(declaration, ['id', 'writeIntent'], `subtask at index ${index}`, parentTaskId, declaration.id || null);
    if (typeof declaration.id !== 'string' || !graphIds.has(declaration.id)) {
      invalid(`Intent Map v1 references unknown subtask "${bounded(declaration.id)}".`, parentTaskId, declaration.id || null);
    }
    if (declarations.has(declaration.id)) {
      invalid(`Intent Map v1 contains duplicate subtask declaration "${declaration.id}".`, parentTaskId, declaration.id);
    }
    if (!Array.isArray(declaration.writeIntent)) {
      invalid(`Intent Map v1 subtask "${declaration.id}" writeIntent must be an array.`, parentTaskId, declaration.id);
    }
    totalPatterns += declaration.writeIntent.length;
    if (totalPatterns > INTENT_MAP_MAX_PATTERNS) {
      invalid(`Intent Map v1 exceeds the ${INTENT_MAP_MAX_PATTERNS} pattern limit.`, parentTaskId, declaration.id);
    }
    const patterns = declaration.writeIntent.map(pattern => normalizeWriteIntentPattern(pattern, {
      parentTaskId,
      subtaskId: declaration.id,
    }));
    if (new Set(patterns).size !== patterns.length) {
      invalid(`Intent Map v1 subtask "${declaration.id}" contains duplicate normalized writeIntent patterns.`, parentTaskId, declaration.id);
    }
    for (const pattern of patterns) {
      if (declaredPatterns.has(pattern)) {
        invalid(`Intent Map v1 writeIntent pattern "${bounded(pattern)}" is duplicated by subtasks "${declaredPatterns.get(pattern)}" and "${declaration.id}".`, parentTaskId, declaration.id);
      }
      declaredPatterns.set(pattern, declaration.id);
    }
    declarations.set(declaration.id, Object.freeze({
      id: declaration.id,
      writeIntent: Object.freeze([...patterns].sort()),
    }));
  }

  const missing = [...graphIds].filter(id => !declarations.has(id)).sort();
  if (missing.length > 0) {
    invalid(`Intent Map v1 is missing subtask declaration "${missing[0]}".`, parentTaskId, missing[0]);
  }
  if (declarations.size !== graphIds.size) {
    invalid('Intent Map v1 must cover every Task Graph subtask exactly once.', parentTaskId);
  }

  return Object.freeze({
    schemaVersion: INTENT_MAP_SCHEMA_VERSION,
    parentTaskId,
    scopePolicy,
    subtasks: Object.freeze(graph.subtasks
      .map(subtask => declarations.get(subtask.id))
      .sort((left, right) => (left.id < right.id ? -1 : (left.id > right.id ? 1 : 0)))),
  });
}

export function intentCoverageFacts(graph) {
  const map = graph.intentMap || null;
  if (!map) {
    return {
      available: false,
      schemaVersion: null,
      scopePolicy: null,
      subtasks: graph.subtasks.map(subtask => ({
        subtaskId: subtask.id,
        coverage: 'unavailable',
        writeIntent: null,
      })),
    };
  }
  const declarations = new Map(map.subtasks.map(subtask => [subtask.id, subtask]));
  return {
    available: true,
    schemaVersion: map.schemaVersion,
    scopePolicy: map.scopePolicy,
    subtasks: graph.subtasks.map(subtask => {
      const writeIntent = [...declarations.get(subtask.id).writeIntent];
      return {
        subtaskId: subtask.id,
        coverage: writeIntent.length === 0 ? 'explicit-empty' : 'declared',
        writeIntent,
      };
    }),
  };
}
