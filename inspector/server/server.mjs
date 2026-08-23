#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInspectorData } from './inspector-data.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

const webRoot = resolve(fileURLToPath(new URL('../web', import.meta.url)));
const STATIC_FILES = new Map([
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
]);

function json(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function asset(response, pathname) {
  const entry = STATIC_FILES.get(pathname) || STATIC_FILES.get('/index.html');
  try {
    const body = readFileSync(resolve(webRoot, entry.file));
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': entry.type,
      'Content-Length': body.byteLength,
    });
    response.end(body);
  } catch {
    json(response, 500, { error: 'Inspector web assets are unavailable.' });
  }
}

function parseLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : 100;
}

function parseSequence(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function eventOptions(url, request = null) {
  return {
    taskId: url.searchParams.get('taskId') || null,
    sessionId: url.searchParams.get('sessionId') || null,
    type: url.searchParams.get('type') || null,
    after: parseSequence(url.searchParams.get('after'), parseSequence(request?.headers?.['last-event-id'], null)),
    limit: parseLimit(url.searchParams.get('limit')),
  };
}

function streamEvents(request, response, data, url) {
  let cursor = eventOptions(url, request).after || 0;
  let closed = false;
  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 1000\n\n');
  const push = () => {
    if (closed) return;
    try {
      const events = data.readEvents({ ...eventOptions(url), after: cursor, limit: 100 });
      for (const event of events) {
        if (!event.recorded || !Number.isInteger(event.sequence)) continue;
        response.write(`id: ${event.sequence}\nevent: runtime-event\ndata: ${JSON.stringify(event)}\n\n`);
        cursor = event.sequence;
      }
    } catch (error) {
      response.write(`event: inspector-error\ndata: ${JSON.stringify({ error: redactOutput(error.message || String(error), 2 * 1024) })}\n\n`);
    }
  };
  push();
  const poll = setInterval(push, 500);
  const heartbeat = setInterval(() => { if (!closed) response.write(': keepalive\n\n'); }, 15_000);
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
  };
  request.once('close', finish);
  response.once('close', finish);
}

function apiError(response, error) {
  const code = error?.code || '';
  const status = code === 'TASK_NOT_FOUND' ? 404 : 500;
  json(response, status, {
    error: redactOutput(error?.message || 'Inspector request failed.', 2 * 1024),
    code: code || 'INSPECTOR_READ_FAILED',
  });
}

export function createInspectorServer({ root, data = createInspectorData(root) } = {}) {
  return createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Inspector is read-only; only GET is supported.' });
      return;
    }

    const url = new URL(request.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) {
      if (pathname === '/' || STATIC_FILES.has(pathname)) {
        asset(response, pathname);
        return;
      }
      json(response, 404, { error: 'Inspector page not found.' });
      return;
    }

    try {
      if (pathname === '/api/tasks') {
        json(response, 200, data.readTasks());
        return;
      }
      if (pathname.startsWith('/api/tasks/')) {
        const id = decodeURIComponent(pathname.slice('/api/tasks/'.length));
        json(response, 200, data.readTask(id));
        return;
      }
      if (pathname === '/api/agents') {
        json(response, 200, data.readAgents());
        return;
      }
      if (pathname === '/api/sessions') {
        json(response, 200, await data.readSessions());
        return;
      }
      if (pathname === '/api/events') {
        json(response, 200, data.readEvents(eventOptions(url, request)));
        return;
      }
      if (pathname === '/api/events/stream') {
        streamEvents(request, response, data, url);
        return;
      }
      json(response, 404, { error: 'Inspector API endpoint not found.' });
    } catch (error) {
      apiError(response, error);
    }
  });
}

export function startInspector({ root, host = '127.0.0.1', port = 3000 } = {}) {
  if (host !== '127.0.0.1') throw new Error('Inspector must listen on localhost only.');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Inspector port must be an integer between 0 and 65535: ${port}`);
  }
  const data = createInspectorData(root);
  const server = createInspectorServer({ root: data.root, data });
  return new Promise((resolvePromise, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolvePromise({
        server,
        root: data.root,
        host,
        port: boundPort,
        url: `http://localhost:${boundPort}`,
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isInvokedDirectly()) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const portIndex = args.indexOf('--port');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 3000;
  try {
    const started = await startInspector({ root, port });
    console.log(`Inspector running:\n\n${started.url}`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
