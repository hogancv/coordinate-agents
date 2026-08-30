import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pluginJson = JSON.parse(readFileSync(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const verifier = join(root, 'scripts', 'verify-release-artifact.mjs');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function sourceCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('release candidate metadata and notes cover the Task Graph v1 scope', () => {
  assert.equal(packageJson.version, '2.3.0');
  assert.equal(pluginJson.version, packageJson.version);
  assert.equal(packageJson.name, '@hogancv/coordinate-agents');
  assert.equal(pluginJson.name, 'coordinate-agents');
  assert.ok(packageJson.files.includes('CHANGELOG.md'));

  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  for (const phrase of [
    'Multi-Agent Task Graph v1',
    'Bounded parallel execution',
    'Runtime-owned Git worktree',
    'Deterministic READY frontier',
    'explicit recovery, stop, and cleanup',
    'isolated integration and review',
    'single-Task',
    'Windows/macOS/Linux and Node.js 18/22',
    '--expected-source-commit',
    '--expected-tag',
    'RELEASE_APPROVED',
    'PUBLISH',
  ]) assert.match(changelog, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('packed release artifact passes isolated payload, example, setup, and doctor verification', () => {
  const output = mkdtempSync(join(tmpdir(), 'coordinate-agents-release-artifact-'));
  try {
    const packEnv = { ...process.env };
    // npm propagates npm_config_dry_run into lifecycle tests when the outer
    // command is `npm pack --dry-run`; the nested pack must create a real
    // tarball for artifact verification.
    delete packEnv.npm_config_dry_run;
    delete packEnv['npm_config_dry-run'];
    const packed = spawnSync(npmCommand(), [
      'pack', '--ignore-scripts', '--json', '--pack-destination', output,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
      env: packEnv,
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const metadata = JSON.parse(packed.stdout);
    const artifact = join(output, metadata[0].filename);
    assert.equal(existsSync(artifact), true);

    const verified = spawnSync(process.execPath, [
      verifier, artifact, '--expected-version', packageJson.version,
      '--expected-source-commit', sourceCommit(),
      '--expected-tag', `v${packageJson.version}`,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    const report = JSON.parse(verified.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.candidate.sourceCommit, sourceCommit());
    assert.equal(report.candidate.tag, `v${packageJson.version}`);
    assert.equal(report.candidate.version, packageJson.version);
    assert.equal(report.package.name, packageJson.name);
    assert.equal(report.package.version, packageJson.version);
    assert.equal(report.plugin.version, pluginJson.version);
    assert.equal(report.payload.llmsSynchronized, true);
    assert.equal(report.externalExample.contractVersion, 1);
    assert.equal(report.externalExample.summary.failed, 0);
    assert.equal(report.runtime.setup.ok, true);
    assert.equal(report.runtime.doctor.ok, true);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
