// Best effort / at-most-once dispatch. Nothing here infers task completion.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join, win32 } from 'node:path';
import { atomicWrite } from './config.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { defaultNotificationConfig, notificationPaths, notificationStat, readBoundedNotificationFile, readNotificationConfig, withNotificationStore } from './workspace-notification-config.mjs';

export const MAX_NOTIFICATION_CLAIMS = 4096;
const MAX_LEDGER_BYTES = 1024 * 1024;
const TASK_ID = /^workspace-[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROUND_ID = /^round-[a-zA-Z0-9_-]{1,128}$/;
const EVENT = { DONE: 'done', APPROVED: 'approved', FAILED: 'failed' };
const APPLESCRIPT = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
const outcome = (status, reason = null) => ({ status, reason, displayed: null });

export function notificationCapability(platform = process.platform) {
  const supported = ['win32', 'darwin'].includes(platform);
  return { platform, supported, available: supported ? null : false, reason: supported ? 'TEST_REQUIRED' : 'UNSUPPORTED_PLATFORM' };
}
function text(value, limit) {
  const cleaned = redactOutput(String(value || ''), 4096)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s]+/gu, '[path]')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '')
    .replace(/\s+/gu, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : cleaned;
}
export function buildTaskNotification(root, task) {
  const status = task.cooperation?.status;
  const templates = {
    DONE: ['实现完成', 'Antigravity 已完成实现，等待 Codex 审查。'],
    APPROVED: ['任务已完成', 'Codex 已完成审查，任务通过。'],
    FAILED: ['任务执行失败', 'Agent 报告任务失败，请返回 Workspace 查看。'],
  };
  if (!Object.hasOwn(templates, status)) throw new Error('Unsupported notification event.');
  const [title, detail] = templates[status];
  return { title: `Coordinate Agents · ${title}`, body: `项目：${text(basename(root), 48)}\n任务：${text(task.title, 96)}\n\n${detail}` };
}

