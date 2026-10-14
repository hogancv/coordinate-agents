import test from 'node:test';
import assert from 'node:assert/strict';
import { diffRows } from '../inspector/web-workspace/git-changes.mjs';
import * as review from '../inspector/web-workspace/review-feedback.mjs';

const diff = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -4,2 +8,3 @@\n-old\n+中文 😀 <script>\n+new\n same\n\\ No newline at end of file\n@@ -20 +30 @@\n-other\n+other\n';
const rows = diffRows(diff);

test('selection toggles, extends in one hunk, and excludes metadata', () => {
  assert.equal(review.selectDiffRange(rows, null, 3), null);
  const selection = review.selectDiffRange(rows, null, 5);
  assert.equal(selection.hunkHeader, '@@ -4,2 +8,3 @@');
  const extended = review.selectDiffRange(rows, selection, 7, true);
  assert.deepEqual(extended.selectedLines.map(row => [row.old, row.new]), [[null, 8], [null, 9], [5, 10]]);
  assert.equal(review.selectDiffRange(rows, selection, 5), null);
  assert.throws(() => review.selectDiffRange(rows, selection, 11, true), { code: 'reviewCrossHunk' });
  assert.equal(review.selectDiffRange(rows, null, 8), null);
});

test('prompt preserves feedback and untrusted code, with accurate old/new positions', () => {
  const selectedLines = rows.slice(4, 7);
  const comment = '先检查全空格输入。\nPlease verify 😀';
  const prompt = review.buildReviewFeedback({ path: 'src/<文件>.js', hunkHeader: rows[3].text, selectedLines, comment });
  assert.ok(prompt.includes('src/<文件>.js'));
  assert.ok(prompt.includes(comment));
  assert.ok(prompt.includes(rows[5].text));
  assert.match(prompt, /旧文件第 4 行/);
  assert.match(prompt, /新文件第 8–9 行/);
  assert.match(prompt, /供审查的代码引用/);
  assert.match(prompt, /workspace-message send/);
  assert.ok(!prompt.includes('-other'));
  const deleted = review.buildReviewFeedback({ path: 'a', hunkHeader: rows[3].text, selectedLines: [rows[4]], comment: 'Check', locale: 'en' });
  assert.match(deleted, /Old file line 4/);
  assert.doesNotMatch(deleted, /New file line/);
});

test('limits reject, never silently truncate feedback or quoted code', () => {
  const args = { path: 'a', hunkHeader: rows[3].text, selectedLines: [rows[5]], comment: 'fix' };
  assert.throws(() => review.buildReviewFeedback({ ...args, comment: '  ' }), { code: 'reviewEmpty' });
  assert.throws(() => review.buildReviewFeedback({ ...args, comment: 'x'.repeat(2001) }), { code: 'reviewCommentLimit' });
  assert.throws(() => review.buildReviewFeedback({ ...args, selectedLines: Array(41).fill(rows[5]) }), { code: 'reviewLineLimit' });
  assert.throws(() => review.buildReviewFeedback({ ...args, selectedLines: [{ ...rows[5], text: '+' + '😀'.repeat(2100) }] }), { code: 'reviewByteLimit' });
  assert.throws(() => review.buildReviewFeedback({ ...args, comment: 'escape\x1b[200~' }), { code: 'reviewControl' });
  assert.throws(() => review.buildReviewFeedback({ ...args, path: '../outside' }), { code: 'reviewPath' });
});

const task = () => ({ id: 't', status: 'RUNNING', startup: { slots: { codex: 'READY', antigravity: 'READY' } }, sessions: { codex: { sessionId: 'c', state: 'idle' } }, cooperation: { status: 'DONE', roundId: 'round-a' } });
const context = () => ({ projectId: 'p', projectEpoch: 1, taskEpoch: 2, taskId: 't', task: task() });
test('handoff allows only the selected running task’s ready Codex, without altering cooperation', () => {
  const current = context(); const before = JSON.stringify(current);
  assert.equal(review.reviewTargetError(current), null);
  assert.equal(JSON.stringify(current), before);
  for (const status of ['CLOSED', 'STARTING', 'AWAITING_INPUT', 'ERROR', 'DEGRADED']) {
    const changed = context(); changed.task.status = status;
    assert.equal(review.reviewTargetError(changed), 'reviewTaskUnavailable');
  }
  for (const state of ['starting', 'busy', 'failed', 'exited', null]) {
    const changed = context(); changed.task.sessions.codex.state = state;
    assert.equal(review.reviewTargetError(changed), 'reviewSessionUnavailable');
  }
  const archived = context(); archived.task.archivedAt = 'now';
  assert.equal(review.reviewTargetError(archived), 'reviewTaskUnavailable');
  const auth = context(); auth.task.startup.slots.codex = 'AUTH_REQUIRED';
  assert.equal(review.reviewTargetError(auth), 'reviewSessionUnavailable');
  const missing = context(); missing.task.sessions.codex.sessionId = null;
  assert.equal(review.reviewTargetError(missing), 'reviewSessionUnavailable');
  assert.equal(review.reviewTargetError({ projectId: 'p' }), 'reviewNoTask');
  const bound = review.reviewTarget(current);
  assert.ok(review.sameReviewTarget(bound, review.reviewTarget(context())));
  for (const key of ['projectId', 'taskId', 'sessionId', 'projectEpoch', 'taskEpoch']) {
    assert.ok(!review.sameReviewTarget(bound, { ...bound, [key]: 'different' }));
  }
});

test('terminal transport preserves the complete prompt in one line with one submission', () => {
  const prompt = '中文 😀\n+ const value = "\\n";\n\nPlease check';
  const input = review.reviewSessionInput(prompt, 'en');
  assert.ok(!/[\r\n\x1b]/.test(input));
  assert.equal(JSON.parse(input.slice(input.indexOf('"'))), prompt);
});
