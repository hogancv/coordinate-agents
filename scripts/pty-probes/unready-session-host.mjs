// Deliberately never binds an endpoint, to exercise bounded startup cleanup.
// Windows force cleanup uses taskkill, rather than a catchable Unix signal.
if (process.platform !== 'win32') process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
// Match the real Host: consume init, then disconnect outside the message
// callback so IPC consumption and transport closure are separate steps.
await new Promise(resolve => process.once('message', resolve));
process.disconnect();
