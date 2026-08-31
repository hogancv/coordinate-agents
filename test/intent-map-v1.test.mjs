import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  intentCoverageFacts,
  intentSchedulingWave,
  normalizeWriteIntentPattern,
  validateIntentMapV1,
  writeIntentConflictBetween,
  writeIntentPatternsMayOverlap,
} from '../skills/coordinate-agents/scripts/intent-map-contract.mjs';
import {
  readTaskGraph,
  taskGraphPath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import {
  runtimeTaskGraphCreate,
  runtimeTaskGraphInspect,
  runtimeTaskGraphPlan,
  runtimeTaskGraphStatus,
} from '../bin/coordinate-agents.mjs';
import { createMcpServer } from '../mcp/server.mjs';

const unusualIntentPattern = [
  'path with spaces/',
  String.fromCharCode(36),
  'value',
  String.fromCharCode(59, 96),
  'literal',
  String.fromCharCode(96),
].join('');

function repository(prefix = 'coordinate-agents-intent-map-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(parentTaskId = 'task-intent-map') {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Exercise Intent Map v1',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'backend', implementer: 'antigravity', spec: 'Implement backend.' },
      { id: 'docs', implementer: 'codex', spec: 'Document it.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
  };
}

function validatedGraph(parentTaskId = 'task-intent-map') {
  return {
    parentTaskId,
    subtasks: [{ id: 'backend' }, { id: 'docs' }],
  };
}

function intentMap(parentTaskId = 'task-intent-map') {
  return {
    schemaVersion: 1,
    parentTaskId,
    subtasks: [
      { id: 'docs', writeIntent: [] },
      { id: 'backend', writeIntent: ['src\\server//./api/**', unusualIntentPattern] },
    ],
  };
}

function invalid(map, match) {
  assert.throws(
    () => validateIntentMapV1(map, validatedGraph()),
    error => error.code === 'TASK_GRAPH_INVALID'
      && error.stage === 'intent-map-validation'
      && match.test(error.message),
  );
}

test('Intent Map v1 defaults policy, sorts coverage, normalizes separators, and preserves explicit empty intent', () => {
  const normalized = validateIntentMapV1(intentMap(), validatedGraph());
  assert.equal(normalized.scopePolicy, 'warn');
  assert.deepEqual(normalized.subtasks, [
    { id: 'backend', writeIntent: [unusualIntentPattern, 'src/server/api/**'] },
    { id: 'docs', writeIntent: [] },
  ]);
  assert.deepEqual(intentCoverageFacts({ subtasks: validatedGraph().subtasks, intentMap: normalized }), {
    available: true,
    schemaVersion: 1,
    scopePolicy: 'warn',
    subtasks: [
      { subtaskId: 'backend', coverage: 'declared', writeIntent: [unusualIntentPattern, 'src/server/api/**'] },
      { subtaskId: 'docs', coverage: 'explicit-empty', writeIntent: [] },
    ],
  });
  assert.equal(normalizeWriteIntentPattern('src\\feature//./file.js'), 'src/feature/file.js');
});

test('write-intent overlap is deterministic, literal-disjoint when provable, and conservative after glob syntax', () => {
  assert.equal(writeIntentPatternsMayOverlap('src/alpha/**', 'src/beta/**'), false);
  assert.equal(writeIntentPatternsMayOverlap('src/shared/**', 'src/shared/file.js'), true);
  assert.equal(writeIntentPatternsMayOverlap('src/*/index.js', 'src/*/other.js'), true);
  assert.equal(writeIntentPatternsMayOverlap('README.md', 'README.zh-CN.md'), false);

  const normalized = validateIntentMapV1({
    schemaVersion: 1,
    parentTaskId: 'task-intent-map',
    subtasks: [
      { id: 'backend', writeIntent: ['src/shared/**'] },
      { id: 'docs', writeIntent: ['src/shared/file.js'] },
    ],
  }, validatedGraph());
  const graphWithIntent = { ...validatedGraph(), intentMap: normalized };
  assert.deepEqual(writeIntentConflictBetween(graphWithIntent, 'docs', 'backend'), {
    code: 'WRITE_INTENT_CONFLICT',
    subtasks: ['backend', 'docs'],
    patterns: [
      { subtaskId: 'backend', pattern: 'src/shared/**' },
      { subtaskId: 'docs', pattern: 'src/shared/file.js' },
    ],
    conservative: true,
  });
});

