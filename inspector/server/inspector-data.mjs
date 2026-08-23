import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  assertSafePath,
  readConfig,
  readInternalFile,
  safeInternalStat,
} from '../../skills/coordinate-agents/scripts/config.mjs';
import {
  listTasks,
  readTask,
  TASK_STATUSES,
} from '../../skills/coordinate-agents/scripts/task-runtime.mjs';
import {
  listRecords,
} from '../../skills/coordinate-agents/scripts/session-manager.mjs';
import { runtimeSessionFacts } from '../../skills/coordinate-agents/scripts/session-service.mjs';
import { observeAgentBus } from '../../skills/coordinate-agents/scripts/agent-observer.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

const TASK_ID_PATTERN = /\btask-[A-Za-z0-9][A-Za-z0-9_-]{1,127}\b/;
const MAX_EVENT_SCAN = 600;
const MAX_EVENT_DETAILS = 4 * 1024;
const MAX_SPEC_BYTES = 16 * 1024;
const MAX_SESSION_OUTPUT = 8 * 1024;
const EMPTY_ARRAY = Object.freeze([]);

function canonicalRoot(root) {
  const candidate = resolve(`${root || process.cwd()}`);
  const metadata = lstatSync(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Inspector root is not a regular directory: ${candidate}`);
  }
  return realpathSync(candidate);
}

function busFor(root) {
  const bus = join(root, '.agent-bus');
  if (!existsSync(bus)) return null;
  assertSafePath(root, bus);
  const metadata = lstatSync(bus);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe Agent Bus root: ${bus}`);
  }
  return bus;
}

function bounded(value, limit = MAX_EVENT_DETAILS) {
  if (value === null || value === undefined) return '';
  return redactOutput(`${value}`, limit);
}

function validTimestamp(value, fallback = Date.now()) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return new Date(Number.isFinite(fallback) ? fallback : Date.now()).toISOString();
}

function taskIdFrom(value) {
  return `${value || ''}`.match(TASK_ID_PATTERN)?.[0] || null;
}

function readJson(bus, path) {
  safeInternalStat(bus, path);
  return JSON.parse(readInternalFile(bus, path));
}

function filesIn(bus, segments, extension) {
  const directory = join(bus, ...segments);
  try {
    assertSafePath(bus, directory);
    if (!existsSync(directory)) return EMPTY_ARRAY;
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return EMPTY_ARRAY;
    return readdirSync(directory)
      .filter(name => !extension || name.endsWith(extension))
      .sort()
      .slice(-MAX_EVENT_SCAN)
      .map(name => join(directory, name));
  } catch {
    return EMPTY_ARRAY;
  }
}

function parseFrontMatter(content) {
  const match = `${content}`.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  return { fields, body: match[2].trim() };
}

function safeReadMessage(bus, path) {
  try {
    const metadata = safeInternalStat(bus, path);
    const parsed = parseFrontMatter(readInternalFile(bus, path));
    if (!parsed) return null;
    return { ...parsed, modifiedAt: metadata.mtimeMs };
  } catch {
    return null;
  }
}

function safeReadState(bus, path) {
  try {
    const metadata = safeInternalStat(bus, path);
    const record = readJson(bus, path);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    return { record, modifiedAt: metadata.mtimeMs };
  } catch {
    return null;
  }
}

function sanitizeError(error) {
  if (!error || typeof error !== 'object') return error || null;
  const result = { ...error };
  for (const key of ['message', 'details', 'command', 'root']) {
    if (result[key] !== undefined && result[key] !== null) {
      result[key] = bounded(typeof result[key] === 'string' ? result[key] : JSON.stringify(result[key]), 2 * 1024);
    }
  }
  return result;
}

function sanitizeTask(task) {
  return {
    ...task,
    spec: bounded(task.spec, MAX_SPEC_BYTES),
    evidence: Array.isArray(task.evidence)
      ? task.evidence.map(item => ({
        ...item,
        details: bounded(item?.details, 8 * 1024),
      }))
      : [],
    reviewFeedback: task.reviewFeedback ? bounded(task.reviewFeedback, 8 * 1024) : task.reviewFeedback || null,
    reviewHistory: Array.isArray(task.reviewHistory)
      ? task.reviewHistory.map(item => ({
        ...item,
        feedback: bounded(item?.feedback, 8 * 1024),
      }))
      : [],
    lastError: sanitizeError(task.lastError),
  };
}

function readTaskRecords(root) {
  if (!busFor(root)) return [];
  return listTasks(root).map(sanitizeTask);
}

function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    round: task.round,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    planner: task.planner,
    implementer: task.implementer,
    reviewer: task.reviewer,
    sessionId: task.sessionId || null,
    reviewDecision: task.reviewDecision || null,
  };
}

