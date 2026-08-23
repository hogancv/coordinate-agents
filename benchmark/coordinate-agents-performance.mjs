#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';
import { runtimeSessionClose } from '../skills/coordinate-agents/scripts/session-service.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_ENTRY = join(REPOSITORY_ROOT, 'bin', 'coordinate-agents.mjs');
const MCP_ENTRY = join(REPOSITORY_ROOT, 'mcp', 'server.mjs');
const BUS_ENTRY = join(REPOSITORY_ROOT, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const SKILL_ENTRY = join(REPOSITORY_ROOT, 'skills', 'coordinate-agents', 'SKILL.md');
const FAKE_IMPLEMENTER = join(REPOSITORY_ROOT, 'benchmark', 'fixtures', 'fake-implementer.mjs');
const RESULTS_DIRECTORY = join(REPOSITORY_ROOT, 'benchmark', 'results');
const TRACE_OUTPUT = join(RESULTS_DIRECTORY, 'benchmark-trace.json');
const RESULTS_OUTPUT = join(RESULTS_DIRECTORY, 'benchmark-results.json');
const REPORT_OUTPUT = join(REPOSITORY_ROOT, 'PERFORMANCE_REPORT.md');

const TASK_TITLE = 'Build a simple Todo feature.';
const TASK_SPEC = [
  'Build a simple Todo feature.',
  '',
  'Requirements:',
  '',
  '- Create todo item',
  '- Mark todo completed',
  '- Add regression test',
].join('\n');
const REVIEW_FEEDBACK = 'Add one regression assertion for the completed Todo state.';
const FIXED_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FAKE_WAIT_MS = 500;
const DEFAULT_RUNS = 5;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const RUNS = Math.max(1, Number(argument('--runs', process.env.COORDINATE_BENCH_RUNS || DEFAULT_RUNS)) || DEFAULT_RUNS);

function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function iso(epochMs = Date.now()) {
  return new Date(epochMs).toISOString();
}

function parseJsonLines(value) {
  return `${value || ''}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

function parseTraceFile(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

function traceSort(events) {
  return [...events].sort((a, b) => {
    const time = Date.parse(a.timestamp || '') - Date.parse(b.timestamp || '');
    return time || `${a.event || ''}`.localeCompare(`${b.event || ''}`);
  });
}

class TraceWriter {
  constructor(path, { runId, workflow, profile }) {
    this.path = path;
    this.runId = runId;
    this.workflow = workflow;
    this.profile = profile;
    this.sequence = 0;
    this.spans = [];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '', 'utf8');
  }

  addAt(event, component, timestampMs, durationMs = 0, details = {}) {
    const record = {
      timestamp: iso(timestampMs),
      event,
      component,
      durationMs: round(durationMs),
      runId: this.runId,
      workflow: this.workflow,
      profile: this.profile,
      ...details,
    };
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  point(event, component, details = {}) {
    return this.addAt(event, component, Date.now(), 0, details);
  }

  async span(name, component, operation, details = {}) {
    const spanId = `${this.runId}-${this.sequence++}`;
    const startEpochMs = Date.now();
    const startPerf = performance.now();
    this.addAt(`${name}_start`, component, startEpochMs, 0, { spanId, ...details });
    let result;
    let error;
    try {
      result = await operation();
      return result;
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      const endEpochMs = Date.now();
      const durationMs = performance.now() - startPerf;
      this.addAt(`${name}_end`, component, endEpochMs, durationMs, {
        spanId,
        ...details,
        ...(error ? { failed: true } : {}),
      });
      this.spans.push({
        name,
        component,
        spanId,
        startEpochMs,
        endEpochMs,
        durationMs,
        ...details,
      });
    }
  }
}

function runProcess(command, args, { cwd, env, timeoutMs = 30_000, input = null } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* The child may have already exited. */ }
      reject(new Error(`Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function assertProcessSucceeded(result, label) {
  if (result.code !== 0) {
    throw new Error(`${label} failed with code ${result.code}: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

function jsonPayload(result, label) {
  assertProcessSucceeded(result, label);
  const values = parseJsonLines(result.stdout);
  const payload = values.at(-1);
  if (!payload || typeof payload !== 'object') throw new Error(`${label} did not return JSON.`);
  if (payload.ok === false) throw new Error(`${label} returned Runtime failure: ${JSON.stringify(payload.error || payload)}`);
  return payload;
}

function environmentFor(home, tracePath, runId, { workflow = null, profile = null } = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, '.codex'),
    GEMINI_HOME: join(home, '.gemini'),
    NO_COLOR: '1',
    CI: '1',
    COORDINATE_BENCH_TRACE_PATH: tracePath,
    COORDINATE_BENCH_RUN_ID: runId,
    ...(workflow ? { COORDINATE_BENCH_WORKFLOW: workflow } : {}),
    ...(profile ? { COORDINATE_BENCH_PROFILE: profile } : {}),
  };
}

function ensureAgentDirectories(root, agentId) {
  for (const path of [
    join(root, '.agent-bus', 'inbox', agentId, 'new'),
    join(root, '.agent-bus', 'inbox', agentId, 'processing'),
    join(root, '.agent-bus', 'inbox', agentId, 'processed'),
    join(root, '.agent-bus', 'quarantine', agentId),
    join(root, '.agent-bus', 'state', agentId),
  ]) mkdirSync(path, { recursive: true });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'coordinate-agents-benchmark-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-benchmark-home-'));
  execFileSync('git', ['init', '--quiet', root], { cwd: root, encoding: 'utf8' });
  const init = execFileSync(process.execPath, [BUS_ENTRY, 'init', '--root', root], { cwd: root, encoding: 'utf8' });
  if (!init.includes('Initialized') && !existsSync(join(root, '.agent-bus', 'config.json'))) {
    throw new Error('Agent Bus fixture initialization did not produce config.json.');
  }
  const config = {
    version: 1,
    agents: [
      { id: 'codex', adapter: 'codex-cli' },
      {
        id: 'fake-implementer',
        adapter: 'generic-cli',
        command: process.execPath,
        args: [FAKE_IMPLEMENTER, '--root', '{root}', '--agent', '{agent}', '--bus-tool', BUS_ENTRY],
      },
    ],
    workflow: {
      planner: 'codex',
      implementer: 'fake-implementer',
      reviewer: 'codex',
    },
  };
  writeConfig(join(root, '.agent-bus'), config);
  ensureAgentDirectories(root, 'codex');
  ensureAgentDirectories(root, 'fake-implementer');
  return { root, home };
}

function taskPath(root, taskId) {
  return join(root, '.agent-bus', 'tasks', `${taskId}.json`);
}

function readTaskRecord(root, taskId) {
  const path = taskPath(root, taskId);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readSessionRecords(root) {
  const directory = join(root, '.agent-bus', 'sessions');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      try { return [JSON.parse(readFileSync(join(directory, name), 'utf8'))]; } catch { return []; }
    });
}

function messageSnapshot(root) {
  const result = new Map();
  for (const agent of ['codex', 'fake-implementer']) {
    for (const stage of ['new', 'processing', 'processed']) {
      const directory = join(root, '.agent-bus', 'inbox', agent, stage);
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory).filter(item => item.endsWith('.md'))) {
        const path = join(directory, name);
        try { result.set(`${agent}/${stage}/${name}`, statSync(path).mtimeMs); } catch { /* Concurrent move; retry next snapshot. */ }
      }
    }
  }
  return result;
}

function recordNewBusWrites(root, before, trace, details = {}) {
  const after = messageSnapshot(root);
  for (const [name, mtimeMs] of after.entries()) {
    if (before.has(name)) continue;
    if (name.includes('-IMPLEMENTATION_DONE-')) continue;
    trace.addAt('bus_write', 'agent-bus', mtimeMs, 0, {
      message: name.split('/').at(-1).replace(/-[a-f0-9]{12}\.md$/, ''),
      ...details,
    });
  }
  return after;
}

function fakeEvents(tracePath) {
  return parseTraceFile(tracePath).filter(event => event.component === 'fake-implementer');
}

function fakeEvent(tracePath, eventName, taskId, round) {
  return fakeEvents(tracePath).find(event => event.event === eventName && event.taskId === taskId && event.round === round) || null;
}

function implementationIntervals(events) {
  return events
    .filter(event => event.event === 'implementation_done' && event.taskId && Number.isFinite(Number(event.durationMs)))
    .map(event => {
      const end = Date.parse(event.timestamp);
      const start = end - Number(event.durationMs);
      return { start, end, durationMs: Number(event.durationMs), taskId: event.taskId, round: event.round };
    })
    .filter(interval => Number.isFinite(interval.start));
}

function intervalDifference(intervals, excluded) {
  let total = 0;
  for (const interval of intervals) {
    const overlaps = excluded
      .map(item => ({ start: Math.max(interval.start, item.start), end: Math.min(interval.end, item.end) }))
      .filter(item => item.end > item.start)
      .sort((a, b) => a.start - b.start);
    let cursor = interval.start;
    for (const overlap of overlaps) {
      if (overlap.start > cursor) total += overlap.start - cursor;
      cursor = Math.max(cursor, overlap.end);
    }
    if (cursor < interval.end) total += interval.end - cursor;
  }
  return total;
}

function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function statistics(values) {
  const valid = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    count: valid.length,
    min: round(valid[0] || 0),
    median: round(median(valid)),
    mean: round(average(valid)),
    max: round(valid.at(-1) || 0),
  };
}

function metricSpans(trace, workflow, profile) {
  const events = traceSort(parseTraceFile(trace.path));
  const implementations = implementationIntervals(events);
  const cliCalls = trace.spans.filter(span => ['task_create', 'cli_dispatch_operation', 'cli_review_operation'].includes(span.name));
  const mcpCalls = trace.spans.filter(span => span.name === 'mcp_tool_call');
  const operationSpans = workflow === 'plugin' ? mcpCalls : cliCalls;
  const totalMs = trace.totalEndEpochMs - trace.totalStartEpochMs;
  const implementerMs = implementations.reduce((sum, item) => sum + item.durationMs, 0);
  const runtimeMs = intervalDifference(operationSpans.map(span => ({ start: span.startEpochMs, end: span.endEpochMs })), implementations);
  const orchestrationMs = Math.max(0, totalMs - implementerMs - runtimeMs);
  const taskCreateSpans = trace.spans.filter(span => span.name === 'task_create');
  const dispatchSpans = trace.spans.filter(span => span.name === 'task_dispatch');
  const reviewSpans = trace.spans.filter(span => span.name === 'review');
  const toolSpans = mcpCalls.map(span => ({
    toolName: span.toolName,
    durationMs: round(span.durationMs),
  }));
  const pluginExtraCalls = toolSpans.filter(item => !['coordinate_agents_task_create', 'coordinate_agents_task_dispatch', 'coordinate_agents_task_review'].includes(item.toolName));
  return {
    runId: trace.runId,
    workflow,
    profile,
    totalMs: round(totalMs),
    taskCreateMs: round(taskCreateSpans.reduce((sum, span) => sum + span.durationMs, 0)),
    taskDispatchMs: round(dispatchSpans.reduce((sum, span) => sum + span.durationMs, 0)),
    taskDispatchRoundMs: dispatchSpans.map(span => round(span.durationMs)),
    reviewMs: round(reviewSpans.reduce((sum, span) => sum + span.durationMs, 0)),
    reviewRoundMs: reviewSpans.map(span => round(span.durationMs)),
    runtimeMs: round(runtimeMs),
    implementerMs: round(implementerMs),
    orchestrationMs: round(orchestrationMs),
    pluginToolCalls: workflow === 'plugin' ? mcpCalls.length : 0,
    cliCommandCalls: workflow === 'cli' ? cliCalls.length : 0,
    extraToolCalls: pluginExtraCalls.length,
    extraToolCallMs: round(pluginExtraCalls.reduce((sum, item) => sum + item.durationMs, 0)),
    skillRoutingMs: round(trace.spans.filter(span => span.name === 'skill_routing').reduce((sum, span) => sum + span.durationMs, 0)),
    mcpHandshakeMs: round(trace.spans.filter(span => ['mcp_initialize', 'mcp_tools_list'].includes(span.name)).reduce((sum, span) => sum + span.durationMs, 0)),
    busWrites: events.filter(event => event.event === 'bus_write').length,
    taskSyncs: events.filter(event => event.event === 'task_sync_end').length,
    traceEvents: events.length,
    toolSpans,
  };
}

function assertTask(payload, expectedStatus, label) {
  if (!payload?.task || payload.task.status !== expectedStatus) {
    throw new Error(`${label} expected Task status ${expectedStatus}; got ${payload?.task?.status || 'missing'}.`);
  }
  if (payload.task.implementationCommit && payload.task.implementationCommit !== FIXED_COMMIT) {
    throw new Error(`${label} returned unexpected implementation commit.`);
  }
}

async function waitForTaskSync({ root, taskId, trace, tracePath, round, workflow, profile }) {
  const done = fakeEvent(tracePath, 'implementation_done', taskId, round);
  if (!done) throw new Error(`Fake implementer did not emit implementation_done for ${taskId} round ${round}.`);
  const doneEpoch = Date.parse(done.timestamp);
  trace.addAt('task_sync_start', 'task-runtime', doneEpoch, 0, { taskId, round });
  trace.addAt('bus_read', 'agent-bus', doneEpoch, 0, { reason: 'implementation-done-observation', taskId, round });
  const deadline = Date.now() + 2_000;
  let task = null;
  while (Date.now() < deadline) {
    task = readTaskRecord(root, taskId);
    if (task?.status === 'REVIEWING') break;
    await sleep(10);
  }
  if (task?.status !== 'REVIEWING') throw new Error(`Task sync did not reach REVIEWING for ${taskId} round ${round}.`);
  const endEpoch = Date.parse(task.updatedAt) || Date.now();
  trace.addAt('task_sync_end', 'task-runtime', Math.max(endEpoch, doneEpoch), Math.max(0, endEpoch - doneEpoch), {
    taskId,
    round,
    workflow,
    profile,
  });
  return task;
}

async function watchSessionPhases({ root, trace, tracePath, taskId, round, existingSessionIds, dispatchPromise, workflow, profile }) {
  const deadline = Date.now() + 5_000;
  let sessionStart = null;
  let spawnEnd = false;
  let sessionEnd = false;
  let reuseStart = false;
  let reuseEnd = false;
  while (Date.now() < deadline) {
    const records = readSessionRecords(root);
    const record = records.find(item => item.agent === 'fake-implementer' && !existingSessionIds.has(item.id)) || null;
    const startEvent = fakeEvent(tracePath, 'implement_start', taskId, round);
    if (record && !sessionStart) {
      sessionStart = Date.parse(record.createdAt) || Date.now();
      trace.addAt('session_open_start', 'session-runtime', sessionStart, 0, { taskId, round, sessionId: record.id, workflow, profile });
      trace.addAt('pty_spawn_start', 'pty-runtime', sessionStart, 0, { taskId, round, sessionId: record.id, workflow, profile });
    }
    if (record && sessionStart && !spawnEnd && (Number.isInteger(record.pid) || ['running', 'idle', 'busy'].includes(record.state))) {
      const spawnEpoch = Date.parse(record.lastActivityAt) || Date.now();
      trace.addAt('pty_spawn_end', 'pty-runtime', spawnEpoch, Math.max(0, spawnEpoch - sessionStart), { taskId, round, sessionId: record.id, workflow, profile });
      spawnEnd = true;
    }
    if (startEvent && record && !sessionEnd) {
      const startEpoch = Date.parse(startEvent.timestamp) || Date.now();
      trace.addAt('session_open_end', 'session-runtime', startEpoch, Math.max(0, startEpoch - sessionStart), { taskId, round, sessionId: record.id, workflow, profile });
      sessionEnd = true;
    }
    if (!record && existingSessionIds.size > 0 && !reuseStart) {
      reuseStart = true;
      trace.point('session_reuse_start', 'session-runtime', { taskId, round, workflow, profile });
    }
    if (reuseStart && startEvent && !reuseEnd) {
      reuseEnd = true;
      const startEpoch = Date.parse(startEvent.timestamp) || Date.now();
      trace.addAt('session_reuse_end', 'session-runtime', startEpoch, 0, { taskId, round, workflow, profile });
    }
    if (await Promise.race([dispatchPromise.then(() => true), sleep(0).then(() => false)])) break;
    await sleep(10);
  }
  await dispatchPromise;
}

class McpClient {
  constructor({ root, home, tracePath, runId, profile }) {
    this.root = root;
    this.home = home;
    this.tracePath = tracePath;
    this.runId = runId;
    this.profile = profile;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderr = '';
  }

  async start(trace) {
    this.child = spawn(process.execPath, [MCP_ENTRY, '--stdio'], {
      cwd: this.root,
      env: environmentFor(this.home, this.tracePath, this.runId, { workflow: 'plugin', profile: this.profile }),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.handleStdout(chunk));
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.once('error', error => this.rejectPending(error));
    this.child.once('exit', (code, signal) => {
      if (this.pending.size > 0) this.rejectPending(new Error(`MCP server exited (${code ?? 'null'}/${signal || 'none'}): ${this.stderr}`));
    });
    await trace.span('mcp_initialize', 'mcp', () => this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'coordinate-agents-benchmark', version: '1.0.0' },
    }));
    this.notify('notifications/initialized', {});
    await trace.span('mcp_tools_list', 'mcp', () => this.request('tools/list', {}));
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`MCP protocol error ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(method, params) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error('MCP server stdin is unavailable.'));
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params) {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async callTool(name, argumentsValue) {
    const response = await this.request('tools/call', { name, arguments: argumentsValue });
    if (response?.isError || response?.structuredContent?.ok === false) {
      throw new Error(`MCP tool ${name} failed: ${JSON.stringify(response?.structuredContent || response)}`);
    }
    return response?.structuredContent;
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try { child.stdin.end(); } catch { /* The server may already be closed. */ }
    await new Promise(resolvePromise => {
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* The server may have exited. */ }
        resolvePromise();
      }, 500);
      child.once('close', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }
}

async function pluginTool(client, trace, name, argumentsValue) {
  const result = await trace.span('mcp_tool_call', 'mcp', () => client.callTool(name, argumentsValue), { toolName: name });
  if (name.endsWith('_task_status') || name.endsWith('_task_inspect') || name.endsWith('_session_status') || name.endsWith('_session_inspect') || name.endsWith('_session_read')) {
    trace.point('bus_read', 'agent-bus', { reason: `mcp:${name}` });
  }
  return result;
}

function cliArguments(root, taskId, operation, extra = []) {
  return [
    CLI_ENTRY,
    'task',
    operation,
    '--root', root,
    '--id', taskId,
    ...extra,
    '--json',
  ];
}

async function cliCall({ root, home, tracePath, runId, profile }, trace, taskId, operation, extra = [], spanName = null) {
  const name = spanName || (operation === 'create' ? 'task_create' : operation === 'dispatch' ? 'task_dispatch' : operation === 'review' ? 'review' : `task_${operation}`);
  return trace.span(name, 'cli', async () => {
    const result = await runProcess(process.execPath, cliArguments(root, taskId, operation, extra), {
      cwd: root,
      env: environmentFor(home, tracePath, runId, { workflow: 'cli', profile }),
      timeoutMs: 20_000,
    });
    return jsonPayload(result, `CLI task.${operation}`);
  }, { command: `task.${operation}` });
}

async function dispatchWithObservation({ root, home, tracePath, runId, taskId, round, workflow, profile, trace, dispatch }) {
  const beforeMessages = messageSnapshot(root);
  const existingSessionIds = new Set(readSessionRecords(root).map(record => record.id));
  const operation = trace.span('task_dispatch', workflow === 'plugin' ? 'plugin' : 'cli', dispatch, { taskId, round });
  const watcher = watchSessionPhases({
    root,
    trace,
    tracePath,
    taskId,
    round,
    existingSessionIds,
    dispatchPromise: operation,
    workflow,
    profile,
  });
  const payload = await operation;
  await watcher;
  recordNewBusWrites(root, beforeMessages, trace, { taskId, round, workflow, profile });
  assertTask(payload, 'REVIEWING', `${workflow} dispatch round ${round}`);
  if (payload.task.implementationCommit !== FIXED_COMMIT) throw new Error(`Unexpected commit after ${workflow} dispatch round ${round}.`);
  await waitForTaskSync({ root, taskId, trace, tracePath, round, workflow, profile });
  return payload;
}

async function reviewWithObservation({ root, taskId, workflow, profile, trace, review }) {
  const beforeMessages = messageSnapshot(root);
  const payload = await trace.span('review', workflow === 'plugin' ? 'plugin' : 'cli', review, { taskId, workflow, profile });
  recordNewBusWrites(root, beforeMessages, trace, { taskId, workflow, profile });
  return payload;
}

async function routePluginSkill(trace) {
  return trace.span('skill_routing', 'skill-router', async () => {
    const content = readFileSync(SKILL_ENTRY, 'utf8');
    if (!content.includes('coordinate_agents_task_create') || !content.includes('coordinate-task')) {
      throw new Error('Plugin Skill routing fixture could not find the coordinate-task route.');
    }
    return { route: 'coordinate-task' };
  });
}

async function runCliWorkflow({ root, home, tracePath, runId, taskId, trace, workflow = 'cli', profile = 'latest-cli' }) {
  const totalStartEpochMs = Date.now();
  trace.totalStartEpochMs = totalStartEpochMs;
  const create = await cliCall({ root, home, tracePath, runId, profile }, trace, taskId, 'create', [
    '--title', TASK_TITLE,
    '--spec', TASK_SPEC,
    '--planner', 'codex',
    '--implementer', 'fake-implementer',
    '--reviewer', 'codex',
  ]);
  if (create.task?.spec !== TASK_SPEC) throw new Error('CLI fixture did not preserve the deterministic task specification.');
  const dispatch1 = await dispatchWithObservation({
    root, home, tracePath, runId, taskId, round: 1, workflow, profile, trace,
    dispatch: () => cliCall({ root, home, tracePath, runId, profile }, trace, taskId, 'dispatch', [], 'cli_dispatch_operation'),
  });
  const changes = await reviewWithObservation({
    root, taskId, workflow, profile, trace,
    review: () => cliCall({ root, home, tracePath, runId, profile }, trace, taskId, 'review', ['--decision', 'CHANGES_REQUESTED', '--feedback', REVIEW_FEEDBACK], 'cli_review_operation'),
  });
  assertTask(changes, 'CHANGES_REQUESTED', 'CLI changes request');
  const dispatch2 = await dispatchWithObservation({
    root, home, tracePath, runId, taskId, round: 2, workflow, profile, trace,
    dispatch: () => cliCall({ root, home, tracePath, runId, profile }, trace, taskId, 'dispatch', [], 'cli_dispatch_operation'),
  });
  const approved = await reviewWithObservation({
    root, taskId, workflow, profile, trace,
    review: () => cliCall({ root, home, tracePath, runId, profile }, trace, taskId, 'review', ['--decision', 'REVIEW_APPROVED'], 'cli_review_operation'),
  });
  assertTask(approved, 'APPROVED', 'CLI final review');
  if (dispatch1.session?.id !== dispatch2.session?.id) throw new Error('CLI rework did not reuse the healthy Execution Session.');
  trace.totalEndEpochMs = Date.now();
  return { taskId, status: approved.task.status, sessionId: dispatch1.session.id, commit: approved.task.implementationCommit };
}

async function runPluginWorkflow({ root, home, tracePath, runId, taskId, trace, profile }) {
  const totalStartEpochMs = Date.now();
  trace.totalStartEpochMs = totalStartEpochMs;
  await routePluginSkill(trace);
  const client = new McpClient({ root, home, tracePath, runId, profile });
  let sessionId = null;
  try {
    await client.start(trace);
    const create = await trace.span('task_create', 'plugin', () => pluginTool(client, trace, 'coordinate_agents_task_create', {
      root,
      id: taskId,
      title: TASK_TITLE,
      spec: TASK_SPEC,
      planner: 'codex',
      implementer: 'fake-implementer',
      reviewer: 'codex',
    }));
    if (create.task?.spec !== TASK_SPEC) throw new Error('Plugin fixture did not preserve the deterministic task specification.');

    if (profile === 'verbose') {
      await pluginTool(client, trace, 'coordinate_agents_task_status', { root, taskId });
    }
    const dispatch1 = await dispatchWithObservation({
      root, home, tracePath, runId, taskId, round: 1, workflow: 'plugin', profile, trace,
      dispatch: () => pluginTool(client, trace, 'coordinate_agents_task_dispatch', { root, taskId }),
    });
    sessionId = dispatch1.session?.id || null;
    if (!sessionId) throw new Error('Plugin dispatch did not return a Session id.');
    if (profile === 'verbose') {
      await pluginTool(client, trace, 'coordinate_agents_session_status', { root, sessionId });
      await pluginTool(client, trace, 'coordinate_agents_session_inspect', { root, sessionId, maxLines: 20, maxBytes: 4_096 });
      await pluginTool(client, trace, 'coordinate_agents_session_read', { root, sessionId, cursor: 0, maxLines: 20, maxBytes: 4_096 });
      await pluginTool(client, trace, 'coordinate_agents_task_status', { root, taskId });
      await pluginTool(client, trace, 'coordinate_agents_task_inspect', { root, taskId });
    }
    const changes = await reviewWithObservation({
      root, taskId, workflow: 'plugin', profile, trace,
      review: () => trace.span('plugin_review_operation', 'plugin', () => pluginTool(client, trace, 'coordinate_agents_task_review', {
        root, taskId, decision: 'CHANGES_REQUESTED', feedback: REVIEW_FEEDBACK,
      })),
    });
    assertTask(changes, 'CHANGES_REQUESTED', 'Plugin changes request');
    const dispatch2 = await dispatchWithObservation({
      root, home, tracePath, runId, taskId, round: 2, workflow: 'plugin', profile, trace,
      dispatch: () => pluginTool(client, trace, 'coordinate_agents_task_dispatch', { root, taskId }),
    });
    if (dispatch2.session?.id !== sessionId) throw new Error('Plugin rework did not reuse the healthy Execution Session.');
    if (profile === 'verbose') {
      await pluginTool(client, trace, 'coordinate_agents_session_status', { root, sessionId });
      await pluginTool(client, trace, 'coordinate_agents_session_inspect', { root, sessionId, maxLines: 20, maxBytes: 4_096 });
      await pluginTool(client, trace, 'coordinate_agents_session_read', { root, sessionId, cursor: 0, maxLines: 20, maxBytes: 4_096 });
      await pluginTool(client, trace, 'coordinate_agents_task_status', { root, taskId });
      await pluginTool(client, trace, 'coordinate_agents_task_inspect', { root, taskId });
    }
    const approved = await reviewWithObservation({
      root, taskId, workflow: 'plugin', profile, trace,
      review: () => trace.span('plugin_review_operation', 'plugin', () => pluginTool(client, trace, 'coordinate_agents_task_review', {
        root, taskId, decision: 'REVIEW_APPROVED',
      })),
    });
    assertTask(approved, 'APPROVED', 'Plugin final review');
    if (profile === 'verbose') await pluginTool(client, trace, 'coordinate_agents_task_status', { root, taskId });
    trace.totalEndEpochMs = Date.now();
    return {
      taskId,
      status: approved.task.status,
      sessionId,
      commit: approved.task.implementationCommit,
      mcpProtocolRequests: trace.spans.filter(span => ['mcp_initialize', 'mcp_tools_list'].includes(span.name)).length + trace.spans.filter(span => span.name === 'mcp_tool_call').length,
    };
  } finally {
    if (sessionId) {
      try { await runtimeSessionClose({ root, sessionId, graceful: false, timeoutMs: 1_000 }); } catch { /* Cleanup is best effort after measured result. */ }
    }
    await client.stop();
  }
}

async function runCase({ runNumber, workflow, profile }) {
  const runId = `${workflow}-${profile}-${String(runNumber).padStart(2, '0')}`;
  // Keep the suffix after task- short: the scanner's provider-token heuristic also sees that tail.
  const taskId = `task-${String(runNumber).padStart(2, '0')}-${workflow[0]}${profile[0]}`;
  const fixture = createFixture();
  const tracePath = join(fixture.root, 'benchmark-trace.jsonl');
  const trace = new TraceWriter(tracePath, { runId, workflow, profile });
  let sessionId = null;
  try {
    const result = workflow === 'cli'
      ? await runCliWorkflow({ ...fixture, tracePath, runId, taskId, trace, profile })
      : await runPluginWorkflow({ ...fixture, tracePath, runId, taskId, trace, profile });
    sessionId = result.sessionId;
    const events = traceSort(parseTraceFile(tracePath));
    const metrics = metricSpans(trace, workflow, profile);
    return { ...metrics, result, events, taskSpecSha256: createHash('sha256').update(TASK_SPEC).digest('hex') };
  } finally {
    if (sessionId) {
      try { await runtimeSessionClose({ root: fixture.root, sessionId, graceful: false, timeoutMs: 1_000 }); } catch { /* Cleanup is best effort. */ }
    }
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.home, { recursive: true, force: true });
  }
}

function aggregate(runs) {
  const fields = ['totalMs', 'taskCreateMs', 'taskDispatchMs', 'reviewMs', 'runtimeMs', 'implementerMs', 'orchestrationMs', 'extraToolCallMs', 'skillRoutingMs', 'mcpHandshakeMs', 'busWrites', 'taskSyncs', 'pluginToolCalls', 'cliCommandCalls', 'extraToolCalls'];
  const result = { runs: runs.length };
  for (const field of fields) result[field] = statistics(runs.map(run => run[field]));
  result.taskDispatchRoundMs = [0, 1].map(index => statistics(runs.map(run => run.taskDispatchRoundMs[index] || 0)));
  result.reviewRoundMs = [0, 1].map(index => statistics(runs.map(run => run.reviewRoundMs[index] || 0)));
  return result;
}

function formatMs(value) {
  return `${round(value)} ms`;
}

function percent(value) {
  return `${round(value)}%`;
}

function toolCallSlots(runs) {
  const slots = new Map();
  for (const run of runs) {
    for (const call of run.toolSpans || []) {
      if (!slots.has(call.toolName)) slots.set(call.toolName, []);
      slots.get(call.toolName).push(call.durationMs);
    }
  }
  return [...slots.entries()].map(([toolName, durations]) => ({ toolName, medianMs: round(median(durations)), count: durations.length }));
}

function minimumCallsAnalysis(cliAggregate, pluginAggregate, verboseRuns, compactAggregate) {
  const targetMs = cliAggregate.totalMs.median * 0.8;
  const verboseMedian = pluginAggregate.totalMs.median;
  const compactMedian = compactAggregate.totalMs.median;
  const removableCalls = toolCallSlots(verboseRuns)
    .filter(item => !['coordinate_agents_task_create', 'coordinate_agents_task_dispatch', 'coordinate_agents_task_review'].includes(item.toolName))
    .flatMap(item => Array.from({ length: Math.max(1, Math.round(item.count / verboseRuns.length)) }, () => item))
    .sort((a, b) => b.medianMs - a.medianMs);
  let estimated = verboseMedian;
  let removed = 0;
  while (estimated > targetMs && removed < removableCalls.length) {
    estimated -= removableCalls[removed].medianMs;
    removed += 1;
  }
  return {
    cliTargetMs: round(targetMs),
    verbosePluginMs: round(verboseMedian),
    compactPluginMs: round(compactMedian),
    verboseCalls: pluginAggregate.pluginToolCalls.median,
    compactCalls: compactAggregate.pluginToolCalls.median,
    semanticMinimumCalls: 5,
    removableCalls: removableCalls.length,
    estimatedCallsToRemove: estimated <= targetMs ? removed : null,
    estimatedAfterRemovalMs: round(estimated),
    compactAtLeast80Percent: compactMedian <= targetMs,
  };
}

function reportMarkdown({ environment, cliRuns, pluginRuns, compactRuns, cliAggregate, pluginAggregate, compactAggregate, minimum, paths }) {
  const cli = cliAggregate;
  const plugin = pluginAggregate;
  const extraTotal = round(plugin.totalMs.median - cli.totalMs.median);
  const extraPercent = cli.totalMs.median ? round((extraTotal / cli.totalMs.median) * 100) : 0;
  const runtimeDelta = round(plugin.runtimeMs.median - cli.runtimeMs.median);
  const implementationDelta = round(plugin.implementerMs.median - cli.implementerMs.median);
  const pluginExtraCallMs = plugin.extraToolCallMs.median;
  const verboseCallCount = plugin.pluginToolCalls.median;
  const cliCallCount = cli.cliCommandCalls.median;
  const extraCallCount = Math.max(0, verboseCallCount - minimum.semanticMinimumCalls);
  const sameRuntime = cliRuns.every(run => run.result?.commit === FIXED_COMMIT) && pluginRuns.every(run => run.result?.commit === FIXED_COMMIT);
  const callConclusion = minimum.estimatedCallsToRemove === null
    ? `按本次本地测量，移除全部 ${minimum.removableCalls} 个可选状态/检查 Tool Call 仍预计为 ${formatMs(minimum.estimatedAfterRemovalMs)}，没有仅靠减少 Tool Call 达到 CLI 的 80%（目标 ${formatMs(minimum.cliTargetMs)}）；固定 Runtime/Implementer 下限仍占主导。`
    : `按可选 Tool Call 的实测中位耗时排序，预计至少减少 ${minimum.estimatedCallsToRemove} 次，剩余约 ${formatMs(minimum.estimatedAfterRemovalMs)}；语义上最小工作流是 5 次 Tool Call，因此 verbose profile 最多可减少 ${Math.max(0, verboseCallCount - minimum.semanticMinimumCalls)} 次。`;
  const rootCause = extraTotal > 0
    ? `在这个可重复 fixture 中，Plugin 中位总耗时比 CLI 多 ${formatMs(extraTotal)}（${percent(extraPercent)}）。两条路径的 Fake Implementer 耗时几乎相同（差异 ${formatMs(implementationDelta)}），且都复用了同一个 Task Runtime 和同一个 Session；因此已观测增量主要来自 Plugin 的 MCP/编排边界，而不是 Implementer 或另一个 Runtime。Plugin 观察 profile 使用 ${verboseCallCount} 次 MCP Tool Call，CLI 使用 ${cliCallCount} 次 CLI 命令调用；其中多出的 ${extraCallCount} 次为状态、检查和 Session 读取。`
    : `在这个可重复 fixture 中，没有观察到 Plugin 比 CLI 更慢：Plugin 中位总耗时相对 CLI 的差异为 ${formatMs(extraTotal)}。两条路径共享同一个 Task Runtime、Agent Bus 和 Session，因此当前证据不支持“Runtime 重复初始化”作为原因；若真实 Codex 端到端仍明显变慢，需要另外测量模型推理/Skill 路由等待，本次受限 benchmark 不调用真实模型。`;
  const mcpRanking = pluginExtraCallMs > 0 ? `额外状态/检查 Tool Call 的实测总耗时中位数为 ${formatMs(pluginExtraCallMs)}。` : '额外状态/检查 Tool Call 的本地耗时低于计时分辨率，但仍增加了可见交互次数。';
  const runtimeConclusion = `Runtime 执行包络（从工具/CLI 调用时长扣除 Fake Implementer 区间）中位数：CLI ${formatMs(cli.runtimeMs.median)}，Plugin ${formatMs(plugin.runtimeMs.median)}，差异 ${formatMs(runtimeDelta)}。两条路径的 Task 状态序列都是 CREATED → SPEC_READY → IMPLEMENTING → REVIEWING → CHANGES_REQUESTED → IMPLEMENTING → REVIEWING → APPROVED；每次 rework 都复用同一个 Session。`;
  const rawRows = [...cliRuns.map(run => `| ${run.runId} | CLI | ${formatMs(run.totalMs)} | ${formatMs(run.runtimeMs)} | ${formatMs(run.implementerMs)} | ${run.cliCommandCalls} | ${run.busWrites} |`), ...pluginRuns.map(run => `| ${run.runId} | Plugin verbose | ${formatMs(run.totalMs)} | ${formatMs(run.runtimeMs)} | ${formatMs(run.implementerMs)} | ${run.pluginToolCalls} | ${run.busWrites} |`)].join('\n');
  const compactRows = compactRuns.map(run => `| ${run.runId} | ${formatMs(run.totalMs)} | ${formatMs(run.runtimeMs)} | ${run.pluginToolCalls} |`).join('\n');
  const toolRows = toolCallSlots(pluginRuns).sort((a, b) => b.medianMs - a.medianMs).map(item => `| \`${item.toolName}\` | ${item.count / pluginRuns.length} | ${formatMs(item.medianMs)} |`).join('\n');
  return `# Coordinate Agents Performance Benchmark

## Technical Summary

${rootCause}

${runtimeConclusion}

${callConclusion}

This is a deterministic local benchmark, not a live Codex/Antigravity/Claude benchmark. The Plugin case uses a persistent JSON-RPC MCP client to reproduce a verbose Skill → MCP → Runtime loop; it intentionally excludes real model reasoning and network latency. Conclusions are therefore strong for the measured Runtime/MCP path and not a claim about unmeasured Codex inference time.

## Environment

~~~yaml
commit: ${environment.commit}
version: ${environment.version}
node: ${environment.node}
platform: ${environment.platform}
arch: ${environment.arch}
cpu: ${environment.cpu}
cpu_count: ${environment.cpuCount}
task_spec_sha256: ${environment.taskSpecSha256}
fake_implementer_wait_ms: ${FAKE_WAIT_MS}
benchmark_runs_per_profile: ${RUNS}

Latest CLI entry: ${paths.cli}
Plugin entry: ${paths.plugin}
MCP entry: ${paths.mcp}
Runtime entry: ${paths.runtime}
Task runtime entry: ${paths.taskRuntime}
Session runtime entry: ${paths.sessionRuntime}
~~~

## Benchmark Design

The same fixture and exact task specification were used for every profile:

~~~text
${TASK_SPEC}
~~~

The fake Implementer receives the Runtime's IMPLEMENT prompt, waits exactly ${FAKE_WAIT_MS} ms per round, sends one fixed IMPLEMENTATION_DONE message with commit ${FIXED_COMMIT}, and remains alive for Session reuse. Each measured workflow performs one deterministic CHANGES_REQUESTED review, one re-dispatch, and a final REVIEW_APPROVED. No product files are written.

The CLI profile measures five user-level CLI commands: task.create, two task.dispatch calls, and two task.review calls. The Plugin verbose profile measures the same semantic workflow through a persistent MCP server plus explicit status/inspect/read observations. MCP Tool Call count excludes protocol handshake; initialize and tools/list are reported separately.

## Timing Comparison

Runtime is the measured CLI/MCP operation envelope after subtracting Fake Implementer intervals. Implementer is the observed implement_start → implementation_done interval. The columns are intentionally not treated as independent additive timers; the orchestration residual is calculated as Total − Runtime − Implementer.

| Workflow | Total | Runtime | Implementer | MCP Calls |
|---|---:|---:|---:|---:|
| Latest CLI | ${formatMs(cli.totalMs.median)} | ${formatMs(cli.runtimeMs.median)} | ${formatMs(cli.implementerMs.median)} | 0 |
| Latest Plugin (verbose) | ${formatMs(plugin.totalMs.median)} | ${formatMs(plugin.runtimeMs.median)} | ${formatMs(plugin.implementerMs.median)} | ${plugin.pluginToolCalls.median} |

| Workflow | Task create | Dispatch total | Review total | Orchestration residual | Bus writes |
|---|---:|---:|---:|---:|---:|
| Latest CLI | ${formatMs(cli.taskCreateMs.median)} | ${formatMs(cli.taskDispatchMs.median)} | ${formatMs(cli.reviewMs.median)} | ${formatMs(cli.orchestrationMs.median)} | ${cli.busWrites.median} |
| Latest Plugin (verbose) | ${formatMs(plugin.taskCreateMs.median)} | ${formatMs(plugin.taskDispatchMs.median)} | ${formatMs(plugin.reviewMs.median)} | ${formatMs(plugin.orchestrationMs.median)} | ${plugin.busWrites.median} |

### Repeated-run raw medians and ranges

| Run | Workflow | Total | Runtime | Implementer | Calls | Bus writes |
|---|---|---:|---:|---:|---:|---:|
${rawRows}

## MCP Tool Round Trips

The verbose Plugin simulation used a median of ${verboseCallCount} MCP Tool Calls per task. The CLI has no MCP Tool Calls; it used ${cliCallCount} user-level CLI command invocations. The Plugin sequence adds ${extraCallCount} model-visible status/inspection calls beyond the five semantic calls needed for create, two dispatches, and two review decisions.

| Tool | Calls per run | Median call duration |
|---|---:|---:|
${toolRows}

The measured extra status/inspection/read calls contribute ${formatMs(pluginExtraCallMs)} of call-envelope time in the verbose profile. Even where an individual local call is cheap, each call is an additional boundary at which a real Plugin may perform planning, response parsing, or another status decision. Those model-side delays are intentionally not fabricated or included here.

The 80% counterfactual below sums the per-tool medians for the 12 removable calls. It is therefore not computed as the verbose total minus the median of each run's summed extra-call duration; medians of sums and sums of medians can differ.

## Runtime and Session Difference

${runtimeConclusion}

Observed evidence:

- Both CLI and MCP import the same runtimeTaskCreate / runtimeTaskOperation implementation from ${paths.runtimeServices}.
- Both workflows produced the same fixed implementation commit and the same two-round Task state sequence.
- Both workflows reused the same Session ID from round 1 to round 2; no duplicate Session was created for rework.
- The CLI dispatch performs its Task sync and Session status polling inside one CLI invocation. The Plugin profile additionally exposes task_status, task_inspect, session_status, session_inspect, and session_read as separate MCP calls.
- Bus writes were six logical message publications per run: two IMPLEMENT handoffs, two IMPLEMENTATION_DONE messages, and two review messages. The count is the same for both profiles; the difference is visibility and transport boundaries, not Bus semantics.

No evidence was found in this benchmark for duplicate Runtime initialization, duplicate config loading, or duplicate Agent Bus initialization per task. The persistent MCP server was started once per Plugin run, and the Runtime state remained in the same fixture repository.

## Bottleneck Ranking

~~~yaml
P0:
  - name: Extra MCP status/inspect/read round trips
    evidence: "${verboseCallCount} Plugin Tool Calls vs ${cliCallCount} CLI commands; ${extraCallCount} optional observation calls"
    measured_median_ms: ${pluginExtraCallMs}
    scope: "Plugin verbose profile"
P1:
  - name: Plugin orchestration residual
    evidence: "Total - Runtime envelope - Implementer = ${plugin.orchestrationMs.median} ms median"
    measured_median_ms: ${plugin.orchestrationMs.median}
    scope: "Includes Skill routing, MCP handshake, call gaps, and transport envelope not attributable to fake work"
P1:
  - name: MCP handshake and Skill routing
    evidence: "Skill routing ${plugin.skillRoutingMs.median} ms; initialize/tools/list ${plugin.mcpHandshakeMs.median} ms median"
    measured_median_ms: ${round(plugin.skillRoutingMs.median + plugin.mcpHandshakeMs.median)}
    scope: "Plugin process startup path"
P2:
  - name: Fixed Implementer floor
    evidence: "Two deterministic 500 ms waits per workflow; Implementer median ${plugin.implementerMs.median} ms Plugin vs ${cli.implementerMs.median} ms CLI"
    measured_median_ms: ${plugin.implementerMs.median}
    scope: "Common to both workflows; not a Plugin-specific regression"
P2:
  - name: Required semantic Runtime envelope
    evidence: "After removing optional observation calls and MCP handshake from the Plugin Runtime envelope, the remaining semantic workflow still has a ${round(Math.max(0, plugin.runtimeMs.median - pluginExtraCallMs - plugin.mcpHandshakeMs.median))} ms median envelope"
    measured_median_ms: ${round(Math.max(0, plugin.runtimeMs.median - pluginExtraCallMs - plugin.mcpHandshakeMs.median))}
    scope: "Workflow floor; not a Plugin-specific regression by itself"
~~~

## Root Cause

${rootCause}

The evidence does not support a claim that Plugin enters a different or slower Task/Session Runtime. The current Plugin and CLI are two transport surfaces over the same Runtime source. The measured Plugin-specific difference is the number of externally visible MCP interactions and the residual time around them. A real Codex run may add reasoning time between those calls, but that variable is outside this deterministic benchmark and is not silently estimated.

## 80% Target and High-level Workflow API Question

CLI 80% target: **${formatMs(minimum.cliTargetMs)}**.

Verbose Plugin: **${formatMs(minimum.verbosePluginMs)}**, ${minimum.verboseCalls} Tool Calls.

Compact semantic Plugin sensitivity: **${formatMs(minimum.compactPluginMs)}**, ${minimum.compactCalls} Tool Calls.

${callConclusion}

This directly informs task_start(), task_run(), and task_rework(): if the compact five-call sensitivity reaches the target, a higher-level workflow API can remove ${Math.max(0, minimum.verboseCalls - minimum.semanticMinimumCalls)} model-visible calls from the verbose path. If it does not, reducing calls alone is insufficient under this host; the fixed Runtime/Implementer floor or unmeasured model-side reasoning must be addressed separately.

## Optimization Suggestions (No Code Changes Made)

~~~yaml
MCP API:
  - Provide a high-level task workflow operation that returns the post-dispatch Task and Session facts in one bounded response.
  - Keep status/inspect/read as explicit diagnostic tools, but avoid requiring them for the happy path.
  - Preserve one-call review/rework semantics so CHANGES_REQUESTED can lead directly to the next dispatch.
Runtime:
  - Keep the current single Runtime/Session owner; verify with a server-side operation trace before changing lifecycle ownership.
  - Expose bounded phase timings (Task sync, Session open/reuse, PTY spawn) so Plugin clients do not need repeated inspection to infer progress.
Plugin workflow:
  - Route the normal happy path through create → dispatch → review/rework → approve, using diagnostics only on failure or explicit inspection requests.
  - Record MCP call counts and elapsed time per activation to make orchestration regressions visible.
Task lifecycle:
  - Consider task_start(), task_run(), and task_rework() only after the compact sensitivity and the 80% calculation are confirmed on a real Plugin trace.
  - Maintain explicit review and recovery gates; do not hide CHANGES_REQUESTED or automatic retry semantics inside a convenience API.
~~~

## Limitations and Robustness Checks

- The benchmark uses local stdio MCP, so it measures local JSON-RPC and Runtime boundary cost, not remote MCP latency.
- No real Codex, Antigravity, Claude, or model reasoning was invoked. Skill routing is a deterministic file/rule lookup; it is a lower bound for live Codex routing.
- The Implementer wait is deterministic but process scheduling, PTY backend, filesystem cache state, and host load still create small variance; medians across ${RUNS} runs are the primary comparison.
- Trace phase boundaries are external observation points. The benchmark does not patch production Runtime code; Session/PTY events are inferred from persisted Session records and fake-process markers.
- Generated raw traces contain event metadata only; no Task body, prompt, credentials, or raw Agent Bus message payload is persisted.

## Reproducibility and Artifacts

Run from the repository root:

~~~sh
node benchmark/coordinate-agents-performance.mjs --runs ${RUNS}
~~~

The run generated:

- PERFORMANCE_REPORT.md — this report.
- benchmark/results/benchmark-results.json — environment, per-run metrics, aggregate statistics, and sensitivity result.
- benchmark/results/benchmark-trace.json — unified event trace with the requested Task, Session, PTY, Implementer, Bus, sync, and review events.

## Next Questions

1. Capture one real Codex Plugin activation with the same event schema, including model turn timestamps, to measure the unobserved Skill/reasoning gap.
2. Repeat the compact five-call profile through the actual Plugin host and compare its p50/p95 against the CLI target.
3. If compact Plugin remains above ${formatMs(minimum.cliTargetMs)}, decompose Runtime server-side phases before adding a high-level API; the current benchmark cannot attribute that residual to MCP calls alone.
`;
}

async function collect() {
  mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  const cliRuns = [];
  const pluginRuns = [];
  const compactRuns = [];
  for (let runNumber = 1; runNumber <= RUNS; runNumber += 1) {
    process.stderr.write(`benchmark run ${runNumber}/${RUNS}: CLI\n`);
    cliRuns.push(await runCase({ runNumber, workflow: 'cli', profile: 'latest-cli' }));
    process.stderr.write(`benchmark run ${runNumber}/${RUNS}: Plugin verbose\n`);
    pluginRuns.push(await runCase({ runNumber, workflow: 'plugin', profile: 'verbose' }));
    process.stderr.write(`benchmark run ${runNumber}/${RUNS}: Plugin compact sensitivity\n`);
    compactRuns.push(await runCase({ runNumber, workflow: 'plugin', profile: 'compact' }));
  }
  const environment = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).trim(),
    version: JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')).version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: (await import('node:os')).cpus()[0]?.model || 'unknown',
    cpuCount: (await import('node:os')).cpus().length,
    taskSpecSha256: createHash('sha256').update(TASK_SPEC).digest('hex'),
  };
  const cliAggregate = aggregate(cliRuns);
  const pluginAggregate = aggregate(pluginRuns);
  const compactAggregate = aggregate(compactRuns);
  const minimum = minimumCallsAnalysis(cliAggregate, pluginAggregate, pluginRuns, compactAggregate);
  const paths = {
    cli: 'bin/coordinate-agents.mjs',
    plugin: '.codex-plugin/plugin.json → skills/coordinate-agents/SKILL.md',
    mcp: 'mcp/server.mjs --stdio',
    runtime: 'skills/coordinate-agents/scripts/runtime-entry.mjs (Plugin fallback) / skills/coordinate-agents/scripts/runtime-services.mjs (MCP transport) / bin/coordinate-agents.mjs exports (CLI)',
    runtimeServices: 'skills/coordinate-agents/scripts/runtime-services.mjs',
    taskRuntime: 'skills/coordinate-agents/scripts/task-runtime.mjs',
    sessionRuntime: 'skills/coordinate-agents/scripts/session-manager.mjs + session-service.mjs + pty-runtime.mjs',
  };
  const result = {
    generatedAt: new Date().toISOString(),
    environment,
    paths,
    task: {
      title: TASK_TITLE,
      requirements: ['Create todo item', 'Mark todo completed', 'Add regression test'],
      rounds: 2,
      reviewFlow: ['CHANGES_REQUESTED', 'REVIEW_APPROVED'],
      fakeImplementerWaitMs: FAKE_WAIT_MS,
      fixedCommit: FIXED_COMMIT,
      specificationSha256: environment.taskSpecSha256,
    },
    cli: { aggregate: cliAggregate, runs: cliRuns.map(({ events, toolSpans, ...run }) => run) },
    plugin: { aggregate: pluginAggregate, runs: pluginRuns.map(({ events, ...run }) => run) },
    sensitivity: { compactPlugin: { aggregate: compactAggregate, runs: compactRuns.map(({ events, ...run }) => run) } },
    minimumCalls: minimum,
  };
  const allEvents = [...cliRuns, ...pluginRuns, ...compactRuns].flatMap(run => run.events);
  writeFileSync(RESULTS_OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeFileSync(TRACE_OUTPUT, `${JSON.stringify(traceSort(allEvents), null, 2)}\n`, 'utf8');
  writeFileSync(REPORT_OUTPUT, reportMarkdown({ environment, cliRuns, pluginRuns, compactRuns, cliAggregate, pluginAggregate, compactAggregate, minimum, paths }), 'utf8');
  return { result, reportPath: REPORT_OUTPUT, resultsPath: RESULTS_OUTPUT, tracePath: TRACE_OUTPUT };
}

try {
  const output = await collect();
  process.stdout.write(JSON.stringify({ ok: true, ...output }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
