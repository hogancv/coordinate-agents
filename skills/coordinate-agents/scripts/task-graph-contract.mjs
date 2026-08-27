import { RESERVED_DEVICE_NAMES, validateAgentId } from './config.mjs';
import { runtimeError } from './runtime-contract.mjs';
import { validateTaskId } from './task-runtime.mjs';

export const TASK_GRAPH_SCHEMA_VERSION = 1;
export const TASK_GRAPH_MAX_SUBTASKS = 256;
export const TASK_GRAPH_MAX_CONCURRENCY = 32;
export const TASK_GRAPH_MAX_SPEC_BYTES = 256 * 1024;
export const TASK_GRAPH_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const TASK_GRAPH_STATES = Object.freeze(['CREATED', 'RUNNING', 'REVIEWING', 'APPROVED', 'ERROR', 'STOPPED']);
export const TASK_GRAPH_SUBTASK_STATES = Object.freeze(['PENDING', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED']);

const SUBTASK_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

function boundedText(value, limit = 128) {
  return `${value ?? ''}`.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, limit);
}

function invalid(message, options = {}) {
  const details = options.details || (options.subtaskId
    ? { parentTaskId: options.parentTaskId || null, subtaskId: options.subtaskId }
    : null);
  const boundedMessage = `${message || 'Invalid Task Graph v1 input.'}`
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .slice(0, 2 * 1024);
  throw runtimeError('TASK_GRAPH_INVALID', boundedMessage, {
    recoverable: false,
    taskId: options.parentTaskId || null,
    agent: options.agent || null,
    stage: 'graph-validation',
    details,
  });
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, field, parentTaskId = null, subtaskId = null) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key)).sort();
  if (unknown.length > 0) {
    invalid(`Task Graph v1 ${field} contains unknown field "${boundedText(unknown[0])}".`, {
      parentTaskId,
      subtaskId,
    });
  }
}

function requiredString(value, field, { maxLength = 1024, parentTaskId = null, subtaskId = null } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`Task Graph v1 field "${field}" must be a non-empty string.`, { parentTaskId, subtaskId });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    invalid(`Task Graph v1 field "${field}" exceeds the ${maxLength} character limit.`, { parentTaskId, subtaskId });
  }
  return normalized;
}

function requiredAgent(value, field, { parentTaskId = null, subtaskId = null } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`Task Graph v1 field "${field}" must be a non-empty Agent identity.`, { parentTaskId, subtaskId });
  }
  if (value.length > 64) {
    invalid(`Task Graph v1 field "${field}" exceeds the 64 character limit.`, { parentTaskId, subtaskId });
  }
  try {
    return validateAgentId(value);
  } catch {
    invalid(`Task Graph v1 field "${field}" Agent identity "${boundedText(value)}" is malformed.`, { parentTaskId, subtaskId });
  }
}

function validSubtaskId(value) {
  if (typeof value !== 'string' || !SUBTASK_ID_PATTERN.test(value)) return false;
  const lower = value.toLowerCase();
  const base = lower.split('.')[0];
  return !RESERVED_DEVICE_NAMES.has(base) && !RESERVED_DEVICE_NAMES.has(lower);
}

function validateParentTask(input) {
  if (!plainObject(input.parentTask)) {
    invalid('Task Graph v1 requires one parentTask object.');
  }
  rejectUnknownFields(input.parentTask, ['id', 'title', 'spec', 'planner', 'implementer', 'reviewer'], 'parentTask');
  let id;
  try {
    id = validateTaskId(input.parentTask.id);
  } catch {
    invalid('Task Graph v1 parentTask.id must be a valid Task identifier.');
  }
  const parent = {
    id,
    title: requiredString(input.parentTask.title, 'parentTask.title', { parentTaskId: id }),
    planner: requiredAgent(input.parentTask.planner, 'parentTask.planner', { parentTaskId: id }),
    reviewer: requiredAgent(input.parentTask.reviewer, 'parentTask.reviewer', { parentTaskId: id }),
  };
  if (input.parentTask.spec !== undefined) {
    parent.spec = requiredString(input.parentTask.spec, 'parentTask.spec', {
      maxLength: TASK_GRAPH_MAX_SPEC_BYTES,
      parentTaskId: id,
    });
    if (Buffer.byteLength(parent.spec, 'utf8') > TASK_GRAPH_MAX_SPEC_BYTES) {
      invalid(`Task Graph v1 parent specification exceeds ${TASK_GRAPH_MAX_SPEC_BYTES} bytes.`, { parentTaskId: id });
    }
  }
  if (input.parentTask.implementer !== undefined) {
    parent.implementer = requiredAgent(input.parentTask.implementer, 'parentTask.implementer', { parentTaskId: id });
  }
  return parent;
}

