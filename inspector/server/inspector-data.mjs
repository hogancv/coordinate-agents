import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
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
import {
  runtimeSessionFacts,
  runtimeSessionRead,
} from '../../skills/coordinate-agents/scripts/session-service.mjs';
import { observeAgentBus } from '../../skills/coordinate-agents/scripts/agent-observer.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';
import { readRuntimeEvents } from '../../skills/coordinate-agents/scripts/runtime-events.mjs';
import {
  inspectTaskGraphIntegration,
  inspectTaskGraphRecovery,
  listTaskGraphs,
  readTaskGraph,
  taskGraphPath,
  taskGraphSchedulingView,
} from '../../skills/coordinate-agents/scripts/task-graph-runtime.mjs';

const TASK_ID_PATTERN = /\btask-[A-Za-z0-9][A-Za-z0-9_-]{1,127}\b/;
const MAX_EVENT_SCAN = 600;
const MAX_EVENT_DETAILS = 4 * 1024;
const MAX_SPEC_BYTES = 16 * 1024;
const MAX_SESSION_OUTPUT = 8 * 1024;
const MAX_TERMINAL_READ_BYTES = 32 * 1024;
const MAX_TERMINAL_READ_LINES = 200;
const MAX_GRAPH_ITEMS = 256;
const MAX_NESTED_ITEMS = 256;
const MAX_NESTED_KEYS = 64;
const MAX_NESTED_DEPTH = 8;
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

