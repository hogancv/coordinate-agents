import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { delimiter } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'scripts', 'agent-bus.mjs');
const currentVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function fakeCliEnvironment(rootPath, names = ['codex', 'agy']) {
  const bin = join(rootPath, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    if (process.platform === 'win32') {
      writeFileSync(join(bin, `${name}.cmd`), '@echo 1.0.0\r\n', 'utf8');
    } else {
      const path = join(bin, name);
      writeFileSync(path, '#!/bin/sh\necho 1.0.0\n', 'utf8');
      chmodSync(path, 0o755);
    }
  }
  return { PATH: `${bin}${delimiter}${process.env.PATH || ''}` };
}

function fakeAgentDoctorEnvironment(rootPath, names) {
  const bin = join(rootPath, 'agent-doctor-bin');
  const gitNames = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git.bat'] : ['git'];
  const gitDirectory = (process.env.PATH || '')
    .split(delimiter)
    .find(directory => gitNames.some(name => existsSync(join(directory, name))));
  assert.ok(gitDirectory, 'Git executable directory must be discoverable for the test fixture');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    if (process.platform === 'win32') {
      const script = join(bin, `${name}.cjs`);
      writeFileSync(script, "console.log('test-fixture-1.0.0');\n", 'utf8');
      writeFileSync(join(bin, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    } else {
      const path = join(bin, name);
      writeFileSync(path, "#!/bin/sh\necho test-fixture-1.0.0\n", 'utf8');
      chmodSync(path, 0o755);
    }
  }

  // Keep Windows system tools such as where.exe available, but exclude the
  // developer's normal PATH so installed agent CLIs cannot mask fixture gaps.
  const systemPath = process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    : '';
  return {
    PATH: [bin, gitDirectory, systemPath].filter(Boolean).join(delimiter),
  };
}

function fakeCodexLauncher(rootPath) {
  const bin = join(rootPath, 'launch-bin');
  const source = `#!/usr/bin/env node\nrequire('fs').writeFileSync(process.env.CAPTURE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n`;
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\n', 'utf8');
    const entrypoint = join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(resolve(entrypoint, '..'), { recursive: true });
    writeFileSync(entrypoint, source, 'utf8');
  } else {
    const path = join(bin, 'codex');
    writeFileSync(path, source, 'utf8');
    chmodSync(path, 0o755);
  }
  return { PATH: `${bin}${delimiter}${process.env.PATH || ''}` };
}

function fakeGenericLauncher(rootPath, commandName = 'custom-agent') {
  const bin = join(rootPath, 'custom-bin');
  const source = `#!/usr/bin/env node
const fs = require('fs');
if (process.env.CAPTURE) {
  fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
} else {
  console.log('1.0.0');
}
`;
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    const entry = join(bin, `${commandName}.cmd`);
    const script = join(bin, `${commandName}.cjs`);
    writeFileSync(script, source, 'utf8');
    writeFileSync(entry, `@node "${script}" %*\r\n`, 'utf8');
  } else {
    const path = join(bin, commandName);
    writeFileSync(path, source, 'utf8');
    chmodSync(path, 0o755);
  }
  return { PATH: `${bin}${delimiter}${process.env.PATH || ''}` };
}

function fakeSupervisedAgyLauncher(rootPath) {
  const bin = join(rootPath, 'supervisor & fixtures');
  const script = join(bin, 'agy.cjs');
  const source = `const fs = require('fs');
const { spawnSync } = require('child_process');
const countPath = process.env.ACTIVATION_COUNT;
const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) + 1 : 1;
fs.writeFileSync(countPath, String(count));
if (process.env.STOP_AFTER && count >= Number(process.env.STOP_AFTER)) {
  const stopped = spawnSync(process.execPath, [process.env.BUS_TOOL, 'state', '--root', process.env.TEST_ROOT, '--agent', 'antigravity', '--state', 'STOPPED', '--details', 'supervisor test complete']);
  if (stopped.status !== 0) process.exit(stopped.status || 1);
}
process.exit(Number(process.env.AGENT_EXIT_CODE || 0));
`;
  mkdirSync(bin, { recursive: true });
  writeFileSync(script, source, 'utf8');
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'agy.cmd'), `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
  } else {
    const executable = join(bin, 'agy');
    writeFileSync(executable, `#!${process.execPath}\n${source}`, 'utf8');
    chmodSync(executable, 0o755);
  }
  return { PATH: `${bin}${delimiter}${process.env.PATH || ''}` };
}