function rolesFor(config, agentId) {
  return Object.entries(config.workflow || {})
    .filter(([, configuredAgent]) => configuredAgent === agentId)
    .map(([role]) => role);
}

function readAgents(root) {
  const bus = busFor(root);
  if (!bus) return [];
  const config = readConfig(bus);
  return config.agents.map(agent => {
    let observation = null;
    try {
      observation = observeAgentBus(bus, agent.id);
    } catch (error) {
      observation = { error: bounded(error.message || String(error), 2 * 1024) };
    }
    const roles = rolesFor(config, agent.id);
    const state = observation?.state || null;
    const pending = (observation?.pendingNew || 0) + (observation?.pendingProcessing || 0);
    return {
      id: agent.id,
      role: roles.join(' / ') || null,
      roles,
      adapter: agent.adapter,
      status: state?.state || (pending > 0 ? 'WAITING' : 'IDLE'),
      lastActivity: state?.updated_at || null,
      details: bounded(state?.details || observation?.error || '', 2 * 1024) || null,
      relatedCommit: state?.related_commit || null,
      queue: {
        new: observation?.pendingNew || 0,
        processing: observation?.pendingProcessing || 0,
      },
    };
  });
}

function readSessions(root, tasks = readTaskRecords(root)) {
  const bus = busFor(root);
  if (!bus || !existsSync(join(bus, 'sessions'))) return Promise.resolve([]);
  let records;
  try {
    records = listRecords(root);
  } catch {
    return Promise.resolve([]);
  }
  return Promise.all(records.map(async record => {
    let current = record;
    let recentOutput = '';
    try {
      const facts = await runtimeSessionFacts(root, record.id, { includeOutput: true });
      current = facts;
      recentOutput = facts.output?.output || '';
    } catch (error) {
      current = {
        ...record,
        state: 'failed',
        error: bounded(error.message || String(error), 2 * 1024),
      };
    }
    const taskIds = tasks
      .filter(task => task.sessionId === record.id)
      .map(task => task.id);
    return {
      sessionId: current.id,
      id: current.id,
      agent: current.agent,
      status: current.state,
      createdAt: current.createdAt,
      lastActivity: current.lastActivityAt || null,
      recentOutput: bounded(recentOutput, MAX_SESSION_OUTPUT),
      taskIds,
      exitCode: current.exitCode ?? null,
      signal: current.signal || null,
      error: current.error ? bounded(current.error, 2 * 1024) : null,
    };
  }));
}

function taskEvents(tasks) {
  const events = [];
  for (const task of tasks) {
    events.push({
      timestamp: task.createdAt,
      taskId: task.id,
      agent: task.planner,
      event: 'TASK_CREATED',
      details: bounded(task.title, MAX_EVENT_DETAILS),
      source: 'task',
    });
    if (task.updatedAt !== task.createdAt) {
      events.push({
        timestamp: task.updatedAt,
        taskId: task.id,
        agent: null,
        event: `TASK_${task.status}`,
        details: bounded(task.title, MAX_EVENT_DETAILS),
        source: 'task',
      });
    }
    for (const review of task.reviewHistory || []) {
      events.push({
        timestamp: validTimestamp(review.decidedAt, Date.parse(task.updatedAt)),
        taskId: task.id,
        agent: task.reviewer,
        event: review.decision || 'REVIEW_DECISION',
        details: bounded(review.feedback || review.evidence || '', MAX_EVENT_DETAILS),
        source: 'task',
      });
    }
    for (const evidence of task.evidence || []) {
      events.push({
        timestamp: validTimestamp(evidence.createdAt, Date.parse(task.updatedAt)),
        taskId: task.id,
        agent: task.implementer,
        event: evidence.type || 'EVIDENCE_RECORDED',
        details: bounded(evidence.details || evidence.relatedCommit || '', MAX_EVENT_DETAILS),
        source: 'task',
      });
    }
  }
  return events;
}

function stateEvents(root, bus) {
  const events = [];
  for (const agent of readConfig(bus).agents) {
    for (const path of filesIn(bus, ['state', agent.id], '.json')) {
      const parsed = safeReadState(bus, path);
      if (!parsed) continue;
      const record = parsed.record;
      events.push({
        timestamp: validTimestamp(record.updated_at, parsed.modifiedAt),
        taskId: taskIdFrom(`${record.details || ''} ${record.related_commit || ''}`),
        agent: record.agent || agent.id,
        event: record.state || 'AGENT_STATE',
        details: bounded(record.details || '', MAX_EVENT_DETAILS),
        source: 'agent-state',
      });
    }
  }
  return events;
}

