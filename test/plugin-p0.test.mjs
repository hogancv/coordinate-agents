import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverCodingClis } from '../skills/coordinate-agents/scripts/discovery.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'coordinate-agents.mjs');

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}

function tempGitRepository() {
  const repository = mkdtempSync(join(tmpdir(), 'coordinate-agents-p0-'));
  const init = spawnSync('git', ['init', repository], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return repository;
}

test('Plugin exposes all P0 Skills with valid metadata and exact onboarding prompts', () => {
  const expectedSkills = ['coordinate-agents', 'coordinate-setup', 'coordinate-task', 'coordinate-review', 'coordinate-recover'];
  for (const name of expectedSkills) {
    const path = join(root, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(path), `${name} Skill must exist`);
    const content = readFileSync(path, 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
    assert.match(frontmatter, new RegExp(`(?:^|\\n)name:\\s*${name}(?:\\s|$)`));
    assert.match(frontmatter, /description:\s*>?-/);
  }

  const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.deepEqual(manifest.interface.defaultPrompt, [
    'Check which coding CLIs are available on this computer and help me configure Coordinate Agents.',
    'Help me choose and configure an available CLI as the implementation agent.',
    'Use $coordinate-agents to build a simple Todo web app in the current project.',
  ]);
  assert.match(manifest.description, /Codex-native orchestration/i);
  assert.match(manifest.interface.longDescription, /external coding agent/i);
});

test('setup discovery reports actual executable facts without mutating configuration', () => {
  const result = discoverCodingClis({ root, commands: ['definitely-not-installed-coordinate-agent'] });
  assert.deepEqual(result, [{
    command: 'definitely-not-installed-coordinate-agent',
    available: false,
    resolvedCommand: null,
    version: null,
    code: 'EXECUTABLE_NOT_FOUND',
    details: 'Command not found: definitely-not-installed-coordinate-agent',
    configured: false,
    configuredAgent: null,
    adapter: null,
    status: 'unavailable',
  }]);
});

test('Task lifecycle persists records and JSON errors stay isolated on stdout', () => {
  const repository = tempGitRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-p0-home-'));
  try {
    const created = invoke(['task', 'create', '--root', repository, '--title', 'Build Todo', '--spec', 'Use the real workflow', '--json'], {
      COORDINATE_AGENTS_HOME: home,
    });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stderr, '');
    const createJson = JSON.parse(created.stdout);
    assert.equal(createJson.ok, true);
    assert.equal(createJson.command, 'task.create');
    assert.equal(createJson.task.status, 'CREATED');
    assert.deepEqual(Object.keys(createJson.task).filter(key => ['id', 'title', 'status', 'round', 'planner', 'implementer', 'reviewer', 'createdAt', 'updatedAt', 'spec', 'implementationCommit', 'evidence', 'lastError'].includes(key)).sort(), [
      'createdAt', 'evidence', 'id', 'implementationCommit', 'implementer', 'lastError', 'planner', 'reviewer', 'round', 'spec', 'status', 'title', 'updatedAt',
    ]);

    const id = createJson.task.id;
    const inspected = invoke(['task', 'inspect', '--root', repository, '--id', id, '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).task.id, id);

    const resumed = invoke(['task', 'resume', '--root', repository, '--id', id, '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).task.status, 'PLANNING');

    const failed = invoke(['task', 'error', '--root', repository, '--id', id, '--error-code', 'AGENT_EXIT_NONZERO', '--reason', 'fixture failure', '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(failed.status, 0, failed.stderr);
    const failedJson = JSON.parse(failed.stdout);
    assert.equal(failedJson.task.status, 'ERROR');
    assert.equal(failedJson.task.lastError.code, 'AGENT_EXIT_NONZERO');

    const missing = invoke(['task', 'inspect', '--root', repository, '--id', 'task-does-not-exist', '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(missing.status, 1);
    assert.equal(missing.stderr, '');
    const missingJson = JSON.parse(missing.stdout);
    assert.equal(missingJson.ok, false);
    assert.equal(missingJson.error.code, 'TASK_NOT_FOUND');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('launch JSON maps missing executables to a stable error and records Task ERROR', () => {
  const repository = tempGitRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-p0-launch-home-'));
  try {
    const quickstart = invoke(['quickstart', '--root', repository, '--task', 'P0 launch fixture', '--lang', 'en'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(quickstart.status, 0, quickstart.stderr);
    const created = invoke(['task', 'create', '--root', repository, '--title', 'Launch fixture', '--task', 'Launch fixture', '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(created.status, 0, created.stderr);
    const id = JSON.parse(created.stdout).task.id;

    const configPath = join(repository, '.agent-bus', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.agents.find(agent => agent.id === 'antigravity').command = 'missing-coordinate-agents-executable';
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const launch = invoke(['launch', '--root', repository, '--agent', 'antigravity', '--id', id, '--once', '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(launch.status, 1);
    assert.equal(launch.stderr, '');
    const json = JSON.parse(launch.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.command, 'launch');
    assert.equal(json.error.code, 'EXECUTABLE_NOT_FOUND');

    const status = invoke(['task', 'status', '--root', repository, '--id', id, '--json'], { COORDINATE_AGENTS_HOME: home });
    assert.equal(JSON.parse(status.stdout).task.status, 'ERROR');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
