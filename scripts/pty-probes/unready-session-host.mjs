// Deliberately never binds an endpoint, to exercise bounded startup cleanup.
process.on('message', () => { process.disconnect(); });
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
