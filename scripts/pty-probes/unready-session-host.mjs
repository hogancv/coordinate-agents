// Deliberately never binds an endpoint, to exercise bounded startup cleanup.
process.on('message', () => { process.disconnect(); });
// Windows force cleanup uses taskkill, rather than a catchable Unix signal.
if (process.platform !== 'win32') process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
