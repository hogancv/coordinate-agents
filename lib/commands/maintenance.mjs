async function installOrUpdate(options, context) {
  const expectedManifest = context.payloadManifest();
  try {
    for (const target of context.targets(options)) {
      context.installTarget(target, expectedManifest, options, context.messages);
    }
    context.installAuxiliarySkills(options, context.messages);
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

function printDoctor(options, context, expectedManifest, selectedTargets) {
  let healthy = true;
  let found = false;
  const repairs = context.repairCommands();
  let userConfig = context.defaultUserConfig();
  let projectConfig = null;
  try {
    userConfig = context.readUserConfig();
    projectConfig = context.projectConfigForRoot(context.resolve(options.root));
  } catch (error) {
    healthy = false;
    console.error(error.message || String(error));
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 18) {
    console.log(context.format(context.messages.componentHealthy, { component: 'Node.js', version: process.version }));
  } else {
    healthy = false;
    console.error(context.format(context.messages.componentMissing, { component: 'Node.js 18+' }));
    console.error(context.format(context.messages.repair, { command: repairs.node }));
  }

  for (const component of [
    { id: null, name: 'Git', command: 'git', repair: repairs.git, required: true },
    { id: 'codex', name: 'Codex CLI', adapter: 'codex-cli', command: 'codex', repair: repairs.codex, required: options.codex },
    { id: 'antigravity', name: 'Antigravity CLI', adapter: 'antigravity-cli', command: 'agy', repair: repairs.antigravity, required: options.antigravity },
  ]) {
    const projectAgent = component.id && projectConfig?.agents?.find(agent => agent.id === component.id);
    const resolved = component.id
      ? context.runtimeAgentConfig(projectAgent || { id: component.id, adapter: component.adapter }, userConfig)
      : { command: component.command, commandSource: 'adapter-default' };
    const command = resolved.command || component.command;
    const displayName = component.id === 'antigravity'
      ? `${component.name} (${command || component.command})`
      : component.name;
    let detection = null;
    let version = null;
    if (component.id && resolved.commandSource !== 'adapter-default') {
      try {
        detection = context.getAdapter(resolved.adapter, resolved).detect();
      } catch (error) {
        detection = { available: false, code: 'DETECTION_FAILED', details: error.message || String(error) };
      }
      version = detection.available ? detection.version : null;
    } else {
      version = context.executableVersion(command);
    }
    if (version) {
      console.log(context.format(context.messages.componentHealthy, { component: displayName, version }));
      if (component.id) {
        console.log(`  Command: ${command || '(none)'}`);
        console.log('  Executable: ✓ available');
        console.log(`  Version: ${version}`);
        if (resolved.commandSource === 'user') console.log(`  Configured at: ${context.userConfigPath()}`);
      }
      continue;
    }

    if (component.required) healthy = false;
    console.error(context.format(context.messages.componentMissing, { component: displayName }));
    if (component.id) {
      console.error(`  Command: ${command || '(none)'}`);
      console.error(`  Executable: ✗ ${detection?.code || 'not found'}`);
      if (resolved.commandSource === 'user') console.error(`  Configured at: ${context.userConfigPath()}`);
      const fix = resolved.commandSource === 'adapter-default'
        ? component.repair
        : `coordinate-agents config set agent.${component.id}.command ${context.suggestedCommand(component.id, context.language)}`;
      console.error(context.format(context.messages.repair, { command: fix }));
    } else {
      console.error(context.format(context.messages.repair, { command: component.repair }));
    }
  }

  for (const target of selectedTargets) {
    const result = context.verifyTarget(target.path, expectedManifest);
    if (result.missing) {
      healthy = false;
      console.error(context.format(context.messages.missing, { target: target.name, path: target.path }));
      console.error(context.format(context.messages.repair, { command: context.targetRepairCommand('install', target, options) }));
    } else {
      found = true;
      if (result.ok) {
        console.log(context.format(context.messages.healthy, { target: target.name, version: result.version, path: target.path }));
      } else {
        healthy = false;
        console.error(context.format(context.messages.invalid, { target: target.name, details: result.details, path: target.path }));
        const command = context.targetRepairCommand(result.managed ? 'update' : 'install', target, options);
        console.error(context.format(result.managed ? context.messages.repair : context.messages.manualRepair, { command }));
      }
    }
  }
  if (!found) console.error(context.messages.noInstall);
  console.log(healthy ? context.messages.summaryOk : context.messages.summaryFail);
  if (!healthy) process.exitCode = 1;
}

async function doctor(options, context) {
  const expectedManifest = context.payloadManifest();
  const selectedTargets = context.targets(options);
  if (options.json) {
    try {
      const result = context.doctorJson(options, expectedManifest, selectedTargets);
      context.emitJson(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      context.emitJson(context.jsonFailure('doctor', error));
      process.exitCode = 1;
    }
    return;
  }
  printDoctor(options, context, expectedManifest, selectedTargets);
}

async function uninstall(options, context) {
  const expectedManifest = context.payloadManifest();
  for (const target of context.targets(options)) {
    if (!context.existsSync(target.path)) continue;
    if (!context.isIntactManagedInstallation(target.path, expectedManifest) && !options.force) {
      console.error(context.format(context.messages.skipRemove, { target: target.name, path: target.path }));
      process.exitCode = 1;
      continue;
    }
    context.removePath(target.path);
    console.log(context.format(context.messages.removed, { target: target.name, path: target.path }));
  }
  context.uninstallAuxiliarySkills(options, context.messages);
}

export async function executeMaintenanceCommand(options, context) {
  if (options.command === 'install' || options.command === 'update') return installOrUpdate(options, context);
  if (options.command === 'doctor') return doctor(options, context);
  return uninstall(options, context);
}
