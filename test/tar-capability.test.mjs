import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectTarExtractionFlags,
  selectTarExtractionFlags,
  extractArtifact,
} from '../scripts/verify-release-artifact.mjs';

test('tar extraction flags are chosen by capability, never by platform guessing', () => {
  // GNU tar requires --force-local to treat Windows drive-letter paths
  // (C:\…) as local files; BSD tar must never receive that GNU-only flag.
  assert.deepEqual(selectTarExtractionFlags('tar (GNU tar) 1.34'), ['--force-local']);
  assert.deepEqual(selectTarExtractionFlags('GNU tar 1.35\nCopyright (C) 2023 Free Software Foundation'), ['--force-local']);
  assert.deepEqual(selectTarExtractionFlags('bsdtar 3.7.2 - libarchive 3.7.2'), []);
  assert.deepEqual(selectTarExtractionFlags(''), []);
  assert.deepEqual(selectTarExtractionFlags('tar: unrecognized option'), []);
});

test('artifact extraction uses a process cwd when tar cannot accept the native absolute -C path', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'tar native directory with spaces-'));
  const source = join(temporary, 'source'); const packageRoot = join(source, 'package');
  mkdirSync(packageRoot, { recursive: true }); writeFileSync(join(packageRoot, 'fixture.txt'), 'real archive contents');
  const artifact = join(temporary, 'fixture.tgz');
  const spawn = childProcess.spawnSync;
  const packed = spawn('tar', ['-czf', artifact, 'package', ...detectTarExtractionFlags()], { cwd: source, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    // GNU tar under Git Bash rejects Windows native absolute -C values even
    // though the directory exists. Leave listing and extraction as real tar
    // operations; model only that cross-platform argument incompatibility.
    if (command === 'tar' && args.includes('-xzf') && args.includes('-C')) return { status: 2, stdout: '', stderr: 'Cannot open native -C directory' };
    return spawn(command, args, options);
  });
  syncBuiltinESMExports();
  try {
    const extracted = extractArtifact(artifact, temporary);
    assert.equal(readFileSync(join(extracted, 'fixture.txt'), 'utf8'), 'real archive contents');
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(temporary, { recursive: true, force: true });
  }
});

test('live tar detection returns a flag array for the installed tar', () => {
  const flags = detectTarExtractionFlags();
  assert.ok(Array.isArray(flags), 'detection must return an array');
  for (const flag of flags) {
    assert.equal(typeof flag, 'string');
    assert.match(flag, /^--[a-z-]+$/);
  }
});
