/**
 * Pure selection helpers for the Workspace dual-terminal view.
 *
 * A pane is valid only when its Session ID is present in the selected
 * Workspace Task record.  In particular, this module never searches the
 * global Session list for a convenient fallback.
 */

export const TERMINAL_PANE_COUNT = 2;
export const TERMINAL_MAX_LINES = 200;
export const TERMINAL_MAX_BYTES = 32 * 1024;
export const TERMINAL_POLL_MS = 500;
export const WORKSPACE_TERMINAL_SLOTS = Object.freeze([
  Object.freeze({ slot: 'codex', agentId: 'codex', role: 'planner-reviewer', label: 'Codex' }),
  Object.freeze({ slot: 'antigravity', agentId: 'antigravity', role: 'implementer', label: 'Antigravity' }),
]);
const CUSTOM_TERMINAL_SLOTS = Object.freeze(['terminal1', 'terminal2'].map((slot, index) => Object.freeze({ slot, agentId: 'workspace-custom', role: 'custom', label: `Terminal ${index + 1}` })));

const ACTIVE_SESSION_STATES = new Set(['starting', 'running', 'idle', 'busy']);

function text(value) {
  return typeof value === 'string' ? value : `${value ?? ''}`;
}

function sessionIdOf(session) {
  const id = text(session?.sessionId || session?.id).trim();
  return id || null;
}

/**
 * Select the fixed Codex + Antigravity pair from one Workspace Task record.
 * Missing Session IDs remain empty panes; no unrelated task can appear here.
 */
export function selectTerminalPanes({ workspaceTask = null, pair = null, count = TERMINAL_PANE_COUNT } = {}) {
  const sourceTask = workspaceTask || pair || null;
  const slots = Math.max(0, Math.min(
    TERMINAL_PANE_COUNT,
    Number.isInteger(count) ? count : TERMINAL_PANE_COUNT,
  ));
  return (sourceTask?.mode === 'custom' ? CUSTOM_TERMINAL_SLOTS : WORKSPACE_TERMINAL_SLOTS).slice(0, slots).map((definition, slot) => {
    const stored = sourceTask?.sessions?.[definition.slot] || null;
    const session = stored?.session || stored;
    const sessionId = sessionIdOf(session);
    return {
      slot,
      slotId: definition.slot,
      agentId: definition.agentId,
      role: definition.role,
      label: definition.label,
      command: sourceTask?.custom?.[definition.slot]?.command || null,
      agent: { id: definition.agentId, role: definition.role },
      session,
      sessionId,
      source: sessionId ? 'workspace-task' : 'none',
    };
  });
}

export function isActiveTerminalSession(session) {
  return ACTIVE_SESSION_STATES.has(text(session?.status || session?.state).toLowerCase());
}

export function terminalSessionKey(pane) {
  return [pane?.slotId ?? pane?.slot ?? '', pane?.agentId || '', pane?.sessionId || '', pane?.source || 'none'].join(':');
}

export function terminalBackendKey(session) {
  if (session?.backend === 'node-pty') return 'terminal.nativeBackend';
  if (session?.backend === 'stdio-fallback') return 'terminal.fallbackBackend';
  return 'terminal.unknownBackend';
}
