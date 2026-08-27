#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  jsonFailure,
  normalizeRuntimeError,
} from '../skills/coordinate-agents/scripts/runtime-contract.mjs';
import { invokeRuntimeOperation } from '../skills/coordinate-agents/scripts/runtime-services.mjs';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', '2025-06-18', '2025-11-25']);
const MAX_LINE_LENGTH = 1024 * 1024;
const DEBUG_ENABLED = new Set(['1', 'true', 'yes']).has(
  `${process.env.COORDINATE_AGENTS_MCP_DEBUG || ''}`.trim().toLowerCase(),
);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function serverVersion(root = SERVER_ROOT) {
  const packageJson = readJson(join(root, 'package.json'));
  if (packageJson?.version) return `${packageJson.version}`;
  const pluginJson = readJson(join(root, '.codex-plugin', 'plugin.json'));
  return `${pluginJson?.version || '0.0.0'}`;
}

function debugLog(enabled, message) {
  if (!enabled) return;
  process.stderr.write(`[coordinate-agents:mcp] ${message}\n`);
}

const stringProperty = (description, { minLength = 1 } = {}) => ({
  type: 'string',
  minLength,
  description,
});

const integerProperty = (description, { minimum = 0 } = {}) => ({
  type: 'integer',
  minimum,
  description,
});

const rootProperty = {
  type: 'string',
  minLength: 1,
  description: 'Absolute or repository-relative Git repository root.',
};

