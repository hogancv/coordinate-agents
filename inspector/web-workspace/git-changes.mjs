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
      cancel(); Object.assign(state, { projectId, files: [], summary: null, path: null, diff: null,
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
  let old = 0, next = 0, inHunk = false;
  const lines = diff.split('\n'); if (lines.at(-1) === '') lines.pop();
  return lines.map(text => {
    if (text.startsWith('diff --')) inHunk = false;
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (match) { old = Number(match[1]); next = Number(match[2]); inHunk = true; }
    const kind = match ? 'hunk' : !inHunk || text.startsWith('\\') ? 'meta'
      : text.startsWith('+') ? 'add' : text.startsWith('-') ? 'delete' : text.startsWith(' ') ? 'context' : 'meta';
    return { text, kind, old: kind === 'delete' || kind === 'context' ? old++ : null,
      new: kind === 'add' || kind === 'context' ? next++ : null };
  });
}

const WORDS = {
  en: { title: 'Changes', close: 'Close changes', refresh: 'Refresh', loading: 'Loading changes…',
    empty: 'No working-tree changes', choose: 'Select a file to view its diff.', files: '{n} files changed',
    scope: 'Current working tree · includes existing user changes', copyPath: 'Copy path', copyDiff: 'Copy diff',
    copied: 'Copied', copyError: 'Could not copy. Check clipboard permissions.', retry: 'Retry',
    truncated: 'File list truncated. Totals include all changed files.',
    'too-large': 'Diff is too large. View it in your local IDE.', binary: 'Binary file — no text preview.',
    untracked: 'Untracked file — content preview is not available.', noDiff: 'No net diff against the base.',
    previewLimit: 'Preview limited to 3,000 lines. Copy the diff for the complete text.',
    binaryLabel: 'Binary', modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', conflicted: 'Conflicted' },
  zh: { title: '变更', close: '关闭变更', refresh: '刷新', loading: '正在加载变更…',
    empty: '当前工作区没有变更', choose: '选择文件查看 Diff。', files: '{n} 个文件变更',
    scope: '当前 Git 工作区 · 包含用户已有修改', copyPath: '复制路径', copyDiff: '复制 Diff',
    copied: '已复制', copyError: '复制失败，请检查剪贴板权限。', retry: '重试',
    truncated: '文件列表已截断，统计包含所有变更文件。',
    'too-large': 'Diff 过大，建议在本地 IDE 查看。', binary: '二进制文件，不支持文本预览。',
    untracked: '未跟踪文件，暂不支持内容预览。', noDiff: '与基准相比没有净变更。',
    previewLimit: '预览仅显示前 3,000 行，复制 Diff 可获取完整文本。',
    binaryLabel: '二进制', modified: '已修改', added: '已新增', deleted: '已删除', renamed: '已重命名', conflicted: '冲突' },
};

export function mountChangesDrawer({ request, locale, toast }) {
  const $ = id => document.getElementById(id);
  const text = key => WORDS[locale()]?.[key] || WORDS.en[key] || key;
  const model = createChangesModel({ request, onChange: render });
  const state = model.state;
  let trigger;
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
      const rows = diffRows(state.diff.diff);
      if (rows.length > 3000) view.append(node('p', 'changes-hint', text('previewLimit')));
      for (const row of rows.slice(0, 3000)) {
        const line = node('div', `diff-line diff-${row.kind}`);
        line.append(node('span', 'diff-number', row.old ?? ''), node('span', 'diff-number', row.new ?? ''), node('code', 'diff-code', row.text));
        fragment.append(line);
      }
      view.append(fragment);
    }
  }
  function close() { model.close(); (trigger?.isConnected ? trigger : $('changes-button'))?.focus(); }
  $('changes-button').addEventListener('click', () => {
    if (state.open) { close(); return; }
    trigger = document.activeElement; state.open = true; void model.refresh(); $('changes-close').focus();
  });
  $('changes-close').addEventListener('click', close);
  $('changes-refresh').addEventListener('click', () => void model.refresh());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open) { event.preventDefault(); close(); } });
  for (const [id, value] of [['changes-copy-path', () => state.path], ['changes-copy-diff', () => state.diff?.diff]]) {
    $(id).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(value()); toast(text('copied')); }
      catch { toast(text('copyError'), 'error'); }
    });
  }
  render();
  return { reset(projectId) { model.reset(projectId); void model.refresh(); }, render };
}
