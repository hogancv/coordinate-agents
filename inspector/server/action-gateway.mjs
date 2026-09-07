/**
 * Guarded browser-to-Runtime action gateway (#46).
 *
 * The Web Workspace is read-only on GET paths; this module is the narrow,
 * additive action boundary for later Workspace controls. It binds one
 * canonical repository root to the server process, requires a server-issued
 * per-launch capability on every non-GET request, validates loopback
 * Host/Origin and bounded JSON bodies, exposes only an explicit allow-list of
 * structured operations, and routes them exclusively to the shared
 * `runtime-services.mjs` operation map used by CLI and MCP.
 *
 * The gateway never shells out, parses CLI stdout, proxies MCP, accepts an
 * arbitrary operation name, or lets a request choose a different repository
 * root. Concurrency and replay safety are delegated to the existing Runtime
 * locks/deduplication rules (deterministic Task IDs, atomic Task records,
 * graph validation, claim/state conflicts); the HTTP seam only serializes
 * through the single-threaded Node event loop.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { invokeRuntimeOperation } from '../../skills/coordinate-agents/scripts/runtime-services.mjs';
import {
  jsonFailure,
  normalizeRuntimeError,
} from '../../skills/coordinate-agents/scripts/runtime-contract.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

export const ACTION_ENDPOINT = '/api/action';
export const CAPABILITY_HEADER = 'x-coordinate-agents-capability';
export const CORRELATION_HEADER = 'x-correlation-id';
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
export const CAPABILITY_PLACEHOLDER = '__COORDINATE_AGENTS_CAPABILITY__';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Workspace action allow-list. Every entry maps to one shared Runtime
 * operation. Discovery is read-only; `setupConfigure` is the transactional
 * project Agent/role configuration path. Workspace Task lifecycle actions are
 * the only browser process controls: they create/close/restart a fixed
 * Codex+Antigravity pair. Session input and resize remain bounded and owned by
 * the Runtime, while the legacy Task/Graph actions stay available for
 * compatibility.
 */
