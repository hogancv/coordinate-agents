import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, rmdirSync, unlinkSync, opendirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userConfigPath } from '../../skills/coordinate-agents/scripts/user-config.mjs';

const busTool = fileURLToPath(new URL('../../skills/coordinate-agents/scripts/agent-bus.mjs', import.meta.url));
function directory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || /[\x00-\x1f]/.test(path)) throw new Error('An absolute directory path is required.');
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Select a regular directory.');
  return realpathSync(path);
}
function gitRoot(path) {
  const result = spawnSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024 });
  return result.status === 0 ? directory(result.stdout.trim()) : null;
}
function run(command, args, cwd, stage) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${stage}: ${(result.error?.message || result.stderr || result.stdout).slice(0, 1024)}`);
}

export function createProjectStore({ home } = {}) {
  const file = join(dirname(userConfigPath({ home })), 'workspace-projects.json');
  function read() {
    if (!existsSync(file)) return [];
    if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 1024 * 1024) throw new Error('Invalid project registry.');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed.version !== 1 || !Array.isArray(parsed.projects) || parsed.projects.length > 1000 || parsed.projects.some(project =>
      !project || !/^project-[a-f0-9]{24}$/.test(project.id) || typeof project.root !== 'string' || !isAbsolute(project.root) ||
      typeof project.name !== 'string' || typeof project.createdAt !== 'string') ||
      new Set(parsed.projects.map(project => project.id)).size !== parsed.projects.length ||
      new Set(parsed.projects.map(project => project.root)).size !== parsed.projects.length) throw new Error('Invalid project registry.');
    return parsed.projects;
  }
  function register(path, initialize = false) {
    let root = directory(path);
    const existingRoot = gitRoot(root);
    if (!existingRoot && !initialize) throw new Error('This folder needs Git and Agent Bus initialization.');
    if (!existingRoot) run('git', ['init', '--initial-branch=main'], root, 'Git initialization failed');
    root = existingRoot || root;
    run(process.execPath, [busTool, 'init', '--root', root], root, 'Agent Bus initialization failed');
    const parent = dirname(file);
    mkdirSync(parent, { recursive: true });
    directory(parent);
    const lock = `${file}.lock`;
    const deadline = Date.now() + 2000;
    for (;;) {
      try { mkdirSync(lock); break; } catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= deadline) throw new Error('Project registry is busy; retry adding the project.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    let temporary;
    try {
      const projects = read();
      const existing = projects.find(project => project.root === root);
      if (existing) return existing;
      if (projects.length >= 1000) throw new Error('Project limit reached.');
      const project = { id: `project-${createHash('sha256').update(root).digest('hex').slice(0, 24)}`, name: basename(root), root, createdAt: new Date().toISOString() };
      projects.push(project);
      temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, projects }, null, 2), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
      return project;
    } finally {
      if (temporary && existsSync(temporary)) unlinkSync(temporary);
      rmdirSync(lock);
    }
  }
  function get(id) {
    if (!/^project-[a-f0-9]{24}$/.test(id)) throw new Error('Invalid project ID.');
    const project = read().find(project => project.id === id);
    if (!project) throw new Error('Project not found.');
    if (directory(project.root) !== project.root || gitRoot(project.root) !== project.root) throw new Error('Project directory is unavailable or its repository root changed.');
    return project;
  }
  function list() {
    return read().map(project => {
      try {
        if (directory(project.root) !== project.root || gitRoot(project.root) !== project.root) throw new Error('Unavailable');
        return { ...project, available: true };
      }
      catch { return { ...project, available: false }; }
    });
  }
  function browse({ path = home || homedir(), offset = 0, hidden = false } = {}) {
    const root = directory(path);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || typeof hidden !== 'boolean') throw new Error('Invalid directory page.');
    const handle = opendirSync(root);
    const entries = [];
    let seen = 0;
    let nextOffset = null;
    try {
      for (let entry; (entry = handle.readSync());) {
        if (!entry.isDirectory() || (!hidden && entry.name.startsWith('.'))) continue;
        if (seen++ < offset) continue;
        if (entries.length === 100) { nextOffset = offset + 100; break; }
        entries.push({ name: entry.name, path: join(root, entry.name) });
      }
    } finally { handle.closeSync(); }
    return { path: root, parent: dirname(root), entries, nextOffset, needsInitialization: !gitRoot(root) };
  }
  return { register, get, list, browse };
}
