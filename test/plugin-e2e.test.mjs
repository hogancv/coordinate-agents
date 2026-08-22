import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveCanonicalRuntime } from '../skills/coordinate-agents/scripts/runtime-entry.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}

function tempRepository(prefix = 'coordinate-agents-plugin-e2e-') {
  const repository = mkdtempSync(join(tmpdir(), prefix));
  const init = spawnSync('git', ['init', repository], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return repository;
}

function isolatedEnvironment(home, extra = {}) {
  return {
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

function configureFixture(repository, home, command, extra = {}) {
  const result = invoke([
    'setup', 'configure', '--agent', 'fixture-implementer', '--command', command,
    '--adapter', 'generic-cli', '--args', '["{prompt}"]', '--root', repository, '--json',
  ], isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'fixture-implementer',
    BUS_TOOL: busTool,
    ...extra,
  }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'setup.configure');
  assert.equal(payload.agent.id, 'fixture-implementer');
  assert.equal(payload.agent.adapter, 'generic-cli');
  assert.equal(payload.agent.commandSource, 'user');
  assert.equal(payload.agent.available, true);
  assert.equal(payload.workflow.implementer, 'fixture-implementer');
  return payload;
}

test('Plugin runtime resolves the cached canonical bin without a global CLI', () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'coordinate agents plugin cache with spaces-'));
  const legacyRoot = mkdtempSync(join(tmpdir(), 'coordinate agents legacy skill-'));
  const home = mkdtempSync(join(tmpdir(), 'coordinate agents plugin home-'));
  const repository = tempRepository('coordinate-agents-plugin-runtime-repo-');
  try {
    cpSync(join(root, 'bin'), join(pluginRoot, 'bin'), { recursive: true });
    cpSync(join(root, 'skills'), join(pluginRoot, 'skills'), { recursive: true });
    cpSync(join(root, '.codex-plugin'), join(pluginRoot, '.codex-plugin'), { recursive: true });
    cpSync(join(root, 'package.json'), join(pluginRoot, 'package.json'));

    const cachedEntry = join(pluginRoot, 'skills', 'coordinate-setup', '..', 'coordinate-agents', 'scripts', 'runtime-entry.mjs');
    const resolved = resolveCanonicalRuntime({ entryPath: cachedEntry, env: isolatedEnvironment(home) });
    assert.equal(resolved.kind, 'file');
    assert.equal(resolve(resolved.root), resolve(pluginRoot));

    const marketplacePath = join(home, '.agents', 'plugins', 'marketplace.json');
    mkdirSync(join(home, '.agents', 'plugins'), { recursive: true });
    writeFileSync(marketplacePath, JSON.stringify({
      name: 'personal',
      plugins: [{
        name: 'coordinate-agents',
        source: {
          source: 'local',
          path: relative(join(home, '.agents', 'plugins'), pluginRoot),
        },
      }],
    }), 'utf8');
    const personalEntry = join(legacyRoot, 'skills', 'coordinate-setup', 'runtime-entry.mjs');
    mkdirSync(join(legacyRoot, 'skills', 'coordinate-setup'), { recursive: true });
    writeFileSync(personalEntry, '', 'utf8');
    const personalResolved = resolveCanonicalRuntime({
      entryPath: personalEntry,
      env: isolatedEnvironment(home, { CODEX_HOME: join(home, 'empty-codex') }),
    });
    assert.equal(resolve(personalResolved.root), resolve(pluginRoot));

    const emptyPath = mkdtempSync(join(tmpdir(), 'coordinate-agents-no-global-bin-'));
    const result = spawnSync(process.execPath, [cachedEntry, 'setup', '--root', repository, '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: isolatedEnvironment(home, { PATH: emptyPath }),
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'setup');
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(legacyRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test('setup configure performs discovery-compatible Implementer registration and agnostic identity mapping', () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-setup-home-'));
  const command = fixtureCommand(repository, 'fixture-implementer');
  try {
    const payload = configureFixture(repository, home, command);
    const userConfig = JSON.parse(readFileSync(join(home, '.coordinate-agents', 'config.json'), 'utf8'));
    assert.equal(userConfig.agents['fixture-implementer'].command, command);
    assert.deepEqual(userConfig.agents['fixture-implementer'].args, ['{prompt}']);

    const projectConfig = JSON.parse(readFileSync(join(repository, '.agent-bus', 'config.json'), 'utf8'));
    const registered = projectConfig.agents.find(agent => agent.id === 'fixture-implementer');
    assert.deepEqual(registered, { id: 'fixture-implementer', adapter: 'generic-cli' });
    assert.equal(projectConfig.workflow.implementer, 'fixture-implementer');
    assert.equal(payload.doctor.ok, true);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('setup configure preserves Antigravity identity while selecting agy-proxy executable', () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-agy-proxy-home-'));
  const command = fixtureCommand(repository, 'agy-proxy');
  try {
    const result = invoke([
      'setup', 'configure', '--agent', 'agy-proxy', '--command', command,
      '--root', repository, '--json',
    ], isolatedEnvironment(home));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.agent.id, 'antigravity');
    assert.equal(payload.agent.adapter, 'antigravity-cli');
    assert.equal(payload.agent.command, command);
    assert.equal(payload.agent.commandSource, 'user');
    const config = JSON.parse(readFileSync(join(home, '.coordinate-agents', 'config.json'), 'utf8'));
    assert.equal(config.agents.antigravity.command, command);
    const project = JSON.parse(readFileSync(join(repository, '.agent-bus', 'config.json'), 'utf8'));
    assert.equal(project.workflow.implementer, 'antigravity');
    assert.equal(project.agents.find(agent => agent.id === 'antigravity').command, undefined);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('agy-proxy override is the command actually launched by Task dispatch', () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-agy-proxy-dispatch-home-'));
  const command = fixtureCommand(repository, 'agy-proxy');
  const env = isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'antigravity',
    BUS_TOOL: busTool,
    FIXTURE_COMMIT: 'agyproxy1',
  });
  try {
    const configured = invoke([
      'setup', 'configure', '--agent', 'antigravity', '--command', command,
      '--adapter', 'antigravity-cli', '--args', '["{prompt}"]', '--root', repository, '--json',
    ], env);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const created = invoke([
      'task', 'create', '--root', repository, '--title', 'Launch custom wrapper', '--json',
    ], env);
    const taskId = JSON.parse(created.stdout).task.id;
    const dispatched = invoke([
      'task', 'dispatch', '--root', repository, '--id', taskId,
      '--spec', 'Use the configured wrapper and report completion.', '--json',
    ], env);
    assert.equal(dispatched.status, 0, dispatched.stderr || dispatched.stdout);
    const payload = JSON.parse(dispatched.stdout);
    assert.equal(payload.task.status, 'REVIEWING');
    assert.equal(payload.agent.id, 'antigravity');
    assert.equal(payload.agent.adapter, 'antigravity-cli');
    assert.equal(payload.agent.command, command);
    assert.equal(payload.agent.command.includes('agy-proxy'), true);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('generic setup rejects executable detection without an adapter prompt contract', () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-generic-compat-home-'));
  const command = fixtureCommand(repository, 'generic-no-template');
  try {
    const result = invoke([
      'setup', 'configure', '--agent', 'claude', '--command', command,
      '--adapter', 'generic-cli', '--root', repository, '--json',
    ], isolatedEnvironment(home));
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(existsSync(join(home, '.coordinate-agents', 'config.json')), false);
    assert.equal(existsSync(join(repository, '.agent-bus')), false);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Task dispatch owns IMPLEMENT handoff, launch, implementation sync, review, changes, and approval', async () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-task-e2e-home-'));
  const command = fixtureCommand(repository, 'fixture-implementer');
  const env = isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'fixture-implementer',
    BUS_TOOL: busTool,
    FIXTURE_COMMIT: 'abc1234',
  });
  try {
    configureFixture(repository, home, command, env);
    const created = invoke([
      'task', 'create', '--root', repository, '--title', 'Build Todo', '--json',
    ], env);
    assert.equal(created.status, 0, created.stderr);
    const taskId = JSON.parse(created.stdout).task.id;

    const dispatched = invoke([
      'task', 'dispatch', '--root', repository, '--id', taskId,
      '--spec', 'Build the approved Todo flow and add tests.', '--json',
    ], env);
    assert.equal(dispatched.status, 0, dispatched.stderr);
    assert.equal(dispatched.stderr, '');
    const dispatchPayload = JSON.parse(dispatched.stdout);
    assert.equal(dispatchPayload.command, 'task.dispatch');
    assert.equal(dispatchPayload.task.status, 'REVIEWING');
    assert.equal(dispatchPayload.transport.type, 'IMPLEMENT');
    assert.equal(dispatchPayload.task.implementationCommit, 'abc1234');
    assert.equal(dispatchPayload.task.evidence.length, 1);

    const reviewed = invoke([
      'task', 'review', '--root', repository, '--id', taskId,
      '--decision', 'CHANGES_REQUESTED', '--feedback', 'Add a regression test for empty input.', '--json',
    ], env);
    assert.equal(reviewed.status, 0, reviewed.stderr);
    const changes = JSON.parse(reviewed.stdout).task;
    assert.equal(changes.status, 'CHANGES_REQUESTED');
    assert.equal(changes.round, 2);
    assert.match(changes.reviewFeedback, /regression test/);

    const redispatched = invoke([
      'task', 'dispatch', '--root', repository, '--id', taskId, '--json',
    ], env);
    assert.equal(redispatched.status, 0, redispatched.stderr);
    const second = JSON.parse(redispatched.stdout).task;
    assert.equal(second.status, 'REVIEWING');
    assert.equal(second.round, 2);
    assert.equal(second.evidence.length, 2);

    const approved = invoke([
      'task', 'review', '--root', repository, '--id', taskId,
      '--decision', 'REVIEW_APPROVED', '--json',
    ], env);
    assert.equal(approved.status, 0, approved.stderr);
    assert.equal(JSON.parse(approved.stdout).task.status, 'APPROVED');

    const rejected = invoke([
      'task', 'dispatch', '--root', repository, '--id', taskId, '--json',
    ], env);
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stdout).error.code, 'TASK_STATE_CONFLICT');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Task dispatch fails closed for missing executables and runtime exits, then requires explicit resume', () => {
  const repository = tempRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-task-error-home-'));
  const command = fixtureCommand(repository, 'fixture-implementer');
  const count = join(repository, 'launch-count.txt');
  const env = isolatedEnvironment(home, {
    FIXTURE_ROOT: repository,
    FIXTURE_AGENT: 'fixture-implementer',
    BUS_TOOL: busTool,
    FIXTURE_COUNT: count,
  });
  try {
    configureFixture(repository, home, command, env);
    const createMissing = invoke(['task', 'create', '--root', repository, '--title', 'Missing executable', '--spec', 'spec', '--json'], env);
    const missingId = JSON.parse(createMissing.stdout).task.id;
    const setMissing = invoke(['config', 'set', 'agent.fixture-implementer.command', 'nonexistent-coordinate-implementer', '--json'], env);
    assert.equal(setMissing.status, 0, setMissing.stderr);
    const missing = invoke(['task', 'dispatch', '--root', repository, '--id', missingId, '--json'], env);
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).error.code, 'EXECUTABLE_NOT_FOUND');
    assert.equal(JSON.parse(invoke(['task', 'status', '--root', repository, '--id', missingId, '--json'], env).stdout).task.status, 'ERROR');
    const busStatus = JSON.parse(spawnSync(process.execPath, [busTool, 'status', '--root', repository], { encoding: 'utf8', windowsHide: true }).stdout);
    assert.equal(busStatus.queues['fixture-implementer'].new, 0);

    // Restore the executable and prove that ERROR cannot be dispatched until
    // the user explicitly resumes the Task.
    invoke(['config', 'set', 'agent.fixture-implementer.command', command, '--json'], env);
    const blocked = invoke(['task', 'dispatch', '--root', repository, '--id', missingId, '--json'], env);
    assert.equal(blocked.status, 1);
    assert.equal(JSON.parse(blocked.stdout).error.code, 'TASK_STATE_CONFLICT');
    const resumed = invoke(['task', 'resume', '--root', repository, '--id', missingId, '--json'], env);
    assert.equal(resumed.status, 0);
    assert.equal(JSON.parse(resumed.stdout).task.status, 'SPEC_READY');

    // A process that starts and exits non-zero produces the canonical runtime
    // error and exactly one activation.
    const createRuntime = invoke(['task', 'create', '--root', repository, '--title', 'Runtime failure', '--spec', 'spec', '--json'], env);
    const runtimeId = JSON.parse(createRuntime.stdout).task.id;
    const failed = invoke(['task', 'dispatch', '--root', repository, '--id', runtimeId, '--json'], {
      ...env,
      FIXTURE_MODE: 'failure',
    });
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).error.code, 'AGENT_EXIT_NONZERO');
    assert.equal(readFileSync(count, 'utf8'), '1');
    const runtimeTask = JSON.parse(invoke(['task', 'status', '--root', repository, '--id', runtimeId, '--json'], env).stdout).task;
    assert.equal(runtimeTask.status, 'ERROR');
    assert.equal(runtimeTask.lastError.code, 'AGENT_EXIT_NONZERO');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