const ACTION_DEFINITIONS = Object.freeze({
  setupDiscover: {
    operation: 'setupDiscover',
    command: 'setup',
    params: {},
  },
  setupConfigure: {
    operation: 'setupConfigure',
    command: 'setup.configure',
    params: {
      agent: { type: 'string', required: true, max: 64 },
      command: { type: 'string', required: true, max: 512 },
      adapter: { type: 'string', max: 128 },
      role: { type: 'string', max: 32 },
      args: { type: 'array', max: 64, itemMax: 512 },
    },
  },
  taskCreate: {
    operation: 'taskCreate',
    command: 'task.create',
    params: {
      title: { type: 'string', required: true, max: 1024 },
      id: { type: 'string', max: 128 },
      spec: { type: 'string', max: 256 * 1024 },
      planner: { type: 'string', max: 64 },
      implementer: { type: 'string', max: 64 },
      reviewer: { type: 'string', max: 64 },
    },
  },
  workspaceTaskCreate: {
    operation: 'workspaceTaskCreate',
    command: 'workspace.task.create',
    params: {
      language: { type: 'string', max: 16, enum: ['en', 'zh-CN'] },
    },
  },
  workspaceTaskClose: {
    operation: 'workspaceTaskClose',
    command: 'workspace.task.close',
    params: {
      workspaceTaskId: { type: 'string', required: true, max: 128 },
    },
  },
  workspaceTaskRestart: {
    operation: 'workspaceTaskRestart',
    command: 'workspace.task.restart',
    params: {
      workspaceTaskId: { type: 'string', required: true, max: 128 },
      language: { type: 'string', max: 16, enum: ['en', 'zh-CN'] },
    },
  },
  taskStatus: {
    operation: 'taskStatus',
    command: 'task.status',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskInspect: {
    operation: 'taskInspect',
    command: 'task.inspect',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphStatus: {
    operation: 'taskGraphStatus',
    command: 'task.graph-status',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphInspect: {
    operation: 'taskGraphInspect',
    command: 'task.graph-inspect',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphPlan: {
    operation: 'taskGraphPlan',
    command: 'task.graph-plan',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphValidate: {
    operation: 'taskGraphValidate',
    command: 'task.graph-validate',
    params: {
      graph: { type: 'object', required: true, max: 512 * 1024 },
      intentMap: { type: 'object', max: 512 * 1024 },
    },
  },
  taskGraphCreate: {
    operation: 'taskGraphCreate',
    command: 'task.graph-create',
    params: {
      graph: { type: 'object', required: true, max: 512 * 1024 },
      intentMap: { type: 'object', max: 512 * 1024 },
    },
  },
  taskDispatch: {
    operation: 'taskDispatch',
    command: 'task.dispatch',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      spec: { type: 'string', max: 256 * 1024 },
    },
  },
  taskGraphRun: {
    operation: 'taskGraphRun',
    command: 'task.graph-run',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      sessionWaitMs: { type: 'integer', min: 0, max: 10_000 },
    },
  },
  taskGraphAdvance: {
    operation: 'taskGraphAdvance',
    command: 'task.graph-advance',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      maxWaves: { type: 'integer', required: true, min: 1, max: 32 },
      sessionWaitMs: { type: 'integer', min: 0, max: 10_000 },
    },
  },
  taskStop: {
    operation: 'taskStop',
    command: 'task.stop',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  taskResume: {
    operation: 'taskResume',
    command: 'task.resume',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  taskGraphStop: {
    operation: 'taskGraphStop',
    command: 'task.graph-stop',
    params: { taskId: { type: 'string', required: true, max: 128 }, subtaskId: { type: 'string', max: 128 } },
  },
  taskGraphRecover: {
    operation: 'taskGraphRecover',
    command: 'task.graph-recover',
    params: { taskId: { type: 'string', required: true, max: 128 }, subtaskId: { type: 'string', max: 128 } },
  },
  taskGraphResume: {
    operation: 'taskGraphResume',
    command: 'task.graph-resume',
    params: { taskId: { type: 'string', required: true, max: 128 }, subtaskId: { type: 'string', max: 128 } },
  },
  taskGraphCleanup: {
    operation: 'taskGraphCleanup',
    command: 'task.graph-cleanup',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  sessionStatus: {
    operation: 'sessionStatus',
    command: 'session.status',
    params: { sessionId: { type: 'string', required: true, max: 256 } },
  },
  sessionInspect: {
    operation: 'sessionInspect',
    command: 'session.inspect',
    params: { sessionId: { type: 'string', required: true, max: 256 } },
  },
  sessionRead: {
    operation: 'sessionRead',
    command: 'session.read',
    params: { sessionId: { type: 'string', required: true, max: 256 }, limit: { type: 'integer', min: 1, max: 2000 } },
  },
  sessionWrite: {
    operation: 'sessionWrite',
    command: 'session.write',
    params: {
      sessionId: { type: 'string', required: true, max: 256 },
      input: { type: 'string', required: true, max: 16 * 1024 },
      submit: { type: 'boolean' },
    },
  },
  sessionResize: {
    operation: 'sessionResize',
    command: 'session.resize',
    params: {
      sessionId: { type: 'string', required: true, max: 256 },
      cols: { type: 'integer', required: true, min: 1, max: 1000 },
      rows: { type: 'integer', required: true, min: 1, max: 500 },
    },
  },
  sessionClose: {
    operation: 'sessionClose',
    command: 'session.close',
    params: { sessionId: { type: 'string', required: true, max: 256 } },
  },
  taskGraphIntegrate: {
    operation: 'taskGraphIntegrate',
    command: 'task.graph-integrate',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  taskReview: {
    operation: 'taskReview',
    command: 'task.review',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      decision: { type: 'string', required: true, max: 32, enum: ['REVIEW_APPROVED', 'CHANGES_REQUESTED'] },
      feedback: { type: 'string', max: 16 * 1024 },
      evidence: { type: 'object', max: 64 * 1024 },
    },
  },
  taskGraphReview: {
    operation: 'taskGraphReview',
    command: 'task.graph-review',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      decision: { type: 'string', required: true, max: 32, enum: ['REVIEW_APPROVED', 'CHANGES_REQUESTED'] },
      feedback: { type: 'string', max: 16 * 1024 },
      evidence: { type: 'object', max: 64 * 1024 },
    },
  },
  recoverInspect: {
    operation: 'recoverInspect',
    command: 'recover.inspect',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
});

function gatewayError(code, message) {
  return {
    ok: false,
    command: 'action',
    error: {
      code,
      message: redactOutput(`${message || code}`, 2 * 1024),
      recoverable: false,
    },
  };
}

function actionEnvelope(payload, { action, correlation }) {
  return {
    ...payload,
    action,
    correlation,
  };
}

function readBody(request, maxBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let received = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return; // keep draining so the client can read our 413.
      received += chunk.length;
      if (received > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) resolvePromise({ tooLarge: true, body: null });
      else resolvePromise({ tooLarge: false, body: Buffer.concat(chunks) });
    });
    request.on('error', error => reject({ code: 'ACTION_BODY_READ_FAILED', status: 400, message: error.message }));
  });
}

function parseHost(request) {
  const header = request.headers.host || '';
  const hostname = (header.split(':')[0] || '').trim().toLowerCase();
  return hostname;
}

function originAllowed(request) {
  const origin = request.headers.origin;
  if (origin === undefined || origin === null || origin === '') return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

function capabilityMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function validateParams(definition, params) {
  const allowed = new Set(Object.keys(definition.params));
  for (const key of Object.keys(params)) {
    // root is validated and bound by the gateway itself before this point.
    if (key === 'root') continue;
    if (!allowed.has(key)) return `Unsupported action parameter: ${key}`;
  }
  for (const [key, rule] of Object.entries(definition.params)) {
    const value = params[key];
    const present = value !== undefined && value !== null;
    if (rule.required && !present) return `Missing required parameter: ${key}`;
    if (!present) continue;
    if (rule.type === 'string') {
      if (typeof value !== 'string') return `Parameter ${key} must be a string.`;
      if (value.length > rule.max) return `Parameter ${key} exceeds the supported size limit.`;
    } else if (rule.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        return `Parameter ${key} must be an object.`;
      }
      if (Buffer.byteLength(JSON.stringify(value)) > rule.max) return `Parameter ${key} exceeds the supported size limit.`;
    } else if (rule.type === 'array') {
      if (!Array.isArray(value)) return `Parameter ${key} must be an array.`;
      if (value.length > rule.max || value.some(item => typeof item !== 'string' || item.length > (rule.itemMax || 512))) {
        return `Parameter ${key} exceeds the supported size limit.`;
      }
    } else if (rule.type === 'integer') {
      if (!Number.isInteger(value)) return `Parameter ${key} must be an integer.`;
      if (value < (rule.min ?? 0) || value > (rule.max ?? Number.MAX_SAFE_INTEGER)) {
        return `Parameter ${key} is outside the supported range.`;
      }
    } else if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') return `Parameter ${key} must be a boolean.`;
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return `Parameter ${key} has an unsupported value.`;
  }
  return null;
}

export function createActionGateway({ root, capability, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const boundRoot = resolve(root || process.cwd());
  return {
    capability,
    async handleAction(request, response, pathname) {
      const send = (status, payload) => {
        const body = `${JSON.stringify({ ...payload, correlation })}\n`;
        response.writeHead(status, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        });
        response.end(body);
      };
      const correlation = request.headers[CORRELATION_HEADER] && CORRELATION_PATTERN.test(request.headers[CORRELATION_HEADER])
        ? request.headers[CORRELATION_HEADER]
        : randomUUID();

      // Only the single documented action endpoint accepts non-GET traffic;
      // every other path remains a GET-only read surface (405 with Allow: GET).
      if (pathname !== ACTION_ENDPOINT) {
        response.setHeader('Allow', 'GET');
        send(405, gatewayError('ACTION_ENDPOINT_NOT_FOUND', `Workspace endpoint is read-only; only ${ACTION_ENDPOINT} accepts actions.`));
        return;
      }

      // Loopback Host and Origin policy run before any body is parsed.
      if (!LOOPBACK_HOSTS.has(parseHost(request))) {
        send(403, gatewayError('ACTION_HOST_DISALLOWED', 'Workspace actions require a loopback Host header.'));
        return;
      }
      if (!originAllowed(request)) {
        send(403, gatewayError('ACTION_ORIGIN_DISALLOWED', 'Workspace actions require a same-origin or loopback Origin.'));
        return;
      }

      // Per-launch capability is mandatory for every non-GET request.
      const suppliedCapability = request.headers[CAPABILITY_HEADER];
      if (!capabilityMatches(suppliedCapability, capability)) {
        send(401, gatewayError('ACTION_CAPABILITY_REQUIRED', 'Workspace actions require the server-issued per-launch capability.'));
        return;
      }

      const contentType = `${request.headers['content-type'] || ''}`.split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(415, gatewayError('ACTION_CONTENT_TYPE_INVALID', 'Workspace action bodies must be application/json.'));
        return;
      }

      let read;
      try {
        read = await readBody(request, maxBodyBytes);
      } catch (error) {
        send(error.status || 400, gatewayError(error.code || 'ACTION_BODY_READ_FAILED', error.message || 'Action body could not be read.'));
        return;
      }
      if (read.tooLarge) {
        send(413, gatewayError('ACTION_BODY_TOO_LARGE', 'Workspace action body exceeds the supported size limit.'));
        return;
      }
      if (read.body.length === 0) {
        send(400, gatewayError('ACTION_BODY_INVALID', 'Workspace action body is required.'));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(read.body.toString('utf8'));
      } catch {
        send(400, gatewayError('ACTION_BODY_INVALID', 'Workspace action body is not valid JSON.'));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        send(400, gatewayError('ACTION_BODY_INVALID', 'Workspace action body must be a JSON object.'));
        return;
      }

      const { action, params: rawParams = {}, correlationId } = parsed;
      if (typeof action !== 'string') {
        send(400, gatewayError('ACTION_NOT_ALLOWED', 'Workspace action name is required.'));
        return;
      }
      const correlationValue = typeof correlationId === 'string' && CORRELATION_PATTERN.test(correlationId)
        ? correlationId
        : correlation;
      const definition = ACTION_DEFINITIONS[action];
      if (!definition) {
        send(404, gatewayError('ACTION_NOT_ALLOWED', `Unknown Workspace action: ${action}`));
        return;
      }
      if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
        send(400, gatewayError('ACTION_PARAMS_INVALID', 'Workspace action params must be an object.'));
        return;
      }

      // The repository root is bound at startup. A request may echo the bound
      // root for tool compatibility but may never select another root.
      const params = { ...rawParams };
      if (params.root !== undefined) {
        let requestedRoot;
        try {
          requestedRoot = resolve(`${params.root}`);
        } catch {
          requestedRoot = null;
        }
        if (!requestedRoot || requestedRoot !== boundRoot) {
          send(403, gatewayError('ACTION_ROOT_MISMATCH', 'Workspace action root does not match the bound repository.'));
          return;
        }
        delete params.root;
      }
      params.root = boundRoot;

      const invalid = validateParams(definition, params);
      if (invalid) {
        send(400, gatewayError('ACTION_PARAMS_INVALID', invalid));
        return;
      }

      try {
        const payload = await invokeRuntimeOperation(definition.operation, params);
        send(200, actionEnvelope(payload || {}, { action, correlation: correlationValue }));
      } catch (error) {
        const payload = jsonFailure(definition.command, normalizeRuntimeError(error));
        send(200, actionEnvelope(payload, { action, correlation: correlationValue }));
      }
    },
  };
}

export function createWorkspaceCapability() {
  return randomBytes(24).toString('hex');
}
