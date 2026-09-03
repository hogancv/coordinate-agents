#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInspectorData } from './inspector-data.mjs';
import {
  createActionGateway,
  createWorkspaceCapability,
  CAPABILITY_PLACEHOLDER,
} from './action-gateway.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

const inspectorWebRoot = resolve(fileURLToPath(new URL('../web', import.meta.url)));
const workspaceWebRoot = resolve(fileURLToPath(new URL('../web-workspace', import.meta.url)));
const INSPECTOR_STATIC_FILES = new Map([
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
]);

const WORKSPACE_STATIC_FILES = new Map([
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/composer-model.mjs', { file: 'composer-model.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
]);

const STATIC_FILES = WORKSPACE_STATIC_FILES;

function staticFilesFor(ui) {
  return ui === 'workspace' ? WORKSPACE_STATIC_FILES : INSPECTOR_STATIC_FILES;
}

function webAssetsFor(ui) {
  return ui === 'workspace' ? workspaceWebRoot : inspectorWebRoot;
}

function json(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function asset(response, pathname, assetsRoot, capability = null, staticFiles = WORKSPACE_STATIC_FILES) {
  const entry = staticFiles.get(pathname) || staticFiles.get('/index.html');
  if (!entry) {
    json(response, 404, { error: 'Inspector page not found.' });
    return;
  }
  try {
    let body = readFileSync(resolve(assetsRoot, entry.file));
    if (capability && entry.file === 'index.html') {
      body = Buffer.from(body.toString('utf8').replaceAll(CAPABILITY_PLACEHOLDER, capability), 'utf8');
    }
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': entry.type,
      'Content-Length': body.byteLength,
    });
    response.end(body);
  } catch {
    json(response, 500, { error: 'Workspace web assets are unavailable.' });
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
  const status = code === 'TASK_NOT_FOUND'
    ? 404
    : code === 'TASK_GRAPH_INVALID'
      ? 400
      : code === 'TASK_STATE_CONFLICT'
        ? 409
        : 500;
  json(response, status, {
    error: redactOutput(error?.message || 'Inspector request failed.', 2 * 1024),
    code: code || 'INSPECTOR_READ_FAILED',
  });
}

