#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const states = new Set(['IDLE', 'CLARIFYING', 'SPEC_READY', 'IMPLEMENTING', 'WAITING', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED', 'RELEASING', 'STOPPED', 'ERROR']);
const messageFields = ['id', 'from', 'to', 'type', 'created_at', 'subject'];

const DEFAULT_CONFIG = {
  version: 1,
  agents: [
    { id: 'codex', adapter: 'codex-cli', command: 'codex' },
    { id: 'antigravity', adapter: 'antigravity-cli', command: 'agy' },
  ],
  workflow: {
    planner: 'codex',
    implementer: 'antigravity',
    reviewer: 'codex',
  },
};

const RESERVED_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function validateAgentId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Agent ID must be a non-empty string.');
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`Invalid agent ID "${id}". Agent ID must be 1-64 lowercase alphanumeric characters, underscores, or hyphens, starting with a lowercase letter.`);
  }
  const base = id.toLowerCase().split('.')[0];
  if (RESERVED_DEVICE_NAMES.has(base) || RESERVED_DEVICE_NAMES.has(id.toLowerCase())) {
    throw new Error(`Invalid agent ID "${id}". Cannot use reserved device name.`);
  }
  return id;
}

function parseArgs(argv) {
  if (!argv.length || ['--help', '-h', 'help'].includes(argv[0])) return { command: 'help' };
  const result = { command: argv[0] };
  const args = argv.slice(1);
  while (args.length) {
    const option = args.shift();
    if (!option.startsWith('--')) throw new Error(`Unknown argument: ${option}`);
    let key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === 'command') key = 'agentCommand';
    if (!args.length || args[0].startsWith('--')) throw new Error(`Missing value for ${option}`);
    result[key] = args.shift();
  }
  return result;
}

function requireValue(options, name) {
  if (options[name] === undefined || options[name] === '') throw new Error(`--${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required for ${options.command}.`);
  return options[name];
}

function resolveAgentOption(options, required = false) {
  const agent = options.agent;
  const role = options.role;
  if (agent && role && agent !== role) {
    throw new Error(`Conflicting options: --agent "${agent}" and --role "${role}" must match.`);
  }
  const selected = agent || role;
  if (required && !selected) {
    throw new Error(`--agent (or --role) is required for ${options.command}.`);
  }
  return selected;
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

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must be a JSON object.');
  }
  if (config.version !== 1) {
    throw new Error(`Unsupported config version: ${config.version}. Expected 1.`);
  }
  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error('Config must define a non-empty "agents" array.');
  }
  const ids = new Set();
  for (const agent of config.agents) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error('Invalid agent record in config.');
    validateAgentId(agent.id);
    if (ids.has(agent.id)) throw new Error(`Duplicate agent ID in config: ${agent.id}`);
    ids.add(agent.id);
    if (!agent.adapter || typeof agent.adapter !== 'string') {
      throw new Error(`Agent "${agent.id}" is missing required "adapter" string.`);
    }
  }
  if (config.workflow) {
    if (typeof config.workflow !== 'object' || Array.isArray(config.workflow)) {
      throw new Error('Config workflow must be an object.');
    }
    for (const [role, agentId] of Object.entries(config.workflow)) {
      if (!ids.has(agentId)) {
        throw new Error(`Workflow role "${role}" references unregistered agent "${agentId}".`);
      }
    }
  }
  return config;
}

function configPath(bus) {
  return join(bus, 'config.json');
}

function readConfig(bus) {
  const cfgFile = configPath(bus);
  if (!existsSync(cfgFile)) {
    return DEFAULT_CONFIG;
  }
  try {
    const content = readInternalFile(bus, cfgFile);
    const parsed = JSON.parse(content);
    return validateConfig(parsed);
  } catch (err) {
    throw new Error(`Failed to load valid .agent-bus/config.json: ${err.message}`);
  }
}

