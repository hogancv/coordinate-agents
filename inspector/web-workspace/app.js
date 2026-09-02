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
  discovery: null,
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
  'discover-agents', 'agents-discovery', 'agent-configure', 'cfg-agent',
  'cfg-adapter', 'cfg-command', 'cfg-role', 'apply-agent', 'agent-status',
  'agent-id-options', 'configured-agents',
  'author-empty-agents', 'task-create-form', 'author-task-title', 'author-task-spec',
  'author-task-planner', 'author-task-implementer', 'author-task-reviewer', 'author-task-id',
  'author-task-submit', 'author-task-status', 'graph-create-form', 'author-graph-id',
  'author-graph-title', 'author-graph-spec', 'author-graph-planner', 'author-graph-reviewer',
  'author-graph-max', 'author-graph-intent', 'author-graph-scope', 'author-subtask-add',
  'author-subtask-rows', 'author-graph-validate', 'author-graph-create', 'author-graph-status',
  'author-graph-errors', 'author-graph-validated', 'author-graph-preflight',
  'execution-panel', 'execution-title', 'execution-controls', 'execution-status', 'execution-result',
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

function commandSourceClass(source) {
  const value = `${source || ''}`.toLowerCase();
  if (value.startsWith('project')) return 'project';
  if (value.startsWith('user')) return 'user';
  return 'adapter';
}

function setAgentStatus(message, kind = 'info') {
  const element = elements['agent-status'];
  element.textContent = message;
  element.className = `agent-status ${kind}`;
}

function escapeAgent(value) {
  return escapeHtml(value ?? '');
}

function fillConfigureForm(entry) {
  const agentId = entry.configuredAgent || entry.agent || entry.command || '';
  elements['cfg-agent'].value = agentId;
  elements['cfg-command'].value = entry.command || '';
  if (entry.adapter) elements['cfg-adapter'].value = entry.adapter;
  elements['cfg-role'].value = 'implementer';
  elements['agent-configure'].scrollIntoView({ behavior: 'smooth', block: 'center' });
  elements['cfg-agent'].focus();
}

function renderAgentsDiscovery(snapshot) {
  if (!snapshot) {
    elements['agents-discovery'].innerHTML = '<div class="empty-state">No discovery snapshot available.</div>';
    return;
  }
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const adapters = Array.isArray(snapshot.adapters) ? snapshot.adapters : [];
  const options = [];
  for (const agent of agents) {
    const identity = agent.configuredAgent || agent.command || '';
    if (identity) options.push(`<option value="${escapeHtml(identity)}"></option>`);
  }
  elements['agent-id-options'].innerHTML = options.join('');

  const agentRows = agents.map(agent => {
    const available = agent.available === true;
    const identity = agent.configuredAgent || agent.command || '?';
    return `<article class="agent-row">
      <div class="agent-row-main">
        <strong>${escapeAgent(identity)}</strong>
        <span class="status-pill ${available ? 'idle' : 'error'}">${available ? 'available' : 'unavailable'}</span>
        ${agent.configured ? '<span class="history-label">configured</span>' : ''}
        ${agent.adapter ? `<span class="agent-muted">adapter ${escapeAgent(agent.adapter)}</span>` : ''}
        ${agent.command ? `<span class="agent-muted">command <code>${escapeAgent(agent.command)}</code></span>` : ''}
      </div>
      <div class="agent-row-detail">${escapeAgent(agent.details || agent.code || '')}</div>
      <button class="button ghost agent-fill" type="button" data-json="${escapeHtml(JSON.stringify({ agent: identity, command: agent.command, adapter: agent.adapter || '' }))}">Configure this command</button>
    </article>`;
  }).join('') || '<div class="empty-state">No coding CLIs detected on this machine.</div>';

  const adapterBlocks = adapters.map(adapter => {
    const capabilities = Object.entries(adapter.capabilities || {})
      .filter(([, value]) => value === true)
      .map(([key]) => escapeHtml(key))
      .join(', ');
    const configured = (adapter.configuredAgents || []).map(item => `
      <div class="configured-agent-row">
        <code>${escapeAgent(item.id)}</code>
        <span class="agent-muted">adapter ${escapeAgent(item.adapter || adapter.id)}</span>
        <code>${escapeAgent(item.command || '—')}</code>
        <span class="source-badge ${commandSourceClass(item.commandSource)}">${escapeAgent(item.commandSource || 'adapter-default')}</span>
      </div>`).join('') || '<span class="agent-muted">not configured in this project</span>';
    return `<article class="adapter-card">
      <div class="adapter-card-heading">
        <strong>${escapeAgent(adapter.id)}</strong>
        <span class="history-label">${adapter.builtin ? 'built-in' : 'registered local adapter'}</span>
        <span class="agent-muted">contract v${escapeAgent(adapter.contractVersion)}</span>
      </div>
      <div class="agent-muted">${capabilities || 'no capabilities'}</div>
      <div class="configured-agents-list">${configured}</div>
    </article>`;
  }).join('');

  elements['agents-discovery'].innerHTML = `
    <div class="discovery-grid">
      <div><h3>Detected coding CLIs</h3><div class="discovery-list">${agentRows}</div></div>
      <div><h3>Adapters & command sources</h3><div class="discovery-list">${adapterBlocks || '<div class="empty-state">No adapters registered.</div>'}</div></div>
    </div>`;
  elements['agents-discovery'].querySelectorAll('.agent-fill').forEach(button => {
    button.addEventListener('click', () => {
      try { fillConfigureForm(JSON.parse(button.dataset.json)); } catch { /* ignore malformed presets */ }
    });
  });
}