const taskIdentityProperties = {
  root: rootProperty,
  taskId: stringProperty('Existing Task identifier.'),
};

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'coordinate_agents_setup_discover',
    description: 'Discover available coding CLIs and registered Adapter Contract identities/capabilities without changing configuration.',
    operation: 'setupDiscover',
    command: 'setup',
    inputSchema: {
      type: 'object',
      properties: { root: rootProperty },
      required: ['root'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_setup_configure',
    description: 'Configure an executable, select a built-in or registered external adapter, and assign a project workflow role transactionally.',
    operation: 'setupConfigure',
    command: 'setup.configure',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        agent: stringProperty('Agent identity, independent from its executable command.'),
        command: stringProperty('Executable command or safe path.'),
        adapter: stringProperty('Registered adapter name.', { minLength: 1 }),
        args: { type: 'array', items: { type: 'string' }, description: 'Adapter argument template.' },
        role: { type: 'string', enum: ['implementer', 'planner', 'reviewer'] },
      },
      required: ['root', 'agent', 'command'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_task_create',
    description: 'Create a durable Task without dispatching an Implementer.',
    operation: 'taskCreate',
    command: 'task.create',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        id: stringProperty('Optional deterministic Task identifier.'),
        title: stringProperty('Task title.'),
        spec: { type: 'string', description: 'Optional specification saved for later dispatch.' },
        planner: stringProperty('Planner Agent identity.'),
        implementer: stringProperty('Implementer Agent identity.'),
        reviewer: stringProperty('Reviewer Agent identity.'),
      },
      required: ['root', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_task_graph_validate',
    description: 'Validate and normalize an additive Task Graph v1 DAG before any worktree, Bus handoff, Adapter resolution, Session, or process side effect.',
    operation: 'taskGraphValidate',
    command: 'task.graph-validate',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        graph: {
          type: 'object',
          description: 'Task Graph v1 input with one parent Task, explicit Implementers, dependencies, and bounded concurrency.',
          required: ['schemaVersion', 'parentTask', 'subtasks', 'maxConcurrency'],
          properties: {
            schemaVersion: { const: 1 },
            parentTask: {
              type: 'object',
              required: ['id', 'title', 'planner', 'reviewer'],
              properties: {
                id: { type: 'string', pattern: '^task-[A-Za-z0-9][A-Za-z0-9_-]{1,127}$' },
                title: { type: 'string', minLength: 1, maxLength: 1024 },
                spec: { type: 'string', minLength: 1, maxLength: 262144 },
                planner: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
                implementer: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
                reviewer: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
              },
              additionalProperties: false,
            },
            subtasks: {
              type: 'array',
              minItems: 1,
              maxItems: 256,
              items: {
                type: 'object',
                required: ['id', 'implementer', 'spec'],
                properties: {
                  id: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
                  title: { type: 'string', minLength: 1, maxLength: 1024 },
                  implementer: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
                  spec: { type: 'string', minLength: 1, maxLength: 262144 },
                  dependsOn: {
                    type: 'array',
                    uniqueItems: true,
                    items: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
                  },
                },
                additionalProperties: false,
              },
            },
            maxConcurrency: { type: 'integer', minimum: 1, maximum: 32 },
          },
          additionalProperties: false,
        },
      },
      required: ['root', 'graph'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_task_dispatch',
    description: 'Validate and explicitly dispatch an approved Task to the configured Implementer.',
    operation: 'taskDispatch',
    command: 'task.dispatch',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdentityProperties,
        spec: { type: 'string', description: 'Optional approved specification override.' },
      },
      required: ['root', 'taskId'],
      additionalProperties: false,
    },
  },
  ...['status', 'inspect'].map(subcommand => ({
    name: `coordinate_agents_task_${subcommand}`,
    description: `Read the durable Task ${subcommand} view.`,
    operation: `task${subcommand[0].toUpperCase()}${subcommand.slice(1)}`,
    command: `task.${subcommand}`,
    inputSchema: {
      type: 'object',
      properties: taskIdentityProperties,
      required: ['root', 'taskId'],
      additionalProperties: false,
    },
  })),
  {
    name: 'coordinate_agents_task_review',
    description: 'Record a Codex review decision without authorizing release actions.',
    operation: 'taskReview',
    command: 'task.review',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdentityProperties,
        decision: { type: 'string', enum: ['REVIEW_APPROVED', 'CHANGES_REQUESTED'] },
        feedback: { type: 'string', description: 'Required when decision is CHANGES_REQUESTED.' },
        evidence: { type: 'object', description: 'Optional review evidence reference.' },
      },
      required: ['root', 'taskId', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_task_resume',
    description: 'Explicitly clear a Task recovery gate; this does not dispatch.',
    operation: 'taskResume',
    command: 'task.resume',
    inputSchema: {
      type: 'object',
      properties: taskIdentityProperties,
      required: ['root', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_task_stop',
    description: 'Stop a non-approved Task explicitly.',
    operation: 'taskStop',
    command: 'task.stop',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdentityProperties,
        reason: { type: 'string', description: 'Optional stop reason.' },
      },
      required: ['root', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_recover_inspect',
    description: 'Inspect Task, Agent, executable, and bounded error facts without resuming or retrying.',
    operation: 'recoverInspect',
    command: 'recover.inspect',
    inputSchema: {
      type: 'object',
      properties: taskIdentityProperties,
      required: ['root', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_session_open',
    description: 'Open or reuse a persistent PTY Execution Session for a configured Agent.',
    operation: 'sessionOpen',
    command: 'session.open',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        agent: stringProperty('Registered Agent identity, independent from its executable command.'),
        initialPrompt: { type: 'string', maxLength: 262144, description: 'Optional bounded first input delivered through the adapter launch contract or PTY.' },
        language: { type: 'string', enum: ['en', 'zh-CN'], description: 'Optional Runtime response language.' },
      },
      required: ['root', 'agent'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_session_status',
    description: 'Return the lightweight state of an existing persistent Execution Session.',
    operation: 'sessionStatus',
    command: 'session.status',
    inputSchema: {
      type: 'object',
      properties: { root: rootProperty, sessionId: stringProperty('Execution Session identifier.') },
      required: ['root', 'sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_session_inspect',
    description: 'Inspect an Execution Session with bounded recent PTY output and no environment secrets.',
    operation: 'sessionInspect',
    command: 'session.inspect',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        sessionId: stringProperty('Execution Session identifier.'),
        maxLines: integerProperty('Maximum recent output lines.', { minimum: 1 }),
        maxBytes: integerProperty('Maximum recent output bytes.', { minimum: 1 }),
      },
      required: ['root', 'sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_session_write',
    description: 'Write bounded input to an existing persistent PTY Execution Session.',
    operation: 'sessionWrite',
    command: 'session.write',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        sessionId: stringProperty('Execution Session identifier.'),
        input: stringProperty('Input delivered to the owned PTY.'),
        submit: { type: 'boolean', description: 'Append a terminal Enter when input has no line ending.' },
      },
      required: ['root', 'sessionId', 'input'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_session_read',
    description: 'Read bounded recent or cursor-based output from an Execution Session.',
    operation: 'sessionRead',
    command: 'session.read',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        sessionId: stringProperty('Execution Session identifier.'),
        cursor: integerProperty('Return output after this output cursor.', { minimum: 0 }),
        maxLines: integerProperty('Maximum output lines.', { minimum: 1 }),
        maxBytes: integerProperty('Maximum output bytes.', { minimum: 1 }),
      },
      required: ['root', 'sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'coordinate_agents_session_close',
    description: 'Gracefully close an owned Execution Session and kill it after a bounded timeout.',
    operation: 'sessionClose',
    command: 'session.close',
    inputSchema: {
      type: 'object',
      properties: {
        root: rootProperty,
        sessionId: stringProperty('Execution Session identifier.'),
        graceful: { type: 'boolean', description: 'Attempt Ctrl+C before the bounded termination timeout.' },
        timeoutMs: integerProperty('Graceful close timeout in milliseconds.', { minimum: 100 }),
      },
      required: ['root', 'sessionId'],
      additionalProperties: false,
    },
  },
]);

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));

function protocolError(id, code, message, data = undefined) {
  const error = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) error.error.data = data;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateArguments(tool, args) {
  if (!isObject(args)) return 'Tool arguments must be a JSON object.';
  const schema = tool.inputSchema;
  for (const required of schema.required || []) {
    if (!(required in args)) return `Missing required argument: ${required}`;
  }
  for (const key of Object.keys(args)) {
    if (schema.additionalProperties === false && !schema.properties[key]) return `Unknown argument: ${key}`;
    const property = schema.properties[key];
    if (!property) continue;
    const value = args[key];
    // Let the canonical Runtime classify every graph shape (including null,
    // arrays, and primitives) with the stable TASK_GRAPH_INVALID contract.
    // MCP still advertises the object schema to clients, but must not turn a
    // malformed graph into a transport-level argument error before Runtime
    // validation can run.
    if (tool.command === 'task.graph-validate' && key === 'graph') continue;
    if (property.type === 'string' && (typeof value !== 'string' || value.length < (property.minLength || 0))) {
      return `Argument ${key} must be a non-empty string.`;
    }
    if (property.maxLength !== undefined && typeof value === 'string' && value.length > property.maxLength) {
      return `Argument ${key} exceeds the supported size limit.`;
    }
    if (property.type === 'array' && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
      return `Argument ${key} must be an array of strings.`;
    }
    if (property.type === 'integer' && (!Number.isInteger(value) || value < (property.minimum ?? 0))) {
      return `Argument ${key} must be an integer within the supported range.`;
    }
    if (property.type === 'boolean' && typeof value !== 'boolean') return `Argument ${key} must be a boolean.`;
    if (property.type === 'object' && !isObject(value)) return `Argument ${key} must be an object.`;
    if (property.enum && !property.enum.includes(value)) return `Argument ${key} has an unsupported value.`;
  }
  return null;
}

function resultContent(payload) {
  return [{ type: 'text', text: JSON.stringify(payload) }];
}

async function callTool(tool, args) {
  try {
    const payload = await invokeRuntimeOperation(tool.operation, args);
    return {
      content: resultContent(payload),
      structuredContent: payload,
      isError: payload?.ok === false,
    };
  } catch (error) {
    const payload = jsonFailure(tool.command, normalizeRuntimeError(error));
    return {
      content: resultContent(payload),
      structuredContent: payload,
      isError: true,
    };
  }
}

function initializeResult(root, params = {}) {
  const requested = params.protocolVersion;
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'coordinate-agents', version: serverVersion(root) },
    instructions: 'Use Coordinate Agents tools for setup, durable Task operations, review, and recovery facts. Agent Bus transport and release actions remain internal or user-gated.',
  };
}

