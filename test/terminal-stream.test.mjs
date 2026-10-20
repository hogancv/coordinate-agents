import test from 'node:test';
import assert from 'node:assert/strict';

async function streamModule() { return import('../inspector/web-workspace/terminal-stream.mjs'); }
function response(text, chunkBytes = 3) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) controller.enqueue(bytes.slice(offset, offset + chunkBytes));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
test('fetch SSE parser preserves split Unicode, CRLF, comments and JSON control sequences', async () => {
  const { consumeTerminalStream } = await streamModule();
  const message = { event: 'terminal-output', output: { output: '中文😀\x1b[32m\r\n', nextCursor: 100 } };
  const seen = [];
  await consumeTerminalStream(response(`: heartbeat\r\n\r\nid: 100\r\nevent: terminal-output\r\ndata: ${JSON.stringify(message)}\r\n\r\n`), {
    onEvent: async (event, data) => { await Promise.resolve(); seen.push([event, data]); },
  });
  assert.deepEqual(seen, [['terminal-output', message]]);
});
test('parser rejects unsupported responses and malformed/truncated frames for fallback', async () => {
  const { consumeTerminalStream } = await streamModule();
  await assert.rejects(consumeTerminalStream(new Response('unavailable', { status: 404 }), { onEvent() {} }));
  await assert.rejects(consumeTerminalStream(response('event: terminal-output\ndata: broken\n\n'), { onEvent() {} }));
  await assert.rejects(consumeTerminalStream(response('event: terminal-output\ndata: {}'), { onEvent() {} }));
});
test('cursor is committed after rendering, duplicates are skipped and disposal prevents writes', async () => {
  const { deliverTerminalOutput } = await streamModule();
  const state = { cursor: 0 };
  const writes = [];
  let acknowledge;
  const write = output => new Promise(done => { writes.push(output); acknowledge = done; });
  const delivery = deliverTerminalOutput(state, { output: '中文😀', nextCursor: 10 }, write);
  assert.equal(state.cursor, 0);
  acknowledge(); await delivery;
  assert.equal(state.cursor, 10);
  await deliverTerminalOutput(state, { output: '中文😀', nextCursor: 10 }, write);
  state.disposed = true;
  await deliverTerminalOutput(state, { output: 'stale', nextCursor: 15 }, write);
  assert.deepEqual(writes, ['中文😀']);
});
