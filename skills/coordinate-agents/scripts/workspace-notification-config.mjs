// Project-local preferences. No Task snapshot or global Agent configuration.
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { lstatSync, realpathSync, mkdirSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertSafePath, atomicWrite, readInternalFile, safeInternalStat } from './config.mjs';

export function defaultNotificationConfig() {
  return { enabled: false, events: { done: false, approved: true, failed: true } };
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid notification configuration fields.');
}
export function validateNotificationConfig(value) {
  exact(value, ['enabled', 'events']); exact(value.events, ['done', 'approved', 'failed']);
  if (typeof value.enabled !== 'boolean' || Object.values(value.events).some(item => typeof item !== 'boolean')) throw new Error('Notification preferences must be booleans.');
  return { enabled: value.enabled, events: { done: value.events.done, approved: value.events.approved, failed: value.events.failed } };
}
// Unlike existsSync, lstat detects dangling symlinks as well as live ones.
export function notificationStat(repository, path) {
  assertSafePath(repository, path);
  let cursor = path;
  while (cursor !== repository) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Unsafe notification path.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    cursor = dirname(cursor);
  }
  try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function notificationPaths(root) {
  const supplied = resolve(root);
  const metadata = lstatSync(supplied);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Unsafe notification project.');
  const repository = realpathSync.native(supplied), bus = join(repository, '.agent-bus');
  const paths = { repository, bus, config: join(bus, 'workspace-notifications.json'), tmp: join(bus, 'tmp'),
    directory: join(bus, 'notifications'), ledger: join(bus, 'notifications', 'dispatch.json'), diagnostic: join(bus, 'notifications', 'last-result.json'), lock: join(bus, 'notifications.lock'), recovery: join(bus, 'notifications-recovery.lock') };
  for (const path of [bus, paths.tmp, join(bus, 'locks'), join(bus, 'locks', 'config'), paths.directory, paths.lock, paths.recovery]) {
    const stat = notificationStat(repository, path);
    if (stat && !stat.isDirectory()) throw new Error('Unsafe notification directory.');
  }
  if (!lstatSync(bus).isDirectory()) throw new Error('Workspace is not initialized.');
  for (const path of [paths.config, paths.ledger, paths.diagnostic]) {
    if (notificationStat(repository, path)) safeInternalStat(bus, path);
  }
  return paths;
}
export function readBoundedNotificationFile(paths, path, maxBytes) {
  const stat = notificationStat(paths.repository, path);
  if (!stat) return undefined;
  if (stat.size > maxBytes) throw new Error('Notification file exceeds size limit.');
  return JSON.parse(readInternalFile(paths.bus, path));
}
export function readNotificationConfig(root) {
  const paths = notificationPaths(root);
  const record = readBoundedNotificationFile(paths, paths.config, 2048);
  if (record === undefined) return defaultNotificationConfig();
  exact(record, ['schemaVersion', 'notifications']);
  if (record.schemaVersion !== 1) throw new Error('Unsupported notification config schema.');
  return validateNotificationConfig(record.notifications);
}
// mkdir is an interprocess claim. An ownerless, freshly created directory
// belongs to a process between mkdir and owner write; never steal it.
export function withNotificationStore(root, operation) {
  const paths = notificationPaths(root);
  mkdirSync(paths.tmp, { recursive: true });
  const ownerPath = join(paths.lock, 'owner.json'), token = randomUUID();
  const deadline = Date.now() + 250;
  while (true) {
    try {
      mkdirSync(paths.lock);
      try { atomicWrite(ownerPath, JSON.stringify({ token, pid: process.pid, host: hostname() }), paths.tmp); }
      catch (error) { rmSync(paths.lock, { recursive: true }); throw error; }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = notificationStat(paths.repository, paths.lock);
      if (!stat) continue;
      if (!stat.isDirectory()) throw new Error('Unsafe notification lock.');
      const owner = readBoundedNotificationFile(paths, ownerPath, 1024);
      let dead = false;
      if (owner?.host === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (failure) { dead = failure.code === 'ESRCH'; }
      }
      if (dead || (!owner && Date.now() - stat.mtimeMs > 120000)) {
        // Recovery itself must be exclusive. Otherwise two stale readers can
        // remove each other's newly acquired lock after a crashed owner.
        let recovering = false;
        try {
          try { mkdirSync(paths.recovery); recovering = true; }
          catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
          if (recovering) {
            const currentStat = notificationStat(paths.repository, paths.lock);
            const currentOwner = readBoundedNotificationFile(paths, ownerPath, 1024);
            let currentDead = false;
            if (currentOwner?.host === hostname() && Number.isSafeInteger(currentOwner.pid) && currentOwner.pid > 0) {
              try { process.kill(currentOwner.pid, 0); } catch (failure) { currentDead = failure.code === 'ESRCH'; }
            }
            if (currentStat && (currentDead || (!currentOwner && Date.now() - currentStat.mtimeMs > 120000))) rmSync(paths.lock, { recursive: true });
          }
        } finally { if (recovering) rmdirSync(paths.recovery); }
        if (recovering) continue;
      }
      if (Date.now() >= deadline) throw new Error('Notification store is busy.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return operation(notificationPaths(root)); }
  finally {
    const owner = readBoundedNotificationFile(paths, ownerPath, 1024);
    if (owner?.token === token) rmSync(paths.lock, { recursive: true });
  }
}
export function saveNotificationConfig(root, value) {
  const notifications = validateNotificationConfig(value);
  return withNotificationStore(root, paths => {
    atomicWrite(paths.config, `${JSON.stringify({ schemaVersion: 1, notifications })}\n`, paths.tmp);
    return notifications;
  });
}
