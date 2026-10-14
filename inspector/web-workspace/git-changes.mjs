import { I18N } from './i18n.mjs';
import { selectDiffRange, buildReviewFeedback, reviewLocation, reviewTarget, sameReviewTarget, reviewTargetError, reviewError } from './review-feedback.mjs';

// Bounded, on-demand changes UI. No terminal or Session lifecycle dependencies.
export function createChangesModel({ request, onChange = () => {} }) {
  const state = { projectId: null, open: false, files: [], summary: null, truncated: false,
    path: null, diff: null, error: null, diffError: null, loading: false, diffLoading: false };
  let listRequest = 0, diffRequest = 0, listController, diffController;
  function cancelDiff() { diffRequest++; diffController?.abort(); state.diffLoading = false; }
  function cancel() { listRequest++; listController?.abort(); state.loading = false; cancelDiff(); }
  return {
    state,
    reset(projectId) {
      cancel(); Object.assign(state, { projectId, open: projectId ? state.open : false, files: [], summary: null, path: null, diff: null,
        error: null, diffError: null, truncated: false }); onChange();
    },
    close() { cancel(); state.open = false; onChange(); },
    async refresh() {
      cancel(); const id = ++listRequest, projectId = state.projectId;
      state.path = null; state.diff = null; state.diffError = null; state.error = null;
      if (!projectId) { onChange(); return; }
      state.loading = true; listController = new AbortController(); onChange();
      try {
        const payload = await request('/api/git-changes', { projectId, signal: listController.signal });
        if (id !== listRequest) return;
        if (!payload.ok) throw new Error(payload.error);
        Object.assign(state, { files: payload.files, summary: payload.summary, truncated: payload.truncated });
      } catch (error) {
        if (id !== listRequest) return;
        state.error = error.message; state.files = []; state.summary = null;
      } finally { if (id === listRequest) { state.loading = false; onChange(); } }
    },
    async select(path) {
      cancelDiff(); const id = ++diffRequest;
      state.path = path; state.diff = null; state.diffError = null;
      if (!state.open || !state.files.some(file => file.path === path)) { onChange(); return; }
      state.diffLoading = true; diffController = new AbortController(); onChange();
      try {
        const payload = await request(`/api/git-changes/diff?path=${encodeURIComponent(path)}`, { projectId: state.projectId, signal: diffController.signal });
        if (id !== diffRequest) return;
        if (!payload.ok) throw new Error(payload.error);
        state.diff = payload;
      } catch (error) { if (id === diffRequest) state.diffError = error.message; }
      finally { if (id === diffRequest) { state.diffLoading = false; onChange(); } }
    },
  };
}

export function diffRows(diff) {
  let old = 0, next = 0, inHunk = false, hunkId = -1, hunkHeader = null;
  const lines = diff.split('\n'); if (lines.at(-1) === '') lines.pop();
  return lines.map(text => {
    if (text.startsWith('diff --')) inHunk = false;
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (match) { old = Number(match[1]); next = Number(match[2]); inHunk = true; hunkId++; hunkHeader = text; }
    const kind = match ? 'hunk' : !inHunk || text.startsWith('\\') ? 'meta'
      : text.startsWith('+') ? 'add' : text.startsWith('-') ? 'delete' : text.startsWith(' ') ? 'context' : 'meta';
    return { text, kind, hunkId, hunkHeader, old: kind === 'delete' || kind === 'context' ? old++ : null,
      new: kind === 'add' || kind === 'context' ? next++ : null };
  });
}

