#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const roles = new Set(['codex', 'antigravity']);
const states = new Set(['IDLE', 'CLARIFYING', 'SPEC_READY', 'IMPLEMENTING', 'WAITING', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED', 'RELEASING', 'STOPPED', 'ERROR']);
const messageFields = ['id', 'from', 'to', 'type', 'created_at', 'subject'];

function parseArgs(argv) {
  if (!argv.length || ['--help', '-h', 'help'].includes(argv[0])) return { command: 'help' };
  const result = { command: argv[0] };
  const args = argv.slice(1);
  while (args.length) {
    const option = args.shift();
    if (!option.startsWith('--')) throw new Error(`Unknown argument: ${option}`);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!args.length || args[0].startsWith('--')) throw new Error(`Missing value for ${option}`);
    result[key] = args.shift();
  }
  return result;
}

function requireValue(options, name) {
  if (options[name] === undefined || options[name] === '') throw new Error(`--${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required for ${options.command}.`);
  return options[name];
}

function positiveNumber(value, name, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be greater than zero.`);
  return parsed;
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Git command failed.').trim());
  return result.stdout.trim();
}

function repoRoot(candidate) {
  const cwd = candidate ? resolve(candidate) : process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Repository root does not exist: ${cwd}`);
  return resolve(git(['rev-parse', '--show-toplevel'], cwd));
}

function assertContained(root, candidate) {
  const relation = relative(root, candidate);
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Refusing agent-bus path outside repository: ${candidate}`);
  }
}

function assertSafePath(root, candidate) {
  assertContained(root, candidate);
  let cursor = candidate;
  while (cursor !== root) {
    if (existsSync(cursor)) {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic link or junction in agent-bus path: ${cursor}`);
      const canonical = realpathSync(cursor);
      assertContained(root, canonical);
    }
    cursor = dirname(cursor);
  }
  return candidate;
}

function safeInternalStat(bus, path) {
  assertContained(bus, path);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Refusing linked or non-regular agent-bus file: ${path}`);
  }
  assertContained(bus, realpathSync(path));
  return metadata;
}

function readInternalFile(bus, path) {
  safeInternalStat(bus, path);
  return readFileSync(path, 'utf8');
}

function syncFile(path) {
  const fd = openSync(path, 'r');
  try {
    try { fsyncSync(fd); } catch (error) {
      // Some Windows filesystems reject fsync on read-only descriptors. The
      // close + same-volume rename still prevents readers seeing partial data.
      if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
    }
  } finally { closeSync(fd); }
}

function atomicWrite(destination, content, tempDirectory) {
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(tempDirectory, { recursive: true });
  const temp = join(tempDirectory, `.tmp-${process.pid}-${randomUUID().replaceAll('-', '')}`);
  writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
  syncFile(temp);
  try {
    renameSync(temp, destination);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function writeLease(messagePath, bus, leaseSeconds) {
  const claimedAt = new Date();
  atomicWrite(`${messagePath}.lease.json`, `${JSON.stringify({
    claimed_at: claimedAt.toISOString(),
    expires_at: new Date(claimedAt.getTime() + leaseSeconds * 1000).toISOString(),
    pid: process.pid,
    host: hostname(),
    claim_token: randomUUID(),
  }, null, 2)}\n`, join(bus, 'tmp'));
}

function initialize(root) {
  const bus = assertSafePath(root, join(root, '.agent-bus'));
  const directories = [
    'inbox/codex/new', 'inbox/codex/processing', 'inbox/codex/processed',
    'inbox/antigravity/new', 'inbox/antigravity/processing', 'inbox/antigravity/processed',
    'quarantine/codex', 'quarantine/antigravity', 'specs', 'reviews', 'evidence',
    'releases', 'state/codex', 'state/antigravity', 'dedupe', 'locks', 'logs', 'tmp',
  ];
  for (const directory of directories) {
    const path = assertSafePath(root, join(bus, directory));
    mkdirSync(path, { recursive: true });
    assertSafePath(root, path);
  }

  let exclude = git(['rev-parse', '--git-path', 'info/exclude'], root);
  if (!isAbsolute(exclude)) exclude = resolve(root, exclude);
  mkdirSync(dirname(exclude), { recursive: true });
  const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes('.agent-bus/')) {
    appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}.agent-bus/\n`, 'utf8');
  }
  return bus;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function localLockOwnerIsAlive(bus, lock) {
  try {
    const owner = JSON.parse(readInternalFile(bus, join(lock, 'owner.json')));
    if (owner.host !== hostname() || !Number.isInteger(owner.pid)) return false;
    process.kill(owner.pid, 0);
    return true;
  } catch { return false; }
}

