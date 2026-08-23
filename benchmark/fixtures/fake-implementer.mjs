#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { basename, resolve } from 'node:path';

const FIXED_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const WAIT_MS = 500;

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const root = resolve(argument('--root', process.cwd()));
const agent = argument('--agent', 'fake-implementer');
const busTool = resolve(argument('--bus-tool'));
const tracePath = process.env.COORDINATE_BENCH_TRACE_PATH || '';
const runId = process.env.COORDINATE_BENCH_RUN_ID || null;
const workflow = process.env.COORDINATE_BENCH_WORKFLOW || null;
const profile = process.env.COORDINATE_BENCH_PROFILE || null;
const seenRounds = new Set();
let inputBuffer = '';
let timer = null;
let processing = false;

function writeTrace(event, component, durationMs = 0, details = {}) {
  if (!tracePath) return;
  const record = {
    timestamp: new Date().toISOString(),
    event,
    component,
    durationMs: Number(durationMs.toFixed(3)),
    ...(runId ? { runId } : {}),
    ...(workflow ? { workflow } : {}),
    ...(profile ? { profile } : {}),
    ...details,
  };
  appendFileSync(tracePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

function parsePrompt(prompt) {
  const taskId = prompt.match(/Task ID:\s*(task-[A-Za-z0-9_-]+)/i)?.[1] || null;
  const round = Number(prompt.match(/Round:\s*(\d+)/i)?.[1] || 0);
  const complete = prompt.includes('send one IMPLEMENTATION_DONE message');
  return taskId && round > 0 && complete ? { taskId, round } : null;
}

async function implement(prompt) {
  const parsed = parsePrompt(prompt);
  if (!parsed || seenRounds.has(parsed.round) || processing) return;
  seenRounds.add(parsed.round);
  processing = true;

  const start = performance.now();
  writeTrace('implement_start', 'fake-implementer', 0, {
    taskId: parsed.taskId,
    round: parsed.round,
    waitMs: WAIT_MS,
  });
  await sleep(WAIT_MS);

  const busStart = performance.now();
  const body = [
    `Task ID: ${parsed.taskId}`,
    `Round: ${parsed.round}`,
    `implementationCommit: ${FIXED_COMMIT}`,
    'Evidence: deterministic fake implementer completed the Todo fixture.',
    'IMPLEMENTATION_DONE',
  ].join('\n');
  const dedupeKey = `task:${parsed.taskId}:round:${parsed.round}:implementation-done`;
  execFileSync(process.execPath, [
    busTool,
    'send',
    '--root', root,
    '--from', agent,
    '--to', 'codex',
    '--type', 'IMPLEMENTATION_DONE',
    '--subject', `Implementation done ${parsed.taskId} round ${parsed.round}`,
    '--body', body,
    '--dedupe-key', dedupeKey,
    '--related-commit', FIXED_COMMIT,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  writeTrace('bus_write', 'agent-bus', performance.now() - busStart, {
    direction: 'fake-implementer-to-planner',
    messageType: 'IMPLEMENTATION_DONE',
    taskId: parsed.taskId,
    round: parsed.round,
  });
  writeTrace('implementation_done', 'fake-implementer', performance.now() - start, {
    taskId: parsed.taskId,
    round: parsed.round,
    fixedWaitMs: WAIT_MS,
    commit: FIXED_COMMIT,
  });
  process.stdout.write(`IMPLEMENTATION_DONE ${basename(root)} ${parsed.taskId} round ${parsed.round}\n`);
  processing = false;
  inputBuffer = '';
}

function schedulePromptProcessing() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void implement(inputBuffer);
  }, 40);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  schedulePromptProcessing();
});
process.stdin.on('end', () => {
  if (timer) clearTimeout(timer);
  void implement(inputBuffer);
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

process.stdout.write('FAKE_IMPLEMENTER_READY\n');
process.stdin.resume();
