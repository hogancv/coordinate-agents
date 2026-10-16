// Read-only observations of the current task snapshot. No runtime actions or timers.
export function attentionMinutes(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 10080 ? minutes : 30;
}

export function collaborationHealth(task, { now = Date.now(), minutes = 30 } = {}) {
  const result = { state: 'normal', signals: [], lastReceipt: null };
  if (!task || task.archivedAt || ['CLOSED', 'STARTING', 'AWAITING_INPUT'].includes(task.status)) return result;
  const cooperation = task.mode === 'custom' ? null : task.cooperation;
  const status = cooperation?.status;
  if (status && status !== 'IDLE') result.lastReceipt = { status, timestamp: cooperation.updatedAt,
    agent: ['SENT', 'REVIEWING', 'APPROVED', 'CHANGES_REQUESTED'].includes(status) ? 'codex' : 'antigravity' };
  const active = ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED'].includes(status);
  if (active || task.mode === 'custom') {
    for (const [slot, session] of Object.entries(task.sessions || {})) {
      if (!session.sessionId) continue;
      const state = session.recordAvailable === false ? '' : String(session.state || session.status || '').toLowerCase();
      if (['failed', 'exited', ''].includes(state)) result.signals.push({ kind: 'session', agent: slot,
        sessionId: session.sessionId, sessionState: state || 'unavailable', attention: true });
    }
  }
  if (status === 'FAILED') result.signals.push({ kind: 'reported-failure', agent: 'antigravity', attention: true });
  if (active) {
    const timestamp = typeof cooperation.updatedAt === 'string' ? Date.parse(cooperation.updatedAt) : NaN;
    const overdue = Number.isFinite(timestamp) && now >= timestamp && now - timestamp >= attentionMinutes(minutes) * 60000;
    const kind = { SENT: 'awaiting-start', DONE: 'awaiting-review', CHANGES_REQUESTED: 'awaiting-dispatch' }[status] || 'quiet';
    if (overdue || kind !== 'quiet') result.signals.push({ kind, attention: overdue,
      agent: ['SENT', 'WORKING'].includes(status) ? 'antigravity' : 'codex' });
  }
  result.state = status === 'FAILED' ? 'reported-failure'
    : result.signals.some(s => s.kind === 'session') ? 'session'
      : result.signals.some(s => s.attention) ? 'attention' : result.signals.length ? 'waiting' : 'normal';
  return result;
}

