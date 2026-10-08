import { createLegacyActionGateway } from '../../inspector/server/legacy-action-gateway.mjs';
import { createInspectorData } from '../../inspector/server/inspector-data.mjs';
import { createWorkspaceCapability } from '../../inspector/server/action-gateway.mjs';
import { startWorkspace as start } from './workspace-server.mjs';
export function startWorkspace(options) {
  const capability = createWorkspaceCapability();
  return start({ ...options, capability, dataFactory: createInspectorData, gateway: createLegacyActionGateway({ ...options, capability }) });
}
