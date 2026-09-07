export async function executeWebCommand(options, context) {
  try {
    await context.webCommand(options);
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure('workspace.start', error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
