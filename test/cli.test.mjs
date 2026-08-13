import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'coordinate-cli-agents.mjs');
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

test('installs, verifies, detects modification, updates and uninstalls both targets', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-test-'));
  const codexHome = join(sandbox, 'codex');
  const antigravityHome = join(sandbox, 'antigravity');
  const common = ['--codex-home', codexHome, '--antigravity-home', antigravityHome, '--lang', 'en'];
  const doctorEnv = fakeCliEnvironment(sandbox);
  try {
    const install = invoke(['install', ...common]);
    assert.equal(install.status, 0, install.stderr);

    const codexTarget = join(codexHome, 'skills', 'coordinate-cli-agents');
    const agyTarget = join(antigravityHome, 'skills', 'coordinate-cli-agents');
    for (const target of [codexTarget, agyTarget]) {
      assert.ok(existsSync(join(target, 'SKILL.md')));
      assert.ok(existsSync(join(target, 'scripts', 'agent-bus.ps1')));
      assert.ok(existsSync(join(target, 'scripts', 'agent-bus.mjs')));
      assert.ok(existsSync(join(target, 'references', 'task-templates.md')));
      const metadata = JSON.parse(readFileSync(join(target, '.coordinate-cli-agents.json'), 'utf8'));
      assert.equal(metadata.package, '@hogancv/coordinate-cli-agents');
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
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-protect-'));
  const codexHome = join(sandbox, 'codex');
  const target = join(codexHome, 'skills', 'coordinate-cli-agents');
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

test('quickstart initializes the bus and generates two launch commands from a task template', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-quickstart-'));
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
    assert.match(result.stdout, /launch.*--role.*codex/s);
    assert.match(result.stdout, /launch.*--role.*antigravity/s);
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
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-templates-'));
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
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-safe-'));
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
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-launch-'));
  const capture = join(sandbox, 'capture.json');
  try {
    assert.equal(spawnSync('git', ['init', sandbox]).status, 0);
    const task = 'Preserve A&B, %PATH%, $HOME, and "quoted text" exactly';
    const quickstartResult = invoke(['quickstart', '--root', sandbox, '--template', 'feature', '--task', task, '--lang', 'en']);
    assert.equal(quickstartResult.status, 0, quickstartResult.stderr);
    const prompt = readFileSync(join(sandbox, '.agent-bus', 'launch', 'codex.txt'), 'utf8').trim();

    const launched = invoke(['launch', '--role', 'codex', '--root', sandbox, '--lang', 'en'], {
      ...fakeCodexLauncher(sandbox),
      CAPTURE: capture,
    });
    assert.equal(launched.status, 0, launched.stderr);
    const observed = JSON.parse(readFileSync(capture, 'utf8'));
    const canonicalSandbox = realpathSync(sandbox);
    assert.deepEqual(observed.argv, ['-C', canonicalSandbox, prompt]);
    assert.equal(realpathSync(observed.cwd), canonicalSandbox);
    assert.match(prompt, /A&B, %PATH%, \$HOME/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('doctor prints a repair command for every missing component and skill', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-doctor-'));
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
    assert.ok(result.stderr.includes(`coordinate-cli-agents@${currentVersion}`));
    assert.match(result.stderr, /install.*--codex/s);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
