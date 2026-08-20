import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function initRepository() {
  const repository = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-'));
  assert.equal(spawnSync('git', ['init', repository], { encoding: 'utf8' }).status, 0);
  return repository;
}

function fixtureCommand(repository, name, capturePath, exitCode = 0) {
  const bin = join(repository, 'fixture-bin');
  const source = `const fs = require('fs');
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ argv: process.argv.slice(2) }));
if (process.env.STDERR_MESSAGE) process.stderr.write(process.env.STDERR_MESSAGE);
process.exit(Number(process.env.EXIT_CODE || ${exitCode}));
`;
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    const script = join(bin, `${name}.cjs`);
    writeFileSync(script, source, 'utf8');
    writeFileSync(join(bin, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
  } else {
    const executable = join(bin, name);
    writeFileSync(executable, `#!${process.execPath}\n${source}`, 'utf8');
    chmodSync(executable, 0o755);
  }
  return {
    PATH: `${bin}${delimiter}${process.env.PATH || ''}`,
    CAPTURE: capturePath,
  };
}

function homeEnvironment(home, extra = {}) {
  return { HOME: home, USERPROFILE: home, ...extra };
}

function state(repository) {
  const result = spawnSync(process.execPath, [busTool, 'status', '--root', repository], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

test('config CLI persists a user command and launch uses it when project command is absent', () => {
  const repository = initRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-home-'));
  const capture = join(repository, 'capture.json');
  try {
    assert.equal(invoke(['quickstart', '--root', repository, '--task', 'custom command', '--lang', 'en']).status, 0);
    const config = invoke(['config', 'set', 'agent.antigravity.command', 'agy-proxy'], homeEnvironment(home));
    assert.equal(config.status, 0, config.stderr);
    assert.equal(invoke(['config', 'get', 'agent.antigravity.command'], homeEnvironment(home)).stdout.trim(), 'agy-proxy');

    const launch = invoke(['launch', '--agent', 'antigravity', '--once', '--root', repository, '--lang', 'en'], {
      ...homeEnvironment(home),
      ...fixtureCommand(repository, 'agy-proxy', capture),
    });
    assert.equal(launch.status, 0, launch.stderr);
    assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')).argv.slice(0, 1), ['--prompt-interactive']);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('project command overrides user command', () => {
  const repository = initRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-home-'));
  const capture = join(repository, 'capture.json');
  try {
    assert.equal(invoke(['quickstart', '--root', repository, '--task', 'project override', '--lang', 'en']).status, 0);
    const configPath = join(repository, '.agent-bus', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.agents.find(agent => agent.id === 'antigravity').command = 'agy-special';
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    assert.equal(invoke(['config', 'set', 'agent.antigravity.command', 'agy-proxy'], homeEnvironment(home)).status, 0);

    const launch = invoke(['launch', '--agent', 'antigravity', '--once', '--root', repository, '--lang', 'en'], {
      ...homeEnvironment(home),
      ...fixtureCommand(repository, 'agy-special', capture),
    });
    assert.equal(launch.status, 0, launch.stderr);
    assert.ok(existsSync(capture));
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('missing explicit command fails closed, records ERROR, and never falls back', () => {
  const repository = initRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-home-'));
  try {
    assert.equal(invoke(['quickstart', '--root', repository, '--task', 'missing command', '--lang', 'en']).status, 0);
    assert.equal(invoke(['config', 'set', 'agent.antigravity.command', 'nonexistent-agent'], homeEnvironment(home)).status, 0);
    const launch = invoke(['launch', '--agent', 'antigravity', '--once', '--root', repository, '--lang', 'en'], homeEnvironment(home));
    assert.equal(launch.status, 1);
    assert.match(launch.stderr, /Implementer unavailable/);
    assert.match(launch.stderr, /COMMAND_NOT_FOUND/);
    assert.match(launch.stderr, /nonexistent-agent/);
    assert.equal(state(repository).states.antigravity.state, 'ERROR');
    const artifacts = readdirSync(join(repository, '.agent-bus', 'logs')).filter(name => name.endsWith('.json'));
    assert.ok(artifacts.length >= 1);
    const artifact = JSON.parse(readFileSync(join(repository, '.agent-bus', 'logs', artifacts.at(-1)), 'utf8'));
    assert.equal(artifact.code, 'COMMAND_NOT_FOUND');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('non-zero CLI exit fails fast, records ERROR, and does not retry', () => {
  const repository = initRepository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-home-'));
  const capture = join(repository, 'capture.json');
  try {
    assert.equal(invoke(['quickstart', '--root', repository, '--task', 'runtime failure', '--lang', 'en']).status, 0);
    const env = {
      ...homeEnvironment(home),
      ...fixtureCommand(repository, 'agy-proxy', capture),
      EXIT_CODE: '7',
      STDERR_MESSAGE: 'runtime fixture failure\n',
    };
    assert.equal(invoke(['config', 'set', 'agent.antigravity.command', 'agy-proxy'], env).status, 0);
    const launch = invoke(['launch', '--agent', 'antigravity', '--once', '--root', repository, '--lang', 'en'], env);
    assert.equal(launch.status, 1);
    assert.match(launch.stderr, /PROCESS_EXIT_NON_ZERO/);
    assert.match(launch.stderr, /Exit code: 7/);
    assert.equal(state(repository).states.antigravity.state, 'ERROR');
    assert.equal(JSON.parse(readFileSync(capture, 'utf8')).argv[0], '--prompt-interactive');
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Skill install and update leave the user configuration untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-home-'));
  const installHome = mkdtempSync(join(tmpdir(), 'coordinate-agents-reliability-install-'));
  try {
    const env = homeEnvironment(home);
    assert.equal(invoke(['config', 'set', 'agent.antigravity.command', 'agy-proxy'], env).status, 0);
    const configPath = join(home, '.coordinate-agents', 'config.json');
    const before = readFileSync(configPath, 'utf8');
    assert.equal(invoke(['install', '--codex', '--codex-home', join(installHome, 'codex'), '--lang', 'en'], env).status, 0);
    assert.equal(invoke(['update', '--codex', '--codex-home', join(installHome, 'codex'), '--lang', 'en'], env).status, 0);
    assert.equal(readFileSync(configPath, 'utf8'), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(installHome, { recursive: true, force: true });
  }
});

test('Planner wait terminates when the Implementer enters ERROR', async () => {
  const repository = initRepository();
  let waiter = null;
  try {
    assert.equal(invoke(['quickstart', '--root', repository, '--task', 'planner error propagation', '--lang', 'en']).status, 0);
    waiter = spawn(process.execPath, [busTool, 'wait', '--root', repository, '--agent', 'codex', '--timeout-minutes', '1', '--poll-seconds', '0.1'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exitPromise = childExit(waiter);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
    const failed = spawnSync(process.execPath, [busTool, 'state', '--root', repository, '--agent', 'antigravity', '--state', 'ERROR', '--details', 'fixture runtime failure'], { encoding: 'utf8' });
    assert.equal(failed.status, 0, failed.stderr);
    const exit = await exitPromise;
    assert.equal(exit.code, 1);
    assert.equal(exit.signal, null);
  } finally {
    if (waiter && waiter.exitCode === null && waiter.signalCode === null) waiter.kill();
    rmSync(repository, { recursive: true, force: true });
  }
});
