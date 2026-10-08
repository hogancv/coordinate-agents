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

test('npm and Plugin distribution versions are independent', () => {
  assert.equal(packageJson.version, '3.0.0');
  assert.equal(pluginJson.version, '2.4.0');
  assert.equal(packageJson.name, '@hogancv/coordinate-agents');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /3\.0\.0/);
  assert.match(changelog, /Web-first/);
  assert.match(changelog, /2\.4\.0/);
});

test('packed release artifact independently installs and passes offline Web dual-terminal acceptance', () => {
  const output = mkdtempSync(join(tmpdir(), 'coordinate-agents-release-artifact-'));
  try {
    const packEnv = { ...process.env };
    // The nested pack must create a real tarball for artifact verification and
    // must not run package lifecycle scripts recursively.
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
    assert.equal(report.payload.legacyAbsent, true);
    assert.equal(report.installation.productionDependencies, true);
    assert.equal(report.installation.isolatedHome, true);
    for (const capability of ['dualTerminals', 'rolePrompts', 'messageRoundTrip', 'taskIsolation', 'customPathsAndArgs', 'resize', 'settings', 'multipleProjects', 'serverReconnect', 'restart', 'cleanup', 'archive', 'archiveCleanup']) assert.equal(report.runtime[capability], true, capability);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('payload verifier rejects omitted runtime files and added Legacy or secret files', async () => {
  const { cpSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { verifyPayload } = await import('../scripts/verify-release-artifact.mjs');
  const temporary = mkdtempSync(join(tmpdir(), 'coordinate-payload-negative-'));
  try {
    for (const file of ['package.json', ...packageJson.files]) {
      const target = join(temporary, file); mkdirSync(resolve(target, '..'), { recursive: true }); cpSync(join(root, file), target);
    }
    assert.equal(verifyPayload(temporary).legacyAbsent, true);
    for (const file of ['.mcp.json', '.env', 'test/fixture.test.mjs', 'skills/coordinate-agents/SKILL.md']) {
      const target = join(temporary, file); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, 'unexpected');
      assert.throws(() => verifyPayload(temporary), /Unexpected or Legacy payload file/); rmSync(target);
    }
    rmSync(join(temporary, 'skills/coordinate-agents/scripts/session-host.mjs'));
    assert.throws(() => verifyPayload(temporary), /session-host.mjs is missing/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
