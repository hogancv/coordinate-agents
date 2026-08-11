import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

test('prints English and Chinese help', () => {
  const en = invoke(['help', '--lang', 'en']);
  assert.equal(en.status, 0, en.stderr);
  assert.match(en.stdout, /Install the skill/);

  const zh = invoke(['help', '--lang', 'zh-CN']);
  assert.equal(zh.status, 0, zh.stderr);
  assert.match(zh.stdout, /安装技能/);
});

test('installs, verifies, detects modification, updates and uninstalls both targets', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'coordinate-cli-agents-test-'));
  const codexHome = join(sandbox, 'codex');
  const antigravityHome = join(sandbox, 'antigravity');
  const common = ['--codex-home', codexHome, '--antigravity-home', antigravityHome, '--lang', 'en'];
  try {
    const install = invoke(['install', ...common]);
    assert.equal(install.status, 0, install.stderr);

    const codexTarget = join(codexHome, 'skills', 'coordinate-cli-agents');
    const agyTarget = join(antigravityHome, 'skills', 'coordinate-cli-agents');
    for (const target of [codexTarget, agyTarget]) {
      assert.ok(existsSync(join(target, 'SKILL.md')));
      assert.ok(existsSync(join(target, 'scripts', 'agent-bus.ps1')));
      assert.ok(existsSync(join(target, 'scripts', 'agent-bus.mjs')));
      const metadata = JSON.parse(readFileSync(join(target, '.coordinate-cli-agents.json'), 'utf8'));
      assert.equal(metadata.package, '@hogancv/coordinate-cli-agents');
      assert.equal(metadata.version, currentVersion);
    }

    const healthy = invoke(['doctor', ...common]);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /All selected installations are healthy/);

    writeFileSync(join(codexTarget, 'SKILL.md'), 'modified', 'utf8');
    const broken = invoke(['doctor', '--codex', ...common]);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /SKILL\.md modified/);

    const update = invoke(['update', '--codex', ...common]);
    assert.equal(update.status, 0, update.stderr);
    assert.match(update.stdout, /Backed up previous installation/);

    const repaired = invoke(['doctor', '--codex', ...common]);
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
