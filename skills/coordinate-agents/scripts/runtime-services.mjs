/**
 * Structured transport adapters for the canonical Coordinate Agents Runtime.
 *
 * The CLI and MCP server use the same exported operations.  This module keeps
 * the transport-facing names independent from MCP protocol details while the
 * existing Task Runtime and Agent Bus remain the only workflow state owners.
 */

import {
  runtimeRecoverInspect,
  runtimeAdapterList,
  runtimeAdapterRegister,
  runtimeAdapterRemove,
  runtimeSetupConfigure,
  runtimeSetupDiscover,
  runtimeTaskCreate,
  runtimeTaskGraphCreate,
  runtimeTaskGraphValidate,
  runtimeTaskGraphStatus,
  runtimeTaskGraphInspect,
  runtimeTaskGraphPlan,
  runtimeTaskGraphRun,
  runtimeTaskGraphRecover,
  runtimeTaskGraphResume,
  runtimeTaskGraphStop,
  runtimeTaskGraphCleanup,
  runtimeTaskGraphIntegrate,
  runtimeTaskGraphReview,
  runtimeTaskGraphDispatch,
  runtimeTaskOperation,
} from '../../../bin/coordinate-agents.mjs';
import {
  runtimeSessionClose,
  runtimeSessionInspect,
  runtimeSessionInterrupt,
  runtimeSessionOpen,
  runtimeSessionRead,
  runtimeSessionResize,
  runtimeSessionStatus,
  runtimeSessionWrite,
} from './session-service.mjs';

export {
  runtimeAdapterList,
  runtimeAdapterRegister,
  runtimeAdapterRemove,
  runtimeSetupDiscover,
  runtimeSetupConfigure,
  runtimeTaskCreate,
  runtimeTaskGraphCreate,
  runtimeTaskGraphValidate,
  runtimeTaskGraphDispatch,
  runtimeTaskOperation,
  runtimeTaskGraphStatus,
  runtimeTaskGraphInspect,
  runtimeTaskGraphPlan,
  runtimeTaskGraphRun,
  runtimeTaskGraphRecover,
  runtimeTaskGraphResume,
  runtimeTaskGraphStop,
  runtimeTaskGraphCleanup,
  runtimeTaskGraphIntegrate,
  runtimeTaskGraphReview,
  runtimeRecoverInspect,
};
export {
  runtimeSessionOpen,
  runtimeSessionStatus,
  runtimeSessionInspect,
  runtimeSessionWrite,
  runtimeSessionRead,
  runtimeSessionClose,
  runtimeSessionResize,
  runtimeSessionInterrupt,
};

export const RUNTIME_OPERATIONS = Object.freeze({
  setupDiscover: runtimeSetupDiscover,
  setupConfigure: runtimeSetupConfigure,
  taskCreate: runtimeTaskCreate,
  taskGraphCreate: runtimeTaskGraphCreate,
  taskGraphValidate: runtimeTaskGraphValidate,
  graphValidate: runtimeTaskGraphValidate,
  taskGraphStatus: runtimeTaskGraphStatus,
  taskGraphInspect: runtimeTaskGraphInspect,
  taskGraphPlan: runtimeTaskGraphPlan,
  taskGraphRun: runtimeTaskGraphRun,
  taskGraphRecover: runtimeTaskGraphRecover,
  taskGraphResume: runtimeTaskGraphResume,
  taskGraphStop: runtimeTaskGraphStop,
  taskGraphCleanup: runtimeTaskGraphCleanup,
  taskGraphIntegrate: runtimeTaskGraphIntegrate,
  taskGraphReview: runtimeTaskGraphReview,
  taskGraphDispatch: runtimeTaskGraphDispatch,
  taskDispatch: input => runtimeTaskOperation('dispatch', input),
  taskStatus: input => runtimeTaskOperation('status', input),
  taskInspect: input => runtimeTaskOperation('inspect', input),
  taskReview: input => runtimeTaskOperation('review', input),
  taskResume: input => runtimeTaskOperation('resume', input),
  taskStop: input => runtimeTaskOperation('stop', input),
  recoverInspect: runtimeRecoverInspect,
  sessionOpen: runtimeSessionOpen,
  sessionStatus: runtimeSessionStatus,
  sessionInspect: runtimeSessionInspect,
  sessionWrite: runtimeSessionWrite,
  sessionRead: runtimeSessionRead,
  sessionClose: runtimeSessionClose,
  sessionResize: runtimeSessionResize,
  sessionInterrupt: runtimeSessionInterrupt,
});

export async function invokeRuntimeOperation(operation, input = {}) {
  const handler = RUNTIME_OPERATIONS[operation];
  if (!handler) throw new Error(`Unknown Coordinate Agents Runtime operation: ${operation}`);
  return await handler(input);
}