function renderConfiguredAgents(agents) {
  const list = Array.isArray(agents) ? agents : [];
  if (list.length === 0) {
    elements['configured-agents'].innerHTML = '<div class="empty-state">No Agents are registered in this repository yet.</div>';
    return;
  }
  elements['configured-agents'].innerHTML = list.map(agent => `
    <article class="configured-agent">
      <div class="configured-agent-head">
        <strong>${escapeAgent(agent.id)}</strong>
        <span class="status-pill ${statusClass(agent.status)}">${escapeAgent(statusLabel(agent.status))}</span>
      </div>
      <div class="configured-agent-facts">
        <span>adapter <code>${escapeAgent(agent.adapter || '—')}</code></span>
        <span>roles <code>${escapeAgent(agent.roles?.join(', ') || 'unassigned')}</code></span>
        <span>queue ${escapeAgent(agent.queue?.new || 0)} new · ${escapeAgent(agent.queue?.processing || 0)} processing</span>
      </div>
      ${agent.lastActivity ? `<div class="agent-muted">last activity ${escapeAgent(agent.lastActivity)}</div>` : ''}
    </article>`).join('');
}

function authorAgentIds() {
  return Array.isArray(state.agents) ? state.agents.map(agent => agent.id).filter(Boolean) : [];
}

function refreshAgentSelects() {
  const ids = authorAgentIds();
  elements['author-empty-agents'].hidden = ids.length > 0;
  const selects = [
    'author-task-planner', 'author-task-implementer', 'author-task-reviewer',
    'author-graph-planner', 'author-graph-reviewer',
  ];
  const options = ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
  for (const name of selects) {
    const element = elements[name];
    if (!element) continue;
    const previous = element.value;
    element.innerHTML = options || '<option value="">(no agents configured)</option>';
    if (previous && ids.includes(previous)) element.value = previous;
    else if (element.name === 'implementer' && ids.includes('antigravity')) element.value = 'antigravity';
  }
  document.querySelectorAll('[data-implementer-select]').forEach(select => {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = options || '<option value="">(no agents configured)</option>';
    if (previous && ids.includes(previous)) select.value = previous;
  });
}