function acquireLock(bus, name, { timeoutMs = 10_000, staleMs = 30_000 } = {}) {
  const lock = join(bus, 'locks', name.replace(/[^a-zA-Z0-9._-]/g, '_'));
  const owner = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({ owner, pid: process.pid, host: hostname(), acquired_at: new Date().toISOString() })}\n`, 'utf8');
      return () => {
        try {
          const current = JSON.parse(readInternalFile(bus, join(lock, 'owner.json')));
          if (current.owner === owner) rmSync(lock, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs && !localLockOwnerIsAlive(bus, lock)) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      sleepSync(20);
    }
  }
  throw new Error(`Timed out acquiring lock: ${name}`);
}

function safeSubject(subject) {
  return subject.replaceAll('"', '\\"').replace(/[\r\n]/g, ' ');
}

function safeHeaderValue(value, name) {
  if (!/^[A-Za-z0-9._/@:+-]*$/.test(value)) throw new Error(`--${name} contains unsupported characters.`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function findMessageByName(bus, role, name) {
  for (const stage of ['new', 'processing', 'processed']) {
    const candidate = join(bus, 'inbox', role, stage, name);
    if (existsSync(candidate)) return candidate;
  }
  const quarantined = join(bus, 'quarantine', role, name);
  return existsSync(quarantined) ? quarantined : null;
}

function findMessageBySuffix(bus, role, suffix) {
  for (const stage of ['new', 'processing', 'processed']) {
    const directory = join(bus, 'inbox', role, stage);
    const name = readdirSync(directory).find(candidate => candidate.endsWith(suffix));
    if (name) return join(directory, name);
  }
  const quarantineDirectory = join(bus, 'quarantine', role);
  const name = readdirSync(quarantineDirectory).find(candidate => candidate.endsWith(suffix));
  return name ? join(quarantineDirectory, name) : null;
}

function send(options, bus) {
  const from = requireValue(options, 'from');
  const to = requireValue(options, 'to');
  if (!roles.has(from) || !roles.has(to)) throw new Error('--from and --to must be codex or antigravity.');
  const type = requireValue(options, 'type').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const subject = safeSubject(requireValue(options, 'subject'));
  const body = (options.bodyFile ? readFileSync(resolve(options.bodyFile), 'utf8') : requireValue(options, 'body')).replace(/^\uFEFF/, '');
  const dedupeKey = safeHeaderValue(options.dedupeKey || '', 'dedupe-key');
  const relatedCommit = safeHeaderValue(options.relatedCommit || '', 'related-commit');
  const dedupeHash = dedupeKey ? sha256(`${from}\0${to}\0${dedupeKey}`) : '';
  const lockName = dedupeKey ? `dedupe-${dedupeHash}` : null;
  const release = lockName ? acquireLock(bus, lockName) : () => {};
  try {
    if (dedupeKey) {
      const recordPath = join(bus, 'dedupe', `${dedupeHash}.json`);
      if (existsSync(recordPath)) {
        const prior = JSON.parse(readInternalFile(bus, recordPath));
        const existing = findMessageByName(bus, to, prior.message_name);
        if (existing) {
          console.log(resolve(existing));
          return;
        }
      }
      // If a writer stopped after publishing the message but before recording
      // deduplication metadata, recover it by the deterministic hash suffix.
      const orphan = findMessageBySuffix(bus, to, `-${dedupeHash.slice(0, 12)}.md`);
      if (orphan) {
        const record = { message_id: dedupeHash, message_name: basename(orphan), created_at: new Date().toISOString() };
        if (!existsSync(recordPath)) atomicWrite(recordPath, `${JSON.stringify(record, null, 2)}\n`, join(bus, 'tmp'));
        console.log(resolve(orphan));
        return;
      }
    }

    const now = new Date();
    const id = dedupeHash || randomUUID().replaceAll('-', '');
    const compactTimestamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
    const name = `${compactTimestamp}-${type}-${id.slice(0, 12)}.md`;
    const destination = join(bus, 'inbox', to, 'new', name);
    const header = [
      '---', `id: ${id}`, `from: ${from}`, `to: ${to}`, `type: ${type}`,
      `created_at: ${now.toISOString()}`, `related_commit: ${relatedCommit}`,
      `dedupe_key: ${dedupeKey}`, `subject: "${subject}"`, '---', '',
    ].join('\n');
    atomicWrite(destination, `${header}${body}\n`, join(bus, 'tmp'));
    if (dedupeKey) {
      const recordPath = join(bus, 'dedupe', `${dedupeHash}.json`);
      atomicWrite(recordPath, `${JSON.stringify({ message_id: id, message_name: name, created_at: now.toISOString() }, null, 2)}\n`, join(bus, 'tmp'));
    }
    console.log(resolve(destination));
  } finally {
    release();
  }
}

function parseMessage(path, expectedRole, bus) {
  const content = readInternalFile(bus, path);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('missing YAML front matter');
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^"|"$/g, '');
  }
  for (const field of messageFields) if (!fields[field]) throw new Error(`missing ${field}`);
  if (!roles.has(fields.from) || !roles.has(fields.to) || fields.to !== expectedRole) throw new Error('invalid message role');
  if (Number.isNaN(Date.parse(fields.created_at))) throw new Error('invalid created_at');
  return fields;
}

function quarantine(path, role, bus, reason) {
  const destination = join(bus, 'quarantine', role, basename(path));
  renameSync(path, destination);
  atomicWrite(`${destination}.error.json`, `${JSON.stringify({ reason, quarantined_at: new Date().toISOString() }, null, 2)}\n`, join(bus, 'tmp'));
}

function recoverStale(bus, rolesToRecover, staleAfterSeconds, includeLocks = true) {
  const recovered = [];
  for (const role of rolesToRecover) {
    const release = acquireLock(bus, `queue-${role}`);
    try {
      const processing = join(bus, 'inbox', role, 'processing');
      for (const name of readdirSync(processing).filter(item => item.endsWith('.md')).sort()) {
        const message = join(processing, name);
        const lease = `${message}.lease.json`;
        // A missing lease means a claimant was interrupted between rename and
        // lease publication. Give that gap its own grace period; otherwise use
        // the recorded lease expiry, with the CLI threshold as a conservative
        // fallback for old-format leases.
        let expired = Date.now() - safeInternalStat(bus, message).ctimeMs >= staleAfterSeconds * 1000;
        if (existsSync(lease)) {
          try {
            const record = JSON.parse(readInternalFile(bus, lease));
            expired = Number.isNaN(Date.parse(record.expires_at))
              ? Date.now() - safeInternalStat(bus, lease).mtimeMs >= staleAfterSeconds * 1000
              : Date.now() >= Date.parse(record.expires_at);
          } catch { expired = Date.now() - safeInternalStat(bus, lease).mtimeMs >= staleAfterSeconds * 1000; }
        }
        if (!expired) continue;
        try {
          // Change the path on every recovery. An interrupted claimant holding
          // the old path can no longer complete a later claimant's lease.
          const recoveredName = `${name.slice(0, -3)}-r${randomUUID().slice(0, 8)}.md`;
          renameSync(message, join(bus, 'inbox', role, 'new', recoveredName));
          rmSync(lease, { force: true });
          recovered.push({ kind: 'message', role, name: recoveredName, prior_name: name });
        } catch (error) {
          if (!['ENOENT', 'EEXIST', 'EPERM'].includes(error.code)) throw error;
        }
      }
    } finally {
      release();
    }
  }
  if (includeLocks) {
    for (const name of readdirSync(join(bus, 'locks'))) {
      const lock = join(bus, 'locks', name);
      if (Date.now() - statSync(lock).mtimeMs < staleAfterSeconds * 1000 || localLockOwnerIsAlive(bus, lock)) continue;
      rmSync(lock, { recursive: true, force: true });
      recovered.push({ kind: 'lock', name });
    }
  }
  return recovered;
}

function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function wait(options, bus) {
  const role = requireValue(options, 'role');
  if (!roles.has(role)) throw new Error('--role must be codex or antigravity.');
  const timeoutMinutes = positiveNumber(options.timeoutMinutes, 'timeout-minutes', 120);
  const pollSeconds = positiveNumber(options.pollSeconds, 'poll-seconds', 5);
  const leaseSeconds = positiveNumber(options.leaseSeconds, 'lease-seconds', 14_400);
  const newDirectory = join(bus, 'inbox', role, 'new');
  const processingDirectory = join(bus, 'inbox', role, 'processing');
  const deadline = Date.now() + timeoutMinutes * 60_000;
  while (Date.now() < deadline) {
    const release = acquireLock(bus, `queue-${role}`);
    try {
      const candidate = readdirSync(newDirectory).filter(name => name.endsWith('.md')).sort()[0];
      if (candidate) {
        const source = join(newDirectory, candidate);
        const claimed = join(processingDirectory, candidate);
        try {
          renameSync(source, claimed);
          writeLease(claimed, bus, leaseSeconds);
          try {
            parseMessage(claimed, role, bus);
          } catch (error) {
            rmSync(`${claimed}.lease.json`, { force: true });
            quarantine(claimed, role, bus, error.message);
            continue;
          }
          console.log(resolve(claimed));
          return;
        } catch (error) {
          if (!['ENOENT', 'EEXIST', 'EPERM'].includes(error.code)) throw error;
        }
      }
    } finally {
      release();
    }
    await sleep(pollSeconds * 1000);
  }
  console.log('TIMEOUT');
  process.exitCode = 2;
}

function complete(options, bus) {
  const messagePath = resolve(requireValue(options, 'messagePath'));
  const inboxRoot = resolve(bus, 'inbox');
  const normalizedRelative = relative(inboxRoot, messagePath);
  const parts = normalizedRelative.split(sep);
  if (normalizedRelative.startsWith('..') || isAbsolute(normalizedRelative) || parts.length !== 3 || !roles.has(parts[0]) || parts[1] !== 'processing' || !parts[2]?.endsWith('.md')) {
    throw new Error('Message path must be a file in this bus processing directory.');
  }
  const roleDirectory = dirname(dirname(messagePath));
  const destination = join(roleDirectory, 'processed', basename(messagePath));
  if (!existsSync(messagePath) && existsSync(destination)) {
    console.log(resolve(destination));
    return;
  }
  safeInternalStat(bus, messagePath);
  renameSync(messagePath, destination);
  rmSync(`${messagePath}.lease.json`, { force: true });
  console.log(resolve(destination));
}

function recover(options, bus) {
  const selectedRoles = options.role ? [options.role] : [...roles];
  if (selectedRoles.some(role => !roles.has(role))) throw new Error('--role must be codex or antigravity.');
  const staleAfterSeconds = positiveNumber(options.staleAfterSeconds, 'stale-after-seconds', 14_400);
  console.log(JSON.stringify({ recovered: recoverStale(bus, selectedRoles, staleAfterSeconds) }, null, 2));
}

function setState(options, bus) {
  const role = requireValue(options, 'role');
  const state = requireValue(options, 'state');
  if (!roles.has(role)) throw new Error('--role must be codex or antigravity.');
  if (!states.has(state)) throw new Error(`Unsupported state: ${state}`);
  const record = {
    agent: role, state, details: options.details || '', related_commit: options.relatedCommit || '',
    updated_at: new Date().toISOString(), process_id: process.pid, machine_name: hostname(),
  };
  const name = `${record.updated_at.replace(/[-:TZ.]/g, '')}-${randomUUID().slice(0, 8)}.json`;
  const destination = join(bus, 'state', role, name);
  atomicWrite(destination, `${JSON.stringify(record, null, 2)}\n`, join(bus, 'tmp'));
  console.log(resolve(destination));
}

function latestState(bus, role) {
  const directory = join(bus, 'state', role);
  const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse();
  let invalid = 0;
  for (const name of files) {
    try {
      const record = JSON.parse(readInternalFile(bus, join(directory, name)));
      if (record.agent !== role || !states.has(record.state) || Number.isNaN(Date.parse(record.updated_at))) throw new Error('invalid state record');
      return { record, invalid };
    } catch { invalid += 1; }
  }
  return { record: null, invalid };
}

function status(root, bus) {
  const roleStates = {};
  const queues = {};
  const diagnostics = { invalid_state_records: {}, quarantined_messages: {} };
  for (const role of roles) {
    const latest = latestState(bus, role);
    roleStates[role] = latest.record;
    diagnostics.invalid_state_records[role] = latest.invalid;
    diagnostics.quarantined_messages[role] = readdirSync(join(bus, 'quarantine', role)).filter(name => name.endsWith('.md')).length;
    queues[role] = {};
    for (const stage of ['new', 'processing', 'processed']) {
      queues[role][stage] = readdirSync(join(bus, 'inbox', role, stage)).filter(name => name.endsWith('.md')).length;
    }
  }
  console.log(JSON.stringify({ root, bus, states: roleStates, queues, diagnostics }, null, 2));
}

function clean(options, bus) {
  const confirm = requireValue(options, 'confirm');
  if (confirm !== 'DELETE_AGENT_BUS') throw new Error('--confirm must be DELETE_AGENT_BUS.');
  rmSync(bus, { recursive: true, force: true });
  console.log(JSON.stringify({ removed: resolve(bus) }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const validCommands = new Set(['help', 'init', 'send', 'wait', 'complete', 'recover', 'state', 'status', 'clean']);
  if (!validCommands.has(options.command)) throw new Error(`Unknown command: ${options.command}`);
  if (options.command === 'help') {
    console.log(`agent-bus <command> [options]\n\nCommands: init, send, wait, complete, recover, state, status, clean\nStates: ${[...states].join(', ')}\nUse --root <repository> on any command.`);
    return;
  }
  const root = repoRoot(options.root);
  const bus = initialize(root);
  if (options.command === 'init') console.log(JSON.stringify({ success: true, root, bus }));
  else if (options.command === 'send') send(options, bus);
  else if (options.command === 'wait') await wait(options, bus);
  else if (options.command === 'complete') complete(options, bus);
  else if (options.command === 'recover') recover(options, bus);
  else if (options.command === 'state') setState(options, bus);
  else if (options.command === 'status') status(root, bus);
  else clean(options, bus);
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
