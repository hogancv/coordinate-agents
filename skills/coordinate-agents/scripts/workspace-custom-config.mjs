// Project-local, bounded user data. Never interpreted as shell or logged.
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, win32, posix } from 'node:path';
import { acquireConfigLock, assertSafePath, atomicWrite, readConfig, readInternalFile } from './config.mjs';
import { readUserConfig, resolveAgentConfig } from './user-config.mjs';

function exactObject(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${name} fields.`);
}

export function validateTerminalCommand(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || Buffer.byteLength(value) > 512 || /[\x00-\x1f\x7f|&;`$%<>"']/u.test(value)
    || (!/^[A-Za-z0-9_.+-]+$/.test(value) && !win32.isAbsolute(value) && !posix.isAbsolute(value))) {
    throw new Error('Command must be an executable name or absolute path, without arguments or shell syntax (at most 512 UTF-8 bytes).');
  }
  return value;
}

export function validateCustomWorkspaceConfig(value) {
  exactObject(value, ['terminal1', 'terminal2', 'prompts'], 'custom configuration');
  const result = {};
  for (const slot of ['terminal1', 'terminal2']) {
    exactObject(value[slot], ['command'], slot);
    result[slot] = { command: validateTerminalCommand(value[slot].command) };
  }
  exactObject(value.prompts, ['project', 'terminal1', 'terminal2'], 'prompts');
  result.prompts = {};
  for (const [key, limit] of [['project', 8192], ['terminal1', 4096], ['terminal2', 4096]]) {
    const prompt = value.prompts[key];
    if (typeof prompt === 'string' && prompt.includes('\r')) {
      throw new Error(`Prompt ${key} must use LF line endings.`);
    }
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt, 'utf8') > limit
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(prompt)
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(prompt)) {
      throw new Error(`Prompt ${key} must be valid text, without terminal controls, at most ${limit} UTF-8 bytes.`);
    }
    result.prompts[key] = prompt;
  }
  return result;
}

function configPaths(root) {
  const supplied = resolve(root);
  if (!lstatSync(supplied).isDirectory() || lstatSync(supplied).isSymbolicLink()) throw new Error('Unsafe Workspace root.');
  const repository = realpathSync.native(supplied);
  const bus = join(repository, '.agent-bus');
  const path = join(bus, 'workspace-custom.json');
  assertSafePath(repository, bus);
  assertSafePath(repository, path);
  assertSafePath(repository, join(bus, 'tmp'));
  assertSafePath(repository, join(bus, 'locks', 'config'));
  if (!lstatSync(bus).isDirectory()) throw new Error('Workspace is not initialized.');
  return { repository, bus, path };
}

export function readCustomWorkspaceConfig(root) {
  const { bus, path } = configPaths(root);
  if (existsSync(path)) {
    const record = JSON.parse(readInternalFile(bus, path));
    exactObject(record, ['schemaVersion', 'custom'], 'Workspace config');
    if (record.schemaVersion !== 1) throw new Error('Unsupported custom Workspace config schema.');
    return validateCustomWorkspaceConfig(record.custom);
  }
  const commands = { terminal1: 'codex', terminal2: 'agy' };
  const agents = existsSync(join(bus, 'config.json')) ? readConfig(bus).agents : [];
  let user;
  try { user = readUserConfig(); } catch { user = { version: 1, agents: {} }; }
  for (const [slot, id] of [['terminal1', 'codex'], ['terminal2', 'antigravity']]) {
    const agent = agents.find(agent => agent.id === id) || { id, adapter: `${id}-cli` };
    commands[slot] = resolveAgentConfig(agent, user).command || commands[slot];
  }
  return validateCustomWorkspaceConfig({ terminal1: { command: commands.terminal1 }, terminal2: { command: commands.terminal2 }, prompts: { project: '', terminal1: '', terminal2: '' } });
}

export function saveCustomWorkspaceConfig(root, custom) {
  const validated = validateCustomWorkspaceConfig(custom);
  const { bus, path } = configPaths(root);
  const release = acquireConfigLock(bus);
  try { atomicWrite(path, `${JSON.stringify({ schemaVersion: 1, custom: validated }, null, 2)}\n`, join(bus, 'tmp')); }
  finally { release(); }
  return validated;
}

export function composeCustomPrompt(custom, slot) {
  if (!['terminal1', 'terminal2'].includes(slot)) throw new Error('Invalid custom terminal slot.');
  return [custom.prompts.project, custom.prompts[slot]].filter(text => text.length > 0).join('\n\n---\n\n');
}

export function customPromptInput(prompt) {
  // Bracketed paste preserves literal newlines as one CLI editor paste, then
  // exactly one Enter. Never use submit:true (Windows converts LF to Enter).
  return `\x1b[200~${prompt}\x1b[201~\r`;
}

export function resolveCustomTaskConfig(root, overrides) {
  const saved = readCustomWorkspaceConfig(root);
  if (overrides === undefined) return saved;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
    || Object.keys(overrides).some(key => !['terminal1', 'terminal2', 'prompts'].includes(key))) throw new Error('Invalid custom task overrides.');
  return validateCustomWorkspaceConfig({ ...saved, ...overrides });
}
