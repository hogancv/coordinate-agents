export async function executeInspectorCommand(options, context) {
  try {
    await context.inspectorCommand(options);
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure('inspector.start', error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
