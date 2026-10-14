// Small fetch-based SSE reader: custom Capability headers stay out of URLs.
export async function consumeTerminalStream(response, { onEvent, signal } = {}) {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const error = new Error('Terminal streaming is unavailable.');
    error.status = response.status;
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!signal?.aborted) {
      let timer;
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Terminal stream heartbeat timed out.')), 45_000); }),
      ]).finally(() => clearTimeout(timer));
      if (result.done) {
        if (buffer || data.length) throw new Error('Incomplete terminal stream frame.');
        return;
      }
      buffer += decoder.decode(result.value, { stream: true });
      if (buffer.length + data.join('\n').length > 1024 * 1024) throw new Error('Terminal stream frame exceeds its size limit.');
      let newline;
      while (!signal?.aborted && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) {
          if (data.length && ['terminal-output', 'terminal-gap', 'terminal-state'].includes(event)) {
            await onEvent(event, JSON.parse(data.join('\n')));
          }
          event = ''; data = [];
        } else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function deliverTerminalOutput(controller, page, write) {
  if (controller.disposed) return;
  const next = page?.nextCursor;
  if (Number.isSafeInteger(controller.cursor) && Number.isSafeInteger(next) && next <= controller.cursor) return;
  if (page?.output) await write(page.output);
  // xterm's callback confirms it consumed the page before reconnect can reuse
  // this cursor. Transport ownership keeps SSE and polling writes serialized.
  if (!controller.disposed) controller.cursor = Number.isSafeInteger(next) ? next : null;
}