export function mountCollaborationHealth({ document, getContext, t, storage, now = Date.now, onInspect, onChange, onOpen }) {
  const panel = document.querySelector('#collaboration-health');
  const list = document.querySelector('#collaboration-health-signals');
  const input = document.querySelector('#collaboration-health-minutes');
  const links = document.querySelector('#collaboration-health-links');
  const button = document.querySelector('#collaboration-health-button');
  const drawer = document.querySelector('#collaboration-health-drawer');
  const mask = document.querySelector('#collaboration-health-mask');
  const closeButton = document.querySelector('#collaboration-health-close');
  let open = false, identity;
  function showDrawer() {
    if (drawer) drawer.hidden = !open;
    if (mask) mask.hidden = !open;
    button?.setAttribute('aria-expanded', String(open));
  }
  function close({ restoreFocus = true } = {}) {
    const wasOpen = open; open = false; showDrawer();
    if (wasOpen && restoreFocus) button?.focus();
  }
  button?.addEventListener('click', () => {
    update();
    if (button.disabled) return;
    if (open) { close(); return; }
    onOpen?.(); open = true; showDrawer(); closeButton?.focus();
  });
  closeButton?.addEventListener('click', () => close());
  mask?.addEventListener('click', () => close());
  document.addEventListener?.('keydown', event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
  });
  const storageKey = 'coordinate-agents-collaboration-attention-minutes';
  let minutes = 30, signature;
  try { minutes = attentionMinutes(storage?.getItem(storageKey)); } catch { /* Storage can be disabled. */ }
  if (input) input.value = String(minutes);
  function update() {
    if (!panel) return;
    const { projectId, selectedId, task } = getContext();
    const key = JSON.stringify([projectId, selectedId]);
    if (key !== identity) { close({ restoreFocus: false }); identity = key; }
    const available = Boolean(projectId && task && task.id === selectedId && !task.archivedAt
      && !(task.mode === 'custom' && task.status === 'CLOSED'));
    const health = collaborationHealth(available ? task : null, { now: now(), minutes });
    if (button) {
      button.disabled = !available;
      button.dataset.health = health.state;
      const symbol = { normal: '○', waiting: '◷', attention: '!', session: '!', 'reported-failure': '×' }[health.state];
      button.textContent = `${symbol} ${t('collaborationHealth.title')}`;
      button.title = available ? `${t('collaborationHealth.title')} · ${t(task.status === 'CLOSED' ? 'collaborationHealth.closed' : `collaborationHealth.${health.state}`)}` : t('collaborationHealth.selectTask');
      button.setAttribute('aria-label', button.title);
    }
    if (drawer) {
      document.querySelector('#collaboration-health-title').textContent = t('collaborationHealth.title');
      document.querySelector('#collaboration-health-context').textContent = available ? task.title || task.id : '';
      closeButton?.setAttribute('aria-label', t('collaborationHealth.close'));
    }
    if (!available) close({ restoreFocus: false });
    panel.hidden = !available || task.status === 'CLOSED';
    if (panel.hidden) { list.textContent = ''; links.textContent = ''; signature = null; return; }
    const next = JSON.stringify([projectId, selectedId, task.title, health, minutes, t('collaborationHealth.title')]);
    if (next === signature) return;
    signature = next;
    panel.dataset.health = health.state;
    document.querySelector('#collaboration-health-heading').textContent = `${t('collaborationHealth.title')} · ${t(`collaborationHealth.${health.state}`)}`;
    document.querySelector('#collaboration-health-config').textContent = t('collaborationHealth.configure');
    document.querySelector('#collaboration-health-label').textContent = t('collaborationHealth.minutes');
    const name = agent => task.mode === 'custom' ? t(`custom.${agent}`) : agent === 'codex' ? 'Codex' : 'Antigravity';
    list.textContent = '';
    for (const signal of health.signals) {
      const row = document.createElement('li');
      row.textContent = `${name(signal.agent)}: ${t(`collaborationHealth.${signal.kind}.reason`)}${signal.kind === 'session' ? ` (${signal.sessionState}; ${signal.sessionId})` : ''}`;
      list.append(row);
    }
    const receipt = health.lastReceipt;
    document.querySelector('#collaboration-health-receipt').textContent = receipt
      ? `${t('collaborationHealth.lastReceipt')}: ${name(receipt.agent)} · ${receipt.status} · ${receipt.timestamp || t('collaborationHealth.unknownTime')}`
      : t(task.mode === 'custom' ? 'collaborationHealth.customNote' : 'collaborationHealth.noReceipt');
    links.textContent = '';
    const addLink = (label, kind, agent) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'link-button'; button.textContent = label;
      button.addEventListener('click', () => {
        if (kind !== 'timeline') close({ restoreFocus: false });
        onInspect?.(kind, agent);
      }); links.append(button);
    };
    for (const agent of [...new Set(health.signals.map(signal => signal.agent))]) addLink(`${t('collaborationHealth.terminal')} · ${name(agent)}`, 'terminal', agent);
    if (task.mode !== 'custom') addLink(t('timeline.title'), 'timeline');
    addLink(t('collaborationHealth.changes'), 'changes');
  }
  input?.addEventListener('change', () => {
    minutes = attentionMinutes(input.value); input.value = String(minutes);
    try { storage?.setItem(storageKey, String(minutes)); } catch { /* Use the preference for this page. */ }
    signature = null; update(); onChange?.();
  });
  return { update, close, getMinutes: () => minutes };
}