export function createInspectorServer({
  root,
  data = createInspectorData(root),
  ui = 'inspector',
  capability = null,
  gateway = null,
} = {}) {
  const assetsRoot = webAssetsFor(ui);
  const staticFiles = staticFilesFor(ui);
  return createServer(async (request, response) => {
    if (request.method !== 'GET') {
      // The Workspace action gateway is the only non-GET surface; the
      // compatibility Inspector path remains strictly GET-only.
      if (gateway) {
        const actionUrl = new URL(request.url || '/', 'http://localhost');
        await gateway.handleAction(request, response, actionUrl.pathname);
        return;
      }
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Inspector is read-only; only GET is supported.' });
      return;
    }

    const url = new URL(request.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) {
      if (pathname === '/' || staticFiles.has(pathname)) {
        asset(response, pathname, assetsRoot, capability, staticFiles);
        return;
      }
      json(response, 404, { error: 'Inspector page not found.' });
      return;
    }

    try {
      if (pathname === '/api/repository' && typeof data.readRepository === 'function') {
        json(response, 200, data.readRepository());
        return;
      }
      if (pathname === '/api/tasks') {
        json(response, 200, data.readTasks());
        return;
      }
      if (pathname.startsWith('/api/tasks/')) {
        const id = decodeURIComponent(pathname.slice('/api/tasks/'.length));
        json(response, 200, data.readTask(id));
        return;
      }
      if (pathname === '/api/graphs') {
        json(response, 200, data.readGraphs());
        return;
      }
      if (pathname.startsWith('/api/graphs/')) {
        const id = decodeURIComponent(pathname.slice('/api/graphs/'.length));
        json(response, 200, data.readGraph(id));
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

export function startInspector({
  root,
  host = '127.0.0.1',
  port = 3000,
  ui = 'inspector',
  capability = null,
  gateway = null,
} = {}) {
  if (host !== '127.0.0.1') throw new Error('Inspector must listen on localhost only.');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Inspector port must be an integer between 0 and 65535: ${port}`);
  }
  const data = createInspectorData(root);
  const server = createInspectorServer({ root: data.root, data, ui, capability, gateway });
  return new Promise((resolvePromise, reject) => {
    let ipv6Loopback = null;
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = async () => {
      server.off('error', onError);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;

      // Node 18's fetch resolves localhost to ::1 first on some supported
      // hosts and does not retry 127.0.0.1 after an IPv6 connection refusal.
      // Keep the documented IPv4 listener as the primary server, and add an
      // optional IPv6 loopback alias on the same port so the localhost URL is
      // reachable without exposing the Inspector beyond loopback interfaces.
      if (host === '127.0.0.1') {
        const candidate = createInspectorServer({ root: data.root, data, ui, capability, gateway });
        try {
          await new Promise((resolveAlias, rejectAlias) => {
            const onAliasError = error => {
              candidate.off('listening', onAliasListening);
              rejectAlias(error);
            };
            const onAliasListening = () => {
              candidate.off('error', onAliasError);
              resolveAlias();
            };
            candidate.once('error', onAliasError);
            candidate.once('listening', onAliasListening);
            candidate.listen(boundPort, '::1');
          });
          ipv6Loopback = candidate;
          // A later bind error must not become an uncaught EventEmitter error.
          candidate.on('error', () => {});
        } catch {
          try { candidate.close(); } catch { /* IPv6 loopback is optional. */ }
        }
      }

      // Return the primary IPv4 server for compatibility, but make its close
      // lifecycle own the optional IPv6 alias as well.
      if (ipv6Loopback) {
        const closePrimary = server.close.bind(server);
        const closePrimaryConnections = server.closeAllConnections?.bind(server);
        const closeAlias = ipv6Loopback.close.bind(ipv6Loopback);
        const closeAliasConnections = ipv6Loopback.closeAllConnections?.bind(ipv6Loopback);
        let closing = false;
        server.closeAllConnections = () => {
          closePrimaryConnections?.();
          closeAliasConnections?.();
        };
        server.close = callback => {
          if (closing) {
            callback?.();
            return server;
          }
          closing = true;
          let remaining = 2;
          const done = () => {
            remaining -= 1;
            if (remaining === 0) callback?.();
          };
          try { closePrimary(done); } catch { done(); }
          try { closeAlias(done); } catch { done(); }
          return server;
        };
      }

      resolvePromise({
        server,
        root: data.root,
        host,
        port: boundPort,
        url: `http://localhost:${boundPort}`,
        capability: capability || null,
        actionEndpoint: gateway ? '/api/action' : null,
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

// The Web Workspace is the primary local product entry (#45). It reuses the
// same read-only server, data adapter, loopback guards, and bounded content as
// the Inspector compatibility path and only selects the Workspace web assets.
// Unlike the compatibility Inspector, the Workspace binds exactly one validated
// Git repository root: unsafe, symlinked, or non-Git roots fail closed before a
// listener is created. It also mounts the guarded browser-to-Runtime action
// gateway (#46) with a server-issued per-launch capability.
export function startWorkspace(options = {}) {
  const requested = resolve(options.root || process.cwd());
  const result = spawnSync('git', ['-C', requested, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 512 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Workspace must start inside an initialized Git repository: ${requested}`);
  }
  const canonicalRoot = resolve(result.stdout.trim());
  const capability = options.capability || createWorkspaceCapability();
  const gateway = options.gateway || createActionGateway({
    root: canonicalRoot,
    capability,
    maxBodyBytes: options.maxBodyBytes,
  });
  return startInspector({
    ...options,
    root: canonicalRoot,
    ui: 'workspace',
    capability,
    gateway,
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
  const uiIndex = args.indexOf('--ui');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 3000;
  const ui = uiIndex >= 0 ? args[uiIndex + 1] : 'inspector';
  try {
    const started = ui === 'workspace'
      ? await startWorkspace({ root, port })
      : await startInspector({ root, port });
    console.log(`${ui === 'workspace' ? 'Workspace' : 'Inspector'} running:\n\n${started.url}`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