const WORDS = {
  en: { title: 'Changes', close: 'Close changes', refresh: 'Refresh', loading: 'Loading changes…',
    empty: 'No working-tree changes', choose: 'Select a file to view its diff.', files: '{n} files changed',
    scope: 'Current working tree · includes existing user changes', copyPath: 'Copy path', copyDiff: 'Copy diff',
    copied: 'Copied', copyError: 'Could not copy. Check clipboard permissions.', retry: 'Retry',
    truncated: 'File list truncated. File count includes all changed files.',
    lineTotals: 'Line totals exclude untracked file contents.',
    'too-large': 'Diff is too large. View it in your local IDE.', binary: 'Binary file — no text preview.',
    untracked: 'Untracked file — content preview is not available.', noDiff: 'No net diff against the base.',
    previewLimit: 'Preview limited to 3,000 lines. Copy the diff for the complete text.',
    binaryLabel: 'Binary', modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', conflicted: 'Conflicted' },
  zh: { title: '变更', close: '关闭变更', refresh: '刷新', loading: '正在加载变更…',
    empty: '当前工作区没有变更', choose: '选择文件查看 Diff。', files: '{n} 个文件变更',
    scope: '当前 Git 工作区 · 包含用户已有修改', copyPath: '复制路径', copyDiff: '复制 Diff',
    copied: '已复制', copyError: '复制失败，请检查剪贴板权限。', retry: '重试',
    truncated: '文件列表已截断，文件数量包含所有变更文件。',
    lineTotals: '增删行数统计不包含未跟踪文件内容。',
    'too-large': 'Diff 过大，建议在本地 IDE 查看。', binary: '二进制文件，不支持文本预览。',
    untracked: '未跟踪文件，暂不支持内容预览。', noDiff: '与基准相比没有净变更。',
    previewLimit: '预览仅显示前 3,000 行，复制 Diff 可获取完整文本。',
    binaryLabel: '二进制', modified: '已修改', added: '已新增', deleted: '已删除', renamed: '已重命名', conflicted: '冲突' },
};

export function mountChangesDrawer({ request, locale, toast, getTaskContext = () => ({}), sendToCodex }) {
  const $ = id => document.getElementById(id);
  const text = key => I18N[locale()]?.[`changes.${key}`] || WORDS[locale()]?.[key] || WORDS.en[key] || key;
  const model = createChangesModel({ request, onChange: render });
  const state = model.state;
  let trigger, renderedDiff, renderedPath, renderedProject, renderedLocale, rows = [], selection = null;
  let sending = false, generation = 0, outcome = null, confirmedInputRevision = null;
  function clearReview() {
    generation++; selection = null; outcome = null;
    $('review-comment').value = ''; $('review-ready').checked = false;
    $('review-status').textContent = '';
  }
  function prompt() {
    if (!selection) throw reviewError('reviewSelection');
    return buildReviewFeedback({ ...selection, comment: $('review-comment').value, locale: locale() });
  }
  function targetError() {
    if (!selection || selection.stale) return 'reviewStale';
    const context = getTaskContext();
    if (selection.projectId !== state.projectId || !sameReviewTarget(selection.target, reviewTarget(context))) return 'reviewTargetChanged';
    return reviewTargetError(context);
  }
  function renderFeedback() {
    $('review-feedback').hidden = !selection;
    $('review-title').textContent = text('reviewTitle');
    $('review-comment').placeholder = text('reviewPlaceholder');
    $('review-comment').setAttribute('aria-label', text('reviewPlaceholder'));
    $('review-clear').textContent = text('reviewClear');
    $('review-copy').textContent = text('reviewCopy');
    $('review-send').textContent = text(sending ? 'reviewSending' : 'reviewSend');
    $('review-ready-label').textContent = text('reviewReady');
    if (!selection) return;
    $('review-selection').textContent = `${text('reviewSelected').replace('{n}', selection.selectedLines.length)} · ${selection.path} · ${reviewLocation(selection.selectedLines, locale())}`;
    const error = targetError();
    if (error || confirmedInputRevision !== getTaskContext().inputRevision) $('review-ready').checked = false;
    let promptError = null;
    try { prompt(); } catch (failure) { promptError = failure.code; }
    $('review-copy').disabled = Boolean(promptError);
    $('review-send').disabled = sending || Boolean(outcome || error || promptError || !sendToCodex || !$('review-ready').checked);
    $('review-ready').disabled = sending || Boolean(outcome || error);
    $('review-clear').disabled = sending;
    $('review-hint').textContent = text(promptError || error || 'reviewWarning');
  }
  function highlight() {
    for (const line of $('changes-diff').querySelectorAll('[data-diff-row]')) {
      const index = Number(line.dataset.diffRow);
      const selected = Boolean(selection && index >= selection.startRow && index <= selection.endRow && ['add', 'delete', 'context'].includes(rows[index]?.kind));
      line.classList.toggle('diff-selected', selected);
      if (line.getAttribute('role') === 'button') line.setAttribute('aria-pressed', String(selected));
    }
  }
  function selectRow(index, extend) {
    if (sending) return;
    try {
      const next = selectDiffRange(rows, selection, index, extend);
      if (next === selection) return;
      generation++; outcome = null;
      selection = next ? { ...next, projectId: state.projectId, path: state.path, sourceDiff: state.diff.diff,
        target: reviewTarget(getTaskContext()) } : null;
      $('review-ready').checked = false; $('review-status').textContent = '';
      highlight(); renderFeedback();
    } catch (error) { toast(text(error.code), 'error'); }
  }
  async function sendFeedback() {
    renderFeedback();
    if (sending || outcome || targetError() || !$('review-ready').checked || !sendToCodex) return;
    let content;
    try { content = prompt(); } catch (error) { toast(text(error.code), 'error'); return; }
    const captured = selection, currentGeneration = generation;
    sending = true; $('review-comment').disabled = true;
    $('review-status').textContent = text('reviewSending'); renderFeedback();
    const assertSelection = () => {
      if (generation !== currentGeneration || selection !== captured || !state.open
        || state.projectId !== captured.projectId || state.path !== captured.path || targetError()) throw reviewError('reviewTargetChanged');
    };
    try {
      await sendToCodex({ target: captured.target, prompt: content, validateSelection: async () => {
        assertSelection();
        const fresh = await request(`/api/git-changes/diff?path=${encodeURIComponent(captured.path)}`, { projectId: captured.projectId });
        assertSelection();
        if (!fresh.ok || fresh.reason || fresh.diff !== captured.sourceDiff) {
          captured.stale = true; throw reviewError('reviewStale');
        }
      } });
      if (generation === currentGeneration) { outcome = 'sent'; $('review-status').textContent = text('reviewSent'); }
      toast(text('reviewSent'));
    } catch (error) {
      if (generation === currentGeneration) {
        if (error.code === 'reviewUncertain') outcome = 'uncertain';
        $('review-status').textContent = text(error.code || 'reviewFailed');
        $('review-ready').checked = false;
      }
      toast(text(error.code || 'reviewFailed'), 'error');
    } finally {
      sending = false; $('review-comment').disabled = false; renderFeedback();
    }
  }

  function node(tag, className, value) {
    const element = document.createElement(tag); element.className = className;
    if (value !== undefined) element.textContent = value; return element;
  }
  function render() {
    $('changes-button').disabled = !state.projectId;
    $('changes-button').textContent = `${text('title')} ${state.summary?.files ?? '—'}`;
    $('changes-button').setAttribute('aria-expanded', String(state.open));
    $('changes-drawer').hidden = !state.open;
    $('changes-title').textContent = text('title');
    $('changes-close').setAttribute('aria-label', text('close'));
    $('changes-refresh').textContent = text(state.error ? 'retry' : 'refresh');
    $('changes-refresh').disabled = state.loading || !state.projectId;
    $('changes-scope').textContent = text('scope');
    const summary = $('changes-summary'); summary.replaceChildren();
    if (state.summary) summary.append(node('span', '', text('files').replace('{n}', state.summary.files)),
      node('span', 'changes-additions', ` +${state.summary.additions}`), node('span', 'changes-deletions', ` −${state.summary.deletions}`));
    $('changes-stat-note').textContent = text('lineTotals');
    $('changes-stat-note').hidden = !state.summary;
    const message = $('changes-message');
    message.textContent = state.loading ? text('loading') : state.error || (state.truncated ? text('truncated') : !state.files.length ? text('empty') : '');
    message.hidden = !message.textContent;
    message.setAttribute('role', state.error ? 'alert' : 'status');
    const list = $('changes-files');
    // Preserve keyboard focus when a diff reply updates the detail pane.
    const focusedPath = document.activeElement?.dataset?.changePath;
    list.replaceChildren();
    const initials = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?', conflicted: 'U' };
    for (const file of state.files) {
      const button = node('button', 'changes-file'); button.type = 'button'; button.dataset.changePath = file.path;
      button.setAttribute('aria-pressed', String(file.path === state.path));
      button.title = `${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}\n${text(file.status)}`;
      button.append(node('span', `changes-status changes-status-${file.status}`, initials[file.status] || 'M'),
        node('span', 'changes-file-path', file.path), node('span', 'changes-file-count', file.binary ? text('binaryLabel') : file.status === 'untracked' ? '' : `+${file.additions ?? 0} −${file.deletions ?? 0}`));
      button.addEventListener('click', () => void model.select(file.path)); list.append(button);
      if (file.path === focusedPath) button.focus({ preventScroll: true });
    }
    $('changes-path').textContent = state.path || '';
    $('changes-copy-path').textContent = text('copyPath'); $('changes-copy-path').disabled = !state.path;
    $('changes-copy-diff').textContent = text('copyDiff'); $('changes-copy-diff').disabled = !state.diff?.diff;
    renderFeedback();
    if (renderedDiff === state.diff && renderedPath === state.path && renderedProject === state.projectId && !state.diffError && !state.diffLoading) {
      if (renderedLocale !== locale()) {
        for (const line of $('changes-diff').querySelectorAll('[role="button"]')) line.title = text('reviewSelectHint');
        const hint = $('changes-diff').querySelector('.changes-hint');
        if (hint) hint.textContent = text(state.diff?.reason || (!state.path ? 'choose' : !state.diff?.diff ? 'noDiff' : 'previewLimit'));
        renderedLocale = locale();
      }
      return;
    }
    clearReview(); renderFeedback();
    renderedLocale = locale(); renderedDiff = state.diff; renderedPath = state.path; renderedProject = state.projectId;
    rows = [];
    const view = $('changes-diff'); view.replaceChildren(); view.setAttribute('aria-busy', String(state.diffLoading));
    const hint = state.diffLoading ? text('loading') : state.diffError || (state.diff?.reason ? text(state.diff.reason)
      : !state.path ? text('choose') : !state.diff?.diff ? text('noDiff') : null);
    if (hint) {
      view.append(node('p', 'changes-hint', hint));
      if (state.diffError) {
        const retry = node('button', 'secondary-button', text('retry')); retry.type = 'button';
        retry.onclick = () => void model.select(state.path); view.append(retry);
      }
    } else {
      const fragment = document.createDocumentFragment();
      rows = diffRows(state.diff.diff);
      if (rows.length > 3000) view.append(node('p', 'changes-hint', text('previewLimit')));
      for (const [index, row] of rows.slice(0, 3000).entries()) {
        const line = node('div', `diff-line diff-${row.kind}`); line.dataset.diffRow = String(index);
        if (['add', 'delete', 'context'].includes(row.kind)) {
          line.tabIndex = 0; line.setAttribute('role', 'button'); line.setAttribute('aria-pressed', 'false');
          line.title = text('reviewSelectHint');
        }
        line.append(node('span', 'diff-number', row.old ?? ''), node('span', 'diff-number', row.new ?? ''), node('code', 'diff-code', row.text));
        fragment.append(line);
      }
      view.append(fragment);
    }
  }
  function close() { clearReview(); model.close(); (trigger?.isConnected ? trigger : $('changes-button'))?.focus(); }
  $('changes-button').addEventListener('click', () => {
    if (state.open) { close(); return; }
    trigger = document.activeElement; state.open = true; void model.refresh(); $('changes-close').focus();
  });
  $('changes-close').addEventListener('click', close);
  $('changes-refresh').addEventListener('click', () => void model.refresh());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open && !selection && !sending) { event.preventDefault(); close(); } });
  for (const [id, value] of [['changes-copy-path', () => state.path], ['changes-copy-diff', () => state.diff?.diff]]) {
    $(id).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(value()); toast(text('copied')); }
      catch { toast(text('copyError'), 'error'); }
    });
  }
  $('changes-diff').addEventListener('click', event => {
    const line = event.target.closest('[data-diff-row]');
    if (line) selectRow(Number(line.dataset.diffRow), event.shiftKey);
  });
  $('changes-diff').addEventListener('keydown', event => {
    const line = event.target.closest('[data-diff-row]');
    if (line && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectRow(Number(line.dataset.diffRow), event.shiftKey); }
  });
  $('review-comment').addEventListener('input', () => { if (outcome === 'sent') outcome = null; renderFeedback(); });
  $('review-ready').addEventListener('change', () => { confirmedInputRevision = getTaskContext().inputRevision; renderFeedback(); });
  $('review-clear').addEventListener('click', () => { if (!sending) { clearReview(); highlight(); renderFeedback(); } });
  $('review-copy').addEventListener('click', async () => {
    try { const content = prompt(); await navigator.clipboard.writeText(content); toast(text('copied')); }
    catch (error) { toast(text(error.code || 'copyError'), 'error'); }
  });
  $('review-send').addEventListener('click', () => void sendFeedback());
  render();
  return { reset(projectId) { clearReview(); model.reset(projectId); void model.refresh(); }, render, updateContext: renderFeedback };
}
