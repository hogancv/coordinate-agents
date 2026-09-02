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
  repository: null,
  selectedTask: null,
  selectedSubtask: null,
  graphDetail: null,
};

// Server-issued per-launch capability for guarded browser actions (#46). The
// read-only surfaces never use it; later control panels attach it to POST
// /api/action requests as x-coordinate-agents-capability.
const capabilityMeta = document.querySelector('meta[name="coordinate-agents-capability"]');
const workspaceCapability = capabilityMeta?.content && capabilityMeta.content !== '__COORDINATE_AGENTS_CAPABILITY__'
  ? capabilityMeta.content
  : null;

async function postAction(action, params, { correlationId = null } = {}) {
  const response = await fetch('/api/action', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceCapability ? { 'x-coordinate-agents-capability': workspaceCapability } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    body: JSON.stringify({ action, params, correlationId }),
  });
  return { status: response.status, payload: await response.json() };
}

const elements = Object.fromEntries([
  'tasks', 'task-count', 'agent-flow', 'task-detail', 'detail-title', 'detail-summary',
  'timeline', 'detail-agent-flow', 'evidence', 'spec', 'sessions', 'session-count',
  'events', 'refresh-button', 'close-detail', 'graph-detail', 'graph-topology',
  'graph-frontier', 'graph-conflicts', 'graph-integration', 'repository',
  'repo-name', 'repo-branch', 'repo-facts', 'graph-map-region', 'graph-map',
  'graph-node-detail', 'graph-map-note', 'graph-legend',
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
    <button class="task-card ${task.graph ? 'graph-card' : ''} ${state.selectedTask === task.id ? 'selected' : ''}" data-task-id="${escapeHtml(task.id)}" type="button">
      <span class="task-card-top"><span class="task-id">${escapeHtml(shortId(task.id))}</span><span class="round">${task.graph ? 'GRAPH' : `R${escapeHtml(task.round)}`}</span></span>
      <strong>${escapeHtml(task.title)}</strong>
      <span class="status-pill ${statusClass(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
      ${task.graph ? `<span class="graph-card-meta">${escapeHtml(task.subtaskCount)} subtasks · concurrency ${escapeHtml(task.maxConcurrency)}</span>` : ''}
      <span class="task-updated">Updated ${formatDate(task.updatedAt)}</span>
    </button>
  `).join('');
  elements.tasks.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
}

function renderRepository() {
  const repository = state.repository;
  if (!repository) {
    elements.repository.hidden = true;
    return;
  }
  elements.repository.hidden = false;
  elements['repo-name'].textContent = repository.name || repository.root || 'Repository';
  elements['repo-branch'].textContent = repository.branch || (repository.detached ? 'detached' : '—');
  const facts = [];
  if (repository.head) {
    facts.push(`<div class="repo-fact"><span>HEAD</span><code>${escapeHtml(repository.head.short || '—')}</code></div>`);
    facts.push(`<div class="repo-fact repo-fact-wide"><span>${repository.branch ? `Latest commit on ${escapeHtml(repository.branch)}` : 'Latest commit'}</span><strong>${escapeHtml(repository.head.subject || '—')}</strong></div>`);
    if (repository.head.committedAt) {
      facts.push(`<div class="repo-fact"><span>Committed</span><time>${formatDate(repository.head.committedAt)}</time></div>`);
    }
  } else {
    facts.push('<div class="repo-fact"><span>HEAD</span><code>no commits yet</code></div>');
  }
  facts.push(`<div class="repo-fact"><span>Remote</span><code>${escapeHtml(repository.remoteUrl || 'no origin remote')}</code></div>`);
  facts.push(`<div class="repo-fact repo-fact-wide"><span>Bound root</span><code>${escapeHtml(repository.root || '—')}</code></div>`);
  if (repository.error) facts.push(`<div class="repo-fact repo-fact-wide"><span>Repository facts</span><code>${escapeHtml(repository.error)}</code></div>`);
  elements['repo-facts'].innerHTML = facts.join('');
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

function compactJson(value) {
  return escapeHtml(JSON.stringify(value ?? null, null, 2));
}

function factBlock(label, value) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '';
  const rendered = typeof value === 'object' ? `<pre>${compactJson(value)}</pre>` : `<code>${escapeHtml(value)}</code>`;
  return `<div class="graph-fact"><span>${escapeHtml(label)}</span>${rendered}</div>`;
}

const GRAPH_MAP_MAX_NODES = 120;
const GRAPH_MAP_STATES = ['READY', 'WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED'];
const GRAPH_MAP_NODE_W = 176;
const GRAPH_MAP_NODE_H = 58;
const GRAPH_MAP_GAP_X = 64;
const GRAPH_MAP_GAP_Y = 16;
const GRAPH_MAP_PAD = 12;

function renderGraphLegend() {
  elements['graph-legend'].innerHTML = GRAPH_MAP_STATES
    .map(state => `<span class="legend-item"><i class="legend-dot ${statusClass(state)}"></i>${escapeHtml(statusLabel(state))}</span>`)
    .join('');
}

function graphNodeLevels(subtasks, dependencies) {
  const levels = new Map(subtasks.map(item => [item.id, 0]));
  const edges = (dependencies || []).filter(edge => levels.has(edge.from) && levels.has(edge.to));
  for (let pass = 0; pass <= subtasks.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const candidate = levels.get(edge.from) + 1;
      if (candidate > levels.get(edge.to)) {
        levels.set(edge.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { levels, edges };
}

function renderGraphNodeDetail(detail, subtaskId) {
  const subtask = (detail.subtasks || []).find(item => item.id === subtaskId);
  if (!subtask) {
    elements['graph-node-detail'].innerHTML = '';
    return;
  }
  const agent = subtask.agent || {};
  const blocks = [
    `<div class="graph-node-detail-heading"><span class="eyebrow">${escapeHtml(subtask.id)}</span>
       <span class="status-pill ${statusClass(subtask.state)}">${escapeHtml(statusLabel(subtask.state))}</span>
       <button class="button ghost graph-node-close" type="button" aria-label="Close subtask detail">Close</button></div>`,
    `<p class="graph-node-detail-title">${escapeHtml(subtask.title || subtask.id)}</p>`,
    factBlock('Specification', subtask.spec),
    `<div class="graph-dependencies">Depends on: ${subtask.dependsOn?.length ? subtask.dependsOn.map(item => `<code>${escapeHtml(item)}</code>`).join(' ') : '<span>none</span>'}</div>`,
    `<div class="graph-node-meta"><span>Agent <strong>${escapeHtml(subtask.implementer || '—')}</strong></span><span>Adapter <strong>${escapeHtml(agent.adapter || '—')}</strong></span><span>Registered <strong>${agent.registered === true ? 'yes' : 'no'}</strong></span><span>Session <code>${escapeHtml(shortId(subtask.sessionId) || '—')}</code></span></div>`,
    factBlock('Executable', subtask.executable),
    factBlock('Worktree / branch / commit', { ...(subtask.worktree || {}), implementationCommit: subtask.implementationCommit }),
    factBlock('Evidence', subtask.evidence),
    factBlock('Scope audit', subtask.scopeAudit),
    factBlock('Recovery', subtask.recovery),
    factBlock('Cleanup', subtask.cleanup),
    factBlock('Last error', subtask.lastError),
  ];
  elements['graph-node-detail'].innerHTML = blocks.join('');
  elements['graph-node-detail'].querySelector('.graph-node-close')?.addEventListener('click', () => {
    state.selectedSubtask = null;
    renderGraphMap(detail);
  });
}

function renderGraphMap(detail) {
  state.graphDetail = detail;
  const subtasks = Array.isArray(detail?.subtasks) ? detail.subtasks : [];
  elements['graph-map-note'].textContent = '';
  if (!subtasks.length) {
    elements['graph-map'].innerHTML = '<div class="empty-state error-state">Task Graph record has no readable subtasks.</div>';
    elements['graph-node-detail'].innerHTML = '';
    return;
  }
  const { levels, edges } = graphNodeLevels(subtasks, detail.dependencies || []);
  const truncated = subtasks.length > GRAPH_MAP_MAX_NODES;
  const visible = truncated ? subtasks.slice(0, GRAPH_MAP_MAX_NODES) : subtasks;
  if (truncated) {
    elements['graph-map-note'].textContent = `Large graph: rendering the first ${GRAPH_MAP_MAX_NODES} of ${subtasks.length} subtasks in deterministic order; the complete bounded topology remains below.`;
  }

  const maxLevel = Math.max(0, ...visible.map(item => levels.get(item.id) || 0));
  const columns = [];
  for (let level = 0; level <= maxLevel; level += 1) {
    columns.push(visible.filter(item => (levels.get(item.id) || 0) === level));
  }
  const rowByLevel = new Map(columns.map((column, level) => [level, new Map(column.map((item, row) => [item.id, row]))]));
  const totalWidth = GRAPH_MAP_PAD * 2 + (maxLevel + 1) * GRAPH_MAP_NODE_W + maxLevel * GRAPH_MAP_GAP_X;
  const maxRows = Math.max(1, ...columns.map(column => column.length));
  const totalHeight = GRAPH_MAP_PAD * 2 + maxRows * GRAPH_MAP_NODE_H + (maxRows - 1) * GRAPH_MAP_GAP_Y;

  const nodeRect = new Map();
  const nodes = visible.map(item => {
    const level = levels.get(item.id) || 0;
    const row = rowByLevel.get(level).get(item.id);
    const x = GRAPH_MAP_PAD + level * (GRAPH_MAP_NODE_W + GRAPH_MAP_GAP_X);
    const y = GRAPH_MAP_PAD + row * (GRAPH_MAP_NODE_H + GRAPH_MAP_GAP_Y);
    nodeRect.set(item.id, { x, y });
    const selected = state.selectedSubtask === item.id;
    const edgeLabels = [];
    return `<button type="button" class="graph-map-node ${statusClass(item.state)}${selected ? ' selected' : ''}"
      data-subtask="${escapeHtml(item.id)}" style="left:${x}px;top:${y}px;width:${GRAPH_MAP_NODE_W}px;height:${GRAPH_MAP_NODE_H}px"
      aria-pressed="${selected}" aria-label="Subtask ${escapeHtml(item.id)}: ${escapeHtml(item.title || item.id)} (${escapeHtml(statusLabel(item.state))})">
      <span class="graph-map-node-title">${escapeHtml(item.title || item.id)}</span>
      <span class="graph-map-node-meta"><code>${escapeHtml(item.id)}</code><i class="state-dot ${statusClass(item.state)}"></i>${escapeHtml(statusLabel(item.state))}</span>
    </button>`;
  }).join('');

  const arrows = edges.map(edge => {
    const from = nodeRect.get(edge.from);
    const to = nodeRect.get(edge.to);
    if (!from || !to) return '';
    const x1 = from.x + GRAPH_MAP_NODE_W;
    const y1 = from.y + GRAPH_MAP_NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + GRAPH_MAP_NODE_H / 2;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="graph-map-edge" marker-end="url(#graph-map-arrow)"></line>`;
  }).join('');
  const edgeLayer = visible.length > 1 ? `
    <svg class="graph-map-edges" width="${totalWidth}" height="${totalHeight}" aria-hidden="true">
      <defs><marker id="graph-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
      ${arrows}
    </svg>` : '';

  elements['graph-map'].innerHTML = `<div class="graph-map-canvas" style="width:${totalWidth}px;height:${totalHeight}px">${edgeLayer}${nodes}</div>`;
  elements['graph-map'].querySelectorAll('[data-subtask]').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedSubtask = button.dataset.subtask;
      renderGraphMap(detail);
      renderGraphNodeDetail(detail, state.selectedSubtask);
    });
  });
  if (state.selectedSubtask && subtasks.some(item => item.id === state.selectedSubtask)) {
    renderGraphNodeDetail(detail, state.selectedSubtask);
  } else {
    elements['graph-node-detail'].innerHTML = '<div class="empty-state">Select a map node to inspect its bounded Runtime evidence.</div>';
  }
  elements['graph-map-region'].hidden = false;
}

