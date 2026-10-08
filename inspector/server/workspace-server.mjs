import { resolve } from 'node:path';
import { startLocalServer } from './http-server.mjs';
import { createWorkspaceData } from './workspace-data.mjs';
import { createProjectStore } from './workspace-projects.mjs';
import { createActionGateway, createWorkspaceCapability } from './action-gateway.mjs';
export function startWorkspace(options = {}) {
  if (options.host !== undefined && options.host !== '127.0.0.1') throw new Error('Inspector must listen on localhost only.');
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) throw new Error('Inspector port must be an integer between 0 and 65535.');
  const store = createProjectStore({ home: options.projectHome || process.env.COORDINATE_AGENTS_HOME });
  const project = store.register(resolve(options.root || process.cwd()), true);
  const capability = options.capability || createWorkspaceCapability();
  const gateway = options.gateway || createActionGateway({ root: project.root, capability, maxBodyBytes: options.maxBodyBytes, projectStore: store });
  return startLocalServer({ ...options, root: project.root, ui: 'workspace', capability, gateway, dataFactory: options.dataFactory || createWorkspaceData, projects: { store, defaultId: project.id, contexts: new Map() } });
}