export function createMcpServer({ root = SERVER_ROOT } = {}) {
  const serverRoot = resolve(root);
  const debug = DEBUG_ENABLED;
  const log = message => debugLog(debug, message);
  log('MCP server starting');
  log(`server root: ${serverRoot}`);
  log(`runtime root: operation input (server root is ${serverRoot})`);
  log(`protocol version: ${PROTOCOL_VERSION}`);
  log(`tool count: ${TOOL_DEFINITIONS.length}`);
  return {
    async handle(message) {
      if (!isObject(message) || message.jsonrpc !== '2.0') return protocolError(message?.id, -32600, 'Invalid JSON-RPC request.');
      const { id = null, method, params = {} } = message;
      if (method === 'notifications/initialized' || method === 'notifications/cancelled' || method === '$/cancelRequest') return null;
      if (method === 'initialize') {
        log(`initialize received: protocolVersion=${params.protocolVersion || 'missing'}`);
        return { jsonrpc: '2.0', id, result: initializeResult(serverRoot, params) };
      }
      if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
      if (method === 'tools/list') {
        log('tools/list received');
        return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS.map(({ operation, command, ...tool }) => tool) } };
      }
      if (method !== 'tools/call') return protocolError(id, -32601, `Method not found: ${method}`);
      if (!isObject(params) || typeof params.name !== 'string') return protocolError(id, -32602, 'tools/call requires a tool name.');
      const tool = TOOL_MAP.get(params.name);
      if (!tool) return protocolError(id, -32601, `Unknown tool: ${params.name}`);
      const args = params.arguments === undefined ? {} : params.arguments;
      const validationError = validateArguments(tool, args);
      if (validationError) return protocolError(id, -32602, validationError);
      const result = await callTool(tool, args);
      return { jsonrpc: '2.0', id, result };
    },
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function runStdio({ input = process.stdin } = {}) {
  const server = createMcpServer();
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line) continue;
    if (line.length > MAX_LINE_LENGTH) {
      writeMessage(protocolError(null, -32700, 'MCP message exceeds the size limit.'));
      continue;
    }
    let message;
    try { message = JSON.parse(line); } catch {
      writeMessage(protocolError(null, -32700, 'Invalid JSON.'));
      continue;
    }
    try {
      const response = await server.handle(message);
      if (response) writeMessage(response);
    } catch (error) {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      if (message?.id !== undefined) writeMessage(protocolError(message.id, -32603, 'Internal MCP server error.'));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await runStdio();
}
