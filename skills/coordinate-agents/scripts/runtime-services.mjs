/**
 * Structured transport adapters for the canonical Coordinate Agents Runtime.
 *
 * The CLI and MCP server use the same exported operations.  This module keeps
 * the transport-facing names independent from MCP protocol details while the
 * existing Task Runtime and Agent Bus remain the only workflow state owners.
 */

import {
  runtimeRecoverInspect,
  runtimeSetupConfigure,
  runtimeSetupDiscover,
  runtimeTaskCreate,
  runtimeTaskOperation,
} from '../../../bin/coordinate-agents.mjs';

export { runtimeSetupDiscover, runtimeSetupConfigure, runtimeTaskCreate, runtimeTaskOperation, runtimeRecoverInspect };

export const RUNTIME_OPERATIONS = Object.freeze({
  setupDiscover: runtimeSetupDiscover,
  setupConfigure: runtimeSetupConfigure,
  taskCreate: runtimeTaskCreate,
  taskDispatch: input => runtimeTaskOperation('dispatch', input),
  taskStatus: input => runtimeTaskOperation('status', input),
  taskInspect: input => runtimeTaskOperation('inspect', input),
  taskReview: input => runtimeTaskOperation('review', input),
  taskResume: input => runtimeTaskOperation('resume', input),
  taskStop: input => runtimeTaskOperation('stop', input),
  recoverInspect: runtimeRecoverInspect,
});

export async function invokeRuntimeOperation(operation, input = {}) {
  const handler = RUNTIME_OPERATIONS[operation];
  if (!handler) throw new Error(`Unknown Coordinate Agents Runtime operation: ${operation}`);
  return await handler(input);
}
