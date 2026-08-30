export async function executeAgentCommand(options, context) {
  try {
    await context.loadConfiguredAdaptersForRuntime();
    if (options.json) context.emitJson(await context.agentCommandJson(options));
    else await context.handleAgentCommand(options, context.messages);
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure(`agent.${options.subcommand || 'list'}`, error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