test('Intent Map scheduling greedily selects one deterministic non-conflicting READY wave', () => {
  const schedulingGraph = {
    parentTaskId: 'task-wave',
    subtasks: [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }, { id: 'running' }],
    intentMap: {
      schemaVersion: 1,
      parentTaskId: 'task-wave',
      scopePolicy: 'warn',
      subtasks: [
        { id: 'alpha', writeIntent: ['src/shared/**'] },
        { id: 'beta', writeIntent: ['src/shared/file.js'] },
        { id: 'gamma', writeIntent: ['docs/**'] },
        { id: 'running', writeIntent: ['config/**'] },
      ],
    },
  };
  const frontier = {
    ready: ['alpha', 'beta', 'gamma'],
    running: ['running'],
    eligible: ['alpha', 'beta'],
    capacityLimited: ['gamma'],
    runningCount: 1,
    availableSlots: 2,
    maxConcurrency: 3,
  };
  const first = intentSchedulingWave(schedulingGraph, frontier);
  const second = intentSchedulingWave(schedulingGraph, frontier);
  assert.deepEqual(first, second);
  assert.deepEqual(first.selected, ['alpha', 'gamma']);
  assert.deepEqual(first.conflictDeferred, ['beta']);
  assert.deepEqual(first.capacityLimited, []);
  assert.equal(first.conflicts[0].code, 'WRITE_INTENT_CONFLICT');
  assert.deepEqual(first.conflicts[0].subtasks, ['alpha', 'beta']);
  assert.match(first.reasons.beta, /deferred from this wave/);

  const legacy = intentSchedulingWave({ ...schedulingGraph, intentMap: null }, frontier);
  assert.equal(legacy.intentCoverageAvailable, false);
  assert.deepEqual(legacy.selected, frontier.eligible);
  assert.deepEqual(legacy.capacityLimited, frontier.capacityLimited);
});

test('Intent Map v1 rejects unsupported, contradictory, duplicate, unsafe, malformed, and oversized input', () => {
  invalid({ ...intentMap(), schemaVersion: 2 }, /schemaVersion/);
  invalid({ ...intentMap(), parentTaskId: 'task-other' }, /must match/);
  invalid({ ...intentMap(), scopePolicy: 'enforce' }, /scopePolicy/);
  invalid({ ...intentMap(), extra: true }, /unknown field/);
  invalid({ ...intentMap(), subtasks: [intentMap().subtasks[0]] }, /missing subtask/);
  invalid({ ...intentMap(), subtasks: [...intentMap().subtasks, { id: 'docs', writeIntent: [] }] }, /duplicate subtask/);
  invalid({ ...intentMap(), subtasks: [{ id: 'unknown', writeIntent: [] }, intentMap().subtasks[0]] }, /unknown subtask/);
  invalid({ ...intentMap(), subtasks: [
    { id: 'backend', writeIntent: ['src//api', 'src/api'] },
    { id: 'docs', writeIntent: [] },
  ] }, /duplicate normalized/);
  invalid({ ...intentMap(), subtasks: [
    { id: 'backend', writeIntent: ['shared/**'] },
    { id: 'docs', writeIntent: ['shared\\**'] },
  ] }, /duplicated by subtasks/);
  for (const pattern of ['/absolute/**', '\\\\server\\share', 'C:\\absolute', 'C:relative', '../escape', 'src/../escape', '!src/**', '', '   ', 'src\u0000bad']) {
    invalid({ ...intentMap(), subtasks: [
      { id: 'backend', writeIntent: [pattern] },
      { id: 'docs', writeIntent: [] },
    ] }, /writeIntent|repository-relative|escape|negation|control|malformed/);
  }
  invalid({ ...intentMap(), subtasks: [
    { id: 'backend', writeIntent: ['x'.repeat(4097)] },
    { id: 'docs', writeIntent: [] },
  ] }, /exceeds 4096 bytes/);
});

