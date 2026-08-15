export class AgentAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  detect() {
    return { available: false, details: 'Detection not implemented' };
  }

  resolveLaunch(_context) {
    throw new Error('Launch not implemented for this adapter');
  }

  capabilities() {
    return {
      launch: false,
      detect: false,
      dispatch: false,
    };
  }
}
