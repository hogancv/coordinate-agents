#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'mcp', 'server.mjs');
const expectedTools = [
  'coordinate_agents_setup_discover',
  'coordinate_agents_setup_configure',
  'coordinate_agents_task_create',
  'coordinate_agents_task_dispatch',
  'coordinate_agents_task_status',
  'coordinate_agents_task_inspect',
  'coordinate_agents_task_review',
  'coordinate_agents_task_resume',
  'coordinate_agents_task_stop',
  'coordinate_agents_recover_inspect',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function responseFor(responses, id) {
  return responses.find(response => response?.id === id);
}

const isolatedCwd = mkdtempSync(join(tmpdir(), 'Coordinate Agents MCP Self Test '));
try {
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'coordinate-agents-self-test', version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(message => JSON.stringify(message)).join('\n') + '\n';

  const result = spawnSync(process.execPath, [serverPath, '--stdio'], {
    cwd: isolatedCwd,
    env: process.env,
    input,
    encoding: 'utf8',
    windowsHide: true,
  });

  const stderr = `${result.stderr || ''}`.trim();
  assert(result.error === undefined, `failed to start MCP server: ${result.error?.message || result.error}`);
  assert(result.status === 0, `MCP server exited with ${result.status}: ${stderr}`);

  const lines = `${result.stdout || ''}`.split(/\r?\n/).filter(Boolean);
  assert(lines.length === 2, `expected two MCP responses, received ${lines.length}`);
  const responses = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`stdout line ${index + 1} is not valid JSON: ${error.message}`);
    }
  });

  const initialized = responseFor(responses, 1);
  assert(initialized?.jsonrpc === '2.0' && initialized.result, 'initialize did not return a JSON-RPC result');
  assert(initialized.result.protocolVersion === '2025-06-18', `unexpected protocol: ${initialized.result.protocolVersion}`);
  assert(initialized.result.capabilities?.tools, 'initialize did not advertise tools capability');

  const listed = responseFor(responses, 2);
  assert(listed?.jsonrpc === '2.0' && listed.result, 'tools/list did not return a JSON-RPC result');
  const names = listed.result.tools?.map(tool => tool.name) || [];
  assert(names.length === expectedTools.length, `expected ${expectedTools.length} tools, received ${names.length}`);
  assert(JSON.stringify(names) === JSON.stringify(expectedTools), 'tools/list returned an unexpected catalog');

  if (stderr) process.stderr.write(`${stderr}\n`);
  console.log('MCP server: OK');
  console.log(`Protocol: ${initialized.result.protocolVersion}`);
  console.log(`Tools: ${names.length}`);
} catch (error) {
  console.error(`MCP server: FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(isolatedCwd, { recursive: true, force: true });
}
