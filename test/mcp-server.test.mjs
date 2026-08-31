import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMcpServer } from '../mcp/server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const serverPath = join(root, 'mcp', 'server.mjs');
const selfTestPath = join(root, 'mcp', 'self-test.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const canonicalTmpdir = realpathSync(tmpdir());

function tempRepository(prefix = 'coordinate-agents-mcp-') {
  const repository = mkdtempSync(join(canonicalTmpdir, prefix));
  const init = spawnSync('git', ['init', repository], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return repository;
}

function isolatedEnvironment(home, extra = {}) {
  return {
    ...process.env,
    COORDINATE_AGENTS_HOME: home,
    HOME: home,
    USERPROFILE: home,
    ...extra,
  };
}

function fixtureCommand(repository, name, mode = 'success') {
  const bin = join(repository, 'fixture bin');
  mkdirSync(bin, { recursive: true });
  const source = `const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('fixture-implementer 1.0.0'); process.exit(0); }
if (process.env.FIXTURE_COUNT) fs.appendFileSync(process.env.FIXTURE_COUNT, '1');
if (process.env.FIXTURE_MODE === 'failure') { process.stderr.write('fixture runtime failure\\n'); process.exit(7); }
const prompt = args.join(' ');
const task = prompt.match(/Task ID:\\s*(task-[A-Za-z0-9_-]+)/)?.[1];
if (!task) { process.stderr.write('missing Task ID\\n'); process.exit(8); }
const result = cp.spawnSync(process.execPath, [
  process.env.BUS_TOOL, 'send', '--root', process.env.FIXTURE_ROOT,
  '--from', process.env.FIXTURE_AGENT, '--to', 'codex',
  '--type', 'IMPLEMENTATION_DONE', '--subject', 'fixture implementation done',
  '--related-commit', process.env.FIXTURE_COMMIT || 'abc1234',
  '--body', 'Task ID: ' + task + '\\nimplementationCommit: ' + (process.env.FIXTURE_COMMIT || 'abc1234') + '\\nEvidence: fixture tests passed',
], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0) { process.stderr.write(result.stderr || result.stdout || 'fixture send failed'); process.exit(result.status || 9); }
process.exit(0);
`;
  if (process.platform === 'win32') {
    const script = join(bin, `${name}.cjs`);
    writeFileSync(script, source, 'utf8');
    const command = join(bin, `${name}.cmd`);
    writeFileSync(command, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return command;
  }
  const command = join(bin, name);
  writeFileSync(command, `#!${process.execPath}\n${source}`, 'utf8');
  chmodSync(command, 0o755);
  return command;
}

function externalAdapterModule(repository) {
  const modulePath = join(repository, 'external-mcp-adapter.mjs');
  const sdkUrl = pathToFileURL(join(root, 'adapter-sdk.mjs')).href;
  writeFileSync(modulePath, `
import { existsSync } from 'node:fs';
import { ADAPTER_CONTRACT_VERSION, defineAdapter } from ${JSON.stringify(sdkUrl)};

export default defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: 'external-mcp-adapter',
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  create(config) {
    const command = config.command || '';
    const script = Array.isArray(config.args) ? config.args[0] || '' : '';
    return {
      validateConfiguration() {
        return command && script && existsSync(script)
          ? { compatible: true, code: null, details: null }
          : { compatible: false, code: 'INVALID_ADAPTER_CONFIG', details: 'external MCP fixture requires command and script.' };
      },
      detect() {
        return command && script && existsSync(script)
          ? { available: true, command, runtimeCommand: command, resolvedCommand: command, prefix: [], version: 'external-mcp-fixture-1.0.0' }
          : { available: false, command, runtimeCommand: command, code: 'COMMAND_NOT_FOUND', details: 'external MCP fixture is unavailable.' };
      },
      resolveLaunch({ root, prompt }) {
        return { command, prefix: [], args: [script, prompt], cwd: root, resolvedCommand: command };
      },
      resolveSessionLaunch({ root }) {
        return { command, prefix: [], args: [script], cwd: root, initialInputConsumed: false, resolvedCommand: command };
      },
      launchPolicy() {
        return { mode: 'bus-supervised', pollIntervalMs: 10 };
      },
    };
  },
});
`, 'utf8');
  return modulePath;
}

function externalSessionFixture(repository) {
  const fixture = join(repository, 'external-mcp-fixture.cjs');
  writeFileSync(fixture, String.raw`const cp = require('node:child_process');
console.log('external-mcp-ready');
let buffer = '';
const completed = new Set();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (const match of buffer.matchAll(/Task ID:\s*(task-[A-Za-z0-9_-]+)[\s\S]*?Round:\s*(\d+)/g)) {
    const key = match[1] + ':' + match[2];
    if (completed.has(key)) continue;
    completed.add(key);
    const result = cp.spawnSync(process.execPath, [
      process.env.BUS_TOOL, 'send', '--root', process.env.FIXTURE_ROOT,
      '--from', process.env.FIXTURE_AGENT, '--to', 'codex',
      '--type', 'IMPLEMENTATION_DONE', '--subject', 'external MCP fixture done',
      '--related-commit', 'externalmcp1234', '--body',
      'Task ID: ' + match[1] + '\nimplementationCommit: externalmcp1234\nExternal MCP adapter completed',
    ], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) process.stderr.write(result.stderr || result.stdout || 'fixture send failed');
    console.log('external-mcp-done:' + key);
  }
});
`, 'utf8');
  return fixture;
}

class StdioMcpClient {
  constructor(env, cwd = root) {
    this.child = spawn(process.execPath, [serverPath, '--stdio'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity, terminal: false });
    this.responses = [];
    this.waiters = [];
    this.stderr = '';
    this.child.stderr.on('data', chunk => { this.stderr += `${chunk}`; });
    this.lines.on('line', line => {
      if (!line) return;
      const response = JSON.parse(line);
      const waiter = this.waiters.shift();
      if (waiter) waiter(response);
      else this.responses.push(response);
    });
  }

  request(method, params = {}) {
    const id = (this._id = (this._id || 0) + 1);
    const message = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP response timeout for ${method}: ${this.stderr}`)), 15_000);
      const resolveOnce = response => {
        clearTimeout(timer);
        resolveResponse(response);
      };
      const queued = this.responses.shift();
      if (queued) resolveOnce(queued);
      else this.waiters.push(resolveOnce);
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async close() {
    this.child.stdin.end();
    await new Promise(resolveClose => {
      const timer = setTimeout(() => {
        if (!this.child.killed) this.child.kill();
        resolveClose();
      }, 2_000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }
}

function invokeCli(args, env) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
}

function taskParityFields(task) {
  return {
    status: task.status,
    round: task.round,
    planner: task.planner,
    implementer: task.implementer,
    reviewer: task.reviewer,
    spec: task.spec,
    implementationCommit: task.implementationCommit,
    evidence: task.evidence,
    lastError: task.lastError,
    reviewDecision: task.reviewDecision,
    reviewFeedback: task.reviewFeedback,
  };
}

test('MCP server exposes the canonical lifecycle and exact P0 tool catalog', async () => {
  const server = createMcpServer({ root });
  const initialized = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(initialized.result.serverInfo.name, 'coordinate-agents');
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.equal(initialized.result.serverInfo.version, packageVersion);
  assert.equal(initialized.result.capabilities.tools.listChanged, false);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = listed.result.tools.map(tool => tool.name);
  assert.deepEqual(names, [
    'coordinate_agents_setup_discover',
    'coordinate_agents_setup_configure',
    'coordinate_agents_task_create',
    'coordinate_agents_task_graph_validate',
    'coordinate_agents_task_graph_create',
    'coordinate_agents_task_graph_plan',
    'coordinate_agents_task_graph_run',
    'coordinate_agents_task_graph_recover',
    'coordinate_agents_task_graph_resume',
    'coordinate_agents_task_graph_stop',
    'coordinate_agents_task_graph_cleanup',
    'coordinate_agents_task_graph_dispatch',
    'coordinate_agents_task_graph_integrate',
    'coordinate_agents_task_graph_review',
    'coordinate_agents_task_dispatch',
    'coordinate_agents_task_status',
    'coordinate_agents_task_inspect',
    'coordinate_agents_task_review',
    'coordinate_agents_task_resume',
    'coordinate_agents_task_stop',
    'coordinate_agents_recover_inspect',
    'coordinate_agents_session_open',
    'coordinate_agents_session_status',
    'coordinate_agents_session_inspect',
    'coordinate_agents_session_write',
    'coordinate_agents_session_read',
    'coordinate_agents_session_close',
  ]);
  for (const tool of listed.result.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(Array.isArray(tool.inputSchema.required));
    assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === 'object');
    for (const required of tool.inputSchema.required) assert.ok(required in tool.inputSchema.properties);
    assert.doesNotMatch(JSON.stringify(tool), /undefined/);
  }
  assert.equal((await server.handle({ jsonrpc: '2.0', id: 3, method: 'ping', params: {} })).result !== undefined, true);
});

test('MCP stdio is protocol-pure, debuggable on stderr, cwd-independent, and path-safe', async () => {
  const independentCwd = mkdtempSync(join(canonicalTmpdir, 'Coordinate Agents MCP cwd '));
  const debugClient = new StdioMcpClient(isolatedEnvironment(independentCwd, {
    COORDINATE_AGENTS_MCP_DEBUG: '1',
  }), independentCwd);
  try {
    const initialized = await debugClient.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'debug-test', version: '1' },
    });
    assert.equal(initialized.result.protocolVersion, '2025-06-18');
    const listed = await debugClient.request('tools/list');
    assert.equal(listed.result.tools.length, 27);
  } finally {
    await debugClient.close();
  }
  assert.match(debugClient.stderr, /MCP server starting/);
  assert.match(debugClient.stderr, /server root:/);
  assert.match(debugClient.stderr, /runtime root:/);
  assert.match(debugClient.stderr, /protocol version: 2025-06-18/);
  assert.match(debugClient.stderr, /tool count: 27/);
  assert.match(debugClient.stderr, /initialize received/);
  assert.match(debugClient.stderr, /tools\/list received/);
  const selfTest = spawnSync(process.execPath, [selfTestPath], {
    cwd: independentCwd,
    encoding: 'utf8',
    env: isolatedEnvironment(independentCwd),
    windowsHide: true,
  });
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  assert.match(selfTest.stdout, /MCP server: OK/);
  assert.match(selfTest.stdout, /Protocol: 2025-06-18/);
  assert.match(selfTest.stdout, /Tools: 27/);
  rmSync(independentCwd, { recursive: true, force: true });

  const pluginRoot = mkdtempSync(join(canonicalTmpdir, 'Coordinate Agents Plugin Fixture '));
  try {
    for (const entry of ['mcp', 'skills', 'bin', 'lib', '.codex-plugin']) {
      cpSync(join(root, entry), join(pluginRoot, entry), { recursive: true });
    }
    cpSync(join(root, 'package.json'), join(pluginRoot, 'package.json'));
    const handshake = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ].map(message => JSON.stringify(message)).join('\n') + '\n';
    const launched = spawnSync(process.execPath, ['./mcp/server.mjs', '--stdio'], {
      cwd: pluginRoot,
      encoding: 'utf8',
      env: isolatedEnvironment(pluginRoot),
      input: handshake,
      windowsHide: true,
    });
    assert.equal(launched.status, 0, launched.stderr || launched.stdout);
    assert.equal(launched.stderr, '');
    const responses = launched.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(responses.length, 2);
    assert.equal(responses[0].result.protocolVersion, '2025-06-18');
    assert.equal(responses[1].result.tools.length, 27);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('MCP stdio workflow uses the same Runtime state and error contract as CLI', async () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-mcp-home-'));
  const count = join(repository, 'fixture-count.txt');
  const command = fixtureCommand(repository, 'fixture-implementer');
  const env = isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'fixture-implementer',
    BUS_TOOL: busTool,
    FIXTURE_COMMIT: 'mcp1234',
    FIXTURE_COUNT: count,
  });
  const client = new StdioMcpClient(env);
  try {
    const init = await client.request('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '1' }, capabilities: {} });
    assert.equal(init.result.protocolVersion, '2025-06-18');

    const cliDiscovered = invokeCli(['setup', '--root', repository, '--json'], env);
    assert.equal(cliDiscovered.status, 0, cliDiscovered.stderr);
    const discovered = await client.request('tools/call', {
      name: 'coordinate_agents_setup_discover',
      arguments: { root: repository },
    });
    assert.equal(discovered.result.structuredContent.ok, true);
    assert.equal(discovered.result.structuredContent.command, 'setup');
    assert.deepEqual(discovered.result.structuredContent, JSON.parse(cliDiscovered.stdout));
    assert.deepEqual(Object.keys(discovered.result.structuredContent).sort(), ['adapters', 'agents', 'availableCommands', 'command', 'configuredAgents', 'detectedButNotConfigured', 'ok', 'projectConfigPath', 'root', 'userConfigPath'].sort());
    assert.ok(discovered.result.structuredContent.adapters.some(adapter => adapter.id === 'generic-cli'));

    const setupArgs = JSON.stringify(['{prompt}']);
    const cliConfigured = invokeCli([
      'setup', 'configure', '--root', repository, '--agent', 'fixture-implementer',
      '--command', command, '--adapter', 'generic-cli', '--args', setupArgs,
      '--json',
    ], env);
    assert.equal(cliConfigured.status, 0, cliConfigured.stderr);
    const configured = await client.request('tools/call', {
      name: 'coordinate_agents_setup_configure',
      arguments: {
        root: repository,
        agent: 'fixture-implementer',
        command,
        adapter: 'generic-cli',
        args: ['{prompt}'],
        role: 'implementer',
      },
    });
    assert.equal(configured.result.structuredContent.ok, true);
    assert.equal(configured.result.structuredContent.command, 'setup.configure');
    assert.equal(configured.result.structuredContent.workflow.implementer, 'fixture-implementer');
    assert.deepEqual(configured.result.structuredContent, JSON.parse(cliConfigured.stdout));

    const cliCreatedParity = invokeCli([
      'task', 'create', '--root', repository, '--id', 'task-cli-create-parity',
      '--title', 'Parity create task', '--json',
    ], env);
    assert.equal(cliCreatedParity.status, 0, cliCreatedParity.stderr);
    const mcpCreatedParity = await client.request('tools/call', {
      name: 'coordinate_agents_task_create',
      arguments: { root: repository, id: 'task-mcp-create-parity', title: 'Parity create task' },
    });
    assert.deepEqual(
      taskParityFields(mcpCreatedParity.result.structuredContent.task),
      taskParityFields(JSON.parse(cliCreatedParity.stdout).task),
    );

    const created = await client.request('tools/call', {
      name: 'coordinate_agents_task_create',
      arguments: { root: repository, id: 'task-mcp-e2e', title: 'MCP fixture task' },
    });
    assert.equal(created.result.structuredContent.ok, true);
    assert.equal(created.result.structuredContent.task.status, 'CREATED');

    const inspected = await client.request('tools/call', {
      name: 'coordinate_agents_task_inspect',
      arguments: { root: repository, taskId: 'task-mcp-e2e' },
    });
    const cliInspect = invokeCli(['task', 'inspect', '--root', repository, '--id', 'task-mcp-e2e', '--json'], env);
    assert.equal(cliInspect.status, 0, cliInspect.stderr);
    assert.deepEqual(inspected.result.structuredContent.task, JSON.parse(cliInspect.stdout).task);

    const dispatched = await client.request('tools/call', {
      name: 'coordinate_agents_task_dispatch',
      arguments: { root: repository, taskId: 'task-mcp-e2e', spec: 'Implement the fixture workflow.' },
    });
    assert.equal(dispatched.result.structuredContent.ok, true);
    assert.equal(dispatched.result.structuredContent.command, 'task.dispatch');
    assert.equal(dispatched.result.structuredContent.task.status, 'REVIEWING');
    assert.equal(dispatched.result.structuredContent.task.implementationCommit, 'mcp1234');
    assert.equal(readFileSync(count, 'utf8'), '1');

    const changes = await client.request('tools/call', {
      name: 'coordinate_agents_task_review',
      arguments: { root: repository, taskId: 'task-mcp-e2e', decision: 'CHANGES_REQUESTED', feedback: 'Add one fixture assertion.' },
    });
    assert.equal(changes.result.structuredContent.ok, true);
    assert.equal(changes.result.structuredContent.task.status, 'CHANGES_REQUESTED');
    assert.equal(changes.result.structuredContent.task.round, 2);

    const cliReviewCreated = invokeCli([
      'task', 'create', '--root', repository, '--id', 'task-cli-review-parity',
      '--title', 'Parity review task', '--json',
    ], env);
    assert.equal(cliReviewCreated.status, 0, cliReviewCreated.stderr);
    const cliReviewDispatched = invokeCli([
      'task', 'dispatch', '--root', repository, '--id', 'task-cli-review-parity',
      '--spec', 'Implement the fixture workflow.', '--json',
    ], env);
    assert.equal(cliReviewDispatched.status, 0, cliReviewDispatched.stderr);
    const cliChanges = invokeCli([
      'task', 'review', '--root', repository, '--id', 'task-cli-review-parity',
      '--decision', 'CHANGES_REQUESTED', '--feedback', 'Add one fixture assertion.', '--json',
    ], env);
    assert.equal(cliChanges.status, 0, cliChanges.stderr);
    assert.deepEqual(
      {
        status: JSON.parse(cliChanges.stdout).task.status,
        round: JSON.parse(cliChanges.stdout).task.round,
        reviewDecision: JSON.parse(cliChanges.stdout).task.reviewDecision,
        reviewFeedback: JSON.parse(cliChanges.stdout).task.reviewFeedback,
      },
      {
        status: changes.result.structuredContent.task.status,
        round: changes.result.structuredContent.task.round,
        reviewDecision: changes.result.structuredContent.task.reviewDecision,
        reviewFeedback: changes.result.structuredContent.task.reviewFeedback,
      },
    );

    const redispatched = await client.request('tools/call', {
      name: 'coordinate_agents_task_dispatch',
      arguments: { root: repository, taskId: 'task-mcp-e2e' },
    });
    assert.equal(redispatched.result.structuredContent.task.status, 'REVIEWING');
    assert.equal(redispatched.result.structuredContent.task.round, 2);
    assert.equal(readFileSync(count, 'utf8'), '111');

    const approved = await client.request('tools/call', {
      name: 'coordinate_agents_task_review',
      arguments: { root: repository, taskId: 'task-mcp-e2e', decision: 'REVIEW_APPROVED' },
    });
    assert.equal(approved.result.structuredContent.task.status, 'APPROVED');
    assert.match(approved.result.structuredContent.review.messagePath, /IMPLEMENT|REVIEW/i);

    const recovery = await client.request('tools/call', {
      name: 'coordinate_agents_recover_inspect',
      arguments: { root: repository, taskId: 'task-mcp-e2e' },
    });
    assert.equal(recovery.result.structuredContent.ok, true);
    assert.equal(recovery.result.structuredContent.recommendedRecovery.automaticRetry, false);
  } finally {
    await client.close();
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('MCP Setup and Task coordination expose and use one registered external adapter snapshot', async () => {
  const repository = tempRepository('coordinate-agents-mcp-external-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-mcp-external-home-'));
  const fixture = externalSessionFixture(repository);
  const modulePath = externalAdapterModule(repository);
  const env = isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'external-implementer',
    BUS_TOOL: busTool,
  });
  const registered = invokeCli(['adapter', 'register', modulePath, '--json'], env);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  const client = new StdioMcpClient(env);
  try {
    await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });

    const discoveredBeforeSetup = await client.request('tools/call', {
      name: 'coordinate_agents_setup_discover',
      arguments: { root: repository },
    });
    const adapterBeforeSetup = discoveredBeforeSetup.result.structuredContent.adapters
      .find(adapter => adapter.id === 'external-mcp-adapter');
    assert.deepEqual(adapterBeforeSetup.capabilities, {
      detection: true,
      configuration: true,
      oneShotLaunch: true,
      persistentSession: true,
    });
    assert.deepEqual(adapterBeforeSetup.configuredAgents, []);

    const configured = await client.request('tools/call', {
      name: 'coordinate_agents_setup_configure',
      arguments: {
        root: repository,
        agent: 'external-implementer',
        command: process.execPath,
        adapter: 'external-mcp-adapter',
        args: [fixture],
        role: 'implementer',
      },
    });
    assert.equal(configured.result.structuredContent.ok, true, JSON.stringify(configured));
    assert.equal(configured.result.structuredContent.agent.adapter, 'external-mcp-adapter');
    assert.equal(configured.result.structuredContent.agent.command, process.execPath);
    assert.equal(configured.result.structuredContent.agent.commandSource, 'user');
    assert.equal(configured.result.structuredContent.adapters.find(adapter => adapter.id === 'external-mcp-adapter').capabilities.persistentSession, true);

    const discoveredAfterSetup = await client.request('tools/call', {
      name: 'coordinate_agents_setup_discover',
      arguments: { root: repository },
    });
    const adapterAfterSetup = discoveredAfterSetup.result.structuredContent.adapters
      .find(adapter => adapter.id === 'external-mcp-adapter');
    assert.equal(adapterAfterSetup.configuredAgents[0].id, 'external-implementer');
    assert.equal(adapterAfterSetup.configuredAgents[0].command, process.execPath);
    assert.equal(adapterAfterSetup.configuredAgents[0].available, true);
    const externalAgent = discoveredAfterSetup.result.structuredContent.agents
      .find(agent => agent.configuredAgent === 'external-implementer');
    assert.equal(externalAgent.adapter, 'external-mcp-adapter');
    assert.equal(externalAgent.available, true);

    const created = await client.request('tools/call', {
      name: 'coordinate_agents_task_create',
      arguments: {
        root: repository,
        id: 'task-mcp-external',
        title: 'MCP external adapter task',
        spec: 'Exercise the registered external adapter through MCP.',
      },
    });
    assert.equal(created.result.structuredContent.ok, true, JSON.stringify(created));
    const dispatched = await client.request('tools/call', {
      name: 'coordinate_agents_task_dispatch',
      arguments: { root: repository, taskId: 'task-mcp-external' },
    });
    assert.equal(dispatched.result.structuredContent.ok, true, JSON.stringify(dispatched));
    assert.equal(dispatched.result.structuredContent.task.status, 'REVIEWING');
    assert.equal(dispatched.result.structuredContent.agent.adapter, 'external-mcp-adapter');
    assert.equal(dispatched.result.structuredContent.agent.adapterCapabilities.persistentSession, true);
    assert.equal(dispatched.result.structuredContent.task.sessionId, dispatched.result.structuredContent.session.id);

    const closed = await client.request('tools/call', {
      name: 'coordinate_agents_session_close',
      arguments: { root: repository, sessionId: dispatched.result.structuredContent.session.id, graceful: false, timeoutMs: 1_000 },
    });
    assert.equal(closed.result.structuredContent.ok, true, JSON.stringify(closed));
    assert.equal(closed.result.structuredContent.session.pid, null);
  } finally {
    await client.close();
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('MCP exposes the bounded persistent Session lifecycle through the canonical service', async () => {
  const repository = tempRepository('coordinate-agents-mcp-session-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-mcp-session-home-'));
  const client = new StdioMcpClient(isolatedEnvironment(home));
  const source = "console.log('session-ready'); process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => console.log('received:' + chunk)); setInterval(() => {}, 120_000);";
  try {
    await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const configured = await client.request('tools/call', {
      name: 'coordinate_agents_setup_configure',
      arguments: {
        root: repository,
        agent: 'node',
        command: process.execPath,
        adapter: 'generic-cli',
        args: ['-e', source],
        role: 'implementer',
      },
    });
    assert.equal(configured.result.structuredContent.ok, true);

    const opened = await client.request('tools/call', {
      name: 'coordinate_agents_session_open',
      arguments: { root: repository, agent: 'node', initialPrompt: 'first session input' },
    });
    assert.equal(opened.result.structuredContent.ok, true);
    const sessionId = opened.result.structuredContent.session.id;
    assert.equal(opened.result.structuredContent.session.agent, 'node');
    assert.equal(opened.result.structuredContent.session.command, process.execPath);

    const reused = await client.request('tools/call', {
      name: 'coordinate_agents_session_open',
      arguments: { root: repository, agent: 'node' },
    });
    assert.equal(reused.result.structuredContent.reused, true);
    assert.equal(reused.result.structuredContent.session.id, sessionId);

    const status = await client.request('tools/call', {
      name: 'coordinate_agents_session_status',
      arguments: { root: repository, sessionId },
    });
    assert.ok(['running', 'idle', 'busy'].includes(status.result.structuredContent.session.state));

    const written = await client.request('tools/call', {
      name: 'coordinate_agents_session_write',
      arguments: { root: repository, sessionId, input: 'second session input' },
    });
    assert.equal(written.result.structuredContent.ok, true);

    let inspected;
    // A PTY-backed CLI may need a few seconds to initialize under the full
    // cross-platform test matrix before it starts echoing application output.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      inspected = await client.request('tools/call', {
        name: 'coordinate_agents_session_inspect',
        arguments: { root: repository, sessionId, maxLines: 20, maxBytes: 4096 },
      });
      if (inspected.result.structuredContent.output.output.includes('received:')) break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
    }
    assert.match(inspected.result.structuredContent.output.output, /received:/);

    const read = await client.request('tools/call', {
      name: 'coordinate_agents_session_read',
      arguments: { root: repository, sessionId, maxLines: 20, maxBytes: 4096 },
    });
    assert.match(read.result.structuredContent.output, /session-ready/);

    const closed = await client.request('tools/call', {
      name: 'coordinate_agents_session_close',
      arguments: { root: repository, sessionId, timeoutMs: 500 },
    });
    assert.ok(['exited', 'failed'].includes(closed.result.structuredContent.session.state));
  } finally {
    await client.close();
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('MCP preserves runtime failure semantics, recovery facts, and explicit resume', async () => {
  const repository = tempRepository('coordinate-agents-mcp-recovery-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-mcp-recovery-home-'));
  const count = join(repository, 'fixture-count.txt');
  const command = fixtureCommand(repository, 'fixture-recoverable');
  const failureEnv = isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'fixture-recoverable',
    BUS_TOOL: busTool,
    FIXTURE_COMMIT: 'recover123',
    FIXTURE_COUNT: count,
    FIXTURE_MODE: 'failure',
  });
  const successEnv = { ...failureEnv, FIXTURE_MODE: 'success' };
  const clients = [];
  try {
    const failingClient = new StdioMcpClient(failureEnv);
    clients.push(failingClient);
    await failingClient.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const configured = await failingClient.request('tools/call', {
      name: 'coordinate_agents_setup_configure',
      arguments: {
        root: repository,
        agent: 'fixture-recoverable',
        command,
        adapter: 'generic-cli',
        args: ['{prompt}'],
        role: 'implementer',
      },
    });
    assert.equal(configured.result.structuredContent.ok, true);
    await failingClient.request('tools/call', {
      name: 'coordinate_agents_task_create',
      arguments: { root: repository, id: 'task-mcp-recovery', title: 'MCP recovery task', spec: 'Recover the fixture workflow.' },
    });

    const failed = await failingClient.request('tools/call', {
      name: 'coordinate_agents_task_dispatch',
      arguments: { root: repository, taskId: 'task-mcp-recovery' },
    });
    assert.equal(failed.result.isError, true);
    assert.equal(failed.result.structuredContent.ok, false);
    assert.equal(failed.result.structuredContent.error.code, 'AGENT_EXIT_NONZERO');
    assert.equal(readFileSync(count, 'utf8'), '1');

    const recovery = await failingClient.request('tools/call', {
      name: 'coordinate_agents_recover_inspect',
      arguments: { root: repository, taskId: 'task-mcp-recovery' },
    });
    assert.equal(recovery.result.structuredContent.task.status, 'ERROR');
    assert.equal(recovery.result.structuredContent.recommendedRecovery.automaticRetry, false);
    assert.equal(recovery.result.structuredContent.recommendedRecovery.resumeRequired, true);

    const blockedRetry = await failingClient.request('tools/call', {
      name: 'coordinate_agents_task_dispatch',
      arguments: { root: repository, taskId: 'task-mcp-recovery' },
    });
    assert.equal(blockedRetry.result.isError, true);
    assert.equal(blockedRetry.result.structuredContent.error.code, 'TASK_STATE_CONFLICT');
    assert.equal(readFileSync(count, 'utf8'), '1');

    const resumed = await failingClient.request('tools/call', {
      name: 'coordinate_agents_task_resume',
      arguments: { root: repository, taskId: 'task-mcp-recovery' },
    });
    assert.equal(resumed.result.structuredContent.task.status, 'SPEC_READY');
    await failingClient.close();
    clients.splice(clients.indexOf(failingClient), 1);

    const retryClient = new StdioMcpClient(successEnv);
    clients.push(retryClient);
    await retryClient.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const retried = await retryClient.request('tools/call', {
      name: 'coordinate_agents_task_dispatch',
      arguments: { root: repository, taskId: 'task-mcp-recovery' },
    });
    assert.equal(retried.result.structuredContent.task.status, 'REVIEWING');
    assert.equal(readFileSync(count, 'utf8'), '11');
  } finally {
    for (const client of clients) await client.close();
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('MCP domain failures are structured and do not become protocol errors', async () => {
  const repository = tempRepository('coordinate-agents-mcp-error-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-mcp-error-home-'));
  const server = createMcpServer({ root });
  try {
    const created = await server.handle({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'coordinate_agents_task_create', arguments: { root: repository, id: 'task-error', title: 'Error task', spec: 'approved' } },
    });
    assert.equal(created.result.structuredContent.ok, true);
    const configPath = join(repository, '.agent-bus', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.agents.find(agent => agent.id === 'antigravity').command = 'missing-coordinate-agents-mcp-executable';
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const missing = await server.handle({
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: { name: 'coordinate_agents_task_dispatch', arguments: { root: repository, taskId: 'task-error' } },
    });
    assert.equal(missing.result.isError, true);
    assert.equal(missing.result.structuredContent.ok, false);
    assert.equal(missing.result.structuredContent.command, 'task.dispatch');
    assert.equal(missing.result.structuredContent.error.code, 'EXECUTABLE_NOT_FOUND');
    assert.equal(missing.error, undefined);
    const invalidTool = await server.handle({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } });
    assert.equal(invalidTool.error.code, -32601);
    assert.equal(existsSync(join(repository, '.agent-bus', 'tasks', 'task-error.json')), true);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('MCP stdio Task Graph operations preserve CLI facts and keep graph failures inside structured content', async () => {
  const repository = tempRepository('coordinate-agents-mcp-graph-gate-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-mcp-graph-home-'));
  const env = isolatedEnvironment(home);
  const client = new StdioMcpClient(env);
  const parentTaskId = 'task-mcp-graph-gate';
  const graph = {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Prove MCP Task Graph protocol purity',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
      { id: 'dependent', implementer: 'antigravity', spec: 'Implement dependent.', dependsOn: ['alpha'] },
    ],
    maxConcurrency: 1,
  };
  try {
    const initialized = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'task-graph-gate', version: '1' },
      capabilities: {},
    });
    assert.equal(initialized.result.protocolVersion, '2025-06-18');

    const created = await client.request('tools/call', {
      name: 'coordinate_agents_task_graph_create',
      arguments: { root: repository, graph },
    });
    assert.equal(created.error, undefined);
    assert.equal(created.result.isError, false);
    assert.equal(created.result.structuredContent.command, 'task.graph-create');
    assert.equal(created.result.structuredContent.graph.parentTaskId, parentTaskId);

    const planned = await client.request('tools/call', {
      name: 'coordinate_agents_task_graph_plan',
      arguments: { root: repository, taskId: parentTaskId },
    });
    assert.equal(planned.error, undefined);
    assert.equal(planned.result.isError, false);
    assert.equal(planned.result.structuredContent.command, 'task.graph-plan');
    assert.deepEqual(planned.result.structuredContent.plan.eligible.map(item => item.subtaskId), ['alpha']);

    const cliStatus = invokeCli(['task', 'graph-status', '--root', repository, '--id', parentTaskId, '--json'], env);
    assert.equal(cliStatus.status, 0, cliStatus.stderr || cliStatus.stdout);
    const cliGraph = JSON.parse(cliStatus.stdout).graph;
    const mcpStatus = await client.request('tools/call', {
      name: 'coordinate_agents_task_status',
      arguments: { root: repository, taskId: parentTaskId },
    });
    assert.deepEqual(
      mcpStatus.result.structuredContent.graph.subtasks.map(item => ({ id: item.id, state: item.state, dependsOn: item.dependsOn })),
      cliGraph.subtasks.map(item => ({ id: item.id, state: item.state, dependsOn: item.dependsOn })),
    );
    assert.deepEqual(mcpStatus.result.structuredContent.graph.frontier, cliGraph.frontier);

    const invalid = await client.request('tools/call', {
      name: 'coordinate_agents_task_graph_validate',
      arguments: {
        root: repository,
        graph: {
          ...graph,
          parentTask: { ...graph.parentTask, id: 'task-mcp-cycle' },
          subtasks: [
            { id: 'alpha', implementer: 'antigravity', spec: 'Alpha.', dependsOn: ['beta'] },
            { id: 'beta', implementer: 'antigravity', spec: 'Beta.', dependsOn: ['alpha'] },
          ],
        },
      },
    });
    assert.equal(invalid.error, undefined);
    assert.equal(invalid.result.isError, true);
    assert.equal(invalid.result.structuredContent.ok, false);
    assert.equal(invalid.result.structuredContent.error.code, 'TASK_GRAPH_INVALID');
    assert.equal(invalid.result.structuredContent.error.stage, 'graph-validation');
    assert.equal(existsSync(join(repository, '.agent-bus', 'worktrees')), false);
    assert.equal(existsSync(join(repository, '.agent-bus', 'sessions')), false);
  } finally {
    await client.close();
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Protocol schemas and Plugin MCP packaging stay version-stable', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(readFileSync(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pluginJson.version, packageJson.version);
  assert.equal(pluginJson.mcpServers, './.mcp.json');
  const mcpConfig = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
  const serverIds = Object.keys(mcpConfig.mcpServers);
  assert.deepEqual(serverIds, ['coordinate_agents']);
  assert.equal(serverIds.some(id => id.includes('-')), false);
  assert.deepEqual(mcpConfig.mcpServers.coordinate_agents.args, ['./mcp/server.mjs', '--stdio']);
  assert.equal(mcpConfig.mcpServers.coordinate_agents.cwd, '.');
  assert.equal(existsSync(join(root, 'mcp', 'self-test.mjs')), true);
  assert.equal(packageJson.scripts['mcp:self-test'], 'node mcp/self-test.mjs');
  assert.equal(packageJson.files.includes('docs/MCP_TROUBLESHOOTING.md'), true);
  for (const name of ['task.schema.json', 'task-graph-v1.schema.json', 'task-graph-v1-record.schema.json', 'task-graph-v1-plan.schema.json', 'task-graph-v1-run.schema.json', 'task-graph-v1-recovery.schema.json', 'scope-audit-v1.schema.json', 'runtime-error.schema.json', 'evidence.schema.json']) {
    const schema = JSON.parse(readFileSync(join(root, 'schemas', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  }
});
