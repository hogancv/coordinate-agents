import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function codexConversationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('An exact non-nil Codex Conversation UUID is required.');
  return value.toLowerCase();
}

// Exact native disk metadata is preflight evidence only. It cannot attest which
// conversation a live TUI has actually loaded. Never use mtime or a "latest" ID.
export function readCodexConversation({ root, conversationId, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') }) {
  const id = codexConversationId(conversationId);
  const home = realpathSync.native(resolve(codexHome));
  const projectRoot = realpathSync.native(root);
  let visited = 0;
  const matches = [];
  function visit(directory, depth = 0) {
    if (!existsSync(directory)) return;
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe Codex native records directory.');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 100_000 || depth > 5) throw new Error('Codex native record search limit exceeded.');
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.name.endsWith(`-${id}.jsonl`)) {
        if (!entry.isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe Codex native record.');
        matches.push(path);
      }
    }
  }
  visit(join(home, 'sessions'));
  visit(join(home, 'archived_sessions'));
  if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous Codex native identity records.' : 'Codex native conversation not found on this machine.');
  const fd = openSync(matches[0], 'r');
  let metadata;
  try {
    const bytes = Buffer.alloc(256 * 1024);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    const text = bytes.subarray(0, length).toString('utf8');
    const end = text.indexOf('\n');
    if (end < 0) throw new Error('Incomplete Codex native identity metadata.');
    metadata = JSON.parse(text.slice(0, end));
  } finally { closeSync(fd); }
  if (metadata.type !== 'session_meta' || metadata.payload?.id !== id) throw new Error('Codex native identity metadata does not match the exact UUID.');
  if (metadata.payload.source !== 'cli') throw new Error('Only a primary Codex CLI conversation can be resumed here.');
  if (typeof metadata.payload.cwd !== 'string' || realpathSync.native(metadata.payload.cwd) !== projectRoot) throw new Error('Codex conversation belongs to a different project.');
  return { conversationId: id, projectRoot, source: 'cli' };
}

export function assertCodexResumeArguments(args) {
  const values = new Set(['-c', '--config', '-m', '--model', '-p', '--profile', '-s', '--sandbox', '-a', '--ask-for-approval', '--enable', '--disable', '--local-provider', '--add-dir']);
  const flags = new Set(['--oss', '--approve-for-me', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--search', '--no-alt-screen', '--no-daemon', '--strict-config']);
  for (let index = 0; index < args.length; index++) {
    const arg = `${args[index]}`;
    if (arg.includes('{prompt}')) throw new Error('Configured prompt arguments cannot be used for native resume.');
    const key = arg.split('=')[0];
    if (values.has(key)) {
      if (!arg.includes('=') && (++index >= args.length || `${args[index]}`.includes('{prompt}'))) throw new Error('Invalid configured native resume argument.');
    } else if (!flags.has(arg)) throw new Error('Configured arguments contain an unsupported native resume target or argument.');
  }
}