function busInvoke(args) {
  return spawnSync(process.execPath, [busTool, ...args], { encoding: 'utf8' });
}

async function waitUntil(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

test('prints English and Chinese help', () => {
  const en = invoke(['help', '--lang', 'en']);
  assert.equal(en.status, 0, en.stderr);
  assert.match(en.stdout, /Install the skill/);
  assert.match(en.stdout, /quickstart/);

  const zh = invoke(['help', '--lang', 'zh-CN']);
  assert.equal(zh.status, 0, zh.stderr);
  assert.match(zh.stdout, /安装技能/);
  assert.match(zh.stdout, /快速|初始化项目/);
});

test('documents a 60-second path and three first-use task templates', () => {
  const english = readFileSync(join(root, 'README.md'), 'utf8');
  const chinese = readFileSync(join(root, 'README.zh-CN.md'), 'utf8');
  const templates = readFileSync(join(root, 'references', 'task-templates.md'), 'utf8');
  assert.match(english, /## 60-second quick start/);
  assert.match(chinese, /## 60 秒快速开始/);
  for (const type of ['bug', 'feature', 'refactor']) {
    assert.match(english, new RegExp(`--template ${type}`));
    assert.match(chinese, new RegExp(`--template ${type}`));
    assert.ok(templates.includes('(`' + type + '`)'));
  }
  assert.match(english, /No role prompt needs to be copied/);
  assert.match(chinese, /不再需要手动复制或维护两段角色提示词/);
});

test('package.json provides canonical bin only', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, '@hogancv/coordinate-agents');
  assert.equal(packageJson.version, '2.1.1');
  assert.deepEqual(Object.keys(packageJson.bin), ['coordinate-agents']);
  assert.equal(packageJson.bin['coordinate-agents'], 'bin/coordinate-agents.mjs');
});

test('installs, verifies, detects modification, updates and uninstalls both targets', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-test-'));
  const codexHome = join(sandbox, 'codex');
  const antigravityHome = join(sandbox, 'antigravity');
  const common = ['--codex-home', codexHome, '--antigravity-home', antigravityHome, '--lang', 'en'];
  const doctorEnv = fakeCliEnvironment(sandbox);
  try {
    const install = invoke(['install', ...common]);
    assert.equal(install.status, 0, install.stderr);

    const codexTarget = join(codexHome, 'skills', 'coordinate-agents');
    const agyTarget = join(antigravityHome, 'skills', 'coordinate-agents');
    for (const target of [codexTarget, agyTarget]) {
      assert.ok(existsSync(join(target, 'SKILL.md')));
      assert.ok(existsSync(join(target, 'adapters', 'index.mjs')));
      assert.ok(existsSync(join(target, 'adapters', 'codex-cli.mjs')));
      assert.ok(existsSync(join(target, 'adapters', 'antigravity-cli.mjs')));
      assert.ok(existsSync(join(target, 'adapters', 'generic-cli.mjs')));
      assert.ok(existsSync(join(target, 'scripts', 'agent-bus.ps1')));
      assert.ok(existsSync(join(target, 'scripts', 'agent-bus.mjs')));
      assert.ok(existsSync(join(target, 'references', 'task-templates.md')));
      const metadata = JSON.parse(readFileSync(join(target, '.coordinate-agents.json'), 'utf8'));
      assert.equal(metadata.package, '@hogancv/coordinate-agents');
      assert.equal(metadata.version, currentVersion);
    }

    const healthy = invoke(['doctor', ...common], doctorEnv);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /All prerequisites and selected installations are healthy/);

    writeFileSync(join(codexTarget, 'SKILL.md'), 'modified', 'utf8');
    const broken = invoke(['doctor', '--codex', ...common], doctorEnv);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /SKILL\.md modified/);
    assert.match(broken.stderr, /Fix:.*update.*--codex/s);

    const update = invoke(['update', '--codex', ...common]);
    assert.equal(update.status, 0, update.stderr);
    assert.match(update.stdout, /Backed up previous installation/);

    const repaired = invoke(['doctor', '--codex', ...common], doctorEnv);
    assert.equal(repaired.status, 0, repaired.stderr);

    const uninstall = invoke(['uninstall', ...common]);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(existsSync(codexTarget), false);
    assert.equal(existsSync(agyTarget), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('protects an unrecognized existing skill directory', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-protect-'));
  const codexHome = join(sandbox, 'codex');
  const target = join(codexHome, 'skills', 'coordinate-agents');
  try {
    writeFileSync(join(sandbox, 'placeholder'), 'x');
    const setup = spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(target)}, {recursive:true})`]);
    assert.equal(setup.status, 0);
    const result = invoke(['install', '--codex', '--codex-home', codexHome, '--lang', 'en']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to remove an unrecognized directory/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('does not trust arbitrary JSON as package-managed installation metadata', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-metadata-'));
  const codexHome = join(sandbox, 'codex');
  const target = join(codexHome, 'skills', 'coordinate-agents');
  const marker = join(target, 'important-user-file.txt');
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.coordinate-agents.json'), '{}\n', 'utf8');
    writeFileSync(marker, 'preserve me\n', 'utf8');

    const install = invoke(['install', '--codex', '--codex-home', codexHome, '--lang', 'en']);
    assert.equal(install.status, 1);
    assert.match(install.stderr, /refusing to remove an unrecognized directory/);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve me\n');

    const uninstall = invoke(['uninstall', '--codex', '--codex-home', codexHome, '--lang', 'en']);
    assert.equal(uninstall.status, 1);
    assert.match(uninstall.stderr, /refusing to remove an unrecognized directory/);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve me\n');

    const digest = createHash('sha256').update(readFileSync(marker)).digest('hex');
    writeFileSync(join(target, '.coordinate-agents.json'), JSON.stringify({
      package: '@hogancv/coordinate-agents',
      version: '999.0.0',
      installedAt: new Date().toISOString(),
      manifest: { 'important-user-file.txt': digest },
    }), 'utf8');
    const forged = invoke(['uninstall', '--codex', '--codex-home', codexHome, '--lang', 'en']);
    assert.equal(forged.status, 1);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve me\n');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('uninstall preserves extra files inside a package-managed installation', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-extra-uninstall-'));
  const codexHome = join(sandbox, 'codex');
  const target = join(codexHome, 'skills', 'coordinate-agents');
  const extra = join(target, 'personal-notes.txt');
  try {
    const common = ['--codex', '--codex-home', codexHome, '--lang', 'en'];
    assert.equal(invoke(['install', ...common]).status, 0);
    writeFileSync(extra, 'preserve me\n', 'utf8');
    const result = invoke(['uninstall', ...common]);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(extra, 'utf8'), 'preserve me\n');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('uninstall preserves a modified package-managed installation without force', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-modified-uninstall-'));
  const codexHome = join(sandbox, 'codex');
  const target = join(codexHome, 'skills', 'coordinate-agents');
  try {
    const common = ['--codex', '--codex-home', codexHome, '--lang', 'en'];
    assert.equal(invoke(['install', ...common]).status, 0);
    writeFileSync(join(target, 'SKILL.md'), 'user modification\n', 'utf8');
    const result = invoke(['uninstall', ...common]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to remove an unrecognized directory/);
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'user modification\n');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart initializes the bus and generates two launch commands from a task template', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-quickstart-'));
  try {
    const init = spawnSync('git', ['init', sandbox], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);

    const result = invoke([
      'quickstart', '--root', sandbox, '--template', 'bug',
      '--task', 'Saving an emoji crashes the Todo page', '--lang', 'en',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex terminal \(copy and run\)/);
    assert.match(result.stdout, /Antigravity terminal \(copy and run\)/);
    assert.match(result.stdout, /launch.*--agent.*codex/s);
    assert.match(result.stdout, /launch.*--agent.*antigravity/s);
    assert.match(result.stdout, /--root-base64 [A-Za-z0-9_-]+/);
    assert.equal(result.stdout.includes(`--root '${sandbox}'`), false);

    const codexPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'codex.txt'), 'utf8');
    const agyPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'antigravity.txt'), 'utf8');
    assert.match(codexPrompt, /Bug fix template/);
    assert.match(codexPrompt, /Saving an emoji crashes the Todo page/);
    assert.match(codexPrompt, /do not edit product code/i);
    assert.match(agyPrompt, /sole product-code writer/);
    assert.ok(existsSync(join(sandbox, '.agent-bus', 'inbox', 'codex', 'new')));
    assert.match(readFileSync(join(sandbox, '.git', 'info', 'exclude'), 'utf8'), /^\.agent-bus\/$/m);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart supports all templates and rejects unknown task types', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-templates-'));
  try {
    for (const [template, marker] of [
      ['bug', 'reproduce first'],
      ['feature', 'clarify user value'],
      ['refactor', 'define invariants'],
    ]) {
      const repository = join(sandbox, template);
      assert.equal(spawnSync('git', ['init', repository]).status, 0);
      const result = invoke(['quickstart', '--root', repository, '--template', template, '--task', 'Example', '--lang', 'en']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(join(repository, '.agent-bus', 'launch', 'codex.txt'), 'utf8'), new RegExp(marker));
    }
    const invalid = invoke(['quickstart', '--root', join(sandbox, 'feature'), '--template', 'rewrite', '--lang', 'en']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Use bug, feature, or refactor/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart refuses to overwrite existing prompts or follow a bus symlink', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-safe-'));
  try {
    const repository = join(sandbox, 'repo');
    assert.equal(spawnSync('git', ['init', repository]).status, 0);
    const first = invoke(['quickstart', '--root', repository, '--task', 'First task', '--lang', 'en']);
    assert.equal(first.status, 0, first.stderr);
    const promptPath = join(repository, '.agent-bus', 'launch', 'codex.txt');
    const original = readFileSync(promptPath, 'utf8');
    const second = invoke(['quickstart', '--root', repository, '--task', 'Second task', '--lang', 'en']);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /Launch prompts already exist/);
    assert.equal(readFileSync(promptPath, 'utf8'), original);

    const unsafeRepository = join(sandbox, 'unsafe');
    const outside = join(sandbox, 'outside');
    assert.equal(spawnSync('git', ['init', unsafeRepository]).status, 0);
    mkdirSync(outside);
    symlinkSync(outside, join(unsafeRepository, '.agent-bus'), process.platform === 'win32' ? 'junction' : 'dir');
    const unsafe = invoke(['quickstart', '--root', unsafeRepository, '--task', 'Unsafe', '--lang', 'en']);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /Refusing unsafe agent-bus path/);
    assert.equal(existsSync(join(outside, 'launch')), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('launch passes the generated prompt and repository to Codex without shell interpolation', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-launch-'));
  const capture = join(sandbox, 'capture.json');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    const task = 'Preserve A&B, %PATH%, $HOME, and "quoted text" exactly';
    const quickstartResult = invoke(['quickstart', '--root', sandbox, '--template', 'feature', '--task', task, '--lang', 'en']);
    assert.equal(quickstartResult.status, 0, quickstartResult.stderr);
    const prompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'codex.txt'), 'utf8').trim();

    const launched = invoke(['launch', '--agent', 'codex', '--root', sandbox, '--lang', 'en'], {
      ...fakeCodexLauncher(sandbox),
      CAPTURE: capture,
    });
    assert.equal(launched.status, 0, launched.stderr);
    const observed = JSON.parse(readFileSync(capture, 'utf8'));
    const gitRoot = spawnSync('git', ['-C', sandbox, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
    assert.deepEqual(observed.argv, ['-C', resolve(gitRoot), prompt]);
    assert.equal(resolve(observed.cwd).toLowerCase(), resolve(gitRoot).toLowerCase());
    assert.match(prompt, /A&B, %PATH%, \$HOME/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('bus-supervised launch waits without claiming, resumes on work, and stops cleanly', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-supervisor-'));
  const activationCount = join(sandbox, 'activation-count.txt');
  let child = null;
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    const quickstart = invoke(['quickstart', '--root', sandbox, '--task', 'Durable launch', '--lang', 'en']);
    assert.equal(quickstart.status, 0, quickstart.stderr);

    child = spawn(process.execPath, [cli, 'launch', '--agent', 'antigravity', '--root', sandbox, '--lang', 'en'], {
      cwd: root,
      env: {
        ...process.env,
        ...fakeSupervisedAgyLauncher(sandbox),
        ACTIVATION_COUNT: activationCount,
        STOP_AFTER: '2',
        BUS_TOOL: busTool,
        TEST_ROOT: sandbox,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exitPromise = childExit(child);

    await waitUntil(() => existsSync(activationCount) && readFileSync(activationCount, 'utf8') === '1');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 700));
    assert.equal(child.exitCode, null, `supervisor exited after first activation: ${stderr}`);

    let status = JSON.parse(busInvoke(['status', '--root', sandbox]).stdout);
    assert.equal(status.queues.antigravity.new, 0);
    assert.equal(status.queues.antigravity.processing, 0);

    const sent = busInvoke([
      'send', '--root', sandbox, '--from', 'codex', '--to', 'antigravity',
      '--type', 'CHANGES_REQUESTED', '--subject', 'Resume supervised work', '--body', 'Review feedback',
    ]);
    assert.equal(sent.status, 0, sent.stderr);
    status = JSON.parse(busInvoke(['status', '--root', sandbox]).stdout);
    assert.equal(status.queues.antigravity.new, 1);
    assert.equal(status.queues.antigravity.processing, 0);

    const exit = await exitPromise;
    assert.deepEqual(exit, { code: 0, signal: null }, stderr);
    assert.equal(readFileSync(activationCount, 'utf8'), '2');
    status = JSON.parse(busInvoke(['status', '--root', sandbox]).stdout);
    assert.equal(status.states.antigravity.state, 'STOPPED');
    assert.equal(status.queues.antigravity.new, 1);
    assert.equal(status.queues.antigravity.processing, 0);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await childExit(child).catch(() => {});
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('bus-supervised launch exits for existing STOPPED state without invoking the Agent', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-supervisor-stopped-'));
  const activationCount = join(sandbox, 'activation-count.txt');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    assert.equal(invoke(['quickstart', '--root', sandbox, '--task', 'Stopped launch', '--lang', 'en']).status, 0);
    assert.equal(busInvoke(['state', '--root', sandbox, '--agent', 'antigravity', '--state', 'STOPPED']).status, 0);
    const launched = invoke(['launch', '--agent', 'antigravity', '--root', sandbox, '--lang', 'en'], {
      ...fakeSupervisedAgyLauncher(sandbox),
      ACTIVATION_COUNT: activationCount,
    });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(existsSync(activationCount), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('bus-supervised launch propagates a non-zero child exit without retry', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-supervisor-failure-'));
  const activationCount = join(sandbox, 'activation-count.txt');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    assert.equal(invoke(['quickstart', '--root', sandbox, '--task', 'Failed launch', '--lang', 'en']).status, 0);
    const launched = invoke(['launch', '--agent', 'antigravity', '--root', sandbox, '--lang', 'en'], {
      ...fakeSupervisedAgyLauncher(sandbox),
      ACTIVATION_COUNT: activationCount,
      AGENT_EXIT_CODE: '7',
    });
    assert.equal(launched.status, 1);
    assert.match(launched.stderr, /exited with status 7/);
    assert.equal(readFileSync(activationCount, 'utf8'), '1');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('--once disables Adapter-declared launch supervision', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-supervisor-once-'));
  const activationCount = join(sandbox, 'activation-count.txt');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    assert.equal(invoke(['quickstart', '--root', sandbox, '--task', 'One-shot launch', '--lang', 'en']).status, 0);
    const launched = invoke(['launch', '--agent', 'antigravity', '--once', '--root', sandbox, '--lang', 'en'], {
      ...fakeSupervisedAgyLauncher(sandbox),
      ACTIVATION_COUNT: activationCount,
    });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(readFileSync(activationCount, 'utf8'), '1');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('bus-supervised launch fails safely on a corrupt newest state record', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-supervisor-corrupt-state-'));
  const activationCount = join(sandbox, 'activation-count.txt');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    assert.equal(invoke(['quickstart', '--root', sandbox, '--task', 'Corrupt state', '--lang', 'en']).status, 0);
    writeFileSync(join(sandbox, '.agent-bus', 'state', 'antigravity', '99999999999999999-invalid.json'), '{', 'utf8');
    const launched = invoke(['launch', '--agent', 'antigravity', '--root', sandbox, '--lang', 'en'], {
      ...fakeSupervisedAgyLauncher(sandbox),
      ACTIVATION_COUNT: activationCount,
    });
    assert.equal(launched.status, 1);
    assert.match(launched.stderr, /JSON|Unexpected end|Expected property name/);
    assert.equal(existsSync(activationCount), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('doctor prints a repair command for every missing component and skill', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-doctor-'));
  try {
    const result = invoke([
      'doctor', '--codex', '--codex-home', join(sandbox, 'codex'), '--lang', 'en',
    ], { PATH: '' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Git: missing[\s\S]*Fix:/);
    assert.match(result.stderr, /Codex CLI: missing[\s\S]*Fix:/);
    assert.match(result.stderr, /Antigravity CLI \(agy\): missing[\s\S]*Fix:/);
    assert.match(result.stderr, /Codex: not installed[\s\S]*Fix:/);
    assert.match(result.stderr, /@openai\/codex@latest/);
    assert.match(result.stderr, /antigravity\.google\/cli\/install/);
    assert.ok(result.stderr.includes(`coordinate-agents@${currentVersion}`));
    assert.match(result.stderr, /install.*--codex/s);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('single-agent doctor treats the unselected CLI as informational', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-single-doctor-'));
  const codexHome = join(sandbox, 'codex');
  try {
    const common = ['--codex', '--codex-home', codexHome, '--lang', 'en'];
    assert.equal(invoke(['install', ...common]).status, 0);
    const env = fakeCliEnvironment(sandbox, ['git', 'codex']);
    const fakeBin = join(sandbox, 'fake-bin');
    if (process.platform === 'win32') writeFileSync(join(fakeBin, 'agy.cmd'), '@exit /b 1\r\n', 'utf8');
    else {
      writeFileSync(join(fakeBin, 'agy'), '#!/bin/sh\nexit 1\n', 'utf8');
      chmodSync(join(fakeBin, 'agy'), 0o755);
    }
    const result = invoke(['doctor', ...common], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex CLI: available/);
    assert.match(result.stderr, /Antigravity CLI \(agy\): missing/);
    assert.match(result.stdout, /All prerequisites and selected installations are healthy/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('agent add, list, and doctor manage registered agents via CLI', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-agent-cmd-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    const addResult = invoke(['agent', 'add', 'custom-helper', '--adapter', 'generic-cli', '--command', 'custom-helper', '--root', sandbox]);
    assert.equal(addResult.status, 0, addResult.stderr);

    const listResult = invoke(['agent', 'list', '--root', sandbox]);
    assert.equal(listResult.status, 0, listResult.stderr);
    assert.match(listResult.stdout, /custom-helper/);

    const env = fakeAgentDoctorEnvironment(sandbox, ['codex', 'agy', 'custom-helper']);
    const doctorResult = invoke(['agent', 'doctor', '--root', sandbox], env);
    assert.equal(doctorResult.status, 0, doctorResult.stderr);
    assert.match(doctorResult.stdout, /codex \(codex-cli\): healthy \(test-fixture-1\.0\.0\)/);
    assert.match(doctorResult.stdout, /antigravity \(antigravity-cli\): healthy \(test-fixture-1\.0\.0\)/);
    assert.match(doctorResult.stdout, /custom-helper \(generic-cli\): healthy \(test-fixture-1\.0\.0\)/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart supports workflow role reassignment', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-custom-workflow-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    invoke(['agent', 'add', 'architect', '--adapter', 'generic-cli', '--command', 'architect', '--root', sandbox]);
    invoke(['agent', 'add', 'coder', '--adapter', 'generic-cli', '--command', 'coder', '--root', sandbox]);

    const result = invoke([
      'quickstart', '--root', sandbox, '--template', 'feature',
      '--planner', 'architect', '--implementer', 'coder',
      '--task', 'Build an advanced feature', '--lang', 'en',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /architect \(planner\) terminal/);
    assert.match(result.stdout, /coder \(implementer\) terminal/);
    assert.match(result.stdout, /launch.*--agent.*architect/s);
    assert.match(result.stdout, /launch.*--agent.*coder/s);

    const plannerPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'architect.txt'), 'utf8');
    const coderPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'coder.txt'), 'utf8');
    assert.match(plannerPrompt, /planner \(architect\)/);
    assert.match(plannerPrompt, /Build an advanced feature/);
    assert.match(coderPrompt, /implementer \(coder\)/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('launch generic-cli adapter executes with configured arguments without shell interpolation', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-generic-launch-'));
  const capture = join(sandbox, 'capture.json');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    invoke([
      'agent', 'add', 'claude-bot', '--adapter', 'generic-cli',
      '--command', 'claude-bot', '--args', '["--dir", "{root}", "--message", "{prompt}"]',
      '--root', sandbox,
    ]);

    const task = 'Refactor $SPECIAL, %VAR%, and "quoted symbols"';
    invoke([
      'quickstart', '--root', sandbox, '--planner', 'codex', '--implementer', 'claude-bot',
      '--template', 'refactor', '--task', task, '--lang', 'en',
    ]);

    const env = {
      ...fakeGenericLauncher(sandbox, 'claude-bot'),
      CAPTURE: capture,
    };

    const launched = invoke(['launch', '--agent', 'claude-bot', '--root', sandbox, '--lang', 'en'], env);
    assert.equal(launched.status, 0, launched.stderr);

    const observed = JSON.parse(readFileSync(capture, 'utf8'));
    const gitRoot = spawnSync('git', ['-C', sandbox, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(resolve(observed.cwd).toLowerCase(), resolve(gitRoot).toLowerCase());
    assert.equal(observed.argv[0], '--dir');
    assert.equal(resolve(observed.argv[1]).toLowerCase(), resolve(gitRoot).toLowerCase());
    assert.equal(observed.argv[2], '--message');
    assert.match(observed.argv[3], /implementer \(claude-bot\)/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart supports --reviewer flag and combines prompts for multi-role agents', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-reviewer-test-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    invoke(['agent', 'add', 'reviewer-bot', '--adapter', 'generic-cli', '--command', 'reviewer-bot', '--root', sandbox]);

    const result = invoke([
      'quickstart', '--root', sandbox, '--template', 'bug',
      '--planner', 'codex', '--implementer', 'antigravity', '--reviewer', 'reviewer-bot',
      '--task', 'Fix memory leak', '--lang', 'en',
    ]);
    assert.equal(result.status, 0, result.stderr);

    const reviewerPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'reviewer-bot.txt'), 'utf8');
    assert.match(reviewerPrompt, /reviewer \(reviewer-bot\)/);

    const cfg = JSON.parse(readFileSync(join(sandbox, '.agent-bus', 'config.json'), 'utf8'));
    assert.deepEqual(cfg.workflow, {
      planner: 'codex',
      implementer: 'antigravity',
      reviewer: 'reviewer-bot',
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart rejects path traversal attempts in agent IDs', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-traversal-test-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    const result = invoke([
      'quickstart', '--root', sandbox, '--template', 'bug',
      '--planner', '../../outside',
      '--task', 'Fix bug', '--lang', 'en',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid agent id|reserved device name/i);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart rejects unregistered agents in workflow roles', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-unregistered-test-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    const result = invoke([
      'quickstart', '--root', sandbox, '--template', 'bug',
      '--planner', 'nonexistent-agent',
      '--task', 'Fix bug', '--lang', 'en',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown agent/i);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('launch rejects unknown --role option', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-role-reject-test-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    const result = invoke(['launch', '--role', 'codex', '--root', sandbox]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown option: --role/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart generates merged prompts for multi-role agents and preserves defaults', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-multirole-test-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    // Test Antigravity as implementer + reviewer
    const result1 = invoke([
      'quickstart', '--root', sandbox, '--template', 'feature',
      '--planner', 'codex', '--implementer', 'antigravity', '--reviewer', 'antigravity',
      '--task', 'Build multi-role support', '--lang', 'en',
    ]);
    assert.equal(result1.status, 0, result1.stderr);

    const agyPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'antigravity.txt'), 'utf8');
    assert.match(agyPrompt, /implementer and reviewer \(antigravity\)/);

    // Clean launch dir for next test
    rmSync(join(sandbox, '.agent-bus', 'launch'), { recursive: true, force: true });

    // Test Codex as planner + implementer + reviewer
    const result2 = invoke([
      'quickstart', '--root', sandbox, '--template', 'bug',
      '--planner', 'codex', '--implementer', 'codex', '--reviewer', 'codex',
      '--task', 'Fix solo workflow', '--lang', 'en',
    ]);
    assert.equal(result2.status, 0, result2.stderr);

    const codexPrompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'codex.txt'), 'utf8');
    assert.match(codexPrompt, /planner, implementer, and reviewer \(codex\)/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('quickstart failure when prompts exist leaves prior workflow unchanged', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-agents-tx-fail-test-'));
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);

    // Initial quickstart with default workflow
    const first = invoke([
      'quickstart', '--root', sandbox, '--template', 'feature',
      '--planner', 'codex', '--implementer', 'antigravity', '--reviewer', 'codex',
      '--task', 'Initial task', '--lang', 'en',
    ]);
    assert.equal(first.status, 0, first.stderr);

    const initialCfg = JSON.parse(readFileSync(join(sandbox, '.agent-bus', 'config.json'), 'utf8'));
    assert.deepEqual(initialCfg.workflow, {
      planner: 'codex',
      implementer: 'antigravity',
      reviewer: 'codex',
    });

    // Add another agent
    invoke(['agent', 'add', 'architect', '--adapter', 'generic-cli', '--command', 'architect', '--root', sandbox]);

    // Second quickstart with new roles should fail because prompt files already exist
    const second = invoke([
      'quickstart', '--root', sandbox, '--template', 'feature',
      '--planner', 'architect', '--implementer', 'antigravity', '--reviewer', 'architect',
      '--task', 'Attempted second task', '--lang', 'en',
    ]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /launch prompts already exist/i);

    // Verify config workflow was NOT mutated by the failed quickstart
    const cfgAfterFailed = JSON.parse(readFileSync(join(sandbox, '.agent-bus', 'config.json'), 'utf8'));
    assert.deepEqual(cfgAfterFailed.workflow, {
      planner: 'codex',
      implementer: 'antigravity',
      reviewer: 'codex',
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
