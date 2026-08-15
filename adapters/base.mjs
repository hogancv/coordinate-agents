export const NORMALIZED_STATUSES = Object.freeze({
  IDLE: 'idle',
  WORKING: 'working',
  COMPLETED: 'completed',
  FAILED: 'failed',
  WAITING: 'waiting',
});

export class AgentAdapter {
  static STATUSES = NORMALIZED_STATUSES;

  constructor(config = {}) {
    this.config = Object.freeze({ ...config });
    this.name = config.adapter || config.name || 'base';
    this.state = { status: NORMALIZED_STATUSES.IDLE, details: null, lastUpdated: null };
  }

  detect() {
    throw new Error('detect() must be implemented by adapter subclass');
  }

  resolveLaunch(_context) {
    throw new Error('resolveLaunch() must be implemented by adapter subclass');
  }

  launchPolicy() {
    return { mode: 'one-shot' };
  }

  resumePrompt({ agentId }) {
    return `Invoke the installed coordinate-cli-agents skill and resume the existing collaboration as registered Agent ${agentId}. Inspect the project-local Agent Bus, process pending work, report results through the Bus, and preserve claim/complete semantics.`;
  }

  dispatch(_message, _context = {}) {
    throw new Error('dispatch() is not supported by this adapter');
  }

  observeStatus(_context = {}) {
    return this.state;
  }

  retrieveResult(_context = {}) {
    return { success: false, output: null, error: 'No result available' };
  }

  reportState(state, details = null) {
    const validStatuses = Object.values(NORMALIZED_STATUSES);
    if (!validStatuses.includes(state)) {
      throw new Error(`Invalid normalized status: "${state}". Must be one of: ${validStatuses.join(', ')}`);
    }
    this.state = { status: state, details, lastUpdated: new Date().toISOString() };
    return this.state;
  }

  cleanup(_context = {}) {
    return { cleaned: true };
  }

  capabilities() {
    return {
      name: this.name,
      launch: false,
      detect: false,
      dispatch: false,
      observe: true,
      result: false,
      report: true,
      cleanup: true,
      supportsHeadless: false,
      supportsInteractive: true,
      supportsStateReporting: true,
      launchPolicy: this.launchPolicy().mode,
    };
  }
}
