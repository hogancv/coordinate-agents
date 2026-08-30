export async function executeWorkspaceCommand(options, context) {
  try {
    if (options.command === 'quickstart') {
      context.quickstart(options, context.messages, context.language);
      return;
    }
    const result = await context.launchAgent(options, context.messages);
    if (options.json) {
      context.emitJson(context.jsonSuccess('launch', result || {
        agent: options.agent,
        root: context.resolve(options.root),
      }));
    }
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure(options.command, error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
