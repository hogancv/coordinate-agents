const STATUS_ORDER = [
  'CREATED',
  'PLANNING',
  'SPEC_READY',
  'IMPLEMENTING',
  'WAITING_IMPLEMENTER',
  'REVIEWING',
  'CHANGES_REQUESTED',
  'APPROVED',
  'ERROR',
  'STOPPED',
];

const state = {
  tasks: [],
  agents: [],
  sessions: [],
  events: [],
  selectedTask: null,
};

const elements = Object.fromEntries([
  'tasks', 'task-count', 'agent-flow', 'task-detail', 'detail-title', 'detail-summary',
  'timeline', 'detail-agent-flow', 'evidence', 'spec', 'sessions', 'session-count',
  'events', 'refresh-button', 'close-detail',
].map(id => [id, document.getElementById(id)]));

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? escapeHtml(value) : date.toLocaleString();
}

function statusClass(status) {
  return `${status || 'UNKNOWN'}`.toLowerCase().replaceAll('_', '-');
}

function statusLabel(status) {
  return `${status || 'UNKNOWN'}`.replaceAll('_', ' ');
}

function shortId(value) {
  const text = `${value || ''}`;
  return text.length > 18 ? `${text.slice(0, 12)}…${text.slice(-4)}` : text;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Inspector request failed (${response.status}).`);
  return response.json();
}

function renderTasks() {
  elements['task-count'].textContent = state.tasks.length;
  if (state.tasks.length === 0) {
    elements.tasks.innerHTML = '<div class="empty-state">No Tasks found in this project.</div>';
    return;
  }
  elements.tasks.innerHTML = state.tasks.map(task => `
    <button class="task-card ${state.selectedTask === task.id ? 'selected' : ''}" data-task-id="${escapeHtml(task.id)}" type="button">
      <span class="task-card-top"><span class="task-id">${escapeHtml(shortId(task.id))}</span><span class="round">R${escapeHtml(task.round)}</span></span>
      <strong>${escapeHtml(task.title)}</strong>
      <span class="status-pill ${statusClass(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
      <span class="task-updated">Updated ${formatDate(task.updatedAt)}</span>
    </button>
  `).join('');
  elements.tasks.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
}

function agentFor(id) {
  return state.agents.find(agent => agent.id === id) || { id, status: 'UNKNOWN', adapter: '—', roles: [] };
}

function renderAgentFlow() {
  const roles = ['planner', 'implementer', 'reviewer'];
  elements['agent-flow'].innerHTML = roles.map((role, index) => {
    const configured = state.agents.find(agent => agent.roles?.includes(role));
    const agent = configured || { id: 'unassigned', status: 'UNKNOWN', adapter: '—', roles: [] };
    return `
      <div class="flow-node">
        <span class="flow-role">${escapeHtml(role)}</span>
        <strong>${escapeHtml(agent.id)}</strong>
        <span class="status-line"><span class="state-dot ${statusClass(agent.status)}"></span>${escapeHtml(statusLabel(agent.status))}</span>
        <span class="adapter">${escapeHtml(agent.adapter)}</span>
      </div>
      ${index < roles.length - 1 ? '<span class="flow-arrow" aria-hidden="true">→</span>' : ''}
    `;
  }).join('');
}

function renderSessions() {
  elements['session-count'].textContent = state.sessions.length;
  if (state.sessions.length === 0) {
    elements.sessions.innerHTML = '<div class="empty-state">No Execution Sessions recorded.</div>';
    return;
  }
  elements.sessions.innerHTML = state.sessions.map(session => `
    <article class="session-card">
      <div class="session-header">
        <div>
          <span class="eyebrow">${escapeHtml(session.agent || 'agent')}</span>
          <h3>${escapeHtml(shortId(session.sessionId))}</h3>
        </div>
        <span class="status-pill ${statusClass(session.status)}">${escapeHtml(statusLabel(session.status))}</span>
      </div>
      <div class="session-meta"><span>Created ${formatDate(session.createdAt)}</span><span>Last activity ${formatDate(session.lastActivity)}</span></div>
      <pre class="session-output">${escapeHtml(session.recentOutput || 'No recent output available.')}</pre>
      ${session.taskIds?.length ? `<div class="session-tasks">Tasks: ${session.taskIds.map(escapeHtml).join(', ')}</div>` : ''}
      <div class="session-history">
        <span class="history-label">${session.historySource === 'recorded' ? 'Recorded Events' : 'Derived / Legacy History'}</span>
        ${(session.events || []).slice(-8).map(event => `<div><code>${event.sequence ? `#${escapeHtml(event.sequence)}` : '—'}</code><strong>${escapeHtml(event.event)}</strong><time>${formatDate(event.timestamp)}</time></div>`).join('')}
      </div>
    </article>
  `).join('');
}

function renderEvents() {
  if (state.events.length === 0) {
    elements.events.innerHTML = '<div class="empty-state">No Runtime events found.</div>';
    return;
  }
  elements.events.innerHTML = state.events.map(event => `
    <article class="event-row">
      <time>${event.sequence ? `#${escapeHtml(event.sequence)} · ` : ''}${formatDate(event.timestamp)}</time>
      <span class="event-marker ${statusClass(event.event)}"></span>
      <div class="event-body">
        <div class="event-title"><strong>${escapeHtml(event.event)}</strong><span>${escapeHtml([event.agent || event.from || 'runtime', event.sessionId ? shortId(event.sessionId) : null].filter(Boolean).join(' · '))}</span></div>
        <div class="event-details">${escapeHtml(event.details || '—')}</div>
        ${event.taskId ? `<button class="event-task" data-task-id="${escapeHtml(event.taskId)}" type="button">${escapeHtml(event.taskId)}</button>` : ''}
        <span class="history-label">${event.recorded ? 'Recorded Event' : 'Derived / Legacy History'}</span>
      </div>
    </article>
  `).join('');
  elements.events.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
}

function renderTimeline(timeline = []) {
  if (timeline.length === 0) {
    elements.timeline.innerHTML = '<div class="empty-state">No Task events recorded yet.</div>';
    return;
  }
  elements.timeline.innerHTML = timeline.map((event, index) => `
    <div class="timeline-item ${event.status ? 'has-status' : ''}">
      <div class="timeline-rail"><span class="timeline-dot ${event.status ? statusClass(event.status) : ''}"></span>${index < timeline.length - 1 ? '<span class="timeline-line"></span>' : ''}</div>
      <div class="timeline-content">
        <div class="timeline-title"><strong>${event.sequence ? `#${escapeHtml(event.sequence)} ` : ''}${escapeHtml(event.status ? statusLabel(event.status) : event.event)}</strong><time>${formatDate(event.timestamp)}</time></div>
        <div class="timeline-meta">${escapeHtml(event.agent || 'runtime')} · ${event.recorded ? 'Recorded Event' : 'Derived / Legacy History'}${event.sessionId ? ` · ${escapeHtml(shortId(event.sessionId))}` : ''}</div>
        ${event.details ? `<p>${escapeHtml(event.details)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTaskDetail(task) {
  if (!task) {
    elements['task-detail'].hidden = true;
    return;
  }
  elements['task-detail'].hidden = false;
  elements['detail-title'].textContent = task.title;
  elements['detail-summary'].innerHTML = `
    <span class="status-pill ${statusClass(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
    <span>Round ${escapeHtml(task.round)}</span>
    <span>${escapeHtml(task.id)}</span>
    <span>Updated ${formatDate(task.updatedAt)}</span>
  `;
  renderTimeline(task.timeline);
  elements['detail-agent-flow'].innerHTML = (task.agentFlow || []).map((item, index) => {
    const agent = agentFor(item.agent);
    return `
      <div class="detail-agent-row">
        <span class="flow-role">${escapeHtml(item.role)}</span>
        <strong>${escapeHtml(item.agent)}</strong>
        <span class="status-line"><span class="state-dot ${statusClass(agent.status)}"></span>${escapeHtml(statusLabel(agent.status))}</span>
      </div>
      ${index < (task.agentFlow || []).length - 1 ? '<div class="detail-agent-arrow">↓</div>' : ''}
    `;
  }).join('');
  const evidence = task.evidence || [];
  const reviews = task.reviewHistory || [];
  elements.evidence.innerHTML = `
    <div class="evidence-row"><span>Commit</span><code>${escapeHtml(task.implementationCommit || '—')}</code></div>
    <div class="evidence-row"><span>Evidence records</span><strong>${evidence.length}</strong></div>
    ${evidence.map(item => `<div class="evidence-block"><strong>${escapeHtml(item.type || 'Evidence')}</strong><p>${escapeHtml(item.details || item.relatedCommit || '—')}</p></div>`).join('')}
    ${reviews.map(item => `<div class="review-block"><span class="status-pill ${statusClass(item.decision)}">${escapeHtml(statusLabel(item.decision))}</span><p>${escapeHtml(item.feedback || 'No feedback')}</p></div>`).join('')}
    ${task.lastError ? `<div class="error-block"><strong>${escapeHtml(task.lastError.code || 'ERROR')}</strong><p>${escapeHtml(task.lastError.message || task.lastError.details || '')}</p></div>` : ''}
  `;
  elements.spec.textContent = task.spec || 'No specification recorded.';
}

async function selectTask(id) {
  try {
    state.selectedTask = id;
    window.location.hash = encodeURIComponent(id);
    renderTasks();
    const task = await fetchJson(`/api/tasks/${encodeURIComponent(id)}`);
    renderTaskDetail(task);
    elements['task-detail'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    elements['detail-title'].textContent = error.message;
  }
}

function closeDetail() {
  state.selectedTask = null;
  history.replaceState(null, '', window.location.pathname);
  renderTasks();
  renderTaskDetail(null);
}

async function refresh() {
  try {
    const [tasks, agents, sessions, events] = await Promise.all([
      fetchJson('/api/tasks'),
      fetchJson('/api/agents'),
      fetchJson('/api/sessions'),
      fetchJson('/api/events?limit=80'),
    ]);
    state.tasks = tasks;
    state.agents = agents;
    state.sessions = sessions;
    state.events = events;
    renderTasks();
    renderAgentFlow();
    renderSessions();
    renderEvents();
    if (state.selectedTask) {
      try { renderTaskDetail(await fetchJson(`/api/tasks/${encodeURIComponent(state.selectedTask)}`)); } catch { /* The list remains useful if a task is removed during refresh. */ }
    }
  } catch (error) {
    elements.tasks.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message)}</div>`;
  }
}

elements['refresh-button'].addEventListener('click', refresh);
elements['close-detail'].addEventListener('click', closeDetail);
const initialTask = decodeURIComponent(window.location.hash.slice(1));
if (initialTask) state.selectedTask = initialTask;
refresh();
setInterval(refresh, 5_000);

let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh();
  }, 150);
}

if ('EventSource' in window) {
  const stream = new EventSource('/api/events/stream');
  stream.addEventListener('runtime-event', scheduleRefresh);
}
