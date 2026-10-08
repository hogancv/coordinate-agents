import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, rmdirSync, unlinkSync, opendirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { initializeWorkspace } from '../../skills/coordinate-agents/scripts/workspace-init.mjs';
import { userConfigPath } from '../../skills/coordinate-agents/scripts/user-config.mjs';
import { pickNativeFolder } from './native-folder-picker.mjs';
import { listWorkspaceTaskRecords, runtimeWorkspaceTaskArchive, runtimeWorkspaceArchivesClear } from '../../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { withWorkspaceProjectOperation } from '../../skills/coordinate-agents/scripts/workspace-services.mjs';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

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
      typeof project.name !== 'string' || typeof project.createdAt !== 'string' ||
      (project.archivedAt !== undefined && (typeof project.archivedAt !== 'string' || Number.isNaN(Date.parse(project.archivedAt))))) ||
      new Set(parsed.projects.map(project => project.id)).size !== parsed.projects.length ||
      new Set(parsed.projects.map(project => project.root)).size !== parsed.projects.length) throw new Error('Invalid project registry.');
    return parsed.projects;
  }
  function transaction(update) {
    const parent = dirname(file);
    mkdirSync(parent, { recursive: true }); directory(parent);
    const lock = `${file}.lock`, deadline = Date.now() + 2000;
    for (;;) {
      try { mkdirSync(lock); break; }
      catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= deadline) throw new Error('Project registry is busy; retry the operation.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    let temporary;
    try {
      const projects = read(), result = update(projects);
      temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, projects }, null, 2), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file); return result;
    } finally {
      if (temporary && existsSync(temporary)) unlinkSync(temporary);
      rmdirSync(lock);
    }
  }
  function register(path, initialize = false, { restoreArchived = false } = {}) {
    let root = directory(path);
    const existingRoot = gitRoot(root);
    if (!existingRoot && !initialize) throw new Error('This folder needs Git and Agent Bus initialization.');
    if (!existingRoot) run('git', ['init', '--initial-branch=main'], root, 'Git initialization failed');
    root = existingRoot || root;
    initializeWorkspace(root);
    return transaction(projects => {
      const existing = projects.find(project => project.root === root);
      if (existing) { if (restoreArchived) delete existing.archivedAt; return existing; }
      if (projects.length >= 1000) throw new Error('Project limit reached.');
      const project = { id: `project-${createHash('sha256').update(root).digest('hex').slice(0, 24)}`, name: basename(root), root, createdAt: new Date().toISOString() };
      projects.push(project); return project;
    });
  }
  function get(id) {
    if (!/^project-[a-f0-9]{24}$/.test(id)) throw new Error('Invalid project ID.');
    const project = read().find(project => project.id === id);
    if (!project) throw new Error('Project not found.');
    if (project.archivedAt) throw new Error('Project is archived.');
    if (directory(project.root) !== project.root || gitRoot(project.root) !== project.root) throw new Error('Project directory is unavailable or its repository root changed.');
    return project;
  }
  function list({ includeArchived = false } = {}) {
    return read().filter(project => includeArchived || !project.archivedAt).map(project => {
      try {
        if (directory(project.root) !== project.root || gitRoot(project.root) !== project.root) throw new Error('Unavailable');
        return { ...project, available: true };
      }
      catch { return { ...project, available: false }; }
    });
  }
  function isArchived(root) { return Boolean(read().find(project => project.root === root)?.archivedAt); }
  async function archive(id) {
    if (typeof id !== 'string' || !/^project-[a-f0-9]{24}$/.test(id)) throw new Error('Invalid project ID.');
    const project = list({ includeArchived: true }).find(item => item.id === id);
    if (!project) throw new Error('Project not found.');
    return withWorkspaceProjectOperation(project.root, async () => {
      if (project.available) {
        for (const task of listWorkspaceTaskRecords(project.root)) await runtimeWorkspaceTaskArchive({ root: project.root, workspaceTaskId: task.id });
      }
      return transaction(projects => {
        const current = projects.find(item => item.id === id);
        if (!current) throw new Error('Project not found.');
        current.archivedAt ||= new Date().toISOString(); return current;
      });
    });
  }
  async function archiveStatus() {
    const projects = list({ includeArchived: true });
    let tasks = 0, unavailableProjects = 0;
    for (const project of projects) {
      if (!project.available) { unavailableProjects++; continue; }
      try { tasks += listWorkspaceTaskRecords(project.root).filter(task => task.archivedAt).length; }
      catch { unavailableProjects++; }
    }
    return { tasks, projects: projects.filter(project => project.archivedAt).length, unavailableProjects };
  }
  async function clearArchives() {
    let deletedTasks = 0, deletedSessions = 0;
    const failedProjects = [];
    for (const project of list({ includeArchived: true })) {
      if (!project.available) { failedProjects.push({ name: project.name, error: 'Project directory is unavailable.' }); continue; }
      try {
        const cleared = await withWorkspaceProjectOperation(project.root, () => runtimeWorkspaceArchivesClear({ root: project.root }));
        deletedTasks += cleared.deletedTasks; deletedSessions += cleared.deletedSessions;
      } catch (error) { failedProjects.push({ name: project.name, error: redactOutput(error.message || String(error), 512) }); }
    }
    return { deletedTasks, deletedSessions, failedProjects };
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
  async function pick() {
    const selected = await pickNativeFolder();
    if (selected.cancelled) return selected;
    const path = directory(selected.path);
    return { path, cancelled: false, needsInitialization: !gitRoot(path) };
  }
  return { register, get, list, browse, pick, archive, archiveStatus, clearArchives, isArchived };
}
