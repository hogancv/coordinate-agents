import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectTarExtractionFlags,
  selectTarExtractionFlags,
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

test('live tar detection returns a flag array for the installed tar', () => {
  const flags = detectTarExtractionFlags();
  assert.ok(Array.isArray(flags), 'detection must return an array');
  for (const flag of flags) {
    assert.equal(typeof flag, 'string');
    assert.match(flag, /^--[a-z-]+$/);
  }
});
