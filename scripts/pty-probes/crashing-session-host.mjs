import '../../skills/coordinate-agents/scripts/session-host.mjs';
if (process.env.COORDINATE_AGENTS_PROBE_DISABLE_MONITOR === '1') process.removeAllListeners('uncaughtExceptionMonitor');
setTimeout(() => { throw Object.assign(new Error('private-secret-value'), { code: 'PRIVATE_SECRET_VALUE' }); }, 3000);
