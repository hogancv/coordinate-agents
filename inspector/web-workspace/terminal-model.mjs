/**
 * Pure selection helpers for the Workspace Agent terminal view.
 *
 * The browser owns terminal rendering and cursors; this module only maps the
 * authoritative Agent/Session summaries into two deterministic pane models.
 */

export const TERMINAL_PANE_COUNT = 2;
export const TERMINAL_MAX_LINES = 200;
export const TERMINAL_MAX_BYTES = 32 * 1024;
export const TERMINAL_POLL_MS = 500;

const ACTIVE_SESSION_STATES = new Set(['starting', 'running', 'idle', 'busy']);

function text(value) {
  return typeof value === 'string' ? value : `${value ?? ''}`;
}

function agentIdOf(agent) {
  const id = text(agent?.id || agent?.agent).trim();
  return id || null;
}

function sessionIdOf(session) {
  const id = text(session?.sessionId || session?.id).trim();
  return id || null;
}

function sessionAgentOf(session) {
  const agent = text(session?.agent).trim();
  return agent || null;
}

function activityValue(session) {
  const value = Date.parse(session?.lastActivity || session?.lastActivityAt || session?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function uniqueAgents(agents) {
  const seen = new Set();
  return (Array.isArray(agents) ? agents : []).filter(agent => {
    const id = agentIdOf(agent);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function taskSessionId(task) {
  if (!task || task.graph) return null;
  return sessionIdOf({ sessionId: task.sessionId });
}

function taskAgentId(task, sessions) {
  const id = taskSessionId(task);
  if (id) {
    const session = (Array.isArray(sessions) ? sessions : []).find(item => sessionIdOf(item) === id);
    const agent = sessionAgentOf(session);
    if (agent) return agent;
  }
  const implementer = text(task?.implementer).trim();
  return implementer || null;
}

function latestSessionForAgent(sessions, agentId) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter(session => sessionAgentOf(session) === agentId && sessionIdOf(session))
    .sort((left, right) => activityValue(right) - activityValue(left))[0] || null;
}

function currentTaskSession(sessions, task, agentId) {
  const id = taskSessionId(task);
  if (!id) return null;
  return (Array.isArray(sessions) ? sessions : [])
    .find(session => sessionIdOf(session) === id && sessionAgentOf(session) === agentId) || null;
}

/**
 * Select exactly two deterministic terminal panes.
 *
 * A current Task session is preferred, but a fallback session is explicitly
 * marked as `latest` so the UI never presents unrelated output as Task output.
 */
export function selectTerminalPanes({ agents = [], sessions = [], task = null, count = TERMINAL_PANE_COUNT } = {}) {
  const configured = uniqueAgents(agents);
  const preferredId = taskAgentId(task, sessions);
  const ordered = preferredId
    ? [...configured.filter(agent => agentIdOf(agent) === preferredId), ...configured.filter(agent => agentIdOf(agent) !== preferredId)]
    : configured;
  const slots = Math.max(0, Number.isInteger(count) ? count : TERMINAL_PANE_COUNT);

  return Array.from({ length: slots }, (_, slot) => {
    const agent = ordered[slot] || null;
    const agentId = agentIdOf(agent);
    if (!agentId) {
      return {
        slot,
        agentId: null,
        agent: null,
        session: null,
        sessionId: null,
        source: 'none',
      };
    }
    const taskSession = currentTaskSession(sessions, task, agentId);
    const session = taskSession || latestSessionForAgent(sessions, agentId);
    return {
      slot,
      agentId,
      agent,
      session,
      sessionId: sessionIdOf(session),
      source: taskSession ? 'task' : session ? 'latest' : 'none',
    };
  });
}

export function isActiveTerminalSession(session) {
  return ACTIVE_SESSION_STATES.has(text(session?.status || session?.state).toLowerCase());
}

export function terminalSessionKey(pane) {
  return [pane?.slot ?? '', pane?.agentId || '', pane?.sessionId || '', pane?.source || 'none'].join(':');
}