function sanitizeNested(value, {
  depth = 0,
  stringLimit = MAX_EVENT_DETAILS,
  itemLimit = MAX_NESTED_ITEMS,
} = {}) {
  if (value === null || value === undefined || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return bounded(value, stringLimit);
  if (typeof value !== 'object' || depth >= MAX_NESTED_DEPTH) return bounded(value, stringLimit);
  if (Array.isArray(value)) {
    return value.slice(0, itemLimit).map(item => sanitizeNested(item, {
      depth: depth + 1,
      stringLimit,
      itemLimit,
    }));
  }
  return Object.fromEntries(Object.entries(value)
    .slice(0, MAX_NESTED_KEYS)
    .map(([key, item]) => [bounded(key, 256), sanitizeNested(item, {
      depth: depth + 1,
      stringLimit,
      itemLimit,
    })]));
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
    kind: 'task',
    graph: false,
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

function graphSummary(graph) {
  const parent = graph.parentTask;
  const counts = Object.fromEntries([
    'READY', 'WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED',
  ].map(state => [state.toLowerCase(), graph.subtasks.filter(item => item.state === state).length]));
  return {
    kind: 'task-graph-parent',
    graph: true,
    id: graph.parentTaskId,
    parentTaskId: graph.parentTaskId,
    title: parent.title,
    status: graph.state,
    state: graph.state,
    round: 1,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    planner: parent.planner,
    implementer: parent.implementer || null,
    reviewer: parent.reviewer,
    sessionId: null,
    reviewDecision: graph.review?.decision || null,
    maxConcurrency: graph.maxConcurrency,
    subtaskCount: graph.subtasks.length,
    counts,
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

function journalDetails(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const preferred = data.summary || data.message || data.feedback || data.reason || data.subject || data.details;
  if (preferred) return bounded(preferred, MAX_EVENT_DETAILS);
  const entries = Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  return bounded(entries.join(' · '), MAX_EVENT_DETAILS);
}

function inspectorJournalEvent(event) {
  return {
    timestamp: event.timestamp,
    sequence: event.sequence,
    taskId: event.taskId || null,
    sessionId: event.sessionId || null,
    agent: event.agentId || null,
    role: event.role || null,
    messageId: event.messageId || null,
    event: event.type,
    type: event.type,
    details: journalDetails(event),
    data: sanitizeNested(event.data || {}, { stringLimit: MAX_EVENT_DETAILS }),
    source: 'journal',
    recorded: true,
  };
}

function graphAgentFacts(config, implementer) {
  const agent = config.agents.find(item => item.id === implementer);
  if (!agent) return { id: implementer, registered: false, adapter: null };
  return {
    id: agent.id,
    registered: true,
    adapter: bounded(agent.adapter, 512),
  };
}

function graphSubtaskView(config, subtask, recovery) {
  return {
    id: subtask.id,
    subtaskId: subtask.id,
    title: bounded(subtask.title || subtask.id, 2 * 1024),
    spec: bounded(subtask.spec, MAX_SPEC_BYTES),
    state: subtask.state,
    status: subtask.status,
    reason: bounded(subtask.reason, 8 * 1024) || null,
    dependsOn: subtask.dependsOn.slice(0, MAX_GRAPH_ITEMS),
    implementer: subtask.implementer,
    agent: graphAgentFacts(config, subtask.implementer),
    executable: {
      effectiveCommand: bounded(subtask.effectiveCommand || subtask.command, 2 * 1024) || null,
      resolvedCommand: bounded(subtask.resolvedCommand, 2 * 1024) || null,
      source: subtask.effectiveCommand || subtask.command || subtask.resolvedCommand ? 'persisted-graph' : null,
    },
    sessionId: subtask.sessionId || null,
    worktree: {
      path: bounded(subtask.worktreePath, 4 * 1024) || null,
      branch: bounded(subtask.branch, 2 * 1024) || null,
      ref: bounded(subtask.ref, 2 * 1024) || null,
      baseCommit: bounded(subtask.baseCommit, 256) || null,
    },
    implementationCommit: bounded(subtask.implementationCommit, 256) || null,
    evidence: sanitizeNested(subtask.evidence || [], { stringLimit: 8 * 1024, itemLimit: 64 }),
    scopeAudit: sanitizeNested(subtask.scopeEvidence || null, { stringLimit: 4 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    dispatch: sanitizeNested(subtask.dispatch || null, { stringLimit: 4 * 1024 }),
    recovery: sanitizeNested(recovery || subtask.recovery || null, { stringLimit: 4 * 1024 }),
    cleanup: sanitizeNested(subtask.cleanup || null, { stringLimit: 4 * 1024 }),
    lastError: sanitizeNested(subtask.lastError || null, { stringLimit: 4 * 1024 }),
    createdAt: subtask.createdAt || null,
    updatedAt: subtask.updatedAt || null,
  };
}

function graphDetail(root, graph) {
  const bus = busFor(root);
  const config = bus ? readConfig(bus) : { agents: [] };
  const scheduling = taskGraphSchedulingView(graph);
  const recovery = inspectTaskGraphRecovery(root, graph, { probeGit: false });
  const recoveryById = new Map(recovery.map(item => [item.subtaskId, item]));
  const events = recordedEvents(root, { taskId: graph.parentTaskId, limit: 300 });
  const parent = graph.parentTask;
  const subtasks = graph.subtasks.slice(0, MAX_GRAPH_ITEMS)
    .map(item => graphSubtaskView(config, item, recoveryById.get(item.id)));
  const detail = {
    ...graphSummary(graph),
    schemaVersion: graph.schemaVersion,
    spec: bounded(parent.spec, MAX_SPEC_BYTES),
    baseCommit: bounded(graph.baseCommit || parent.baseCommit, 256) || null,
    reason: bounded(graph.reason || parent.reason, 8 * 1024) || null,
    maxConcurrency: graph.maxConcurrency,
    frontier: sanitizeNested(scheduling.frontier, { stringLimit: 4 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    wave: sanitizeNested(scheduling.wave, { stringLimit: 4 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    dependencies: subtasks.flatMap(item => item.dependsOn.map(dependency => ({
      from: dependency,
      to: item.id,
    }))).slice(0, MAX_GRAPH_ITEMS * MAX_GRAPH_ITEMS),
    subtasks,
    intentCoverage: sanitizeNested(graph.intentMap || null, { stringLimit: 4 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    conflicts: sanitizeNested(scheduling.wave?.conflicts || [], { stringLimit: 4 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    recovery: sanitizeNested(recovery, { stringLimit: 4 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    integration: sanitizeNested(graph.integration || null, { stringLimit: 8 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    integrationFacts: sanitizeNested(inspectTaskGraphIntegration(root, graph, { probeGit: false }), { stringLimit: 8 * 1024, itemLimit: MAX_GRAPH_ITEMS }),
    evidence: sanitizeNested(parent.evidence || graph.evidence || [], { stringLimit: 8 * 1024, itemLimit: 64 }),
    review: sanitizeNested(graph.review || null, { stringLimit: 8 * 1024, itemLimit: 64 }),
    reviewHistory: sanitizeNested(graph.reviewHistory || [], { stringLimit: 8 * 1024, itemLimit: 64 }),
    events,
    timeline: events.map(event => ({ ...event, status: null })).sort((a, b) => a.sequence - b.sequence),
    historySource: 'recorded',
    agentFlow: [
      { role: 'planner', agent: parent.planner },
      ...[...new Set(graph.subtasks.map(item => item.implementer))].map(agent => ({ role: 'implementer', agent })),
      { role: 'reviewer', agent: parent.reviewer },
    ],
  };
  return detail;
}

function recordedEvents(root, options = {}) {
  return readRuntimeEvents(root, options).map(inspectorJournalEvent);
}

// Repository identity facts are derived with read-only Git helpers only. Each
// invocation stays bounded (short timeout, capped buffers) and spawns no Agent,
// Session, worktree, or Bus side effect; failures degrade to partial facts so
// the Workspace overview remains usable outside a fully committed repository.
function gitFact(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 512 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function repositoryFacts(root) {
  const headLine = gitFact(root, ['log', '-1', '--format=%h%x1f%s%x1f%cI']);
  const head = headLine
    ? (() => {
      const [shortSha, subject, committedAtRaw] = headLine.split('\x1f');
      const committedAt = typeof committedAtRaw === 'string' && !Number.isNaN(Date.parse(committedAtRaw))
        ? committedAtRaw
        : null;
      return {
        short: bounded(shortSha, 64) || null,
        subject: bounded(subject, 2 * 1024) || null,
        committedAt,
      };
    })()
    : null;
  const branch = bounded(gitFact(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']), 256) || null;
  return {
    root,
    name: bounded(basename(root), 256),
    branch,
    detached: Boolean(head && !branch),
    head,
    remoteUrl: bounded(gitFact(root, ['remote', 'get-url', 'origin']), 2 * 1024) || null,
  };
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
    const sessionEvents = recordedEvents(root, { sessionId: record.id, limit: 200 });
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
      events: sessionEvents.length > 0 ? sessionEvents : [{
        timestamp: current.lastActivityAt || current.createdAt,
        sequence: null,
        taskId: taskIds[0] || null,
        sessionId: current.id,
        agent: current.agent,
        event: `SESSION_${`${current.state || 'unknown'}`.toUpperCase()}`,
        details: 'Historical session state before Event Journal recording.',
        source: 'derived-legacy',
        recorded: false,
      }],
      historySource: sessionEvents.length > 0 ? 'recorded' : 'derived-legacy',
    };
  }));
}

async function readSessionOutput(root, sessionId, {
  cursor = null,
  maxLines = MAX_TERMINAL_READ_LINES,
  maxBytes = MAX_TERMINAL_READ_BYTES,
} = {}) {
  const result = await runtimeSessionRead({
    root,
    sessionId,
    cursor,
    maxLines: Math.min(MAX_TERMINAL_READ_LINES, Math.max(1, Number.isInteger(maxLines) ? maxLines : MAX_TERMINAL_READ_LINES)),
    maxBytes: Math.min(MAX_TERMINAL_READ_BYTES, Math.max(1, Number.isInteger(maxBytes) ? maxBytes : MAX_TERMINAL_READ_BYTES)),
  });
  const output = typeof result.output === 'string' ? result.output : '';
  const session = result.session
    ? {
      ...result.session,
      status: result.session.status || result.session.state || null,
    }
    : null;
  return {
    session,
    output: {
      output: redactOutput(output, MAX_TERMINAL_READ_BYTES),
      nextCursor: Number.isInteger(result.nextCursor) ? result.nextCursor : null,
      truncated: result.truncated === true,
    },
  };
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

function readLegacyEvents(root, { taskId = null, limit = 100 } = {}) {
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
  return sortEvents(filtered)
    .slice(0, Math.min(500, Math.max(1, Number(limit) || 100)))
    .map(event => ({ ...event, sequence: null, sessionId: null, recorded: false, source: `derived-legacy:${event.source}` }));
}

function readEvents(root, options = {}) {
  const recorded = recordedEvents(root, options);
  if (recorded.length > 0) return recorded.sort((a, b) => b.sequence - a.sequence);
  if (options.after !== undefined && options.after !== null) return [];
  if (options.sessionId || options.type) return [];
  return readLegacyEvents(root, options);
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
  const recorded = events.some(event => event.recorded);
  const timeline = events
    .map(event => ({
      ...event,
      status: statusFromEvent(event),
    }))
    .filter(event => recorded || event.status || event.event === 'TASK_CREATED' || event.source.includes('task'))
    .sort((a, b) => recorded ? (a.sequence - b.sequence) : a.timestamp.localeCompare(b.timestamp));
  const hasCurrent = timeline.some(event => event.status === task.status);
  if (!hasCurrent) {
    timeline.push({
      timestamp: task.updatedAt,
      taskId: task.id,
      agent: null,
      event: `TASK_${task.status}`,
      status: task.status,
      details: '',
      source: 'derived-legacy:task',
      recorded: false,
    });
  }
  return timeline;
}

export function createInspectorData(root) {
  const repository = canonicalRoot(root);
  return {
    root: repository,
    readRepository() {
      try {
        return repositoryFacts(repository);
      } catch (error) {
        return {
          root: repository,
          name: bounded(basename(repository), 256),
          branch: null,
          detached: false,
          head: null,
          remoteUrl: null,
          error: bounded(error.message || String(error), 2 * 1024),
        };
      }
    },
    readTasks() {
      return [
        ...readTaskRecords(repository).map(taskSummary),
        ...listTaskGraphs(repository).map(graphSummary),
      ].sort((left, right) => `${right.updatedAt || ''}`.localeCompare(`${left.updatedAt || ''}`));
    },
    readTask(id) {
      const graphPath = taskGraphPath(repository, id);
      if (existsSync(graphPath)) return graphDetail(repository, readTaskGraph(repository, id));
      const task = sanitizeTask(readTask(repository, id));
      let events = recordedEvents(repository, { taskId: task.id, limit: 300 });
      if (events.length > 0 && task.sessionId) {
        const sessionEvents = recordedEvents(repository, { sessionId: task.sessionId, limit: 300 });
        const seen = new Set(events.map(event => event.sequence));
        events = [...events, ...sessionEvents.filter(event => !seen.has(event.sequence))]
          .sort((a, b) => a.sequence - b.sequence)
          .slice(-300);
      }
      if (events.length === 0) events = readLegacyEvents(repository, { taskId: task.id, limit: 300 });
      return {
        ...task,
        timeline: buildTimeline(task, events),
        events,
        historySource: events.some(event => event.recorded) ? 'recorded' : 'derived-legacy',
        agentFlow: [
          { role: 'planner', agent: task.planner },
          { role: 'implementer', agent: task.implementer },
          { role: 'reviewer', agent: task.reviewer },
        ],
      };
    },
    readGraphs() {
      return listTaskGraphs(repository).map(graphSummary);
    },
    readGraph(id) {
      return graphDetail(repository, readTaskGraph(repository, id));
    },
    readAgents() {
      return readAgents(repository);
    },
    async readSessions() {
      return readSessions(repository);
    },
    async readSessionOutput(sessionId, options = {}) {
      return readSessionOutput(repository, sessionId, options);
    },
    readEvents(options = {}) {
      return readEvents(repository, options);
    },
  };
}
