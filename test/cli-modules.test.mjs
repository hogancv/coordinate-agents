import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs } from '../lib/cli/parse-args.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('canonical bin is a thin executable and compatibility export surface', () => {
  const content = readFileSync(join(root, 'bin', 'coordinate-agents.mjs'), 'utf8');
  assert.ok(content.split(/\r?\n/).length <= 30, 'bin entry must remain thin');
  assert.match(content, /import \{ runCli \} from '\.\.\/lib\/cli-core\.mjs'/);
  assert.match(content, /export \* from '\.\.\/lib\/cli-core\.mjs'/);
  assert.doesNotMatch(content, /function (task|setup|adapter|doctor|quickstart|launchAgent)/);
});

test('top-level commands are routed through dedicated modules', () => {
  const commandRoot = join(root, 'lib', 'commands');
  for (const name of ['adapter', 'agent', 'config', 'inspector', 'maintenance', 'setup', 'status', 'task', 'workspace']) {
    assert.ok(existsSync(join(commandRoot, `${name}.mjs`)), `missing command module: ${name}`);
  }
  const registry = readFileSync(join(commandRoot, 'index.mjs'), 'utf8');
  for (const command of ['adapter', 'agent', 'config', 'discover', 'doctor', 'inspector', 'install', 'launch', 'quickstart', 'setup', 'status', 'task', 'uninstall', 'update']) {
    assert.match(registry, new RegExp(`\\['${command}',`));
  }
});

test('extracted argument parser preserves nested commands and aliases', () => {
  const graph = parseArgs(['task', 'graph', 'run', 'parent-1', '--subtask-id', 'child-1', '--json']);
  assert.equal(graph.command, 'task');
  assert.equal(graph.subcommand, 'graph');
  assert.deepEqual(graph.positionals, ['run', 'parent-1']);
  assert.equal(graph.subtaskId, 'child-1');
  assert.equal(graph.json, true);

  const adapter = parseArgs(['adapter', 'register', './adapter.mjs']);
  assert.equal(adapter.command, 'adapter');
  assert.equal(adapter.subcommand, 'register');
  assert.equal(adapter.targetAgent, './adapter.mjs');
});