function closeGraphMap() {
  state.selectedSubtask = null;
  if (state.graphDetail) renderGraphMap(state.graphDetail);
}

function renderGraphDetail(task) {
  const graph = Boolean(task?.graph);
  elements['graph-detail'].hidden = !graph;
  if (!graph) {
    for (const id of ['graph-topology', 'graph-frontier', 'graph-conflicts', 'graph-integration', 'graph-map', 'graph-node-detail']) elements[id].innerHTML = '';
    elements['graph-map-note'].textContent = '';
    elements['graph-map-region'].hidden = true;
    state.selectedSubtask = null;
    return;
  }
  elements['graph-map-region'].hidden = false;
  renderGraphLegend();
  renderGraphMap(task);
  const dependencies = task.dependencies || [];
  elements['graph-topology'].innerHTML = (task.subtasks || []).map(subtask => `
    <article class="graph-node">
      <div class="graph-node-heading">
        <div><span class="eyebrow">${escapeHtml(subtask.id)}</span><strong>${escapeHtml(subtask.title || subtask.id)}</strong></div>
        <span class="status-pill ${statusClass(subtask.state)}">${escapeHtml(statusLabel(subtask.state))}</span>
      </div>
      <div class="graph-dependencies">Depends on: ${subtask.dependsOn?.length ? subtask.dependsOn.map(item => `<code>${escapeHtml(item)}</code>`).join(' ') : '<span>none</span>'}</div>
      <div class="graph-node-meta">
        <span>Agent <strong>${escapeHtml(subtask.implementer)}</strong></span>
        <span>Adapter <strong>${escapeHtml(subtask.agent?.adapter || '—')}</strong></span>
        <span>Session <code>${escapeHtml(shortId(subtask.sessionId) || '—')}</code></span>
      </div>
      ${factBlock('Executable', subtask.executable)}
      ${factBlock('Worktree / branch / commit', { ...subtask.worktree, implementationCommit: subtask.implementationCommit })}
      ${factBlock('Evidence', subtask.evidence)}
      ${factBlock('Scope audit', subtask.scopeAudit)}
      ${factBlock('Recovery', subtask.recovery)}
      ${factBlock('Last error', subtask.lastError)}
    </article>
  `).join('') || '<div class="empty-state">No persisted subtasks.</div>';
  const edgeList = dependencies.length
    ? dependencies.map(edge => `<code>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</code>`).join(' ')
    : '<span>none</span>';
  elements['graph-topology'].insertAdjacentHTML('afterbegin', `<div class="graph-edge-list"><strong>Dependency edges</strong>${edgeList}</div>`);
  elements['graph-frontier'].innerHTML = [
    factBlock('Max concurrency', task.maxConcurrency),
    factBlock('Current frontier', task.frontier),
    factBlock('Selected preflight wave', task.wave),
  ].join('');
  elements['graph-conflicts'].innerHTML = [
    factBlock('Write-intent conflicts', task.conflicts),
    factBlock('Intent coverage', task.intentCoverage),
    factBlock('Recovery classifications', task.recovery),
  ].join('') || '<div class="empty-state">No conflict or scope facts recorded.</div>';
  elements['graph-integration'].innerHTML = [
    factBlock('Integration', task.integration),
    factBlock('Integration facts', task.integrationFacts),
    factBlock('Review', task.review),
    factBlock('Review history', task.reviewHistory),
  ].join('') || '<div class="empty-state">Integration and review have not been recorded.</div>';
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
    <span>${task.graph ? 'Task Graph' : `Round ${escapeHtml(task.round)}`}</span>
    <span>${escapeHtml(task.id)}</span>
    <span>Updated ${formatDate(task.updatedAt)}</span>
  `;
  renderGraphDetail(task);
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
    <div class="evidence-row"><span>${task.graph ? 'Base commit' : 'Commit'}</span><code>${escapeHtml(task.graph ? (task.baseCommit || '—') : (task.implementationCommit || '—'))}</code></div>
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
    state.selectedSubtask = null;
    state.graphDetail = null;
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
  state.selectedSubtask = null;
  state.graphDetail = null;
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
  try {
    state.repository = await fetchJson('/api/repository');
  } catch {
    state.repository = null;
  }
  renderRepository();
}

elements['refresh-button'].addEventListener('click', refresh);
elements['close-detail'].addEventListener('click', closeDetail);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeGraphMap();
});
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
