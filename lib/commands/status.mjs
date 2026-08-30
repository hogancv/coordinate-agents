export async function executeStatusCommand(options, context) {
  try {
    const result = context.statusJson(options);
    if (options.json) context.emitJson(result);
    else {
      console.log(JSON.stringify(result.bus, null, 2));
      if (result.tasks.length > 0) console.log(JSON.stringify(result.tasks, null, 2));
    }
  } catch (error) {
    if (options.json) context.emitJson(context.jsonFailure('status', error));
    else console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