function messageEvents(bus) {
  const events = [];
  const inbox = join(bus, 'inbox');
  let agents;
  try {
    assertSafePath(bus, inbox);
    if (!existsSync(inbox) || !lstatSync(inbox).isDirectory()) return events;
    agents = readdirSync(inbox);
  } catch {
    return events;
  }
  for (const agent of agents) {
    for (const stage of ['new', 'processing', 'processed']) {
      for (const path of filesIn(bus, ['inbox', agent, stage], '.md')) {
        const parsed = safeReadMessage(bus, path);
        if (!parsed) continue;
        const { fields, body, modifiedAt } = parsed;
        events.push({
          timestamp: validTimestamp(fields.created_at, modifiedAt),
          taskId: taskIdFrom(`${fields.dedupe_key || ''} ${fields.subject || ''} ${body}`),
          agent: fields.from || fields.to || agent,
          from: fields.from || null,
          to: fields.to || null,
          event: fields.type || 'BUS_MESSAGE',
          details: bounded(`${fields.subject || ''}${body ? `\n${body}` : ''}`, MAX_EVENT_DETAILS),
          source: 'agent-bus',
          messageId: fields.id || basename(path),
        });
      }
    }
  }
  return events;
}

function errorEvents(bus) {
  const events = [];
  for (const path of filesIn(bus, ['logs'], '.json')) {
    try {
      const parsed = safeReadState(bus, path);
      if (!parsed) continue;
      const record = parsed.record;
      if (!/ERROR/i.test(`${record.type || ''} ${basename(path)}`) && !record.code && !record.error) continue;
      events.push({
        timestamp: validTimestamp(record.timestamp || record.createdAt || record.updated_at, parsed.modifiedAt),
        taskId: taskIdFrom(`${record.taskId || ''} ${record.details || ''}`),
        agent: record.agent || null,
        event: record.code || 'ERROR',
        details: bounded(record.details || record.message || record.stderrTail || '', MAX_EVENT_DETAILS),
        source: 'error-log',
      });
    } catch {
      // Malformed diagnostics are ignored just like the existing recovery
      // inspection path; the authoritative Task error remains readable.
    }
  }
  return events;
}

function sortEvents(events) {
  return events
    .filter(event => event && event.timestamp && !Number.isNaN(Date.parse(event.timestamp)))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function readEvents(root, { taskId = null, limit = 100 } = {}) {
  const bus = busFor(root);
  if (!bus) return [];
  const tasks = readTaskRecords(root);
  const events = [
    ...taskEvents(tasks),
    ...stateEvents(root, bus),
    ...messageEvents(bus),
    ...errorEvents(bus),
  ];
  const filtered = taskId ? events.filter(event => event.taskId === taskId) : events;
  return sortEvents(filtered).slice(0, Math.min(500, Math.max(1, Number(limit) || 100)));
}

function statusFromEvent(event) {
  if (TASK_STATUSES.includes(event.event)) return event.event;
  if (event.event.startsWith('TASK_')) {
    const candidate = event.event.slice('TASK_'.length);
    if (TASK_STATUSES.includes(candidate)) return candidate;
  }
  if (event.event === 'REVIEW_APPROVED') return 'APPROVED';
  if (event.event === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  return null;
}

function buildTimeline(task, events) {
  const timeline = events
    .map(event => ({
      ...event,
      status: statusFromEvent(event),
    }))
    .filter(event => event.status || event.event === 'TASK_CREATED' || event.source === 'task')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const hasCurrent = timeline.some(event => event.status === task.status);
  if (!hasCurrent) {
    timeline.push({
      timestamp: task.updatedAt,
      taskId: task.id,
      agent: null,
      event: `TASK_${task.status}`,
      status: task.status,
      details: '',
      source: 'task',
    });
  }
  return timeline;
}

export function createInspectorData(root) {
  const repository = canonicalRoot(root);
  return {
    root: repository,
    readTasks() {
      return readTaskRecords(repository).map(taskSummary);
    },
    readTask(id) {
      const task = sanitizeTask(readTask(repository, id));
      const events = readEvents(repository, { taskId: task.id, limit: 300 });
      return {
        ...task,
        timeline: buildTimeline(task, events),
        events,
        agentFlow: [
          { role: 'planner', agent: task.planner },
          { role: 'implementer', agent: task.implementer },
          { role: 'reviewer', agent: task.reviewer },
        ],
      };
    },
    readAgents() {
      return readAgents(repository);
    },
    async readSessions() {
      return readSessions(repository);
    },
    readEvents(options = {}) {
      return readEvents(repository, options);
    },
  };
}
