export async function executeSetupCommand(options, context) {
  try {
    const result = options.command === 'setup' && options.subcommand === 'configure'
      ? await context.setupConfigureCommand(options, { json: options.json })
      : await context.setupCommand(options, { json: options.json });
    if (options.json) context.emitJson(result);
  } catch (error) {
    const command = options.command === 'discover'
      ? 'discover'
      : (options.subcommand === 'configure' ? 'setup.configure' : 'setup');
    if (options.json) context.emitJson(context.jsonFailure(command, error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
