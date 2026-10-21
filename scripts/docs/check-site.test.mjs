import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSite } from './check-site.mjs';

test('crawler accepts base-prefixed files, encoded Chinese fragments and locale links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-links-'));
  try {
    mkdirSync(join(dir, 'zh-CN'));
    writeFileSync(join(dir, 'index.html'), '<a href="/coordinate-agents/zh-CN/guide.html#%E5%AE%89%E5%85%A8">中文</a>');
    writeFileSync(join(dir, 'zh-CN/guide.html'), '<h2 id="安全">安全</h2><a href="../">English</a>');
    assert.deepEqual(checkSite(dir).errors, []);
  } finally { rmSync(dir, { recursive: true }); }
});

test('crawler rejects base leaks, missing assets and broken fragments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-links-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<a href="/guide.html">bad</a><script src="/coordinate-agents/missing.js"></script><a href="#missing">bad hash</a>');
    const { errors } = checkSite(dir);
    assert.equal(errors.length, 3);
    assert.ok(errors.some(e => e.includes('base')));
    assert.ok(errors.some(e => e.includes('missing.js')));
    assert.ok(errors.some(e => e.includes('#missing')));
  } finally { rmSync(dir, { recursive: true }); }
});
