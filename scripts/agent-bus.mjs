#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const roles = new Set(['codex', 'antigravity']);
const states = new Set(['IDLE', 'CLARIFYING', 'SPEC_READY', 'IMPLEMENTING', 'WAITING', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED', 'RELEASING', 'STOPPED', 'ERROR']);

function parseArgs(argv) {
  if (!argv.length) throw new Error('Command is required: init, send, wait, complete, state, or status.');
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

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Git command failed.').trim());
  return result.stdout.trim();
}

function repoRoot(candidate) {
  if (candidate) {
    const root = resolve(candidate);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Repository root does not exist: ${root}`);
    return resolve(git(['rev-parse', '--show-toplevel'], root));
  }
  return resolve(git(['rev-parse', '--show-toplevel'], process.cwd()));
}

function atomicWrite(destination, content, tempDirectory) {
  mkdirSync(tempDirectory, { recursive: true });
  const temp = join(tempDirectory, `.tmp-${randomUUID().replaceAll('-', '')}`);
  writeFileSync(temp, content, 'utf8');
  try {
    renameSync(temp, destination);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code) || !existsSync(destination)) throw error;
    rmSync(destination, { force: true });
    renameSync(temp, destination);
  }
}

function initialize(root) {
  const bus = join(root, '.agent-bus');
  const directories = [
    'inbox/codex/new', 'inbox/codex/processing', 'inbox/codex/processed',
    'inbox/antigravity/new', 'inbox/antigravity/processing', 'inbox/antigravity/processed',
    'specs', 'reviews', 'evidence', 'releases', 'state', 'logs', 'tmp',
  ];
  for (const directory of directories) mkdirSync(join(bus, directory), { recursive: true });

  let exclude = git(['rev-parse', '--git-path', 'info/exclude'], root);
  if (!isAbsolute(exclude)) exclude = resolve(root, exclude);
  mkdirSync(dirname(exclude), { recursive: true });
  const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes('.agent-bus/')) {
    appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}.agent-bus/\n`, 'utf8');
  }
  return bus;
}

function safeSubject(subject) {
  return subject.replaceAll('"', '\\"').replace(/[\r\n]/g, ' ');
}

function send(options, bus) {
  const from = requireValue(options, 'from');
  const to = requireValue(options, 'to');
  if (!roles.has(from) || !roles.has(to)) throw new Error('--from and --to must be codex or antigravity.');
  const type = requireValue(options, 'type').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const subject = safeSubject(requireValue(options, 'subject'));
  let body;
  if (options.bodyFile) body = readFileSync(resolve(options.bodyFile), 'utf8');
  else body = requireValue(options, 'body');

  const now = new Date();
  const id = randomUUID().replaceAll('-', '');
  const compactTimestamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const name = `${compactTimestamp}-${type}-${id.slice(0, 12)}.md`;
  const destination = join(bus, 'inbox', to, 'new', name);
  const header = [
    '---',
    `id: ${id}`,
    `from: ${from}`,
    `to: ${to}`,
    `type: ${type}`,
    `created_at: ${now.toISOString()}`,
    `related_commit: ${options.relatedCommit || ''}`,
    `subject: "${subject}"`,
    '---',
    '',
  ].join('\n');
  atomicWrite(destination, `${header}${body}\n`, join(bus, 'tmp'));
  console.log(resolve(destination));
}

function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function wait(options, bus) {
  const role = requireValue(options, 'role');
  if (!roles.has(role)) throw new Error('--role must be codex or antigravity.');
  const timeoutMinutes = Number(options.timeoutMinutes ?? 120);
  const pollSeconds = Number(options.pollSeconds ?? 5);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new Error('--timeout-minutes must be greater than zero.');
  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) throw new Error('--poll-seconds must be greater than zero.');
  const newDirectory = join(bus, 'inbox', role, 'new');
  const processingDirectory = join(bus, 'inbox', role, 'processing');
  const deadline = Date.now() + timeoutMinutes * 60_000;
  while (Date.now() < deadline) {
    const candidate = readdirSync(newDirectory).filter(name => name.endsWith('.md')).sort()[0];
    if (candidate) {
      const source = join(newDirectory, candidate);
      const claimed = join(processingDirectory, candidate);
      try {
        renameSync(source, claimed);
        console.log(resolve(claimed));
        return;
      } catch (error) {
        if (!['ENOENT', 'EEXIST', 'EPERM'].includes(error.code)) throw error;
      }
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
  if (normalizedRelative.startsWith('..') || isAbsolute(normalizedRelative) || !normalizedRelative.split(sep).includes('processing')) {
    throw new Error('Message path must be a file in this bus processing directory.');
  }
  const processingDirectory = dirname(messagePath);
  const roleDirectory = dirname(processingDirectory);
  const destination = join(roleDirectory, 'processed', messagePath.split(sep).at(-1));
  if (existsSync(destination)) throw new Error(`Processed message already exists: ${destination}`);
  renameSync(messagePath, destination);
  console.log(resolve(destination));
}

function setState(options, bus) {
  const role = requireValue(options, 'role');
  const state = requireValue(options, 'state');
  if (!roles.has(role)) throw new Error('--role must be codex or antigravity.');
  if (!states.has(state)) throw new Error(`Unsupported state: ${state}`);
  const record = {
    agent: role,
    state,
    details: options.details || '',
    related_commit: options.relatedCommit || '',
    updated_at: new Date().toISOString(),
    process_id: process.pid,
    machine_name: process.env.COMPUTERNAME || process.env.HOSTNAME || '',
  };
  const destination = join(bus, 'state', `${role}.json`);
  atomicWrite(destination, `${JSON.stringify(record, null, 2)}\n`, join(bus, 'tmp'));
  console.log(resolve(destination));
}

function status(root, bus) {
  const roleStates = {};
  const queues = {};
  for (const role of roles) {
    const statePath = join(bus, 'state', `${role}.json`);
    roleStates[role] = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
    queues[role] = {};
    for (const stage of ['new', 'processing', 'processed']) {
      queues[role][stage] = readdirSync(join(bus, 'inbox', role, stage)).filter(name => name.endsWith('.md')).length;
    }
  }
  console.log(JSON.stringify({ root, bus, states: roleStates, queues }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const validCommands = new Set(['init', 'send', 'wait', 'complete', 'state', 'status']);
  if (!validCommands.has(options.command)) throw new Error(`Unknown command: ${options.command}`);
  const root = repoRoot(options.root);
  const bus = initialize(root);
  if (options.command === 'init') console.log(JSON.stringify({ success: true, root, bus }));
  else if (options.command === 'send') send(options, bus);
  else if (options.command === 'wait') await wait(options, bus);
  else if (options.command === 'complete') complete(options, bus);
  else if (options.command === 'state') setState(options, bus);
  else status(root, bus);
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