// execFile has bounded buffers and a kill timeout. Retaining the child (no
// unref/detach) lets an independent workspace-message CLI finish OS handoff.
export function runNotificationCommand(command, args, options) {
  return new Promise((done, reject) => {
    const { input, ...execution } = options;
    const child = execFile(command, args, execution, (error, stdout, stderr) => {
      if (error) reject(error); else done({ stdout, stderr });
    });
    child.stdin.on('error', () => {}); // An early OS failure can close stdin.
    child.stdin.end(input || '');
  });
}
export async function sendNativeNotification(message, { platform = process.platform, run = runNotificationCommand } = {}) {
  if (!notificationCapability(platform).supported) return outcome('unsupported', 'UNSUPPORTED_PLATFORM');
  try {
    let command, args, input;
    if (platform === 'darwin') {
      command = '/usr/bin/osascript'; args = ['-e', APPLESCRIPT, message.title, message.body];
    } else {
      command = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const script = readFileSync(new URL('./workspace-notifications-windows.ps1', import.meta.url), 'utf8');
      args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
      input = JSON.stringify(message);
    }
    const { stdout = '' } = await run(command, args, { input, encoding: 'utf8', timeout: 10000, maxBuffer: 16384, shell: false, windowsHide: true });
    if (platform === 'win32') {
      if (stdout.trim() === 'CA_DISABLED') return outcome('unavailable', 'NOTIFICATIONS_DISABLED');
      if (stdout.trim() !== 'CA_ACCEPTED') return outcome('unavailable', 'NATIVE_UNAVAILABLE');
    }
    return outcome('accepted');
  } catch (error) {
    return outcome('unavailable', error.code === 'ENOENT' ? 'TOOL_UNAVAILABLE' : error.killed ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED');
  }
}

function claimReceipt(root, task) {
  return withNotificationStore(root, paths => {
    const previous = readBoundedNotificationFile(paths, paths.ledger, MAX_LEDGER_BYTES);
    if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous) || previous.schemaVersion !== 1 || !Array.isArray(previous.claims) || previous.claims.length > MAX_NOTIFICATION_CLAIMS
      || Object.keys(previous).some(key => !['schemaVersion', 'claims'].includes(key))
      || previous.claims.some(item => !item || Object.keys(item).length !== 2 || !HASH.test(item.key) || !TASK_ID.test(item.taskId)))) throw new Error('Invalid notification ledger.');
    const claims = previous?.claims || [];
    const key = createHash('sha256').update(JSON.stringify([paths.repository, task.id, task.cooperation.roundId, task.cooperation.status])).digest('hex');
    if (claims.some(item => item.key === key)) return 'DUPLICATE';
    // No expiry/oldest-entry eviction: that would permit duplicate dispatch.
    // Deleted tasks cannot report again, so their claims can be safely removed.
    const retained = claims.length < MAX_NOTIFICATION_CLAIMS ? claims : claims.filter(item => notificationStat(paths.repository, join(paths.bus, 'workspace-tasks', `${item.taskId}.json`)) !== null);
    if (retained.length >= MAX_NOTIFICATION_CLAIMS) return 'DEDUP_CAPACITY_REACHED';
    retained.push({ key, taskId: task.id });
    mkdirSync(paths.directory, { recursive: true });
    atomicWrite(paths.ledger, `${JSON.stringify({ schemaVersion: 1, claims: retained })}\n`, paths.tmp);
    return null;
  });
}
function recordDiagnostic(root, result) {
  try {
    withNotificationStore(root, paths => {
      mkdirSync(paths.directory, { recursive: true });
      // Fixed-size latest result only. Never persist native stderr or content.
      atomicWrite(paths.diagnostic, JSON.stringify({ status: result.status, reason: result.reason, at: new Date().toISOString() }), paths.tmp);
    });
  } catch { /* Diagnostics must not change dispatch or receipt success. */ }
  return result;
}
export async function notifyWorkspaceReceipt(root, task, { platform = process.platform, send = sendNativeNotification } = {}) {
  try {
    if (task.mode === 'custom' || !Object.hasOwn(EVENT, task.cooperation?.status)) return outcome('skipped', 'EVENT_DISABLED');
    if (!TASK_ID.test(task.id) || !ROUND_ID.test(task.cooperation.roundId)) return outcome('skipped', 'INVALID_EVENT');
    const config = readNotificationConfig(root);
    if (!config.enabled) return outcome('skipped', 'DISABLED');
    if (!config.events[EVENT[task.cooperation.status]]) return outcome('skipped', 'EVENT_DISABLED');
    if (!notificationCapability(platform).supported) return recordDiagnostic(root, outcome('unsupported', 'UNSUPPORTED_PLATFORM'));
    const reason = claimReceipt(root, task);
    if (reason) return reason === 'DUPLICATE' ? outcome('skipped', reason) : recordDiagnostic(root, outcome('unavailable', reason));
    // The persisted claim means even failed attempts are never retried.
    let result;
    try { result = await send(buildTaskNotification(root, task), { platform }); }
    catch { result = outcome('unavailable', 'COMMAND_FAILED'); }
    return recordDiagnostic(root, result);
  } catch { return recordDiagnostic(root, outcome('unavailable', 'NOTIFICATION_STORE_UNAVAILABLE')); }
}
export async function testWorkspaceNotification(root, options = {}) {
  const result = await sendNativeNotification({ title: 'Coordinate Agents', body: '系统通知测试成功。\n你可以在任务完成后收到提醒。' }, options);
  return recordDiagnostic(root, result);
}
export function readNotificationSettings(root, platform = process.platform) {
  let config, configError = null, lastResult = null;
  try { config = readNotificationConfig(root); } catch { config = defaultNotificationConfig(); configError = 'NOTIFICATION_CONFIG_UNAVAILABLE'; }
  try {
    const paths = notificationPaths(root);
    const value = readBoundedNotificationFile(paths, paths.diagnostic, 1024);
    // Do not reflect arbitrary contents of on-disk diagnostics into the API.
    if (value && ['accepted', 'unavailable', 'unsupported'].includes(value.status) && (value.reason === null || /^[A-Z_]{1,64}$/.test(value.reason))
      && typeof value.at === 'string' && value.at.length <= 32 && !Number.isNaN(Date.parse(value.at))) lastResult = { status: value.status, reason: value.reason, at: value.at };
  } catch { /* Optional diagnostic. */ }
  return { config, capability: notificationCapability(platform), configError, lastResult };
}