test('invalid Intent Map create is rejected before Agent Bus and valid create persists atomically', async () => {
  const root = repository('coordinate-agents-intent-atomic-');
  try {
    const rejected = await runtimeTaskGraphCreate({
      root,
      graph: graph(),
      intentMap: { ...intentMap(), subtasks: [{ id: 'backend', writeIntent: ['../escape'] }] },
    }).catch(error => error);
    assert.equal(rejected.code, 'TASK_GRAPH_INVALID');
    assert.equal(rejected.stage, 'intent-map-validation');
    assert.equal(existsSync(join(root, '.agent-bus')), false);

    const created = await runtimeTaskGraphCreate({ root, graph: graph(), intentMap: intentMap() });
    assert.equal(created.intentCoverage.available, true);
    assert.equal(created.intentCoverage.subtasks[1].coverage, 'explicit-empty');
    const stored = readTaskGraph(root, 'task-intent-map');
    assert.deepEqual(stored.intentMap, created.graph.intentMap);
    assert.equal(JSON.parse(readFileSync(taskGraphPath(root, 'task-intent-map'), 'utf8')).intentMap.scopePolicy, 'warn');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy graphs report unavailable coverage while status, inspect, and plan preserve explicit empty coverage', async () => {
  const legacyRoot = repository('coordinate-agents-intent-legacy-');
  const mappedRoot = repository('coordinate-agents-intent-views-');
  try {
    await runtimeTaskGraphCreate({ root: legacyRoot, graph: graph('task-intent-legacy') });
    const legacy = await runtimeTaskGraphStatus({ root: legacyRoot, taskId: 'task-intent-legacy' });
    assert.equal(legacy.intentCoverage.available, false);
    assert.equal(legacy.intentCoverage.subtasks[0].coverage, 'unavailable');
    assert.equal(legacy.intentCoverage.subtasks[0].writeIntent, null);

    await runtimeTaskGraphCreate({
      root: mappedRoot,
      graph: graph('task-intent-views'),
      intentMap: intentMap('task-intent-views'),
    });
    const [status, inspect, plan] = await Promise.all([
      runtimeTaskGraphStatus({ root: mappedRoot, taskId: 'task-intent-views' }),
      runtimeTaskGraphInspect({ root: mappedRoot, taskId: 'task-intent-views' }),
      runtimeTaskGraphPlan({ root: mappedRoot, taskId: 'task-intent-views' }),
    ]);
    for (const view of [status.intentCoverage, inspect.intentCoverage, plan.plan.intentCoverage]) {
      assert.equal(view.scopePolicy, 'warn');
      assert.equal(view.subtasks.find(item => item.subtaskId === 'docs').coverage, 'explicit-empty');
      assert.deepEqual(view.subtasks.find(item => item.subtaskId === 'docs').writeIntent, []);
    }
  } finally {
    rmSync(legacyRoot, { recursive: true, force: true });
    rmSync(mappedRoot, { recursive: true, force: true });
  }
});

test('CLI companion file and MCP object create the same normalized durable Intent Map', async () => {
  const root = repository('coordinate-agents intent cli $;-');
  const graphPath = join(root, 'graph input.json');
  const intentPath = join(root, 'intent input.json');
  try {
    writeFileSync(graphPath, `${JSON.stringify(graph('task-intent-cli'))}\n`, 'utf8');
    writeFileSync(intentPath, `${JSON.stringify(intentMap('task-intent-cli'))}\n`, 'utf8');
    const cliOutput = execFileSync(process.execPath, [
      join(process.cwd(), 'bin', 'coordinate-agents.mjs'), 'task', 'graph-create',
      '--root', root, '--input', graphPath, '--intent-map', intentPath, '--json',
    ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: '' } });
    const cliMap = JSON.parse(cliOutput).graph.intentMap;

    const server = createMcpServer();
    const mcp = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_create',
        arguments: {
          root,
          graph: graph('task-intent-mcp'),
          intentMap: intentMap('task-intent-mcp'),
        },
      },
    });
    assert.equal(mcp.result.isError, false);
    assert.deepEqual(
      { ...mcp.result.structuredContent.graph.intentMap, parentTaskId: 'same' },
      { ...cliMap, parentTaskId: 'same' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stored graph validation rejects contradictory or non-normalized Intent Map facts', async () => {
  const root = repository('coordinate-agents-intent-corrupt-');
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(), intentMap: intentMap() });
    const path = taskGraphPath(root, 'task-intent-map');
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.intentMap.subtasks[0].writeIntent = ['src\\not-normalized'];
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readTaskGraph(root, 'task-intent-map'),
      error => error.code === 'TASK_STATE_CONFLICT' && /Intent Map/.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
