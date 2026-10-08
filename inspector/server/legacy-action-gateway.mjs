// Source-only structured operations. Never included in the npm Web payload.
import { createActionGateway } from './action-gateway.mjs';
import { invokeRuntimeOperation } from '../../skills/coordinate-agents/scripts/runtime-services.mjs';
const ACTION_DEFINITIONS = Object.freeze({
  setupDiscover: {
    operation: 'setupDiscover',
    command: 'setup',
    params: {},
  },
  setupConfigure: {
    operation: 'setupConfigure',
    command: 'setup.configure',
    params: {
      agent: { type: 'string', required: true, max: 64 },
      command: { type: 'string', required: true, max: 512 },
      adapter: { type: 'string', max: 128 },
      role: { type: 'string', max: 32 },
      args: { type: 'array', max: 64, itemMax: 512 },
    },
  },
  taskCreate: {
    operation: 'taskCreate',
    command: 'task.create',
    params: {
      title: { type: 'string', required: true, max: 1024 },
      id: { type: 'string', max: 128 },
      spec: { type: 'string', max: 256 * 1024 },
      planner: { type: 'string', max: 64 },
      implementer: { type: 'string', max: 64 },
      reviewer: { type: 'string', max: 64 },
    },
  },
  workspaceTaskCreate: {
    operation: 'workspaceTaskCreate',
    command: 'workspace.task.create',
    params: {
      language: { type: 'string', max: 16, enum: ['en', 'zh-CN'] },
    },
  },
  workspaceTaskClose: {
    operation: 'workspaceTaskClose',
    command: 'workspace.task.close',
    params: {
      workspaceTaskId: { type: 'string', required: true, max: 128 },
    },
  },
  workspaceTaskRestart: {
    operation: 'workspaceTaskRestart',
    command: 'workspace.task.restart',
    params: {
      workspaceTaskId: { type: 'string', required: true, max: 128 },
      language: { type: 'string', max: 16, enum: ['en', 'zh-CN'] },
    },
  },
  taskStatus: {
    operation: 'taskStatus',
    command: 'task.status',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskInspect: {
    operation: 'taskInspect',
    command: 'task.inspect',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphStatus: {
    operation: 'taskGraphStatus',
    command: 'task.graph-status',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphInspect: {
    operation: 'taskGraphInspect',
    command: 'task.graph-inspect',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphPlan: {
    operation: 'taskGraphPlan',
    command: 'task.graph-plan',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
  taskGraphValidate: {
    operation: 'taskGraphValidate',
    command: 'task.graph-validate',
    params: {
      graph: { type: 'object', required: true, max: 512 * 1024 },
      intentMap: { type: 'object', max: 512 * 1024 },
    },
  },
  taskGraphCreate: {
    operation: 'taskGraphCreate',
    command: 'task.graph-create',
    params: {
      graph: { type: 'object', required: true, max: 512 * 1024 },
      intentMap: { type: 'object', max: 512 * 1024 },
    },
  },
  taskDispatch: {
    operation: 'taskDispatch',
    command: 'task.dispatch',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      spec: { type: 'string', max: 256 * 1024 },
    },
  },
  taskGraphRun: {
    operation: 'taskGraphRun',
    command: 'task.graph-run',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      sessionWaitMs: { type: 'integer', min: 0, max: 10_000 },
    },
  },
  taskGraphAdvance: {
    operation: 'taskGraphAdvance',
    command: 'task.graph-advance',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      maxWaves: { type: 'integer', required: true, min: 1, max: 32 },
      sessionWaitMs: { type: 'integer', min: 0, max: 10_000 },
    },
  },
  taskStop: {
    operation: 'taskStop',
    command: 'task.stop',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  taskResume: {
    operation: 'taskResume',
    command: 'task.resume',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  taskGraphStop: {
    operation: 'taskGraphStop',
    command: 'task.graph-stop',
    params: { taskId: { type: 'string', required: true, max: 128 }, subtaskId: { type: 'string', max: 128 } },
  },
  taskGraphRecover: {
    operation: 'taskGraphRecover',
    command: 'task.graph-recover',
    params: { taskId: { type: 'string', required: true, max: 128 }, subtaskId: { type: 'string', max: 128 } },
  },
  taskGraphResume: {
    operation: 'taskGraphResume',
    command: 'task.graph-resume',
    params: { taskId: { type: 'string', required: true, max: 128 }, subtaskId: { type: 'string', max: 128 } },
  },
  taskGraphCleanup: {
    operation: 'taskGraphCleanup',
    command: 'task.graph-cleanup',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  sessionStatus: {
    operation: 'sessionStatus',
    command: 'session.status',
    params: { sessionId: { type: 'string', required: true, max: 256 } },
  },
  sessionInspect: {
    operation: 'sessionInspect',
    command: 'session.inspect',
    params: { sessionId: { type: 'string', required: true, max: 256 } },
  },
  sessionRead: {
    operation: 'sessionRead',
    command: 'session.read',
    params: { sessionId: { type: 'string', required: true, max: 256 }, limit: { type: 'integer', min: 1, max: 2000 } },
  },
  sessionWrite: {
    operation: 'sessionWrite',
    command: 'session.write',
    params: {
      sessionId: { type: 'string', required: true, max: 256 },
      input: { type: 'string', required: true, max: 16 * 1024 },
      submit: { type: 'boolean' },
    },
  },
  sessionResize: {
    operation: 'sessionResize',
    command: 'session.resize',
    params: {
      sessionId: { type: 'string', required: true, max: 256 },
      cols: { type: 'integer', required: true, min: 1, max: 1000 },
      rows: { type: 'integer', required: true, min: 1, max: 500 },
    },
  },
  sessionClose: {
    operation: 'sessionClose',
    command: 'session.close',
    params: { sessionId: { type: 'string', required: true, max: 256 } },
  },
  taskGraphIntegrate: {
    operation: 'taskGraphIntegrate',
    command: 'task.graph-integrate',
    params: { taskId: { type: 'string', required: true, max: 128 } },
  },
  taskReview: {
    operation: 'taskReview',
    command: 'task.review',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      decision: { type: 'string', required: true, max: 32, enum: ['REVIEW_APPROVED', 'CHANGES_REQUESTED'] },
      feedback: { type: 'string', max: 16 * 1024 },
      evidence: { type: 'object', max: 64 * 1024 },
    },
  },
  taskGraphReview: {
    operation: 'taskGraphReview',
    command: 'task.graph-review',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
      decision: { type: 'string', required: true, max: 32, enum: ['REVIEW_APPROVED', 'CHANGES_REQUESTED'] },
      feedback: { type: 'string', max: 16 * 1024 },
      evidence: { type: 'object', max: 64 * 1024 },
    },
  },
  recoverInspect: {
    operation: 'recoverInspect',
    command: 'recover.inspect',
    params: {
      taskId: { type: 'string', required: true, max: 128 },
    },
  },
});
export function createLegacyActionGateway(options) {
  return createActionGateway({ ...options, definitions: ACTION_DEFINITIONS, invoke: invokeRuntimeOperation });
}
