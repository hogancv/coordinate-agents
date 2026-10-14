import test from 'node:test';
import assert from 'node:assert/strict';
import { PtyRuntime } from '../skills/coordinate-agents/scripts/pty-runtime.mjs';

function buffer(maxOutputBytes = 64 * 1024) {
  return new PtyRuntime({ id: 'output-test', command: process.execPath, cwd: process.cwd(), maxOutputBytes }).output;
}
function drain(output, options = {}) {
  let cursor = 0;
  let text = '';
  const pages = [];
  while (cursor < output.cursor) {
    const page = output.read({ cursor, ...options });
    assert.ok(page.nextCursor > cursor, 'every nonempty page advances');
    assert.equal(page.output.includes('\ufffd'), false);
    text += page.output;
    cursor = page.nextCursor;
    pages.push(page);
  }
  return { text, pages, cursor };
}
test('oversized individual chunks and many lines are delivered earliest first without gaps', () => {
  const output = buffer();
  const text = '\x1b[32m中文😀\x1b[0m\r\n'.repeat(1600);
  output.append(text.slice(0, 30000));
  output.append(text.slice(30000));
  const result = drain(output, { maxBytes: 32768, maxLines: 200 });
  assert.equal(result.text, text);
  assert.ok(result.pages.length > 1);
  assert.ok(result.pages.every(page => !page.truncated && Buffer.byteLength(page.output) <= 32768));
  assert.equal(output.read({ cursor: result.cursor }).output, '');
});
test('a byte cursor can resume inside a large chunk across Unicode and ANSI boundaries', () => {
  const output = buffer();
  const text = '中文😀\x1b[2J\r\n'.repeat(2000);
  output.append(text);
  assert.equal(drain(output, { maxBytes: 17, maxLines: 2 }).text, text);
});
test('the 32KB cap pages a long line rather than selecting its tail', () => {
  const output = buffer();
  const text = '0123456789'.repeat(6000);
  output.append(text);
  const first = output.read({ cursor: 0, maxBytes: 32768, maxLines: 200 });
  assert.equal(first.nextCursor, 32768);
  assert.equal(first.latestCursor, 60000);
  assert.equal(first.output, text.slice(0, 32768));
  assert.equal(first.truncated, false);
  assert.equal(first.hasMore, true);
  const rest = output.read({ cursor: first.nextCursor, maxBytes: 32768, maxLines: 200 });
  assert.equal(first.output + rest.output, text);
  assert.equal(rest.hasMore, false);
});
test('only actual eviction reports truncation, including one oversized append', () => {
  const output = buffer(1024);
  output.append('中文😀'.repeat(300));
  const first = output.read({ cursor: 0, maxBytes: 100 });
  assert.equal(first.truncated, true);
  assert.equal(first.hasMore, true);
  const next = output.read({ cursor: first.nextCursor, maxBytes: 100 });
  assert.equal(next.truncated, false);
  assert.ok(output.bytes <= 1024);
  assert.equal(output.read().truncated, true);
});
test('partial eviction retains the still-buffered suffix and tiny pages make Unicode progress', () => {
  const output = buffer(1024);
  output.append('a'.repeat(1000));
  output.append('b'.repeat(100));
  assert.equal(output.read({ cursor: 76 }).output, 'a'.repeat(924) + 'b'.repeat(100));
  const unicode = buffer();
  unicode.append('😀中文');
  assert.equal(drain(unicode, { maxBytes: 1 }).text, '😀中文');
});
test('an oversized append evicts earlier chunks rather than leaving an undetectable internal gap', () => {
  const output = buffer(1024);
  output.append('a');
  output.append('中文'.repeat(1000));
  const page = output.read({ cursor: 0 });
  assert.equal(page.truncated, true);
  assert.ok(!page.output.includes('a'));
  assert.equal(page.nextCursor, Buffer.byteLength('a' + '中文'.repeat(1000)));
});