function addSubtaskRow(preset = {}) {
  const row = document.createElement('div');
  row.className = 'subtask-row';
  row.innerHTML = `
    <label>ID<input class="sub-id" maxlength="64" placeholder="sub-a" value="${escapeHtml(preset.id || '')}"></label>
    <label>Title<input class="sub-title" maxlength="1024" placeholder="${escapeHtml(preset.title || '')}"></label>
    <label>Implementer<select class="sub-implementer" data-implementer-select></select></label>
    <label>Spec<input class="sub-spec" maxlength="262144" placeholder="What this subtask must change"></label>
    <label>Depends on<input class="sub-depends" maxlength="1024" placeholder="sub-a sub-b (ids)"></label>
    <label>Write intent (optional)<input class="sub-intent" maxlength="2048" placeholder="src/a/** docs/a/**"></label>
    <button class="button ghost sub-remove" type="button" aria-label="Remove subtask">Remove</button>`;
  row.querySelector('.sub-remove').addEventListener('click', () => row.remove());
  elements['author-subtask-rows'].appendChild(row);
  refreshAgentSelects();
  return row;
}

function readSubtaskRows() {
  return [...elements['author-subtask-rows'].querySelectorAll('.subtask-row')].map(row => {
    const splitList = value => (value || '').split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
    return {
      id: row.querySelector('.sub-id').value.trim(),
      title: row.querySelector('.sub-title').value.trim(),
      implementer: row.querySelector('.sub-implementer').value,
      spec: row.querySelector('.sub-spec').value.trim(),
      dependsOn: splitList(row.querySelector('.sub-depends').value),
      writeIntent: splitList(row.querySelector('.sub-intent').value),
    };
  });
}

function setGraphStatus(message, kind = 'info') {
  const element = elements['author-graph-status'];
  element.textContent = message;
  element.className = `author-status ${kind}`;
}

function graphInputs() {
  const parentId = elements['author-graph-id'].value.trim();
  const subtasks = readSubtaskRows();
  const intentEnabled = elements['author-graph-intent'].checked;
  const parentTask = {
    id: parentId,
    title: elements['author-graph-title'].value.trim(),
    planner: elements['author-graph-planner'].value,
    reviewer: elements['author-graph-reviewer'].value,
  };
  const spec = elements['author-graph-spec'].value.trim();
  if (spec) parentTask.spec = spec;
  const graph = {
    schemaVersion: 1,
    parentTask,
    subtasks: subtasks.map(item => {
      const subtask = {
        id: item.id,
        implementer: item.implementer,
        spec: item.spec,
        dependsOn: item.dependsOn,
      };
      if (item.title) subtask.title = item.title;
      return subtask;
    }),
    maxConcurrency: Math.max(1, Math.min(32, Number(elements['author-graph-max'].value) || 1)),
  };
  let intentMap = null;
  if (intentEnabled) {
    intentMap = {
      schemaVersion: 1,
      parentTaskId: parentId,
      scopePolicy: elements['author-graph-scope'].value || 'warn',
      subtasks: subtasks.map(item => ({ id: item.id, writeIntent: item.writeIntent })),
    };
  }
  return { graph, intentMap, parentId };
}