function writeConfig(bus, config) {
  validateConfig(config);
  const destination = configPath(bus);
  atomicWrite(destination, `${JSON.stringify(config, null, 2)}\n`, join(bus, 'tmp'));
}

function getRegisteredAgentMap(bus) {
  const cfg = readConfig(bus);
  const map = new Map();
  for (const agent of cfg.agents) {
    map.set(agent.id, agent);
  }
  return map;
}

function getRegisteredAgentIds(bus) {
  return new Set(getRegisteredAgentMap(bus).keys());
}

function ensureAgentDirectories(bus, agentId, root) {
  validateAgentId(agentId);
  const agentDirs = [
    `inbox/${agentId}/new`,
    `inbox/${agentId}/processing`,
    `inbox/${agentId}/processed`,
    `quarantine/${agentId}`,
    `state/${agentId}`,
  ];
  for (const directory of agentDirs) {
    const fullPath = assertSafePath(root, join(bus, directory));
    mkdirSync(fullPath, { recursive: true });
    assertSafePath(root, fullPath);
  }
}

function initialize(root) {
  const bus = assertSafePath(root, join(root, '.agent-bus'));
  const sharedDirectories = [
    'specs', 'reviews', 'evidence', 'releases', 'dedupe', 'locks', 'logs', 'tmp', 'launch',
  ];
  for (const directory of sharedDirectories) {
    const path = assertSafePath(root, join(bus, directory));
    mkdirSync(path, { recursive: true });
    assertSafePath(root, path);
  }

  const cfgFile = configPath(bus);
  if (!existsSync(cfgFile)) {
    writeConfig(bus, DEFAULT_CONFIG);
  }

  const config = readConfig(bus);
  for (const agent of config.agents) {
    ensureAgentDirectories(bus, agent.id, root);
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

function findMessageByName(bus, agent, name) {
  for (const stage of ['new', 'processing', 'processed']) {
    const candidate = join(bus, 'inbox', agent, stage, name);
    if (existsSync(candidate)) return candidate;
  }
  const quarantined = join(bus, 'quarantine', agent, name);
  return existsSync(quarantined) ? quarantined : null;
}

function findMessageBySuffix(bus, agent, suffix) {
  for (const stage of ['new', 'processing', 'processed']) {
    const directory = join(bus, 'inbox', agent, stage);
    if (!existsSync(directory)) continue;
    const name = readdirSync(directory).find(candidate => candidate.endsWith(suffix));
    if (name) return join(directory, name);
  }
  const quarantineDirectory = join(bus, 'quarantine', agent);
  if (!existsSync(quarantineDirectory)) return null;
  const name = readdirSync(quarantineDirectory).find(candidate => candidate.endsWith(suffix));
  return name ? join(quarantineDirectory, name) : null;
}

function send(options, bus) {
  const from = requireValue(options, 'from');
  const to = requireValue(options, 'to');
  const registered = getRegisteredAgentIds(bus);
  if (!registered.has(from) || !registered.has(to)) {
    throw new Error(`--from and --to must be registered agents. Unknown: ${[!registered.has(from) ? from : null, !registered.has(to) ? to : null].filter(Boolean).join(', ')}. Registered: ${[...registered].join(', ')}.`);
  }
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

function parseMessage(path, expectedAgent, bus) {
  const content = readInternalFile(bus, path);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('missing YAML front matter');
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^"|"$/g, '');
  }
  for (const field of messageFields) if (!fields[field]) throw new Error(`missing ${field}`);
  const registered = getRegisteredAgentIds(bus);
  if (!registered.has(fields.from) || !registered.has(fields.to) || fields.to !== expectedAgent) throw new Error('invalid message agent');
  if (Number.isNaN(Date.parse(fields.created_at))) throw new Error('invalid created_at');
  return fields;
}

function quarantine(path, agent, bus, reason) {
  const destination = join(bus, 'quarantine', agent, basename(path));
  renameSync(path, destination);
  atomicWrite(`${destination}.error.json`, `${JSON.stringify({ reason, quarantined_at: new Date().toISOString() }, null, 2)}\n`, join(bus, 'tmp'));
}

function recoverStale(bus, agentsToRecover, staleAfterSeconds, includeLocks = true) {
  const recovered = [];
  for (const agent of agentsToRecover) {
    const release = acquireLock(bus, `queue-${agent}`);
    try {
      const processing = join(bus, 'inbox', agent, 'processing');
      if (!existsSync(processing)) continue;
      for (const name of readdirSync(processing).filter(item => item.endsWith('.md')).sort()) {
        const message = join(processing, name);
        const lease = `${message}.lease.json`;
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
          const recoveredName = `${name.slice(0, -3)}-r${randomUUID().slice(0, 8)}.md`;
          renameSync(message, join(bus, 'inbox', agent, 'new', recoveredName));
          rmSync(lease, { force: true });
          recovered.push({ kind: 'message', role: agent, agent, name: recoveredName, prior_name: name });
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
  const agent = resolveAgentOption(options, true);
  const registered = getRegisteredAgentIds(bus);
  if (!registered.has(agent)) {
    throw new Error(`--agent (or --role) must be a registered agent. Given: "${agent}". Registered agents: ${[...registered].join(', ')}.`);
  }
  const timeoutMinutes = positiveNumber(options.timeoutMinutes, 'timeout-minutes', 120);
  const pollSeconds = positiveNumber(options.pollSeconds, 'poll-seconds', 5);
  const leaseSeconds = positiveNumber(options.leaseSeconds, 'lease-seconds', 14_400);
  const newDirectory = join(bus, 'inbox', agent, 'new');
  const processingDirectory = join(bus, 'inbox', agent, 'processing');
  const deadline = Date.now() + timeoutMinutes * 60_000;
  while (Date.now() < deadline) {
    const release = acquireLock(bus, `queue-${agent}`);
    try {
      const candidate = readdirSync(newDirectory).filter(name => name.endsWith('.md')).sort()[0];
      if (candidate) {
        const source = join(newDirectory, candidate);
        const claimed = join(processingDirectory, candidate);
        try {
          renameSync(source, claimed);
          writeLease(claimed, bus, leaseSeconds);
          try {
            parseMessage(claimed, agent, bus);
          } catch (error) {
            rmSync(`${claimed}.lease.json`, { force: true });
            quarantine(claimed, agent, bus, error.message);
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
  const registered = getRegisteredAgentIds(bus);
  if (normalizedRelative.startsWith('..') || isAbsolute(normalizedRelative) || parts.length !== 3 || !registered.has(parts[0]) || parts[1] !== 'processing' || !parts[2]?.endsWith('.md')) {
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
  const agent = resolveAgentOption(options, false);
  const registered = getRegisteredAgentIds(bus);
  if (agent && !registered.has(agent)) {
    throw new Error(`Unknown agent: ${agent}. Registered agents: ${[...registered].join(', ')}.`);
  }
  const selectedAgents = agent ? [agent] : [...registered];
  const staleAfterSeconds = positiveNumber(options.staleAfterSeconds, 'stale-after-seconds', 14_400);
  console.log(JSON.stringify({ recovered: recoverStale(bus, selectedAgents, staleAfterSeconds) }, null, 2));
}

function setState(options, bus) {
  const agent = resolveAgentOption(options, true);
  const registered = getRegisteredAgentIds(bus);
  if (!registered.has(agent)) {
    throw new Error(`Unknown agent: ${agent}. Registered agents: ${[...registered].join(', ')}.`);
  }
  const state = requireValue(options, 'state');
  if (!states.has(state)) throw new Error(`Unsupported state: ${state}`);
  const record = {
    agent, state, details: options.details || '', related_commit: options.relatedCommit || '',
    updated_at: new Date().toISOString(), process_id: process.pid, machine_name: hostname(),
  };
  const name = `${record.updated_at.replace(/[-:TZ.]/g, '')}-${randomUUID().slice(0, 8)}.json`;
  const destination = join(bus, 'state', agent, name);
  atomicWrite(destination, `${JSON.stringify(record, null, 2)}\n`, join(bus, 'tmp'));
  console.log(resolve(destination));
}

function latestState(bus, agent) {
  const directory = join(bus, 'state', agent);
  if (!existsSync(directory)) return { record: null, invalid: 0 };
  const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse();
  let invalid = 0;
  for (const name of files) {
    try {
      const record = JSON.parse(readInternalFile(bus, join(directory, name)));
      if (record.agent !== agent || !states.has(record.state) || Number.isNaN(Date.parse(record.updated_at))) throw new Error('invalid state record');
      return { record, invalid };
    } catch { invalid += 1; }
  }
  return { record: null, invalid };
}

function status(root, bus) {
  const config = readConfig(bus);
  const agentStates = {};
  const queues = {};
  const diagnostics = { invalid_state_records: {}, quarantined_messages: {} };
  for (const agent of config.agents) {
    const id = agent.id;
    const latest = latestState(bus, id);
    agentStates[id] = latest.record;
    diagnostics.invalid_state_records[id] = latest.invalid;
    const quarantineDir = join(bus, 'quarantine', id);
    diagnostics.quarantined_messages[id] = existsSync(quarantineDir) ? readdirSync(quarantineDir).filter(name => name.endsWith('.md')).length : 0;
    queues[id] = {};
    for (const stage of ['new', 'processing', 'processed']) {
      const stageDir = join(bus, 'inbox', id, stage);
      queues[id][stage] = existsSync(stageDir) ? readdirSync(stageDir).filter(name => name.endsWith('.md')).length : 0;
    }
  }
  console.log(JSON.stringify({ root, bus, config, states: agentStates, queues, diagnostics }, null, 2));
}

function agentAdd(options, bus, root) {
  const id = validateAgentId(requireValue(options, 'agent'));
  const adapter = requireValue(options, 'adapter');
  const command = options.agentCommand || options.command || id;
  let args = undefined;
  if (options.args) {
    try {
      args = JSON.parse(options.args);
    } catch {
      args = options.args.split(',').map(s => s.trim());
    }
  }

  const release = acquireLock(bus, 'config');
  try {
    const config = readConfig(bus);
    if (config.agents.some(a => a.id === id)) {
      throw new Error(`Agent already registered: ${id}`);
    }
    const newAgent = { id, adapter, command };
    if (args) newAgent.args = args;
    config.agents.push(newAgent);
    writeConfig(bus, config);
    ensureAgentDirectories(bus, id, root);
    console.log(JSON.stringify({ added: id, agent: newAgent, config }, null, 2));
  } finally {
    release();
  }
}

function agentList(options, bus) {
  const config = readConfig(bus);
  console.log(JSON.stringify({ agents: config.agents, workflow: config.workflow || {} }, null, 2));
}

function clean(options, bus) {
  const confirm = requireValue(options, 'confirm');
  if (confirm !== 'DELETE_AGENT_BUS') throw new Error('--confirm must be DELETE_AGENT_BUS.');
  rmSync(bus, { recursive: true, force: true });
  console.log(JSON.stringify({ removed: resolve(bus) }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const validCommands = new Set([
    'help', 'init', 'send', 'wait', 'complete', 'recover',
    'state', 'status', 'clean', 'agent-add', 'agent-list',
  ]);
  if (!validCommands.has(options.command)) throw new Error(`Unknown command: ${options.command}`);
  if (options.command === 'help') {
    console.log(`agent-bus <command> [options]\n\nCommands: init, send, wait, complete, recover, state, status, agent-add, agent-list, clean\nStates: ${[...states].join(', ')}\nUse --root <repository> on any command.`);
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
  else if (options.command === 'agent-add') agentAdd(options, bus, root);
  else if (options.command === 'agent-list') agentList(options, bus);
  else clean(options, bus);
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