function validateConfiguredAgent(agent, configuredAgents, parentTaskId, subtaskId, label = 'Implementer') {
  try {
    validateAgentId(agent);
  } catch {
    invalid(`Task Graph v1 ${label} identity "${boundedText(agent)}" is malformed.`, {
      parentTaskId,
      agent,
      subtaskId: subtaskId || null,
    });
  }
  if (!configuredAgents.has(agent)) {
    invalid(`Task Graph v1 ${label} "${boundedText(agent)}" is unknown or unconfigured.`, {
      parentTaskId,
      agent,
      subtaskId: subtaskId || null,
    });
  }
}

function cyclePath(subtasks) {
  const dependencies = new Map(subtasks.map(subtask => [subtask.id, [...subtask.dependsOn].sort()]));
  const visited = new Set();
  const active = new Set();
  const path = [];

  function visit(id) {
    if (active.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    if (visited.has(id)) return null;
    visited.add(id);
    active.add(id);
    path.push(id);
    for (const dependency of dependencies.get(id) || []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(id);
    return null;
  }

  for (const id of [...dependencies.keys()].sort()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Validate and normalize the additive Task Graph v1 input without performing
 * filesystem, Bus, Adapter, Session, worktree, or process operations.
 */
export function validateTaskGraphV1(input, { configuredAgents = [] } = {}) {
  if (!plainObject(input)) invalid('Task Graph v1 input must be a JSON object.');
  rejectUnknownFields(input, ['schemaVersion', 'parentTask', 'subtasks', 'maxConcurrency'], 'input');
  if (input.schemaVersion !== TASK_GRAPH_SCHEMA_VERSION) {
    invalid(`Unsupported Task Graph schemaVersion: ${boundedText(input.schemaVersion ?? '(missing)')}. Expected 1.`);
  }

  const parentTask = validateParentTask(input);
  let planner;
  let reviewer;
  try {
    planner = validateAgentId(parentTask.planner);
    reviewer = validateAgentId(parentTask.reviewer);
  } catch (error) {
    invalid(`Task Graph v1 parent Task has a malformed Agent identity: ${error.message}`, { parentTaskId: parentTask.id });
  }

  if (!Array.isArray(input.subtasks) || input.subtasks.length === 0) {
    invalid('Task Graph v1 requires at least one subtask.', { parentTaskId: parentTask.id });
  }
  if (input.subtasks.length > TASK_GRAPH_MAX_SUBTASKS) {
    invalid(`Task Graph v1 exceeds the ${TASK_GRAPH_MAX_SUBTASKS} subtask limit.`, { parentTaskId: parentTask.id });
  }
  if (!Number.isInteger(input.maxConcurrency)
    || input.maxConcurrency < 1
    || input.maxConcurrency > TASK_GRAPH_MAX_CONCURRENCY) {
    invalid(`Task Graph v1 maxConcurrency must be an integer from 1 to ${TASK_GRAPH_MAX_CONCURRENCY}.`, {
      parentTaskId: parentTask.id,
    });
  }

  const configuredSource = plainObject(configuredAgents) && Array.isArray(configuredAgents.agents)
    ? configuredAgents.agents
    : configuredAgents;
  if (!Array.isArray(configuredSource) && !(configuredSource instanceof Set)) {
    invalid('Task Graph v1 configuredAgents must be an array or Set of Agent identities.', { parentTaskId: parentTask.id });
  }
  const configuredList = configuredSource instanceof Set ? [...configuredSource] : configuredSource;
  const configured = new Set(configuredList.map(agent => (
    typeof agent === 'string' ? agent : agent?.id
  )).filter(Boolean));
  validateConfiguredAgent(parentTask.planner, configured, parentTask.id, null, 'parent planner');
  validateConfiguredAgent(parentTask.reviewer, configured, parentTask.id, null, 'parent reviewer');
  if (parentTask.implementer) validateConfiguredAgent(parentTask.implementer, configured, parentTask.id, null, 'parent Implementer');
  const ids = new Set();
  const normalized = [];
  for (let index = 0; index < input.subtasks.length; index += 1) {
    const subtask = input.subtasks[index];
    if (!plainObject(subtask)) {
      invalid(`Task Graph v1 subtask at index ${index} must be an object.`, { parentTaskId: parentTask.id });
    }
    rejectUnknownFields(subtask, ['id', 'title', 'implementer', 'spec', 'dependsOn'], `subtask at index ${index}`, parentTask.id, subtask.id || null);
    if (!validSubtaskId(subtask.id)) {
      invalid(`Task Graph v1 subtask at index ${index} has malformed id "${boundedText(subtask.id)}".`, { parentTaskId: parentTask.id });
    }
    if (ids.has(subtask.id)) {
      invalid(`Task Graph v1 contains duplicate subtask id "${subtask.id}".`, { parentTaskId: parentTask.id });
    }
    ids.add(subtask.id);
    const implementer = requiredAgent(subtask.implementer, `subtasks[${index}].implementer`, {
      parentTaskId: parentTask.id,
      subtaskId: subtask.id,
    });
    validateConfiguredAgent(implementer, configured, parentTask.id, subtask.id, `subtask "${subtask.id}" Implementer`);
    const spec = requiredString(subtask.spec, `subtasks[${index}].spec`, {
      maxLength: TASK_GRAPH_MAX_SPEC_BYTES,
      parentTaskId: parentTask.id,
      subtaskId: subtask.id,
    });
    if (Buffer.byteLength(spec, 'utf8') > TASK_GRAPH_MAX_SPEC_BYTES) {
      invalid(`Task Graph v1 subtask "${subtask.id}" specification exceeds ${TASK_GRAPH_MAX_SPEC_BYTES} bytes.`, {
        parentTaskId: parentTask.id,
        subtaskId: subtask.id,
      });
    }
    if (subtask.dependsOn !== undefined && !Array.isArray(subtask.dependsOn)) {
      invalid(`Task Graph v1 subtask "${subtask.id}" dependsOn must be an array.`, { parentTaskId: parentTask.id, subtaskId: subtask.id });
    }
    const dependsOn = subtask.dependsOn === undefined ? [] : [...subtask.dependsOn];
    if ([...dependsOn].some(dependency => !validSubtaskId(dependency))) {
      invalid(`Task Graph v1 subtask "${subtask.id}" has a malformed dependency identifier.`, { parentTaskId: parentTask.id, subtaskId: subtask.id });
    }
    if (new Set(dependsOn).size !== dependsOn.length) {
      invalid(`Task Graph v1 subtask "${subtask.id}" contains a duplicate dependency edge.`, { parentTaskId: parentTask.id, subtaskId: subtask.id });
    }
    if (dependsOn.includes(subtask.id)) {
      invalid(`Task Graph v1 subtask "${subtask.id}" cannot depend on itself.`, { parentTaskId: parentTask.id, subtaskId: subtask.id });
    }
    normalized.push({
      id: subtask.id,
      parentTaskId: parentTask.id,
      ...(subtask.title === undefined ? {} : {
        title: requiredString(subtask.title, `subtasks[${index}].title`, {
          parentTaskId: parentTask.id,
          subtaskId: subtask.id,
        }),
      }),
      implementer,
      spec,
      dependsOn: Object.freeze([...dependsOn].sort()),
      state: 'PENDING',
    });
  }

  for (const subtask of [...normalized].sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))) {
    for (const dependency of subtask.dependsOn) {
      if (!ids.has(dependency)) {
        invalid(`Task Graph v1 subtask "${subtask.id}" references missing dependency "${dependency}".`, {
          parentTaskId: parentTask.id,
          subtaskId: subtask.id,
        });
      }
    }
  }
  const cycle = cyclePath(normalized);
  if (cycle) {
    const boundedCycle = cycle.length > 9
      ? [...cycle.slice(0, 8), '...', cycle.at(-1)]
      : cycle;
    invalid(`Task Graph v1 contains a dependency cycle: ${boundedCycle.join(' -> ')}.`, { parentTaskId: parentTask.id });
  }

  const orderedSubtasks = [...normalized].sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
  return Object.freeze({
    schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
    kind: 'task-graph',
    parentTaskId: parentTask.id,
    state: 'CREATED',
    parentTask: Object.freeze({ ...parentTask, planner, reviewer }),
    maxConcurrency: input.maxConcurrency,
    subtasks: Object.freeze(orderedSubtasks.map(subtask => Object.freeze(subtask))),
  });
}

export function taskGraphDurableFacts(graph) {
  return {
    parent: {
      kind: 'parent-task',
      taskId: graph.parentTask.id,
      planner: graph.parentTask.planner,
      ...(graph.parentTask.implementer === undefined ? {} : { implementer: graph.parentTask.implementer }),
      reviewer: graph.parentTask.reviewer,
      state: graph.state,
      status: graph.state,
      maxConcurrency: graph.maxConcurrency,
    },
    subtasks: graph.subtasks.map(subtask => ({
      kind: 'subtask',
      parentTaskId: graph.parentTask.id,
      subtaskId: subtask.id,
      implementer: subtask.implementer,
      state: subtask.state,
      status: subtask.state,
      dependsOn: [...subtask.dependsOn],
    })),
  };
}

// Descriptive aliases keep the public Runtime contract discoverable without
// introducing a second validation implementation.
export const validateTaskGraph = validateTaskGraphV1;
export const validateTaskGraphInput = validateTaskGraphV1;