function renderActionError(container, payload) {
  const error = payload?.error || {};
  container.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.code || 'ACTION_FAILED')} — ${escapeHtml(error.message || 'Request failed.')}${error.details ? `<div>${escapeHtml(error.details)}</div>` : ''}</div>`;
  container.hidden = false;
}

async function validateGraphNow() {
  elements['author-graph-errors'].hidden = true;
  elements['author-graph-validated'].hidden = true;
  const { graph, intentMap } = graphInputs();
  if (!graph.parentTask.title || !graph.subtasks.length) {
    setGraphStatus('Graph title, parent ID, and at least one subtask are required.', 'error');
    return;
  }
  setGraphStatus('Validating…');
  try {
    const { status, payload } = await postAction('taskGraphValidate', {
      graph,
      ...(intentMap ? { intentMap } : {}),
    });
    if (status !== 200 || payload?.ok !== true) {
      renderActionError(elements['author-graph-errors'], payload);
      setGraphStatus('Validation failed.', 'error');
      return;
    }
    elements['author-graph-validated'].innerHTML = `<div class="author-ok-banner">Graph validates: ${escapeHtml(payload.subtaskCount ?? payload.subtasks?.length ?? 'ok')} subtask(s) · ${payload.missingIntentCoverage ? 'intent coverage missing (unverified)' : 'intent facts present'} · scope ${escapeHtml(payload.scopePolicy || payload.intentCoverage?.scopePolicy || '—')}</div>`;
    elements['author-graph-validated'].hidden = false;
    setGraphStatus('Validation passed. Review Preflight after creating, or fix the form.', 'ok');
  } catch (error) {
    setGraphStatus(`Validation request failed: ${error.message}`, 'error');
  }
}

async function showGraphPreflight(taskId) {
  const region = elements['author-graph-preflight'];
  region.hidden = false;
  region.innerHTML = '<div class="empty-state">Loading Graph Preflight…</div>';
  try {
    const { status, payload } = await postAction('taskGraphPlan', { taskId });
    if (status !== 200 || payload?.ok !== true) {
      region.innerHTML = `<div class="empty-state error-state">Preflight unavailable: ${escapeHtml(payload?.error?.message || `HTTP ${status}`)}</div>`;
      return;
    }
    const plan = payload.plan && typeof payload.plan === 'object' ? payload.plan : {};
    region.innerHTML = `
      <h3>Graph Preflight</h3>
      <div class="preflight-grid">
        ${factBlock('Frontier', payload.frontier)}
        ${factBlock('Selected wave', plan.wave)}
        ${factBlock('Write-intent conflicts', plan.conflicts)}
        ${factBlock('Intent coverage', plan.intentCoverage || payload.intentCoverage)}
        ${factBlock('Scope policy', plan.scopePolicy || payload.scopePolicy)}
        ${factBlock('Risks', plan.risks)}
        ${factBlock('Estimated resources', plan.resourceEstimates)}
      </div>`;
  } catch (error) {
    region.innerHTML = `<div class="empty-state error-state">Preflight request failed: ${escapeHtml(error.message)}</div>`;
  }
}

async function createGraphNow() {
  const { graph, intentMap, parentId } = graphInputs();
  if (!graph.parentTask.id || !graph.parentTask.title || !graph.subtasks.length) {
    setGraphStatus('Parent ID, title, and at least one subtask are required.', 'error');
    return;
  }
  setGraphStatus('Creating the validated Runtime record (no dispatch)…');
  elements['author-graph-create'].disabled = true;
  try {
    const { status, payload } = await postAction('taskGraphCreate', {
      graph,
      ...(intentMap ? { intentMap } : {}),
    });
    if (status !== 200 || payload?.ok !== true) {
      renderActionError(elements['author-graph-errors'], payload);
      setGraphStatus('Create failed.', 'error');
      return;
    }
    setGraphStatus(`Created ${payload.parentTaskId || payload.graphId} (state ${escapeHtml(payload.state || payload.status || 'CREATED')}). Loading Preflight…`, 'ok');
    await showGraphPreflight(payload.parentTaskId || payload.graphId || parentId);
    await refresh();
  } catch (error) {
    setGraphStatus(`Create request failed: ${error.message}`, 'error');
  } finally {
    elements['author-graph-create'].disabled = false;
  }
}

async function createSingleTask(event) {
  event.preventDefault();
  const params = {
    title: elements['author-task-title'].value.trim(),
    spec: elements['author-task-spec'].value.trim() || undefined,
    planner: elements['author-task-planner'].value || undefined,
    implementer: elements['author-task-implementer'].value || undefined,
    reviewer: elements['author-task-reviewer'].value || undefined,
  };
  const id = elements['author-task-id'].value.trim();
  if (id) params.id = id;
  if (!params.title) {
    elements['author-task-status'].textContent = 'Task title is required.';
    elements['author-task-status'].className = 'author-status error';
    return;
  }
  elements['author-task-status'].textContent = 'Creating Task…';
  try {
    const { status, payload } = await postAction('taskCreate', params);
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      elements['author-task-status'].textContent = `Create failed: ${error.code || `HTTP ${status}`} — ${error.message || ''}`;
      elements['author-task-status'].className = 'author-status error';
      return;
    }
    elements['author-task-status'].textContent = `Created ${payload.task?.id || payload.id || params.title}.`;
    elements['author-task-status'].className = 'author-status ok';
    elements['author-task-id'].value = '';
    elements['author-task-title'].value = '';
    await refresh();
  } catch (error) {
    elements['author-task-status'].textContent = `Create request failed: ${error.message}`;
    elements['author-task-status'].className = 'author-status error';
  }
}

async function discoverAgents() {
  setAgentStatus('Discovering local coding CLIs…');
  try {
    const { status, payload } = await postAction('setupDiscover', {});
    if (status !== 200 || payload?.ok !== true) {
      const code = payload?.error?.code || `HTTP ${status}`;
      elements['agents-discovery'].innerHTML = `<div class="empty-state error-state">Discovery failed (${escapeHtml(code)}): ${escapeHtml(payload?.error?.message || 'unknown error')}</div>`;
      setAgentStatus('Discovery failed.', 'error');
      return;
    }
    state.discovery = payload;
    renderAgentsDiscovery(payload);
    setAgentStatus('Discovery complete. Configure a command below or pick “Configure this command”.', 'ok');
  } catch (error) {
    setAgentStatus(`Discovery request failed: ${error.message}`, 'error');
  }
}

async function applyAgentConfigure(event) {
  event.preventDefault();
  const params = {
    agent: elements['cfg-agent'].value.trim(),
    adapter: elements['cfg-adapter'].value,
    command: elements['cfg-command'].value.trim(),
    role: elements['cfg-role'].value,
  };
  if (!params.agent || !params.command) {
    setAgentStatus('Agent ID and executable command are required.', 'error');
    return;
  }
  setAgentStatus('Applying configuration…');
  elements['apply-agent'].disabled = true;
  try {
    const { status, payload } = await postAction('setupConfigure', params);
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      setAgentStatus(`Configuration failed: ${error.code || `HTTP ${status}`} — ${error.message || 'unknown error'}${error.details ? ` (${error.details})` : ''}`, 'error');
      return;
    }
    const configured = payload.agent || {};
    setAgentStatus(`Configured ${configured.id} (${configured.adapter}) → ${configured.command} [${configured.commandSource}] · workflow ${Object.keys(payload.workflow || {}).join(', ')}`, 'ok');
    await discoverAgents();
    await refresh();
  } catch (error) {
    setAgentStatus(`Configuration request failed: ${error.message}`, 'error');
  } finally {
    elements['apply-agent'].disabled = false;
  }
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
      ${['starting', 'running', 'idle', 'busy'].includes(session.status) ? `
      <div class="session-controls">
        <form class="session-input-form" data-session="${escapeHtml(session.sessionId)}">
          <input class="session-input-text" maxlength="4096" placeholder="Bounded input to this owned Session…">
          <button class="button" type="submit">Send input</button>
        </form>
        <button class="button ghost session-close-btn" type="button" data-session="${escapeHtml(session.sessionId)}">Close Session</button>
      </div>` : ''}
      <span class="session-control-status" data-session="${escapeHtml(session.sessionId)}" aria-live="polite"></span>
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

function recoveryControls(detail) {
  const graph = Boolean(detail?.graph);
  const state = detail?.state || detail?.status;
  const buttons = [];
  const add = (action, label, taskId, extra = '') => buttons.push(
    `<button class="button ghost" type="button" data-run-action="${action}" data-label="${escapeHtml(label)}" data-params="${escapeHtml(JSON.stringify({ taskId: taskId || detail.id }))}">${escapeHtml(label)}</button>${extra}`);
  if (!graph) {
    if (['IMPLEMENTING', 'WAITING_IMPLEMENTER'].includes(state)) add('taskStop', 'Stop Task', detail.id);
    if (['ERROR', 'STOPPED'].includes(state)) add('taskResume', 'Resume Task', detail.id);
  } else {
    const note = `<span class="agent-muted">state ${escapeHtml(state || 'unknown')}</span>`;
    if (state === 'RUNNING') add('taskGraphStop', 'Stop graph', detail.id, note);
    if (['FAILED', 'RECOVERING'].includes(state)) add('taskGraphRecover', 'Recover graph', detail.id, note);
    if (['FAILED', 'STOPPED', 'BLOCKED', 'RECOVERING'].includes(state)) add('taskGraphResume', 'Resume graph', detail.id, note);
    if (['STOPPED', 'FAILED', 'SUCCEEDED', 'APPROVED'].includes(state)) add('taskGraphCleanup', 'Clean up worktrees', detail.id, note);
    if (!buttons.length) return `<span class="agent-muted">${escapeHtml(state || '')} — no automatic recovery action; review the Runtime facts and act explicitly.</span>`;
  }
  return buttons.length ? `<span class="recovery-sep">Recovery & ownership</span>${buttons.join(' ')}` : '';
}

function setSessionControlStatus(sessionId, message, kind = 'info') {
  const target = elements.sessions.querySelector(`.session-control-status[data-session="${CSS.escape(sessionId)}"]`);
  if (!target) return;
  target.textContent = message;
  target.className = `session-control-status ${kind}`;
}

async function submitSessionInput(form) {
  const sessionId = form.dataset.session;
  const input = form.querySelector('.session-input-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  setSessionControlStatus(sessionId, 'Sending bounded input…');
  try {
    const { status, payload } = await postAction('sessionWrite', { sessionId, input: text });
    if (status !== 200 || payload?.ok !== true) {
      setSessionControlStatus(sessionId, `Input rejected: ${payload?.error?.code || `HTTP ${status}`} — ${payload?.error?.message || ''}`, 'error');
      return;
    }
    setSessionControlStatus(sessionId, 'Input accepted.', 'ok');
    await refresh();
  } catch (error) {
    setSessionControlStatus(sessionId, `Input failed: ${error.message}`, 'error');
  }
}

async function closeOwnedSession(sessionId) {
  setSessionControlStatus(sessionId, 'Closing Session…');
  try {
    const { status, payload } = await postAction('sessionClose', { sessionId });
    if (status !== 200 || payload?.ok !== true) {
      setSessionControlStatus(sessionId, `Close rejected: ${payload?.error?.code || `HTTP ${status}`} — ${payload?.error?.message || ''}`, 'error');
      return;
    }
    setSessionControlStatus(sessionId, 'Session closed.', 'ok');
    await refresh();
  } catch (error) {
    setSessionControlStatus(sessionId, `Close failed: ${error.message}`, 'error');
  }
}

function bindSessionActions(container) {
  if (!container) return;
  container.querySelectorAll('.session-input-form').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      submitSessionInput(form);
    });
  });
  container.querySelectorAll('.session-close-btn').forEach(button => {
    button.addEventListener('click', () => closeOwnedSession(button.dataset.session));
  });
}

function setExecutionStatus(message, kind = 'info') {
  const element = elements['execution-status'];
  element.textContent = message;
  element.className = `author-status ${kind}`;
}

function renderExecutionResult(label, payload) {
  const region = elements['execution-result'];
  region.hidden = false;
  if (!payload || payload.ok !== true) {
    const error = payload?.error || {};
    region.innerHTML = `<div class="empty-state error-state"><strong>${escapeHtml(label)} failed</strong> — ${escapeHtml(error.code || 'ACTION_FAILED')}: ${escapeHtml(error.message || 'Request failed.')}${error.details ? `<div class="execution-detail">${escapeHtml(error.details)}</div>` : ''}</div>`;
    setExecutionStatus(`${label} failed (${error.code || 'error'}). Refreshing authoritative Runtime state…`, 'error');
    return;
  }
  const pick = keys => keys.map(key => payload[key]).find(value => value !== undefined && value !== null && value !== '');
  const facts = [];
  const show = (labelText, value) => {
    if (value !== undefined && value !== null && value !== '') facts.push(`<div class="execution-fact"><span>${escapeHtml(labelText)}</span><code>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</code></div>`);
  };
  show('Task / parent', pick(['taskId', 'parentTaskId', 'id']));
  show('Subtasks', payload.subtaskIds || payload.subtasks?.length);
  show('State', pick(['state', 'status']));
  show('Session', pick(['sessionId', 'sessions']) && !Array.isArray(payload.sessions) ? pick(['sessionId']) : Array.isArray(payload.sessions) ? payload.sessions.length : undefined);
  show('Commit', pick(['implementationCommit', 'commit', 'aggregateCommit']));
  show('Waves executed', payload.wavesExecuted || payload.waveCount);
  show('Stop reason', payload.stopReason);
  show('Agent', pick(['agent', 'implementer']));
  region.innerHTML = `<div class="execution-ok"><strong>${escapeHtml(label)} completed</strong><div class="execution-facts">${facts.join('') || '<div class="agent-muted">(no identity facts returned)</div>'}</div>${payload.error ? `<div class="execution-detail">${escapeHtml(payload.error.message || '')}</div>` : ''}</div>`;
  setExecutionStatus(`${label} completed. Refreshing views…`, 'ok');
}

async function runExecutionAction(actionName, params, label) {
  setExecutionStatus(`${label}: executing…`);
  const region = elements['execution-result'];
  region.hidden = true;
  try {
    const { status, payload } = await postAction(actionName, params);
    renderExecutionResult(label, status === 200 ? payload : { ok: false, error: { code: `HTTP ${status}`, message: payload?.error?.message || payload?.error || 'Request failed.' } });
  } catch (error) {
    setExecutionStatus(`${label} request failed: ${error.message}`, 'error');
  }
  await refresh();
}

function executionConfirmRow(labelText) {
  return `<label class="author-toggle execution-confirm-row"><input type="checkbox" class="execution-confirm" data-action-confirm> ${escapeHtml(labelText)}</label>`;
}

function bindExecutionControls(container, detail) {
  const confirm = container.querySelector('.execution-confirm');
  const runButtons = container.querySelectorAll('[data-run-action]');
  const update = () => {
    const armed = confirm ? confirm.checked : true;
    runButtons.forEach(button => { button.disabled = !armed; });
  };
  confirm?.addEventListener('change', update);
  update();
  runButtons.forEach(button => {
    button.addEventListener('click', async () => {
      if (confirm && !confirm.checked) return;
      button.disabled = true;
      try {
        await runExecutionAction(button.dataset.runAction, JSON.parse(button.dataset.params || '{}'), button.dataset.label || 'Execution');
      } finally {
        if (confirm) confirm.checked = false;
        button.disabled = false;
      }
    });
  });
}

function renderExecution(detail) {
  const panel = elements['execution-panel'];
  if (!detail) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  elements['execution-result'].hidden = true;
  setExecutionStatus('');
  const graph = Boolean(detail.graph);
  elements['execution-title'].textContent = graph ? `Execution · ${detail.title || detail.id}` : `Execution · ${detail.title || detail.id}`;
  const confirmText = 'I understand: this explicitly launches an Agent process that may write to the repository; failures are never retried automatically and no merge, push, tag, publish, deploy, or release occurs.';
  const id = detail.id;
  let controls = '';
  if (!graph) {
    const dispatchable = ['CREATED', 'PLANNING', 'SPEC_READY', 'CHANGES_REQUESTED'].includes(detail.status);
    controls = `
      ${executionConfirmRow(confirmText)}
      <button class="button" type="button" data-run-action="taskDispatch" data-label="Dispatch ${escapeHtml(id)}" data-params="${escapeHtml(JSON.stringify({ taskId: id }))}" ${dispatchable ? '' : 'disabled title="Current status prevents dispatch; the Runtime will still validate"'}>Dispatch task</button>
      ${dispatchable ? '' : `<span class="agent-muted">status ${escapeHtml(detail.status)} — dispatch applies to created / planning / spec-ready / changes-requested Tasks with a specification.</span>`}`;
  } else {
    controls = `
      ${executionConfirmRow(confirmText)}
      <label class="execution-field">Session wait (ms, 0–10000)<input type="number" class="execution-session-wait" min="0" max="10000" value="2000"></label>
      <button class="button" type="button" data-run-action="taskGraphRun" data-label="Run eligible wave of ${escapeHtml(id)}">Run eligible wave</button>
      <label class="execution-field">maxWaves (1–32)<input type="number" class="execution-max-waves" min="1" max="32" value="1"></label>
      <button class="button" type="button" data-run-action="taskGraphAdvance" data-label="Advance ${escapeHtml(id)}">Advance graph</button>`;
  }
  elements['execution-controls'].innerHTML = controls + recoveryControls(detail);
  const waitInput = elements['execution-controls'].querySelector('.execution-session-wait');
  const wavesInput = elements['execution-controls'].querySelector('.execution-max-waves');
  if (waitInput) {
    elements['execution-controls'].querySelectorAll('[data-run-action="taskGraphRun"]').forEach(button => {
      button.dataset.params = JSON.stringify({ taskId: id, sessionWaitMs: Number(waitInput.value) || 0 });
    });
    waitInput.addEventListener('input', () => {
      elements['execution-controls'].querySelectorAll('[data-run-action="taskGraphRun"]').forEach(button => {
        button.dataset.params = JSON.stringify({ taskId: id, sessionWaitMs: Number(waitInput.value) || 0 });
      });
    });
  }
  if (wavesInput) {
    const updateAdvance = () => {
      elements['execution-controls'].querySelectorAll('[data-run-action="taskGraphAdvance"]').forEach(button => {
        button.dataset.params = JSON.stringify({ taskId: id, maxWaves: Math.max(1, Math.min(32, Number(wavesInput.value) || 1)), sessionWaitMs: Number(waitInput?.value) || 0 });
      });
    };
    updateAdvance();
    wavesInput.addEventListener('input', updateAdvance);
    waitInput?.addEventListener('input', updateAdvance);
  }
  bindExecutionControls(elements['execution-controls'], detail);
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
    renderExecution(null);
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
  renderExecution(task);
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
    renderConfiguredAgents(state.agents);
    refreshAgentSelects();
    renderSessions();
    bindSessionActions(elements.sessions);
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
elements['discover-agents'].addEventListener('click', discoverAgents);
elements['agent-configure'].addEventListener('submit', applyAgentConfigure);
elements['author-subtask-add'].addEventListener('click', () => addSubtaskRow());
elements['author-graph-validate'].addEventListener('click', validateGraphNow);
elements['author-graph-create'].addEventListener('click', createGraphNow);
elements['task-create-form'].addEventListener('submit', createSingleTask);
elements['author-graph-intent'].addEventListener('change', event => {
  elements['author-graph-scope'].disabled = !event.target.checked;
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeGraphMap();
});
addSubtaskRow({ id: 'sub-a' });
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
