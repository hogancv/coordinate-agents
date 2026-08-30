function failureCommand(options, taskGraphOperation) {
  const graphValidation = ['graph-validate', 'validate-graph'].includes(options.subcommand)
    || (options.subcommand === 'graph' && options.positionals?.[0] === 'validate');
  const graphOperation = taskGraphOperation(options);
  if (graphValidation) return 'task.graph-validate';
  return graphOperation ? `task.graph-${graphOperation}` : `task.${options.subcommand || 'status'}`;
}

export async function executeTaskCommand(options, context) {
  try {
    const result = await context.taskCommand(options, { json: options.json });
    if (options.json) context.emitJson(result);
  } catch (error) {
    const command = failureCommand(options, context.taskGraphOperation);
    if (options.json) context.emitJson(context.jsonFailure(command, error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
