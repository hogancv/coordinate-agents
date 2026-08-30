import { executeAdapterCommand } from './adapter.mjs';
import { executeAgentCommand } from './agent.mjs';
import { executeConfigCommand } from './config.mjs';
import { executeInspectorCommand } from './inspector.mjs';
import { executeMaintenanceCommand } from './maintenance.mjs';
import { executeSetupCommand } from './setup.mjs';
import { executeStatusCommand } from './status.mjs';
import { executeTaskCommand } from './task.mjs';
import { executeWorkspaceCommand } from './workspace.mjs';

const handlers = new Map([
  ['adapter', executeAdapterCommand],
  ['agent', executeAgentCommand],
  ['config', executeConfigCommand],
  ['discover', executeSetupCommand],
  ['doctor', executeMaintenanceCommand],
  ['inspector', executeInspectorCommand],
  ['install', executeMaintenanceCommand],
  ['launch', executeWorkspaceCommand],
  ['quickstart', executeWorkspaceCommand],
  ['setup', executeSetupCommand],
  ['status', executeStatusCommand],
  ['task', executeTaskCommand],
  ['uninstall', executeMaintenanceCommand],
  ['update', executeMaintenanceCommand],
]);

export async function dispatchCommand(options, context) {
  const handler = handlers.get(options.command);
  if (!handler) return false;
  await handler(options, context);
  return true;
}
