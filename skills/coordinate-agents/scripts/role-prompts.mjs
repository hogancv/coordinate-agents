/**
 * Canonical v2.3 role prompts shared by CLI quickstart and the Web Workspace.
 *
 * Keep this module side-effect free.  Both entry points must be able to build
 * the same prompt without importing a transport, a server, or a browser.
 */

export const ROLE_PROMPT_VERSION = '2.3.0';

export function taskGuidance(template = 'feature', language = 'en') {
  const guidance = {
    en: {
      bug: 'Bug fix template: reproduce first; record expected vs actual behavior; identify root cause; make the smallest safe fix; add a regression test; verify related behavior.',
      feature: 'Feature template: clarify user value, observable behavior, UX/API, edge cases, compatibility, acceptance criteria, and validation before implementation.',
      refactor: 'Refactor template: define invariants and non-goals; capture a green baseline; preserve observable behavior; change incrementally; compare tests/build before and after.',
    },
    zh: {
      bug: 'Bug 修复模板：先复现；记录预期与实际行为；定位根因；采用最小安全修复；添加回归测试；验证关联行为。',
      feature: '功能开发模板：实施前澄清用户价值、可观察行为、UX/API、边界情况、兼容性、验收标准和验证方式。',
      refactor: '重构模板：定义不变量和非目标；记录全绿基线；保持可观察行为不变；增量修改；对比修改前后的测试与构建。',
    },
  };
  const locale = language === 'zh' ? 'zh' : 'en';
  return guidance[locale][template] || guidance[locale].feature;
}

/**
 * Build the current CLI quickstart prompt for an arbitrary role assignment.
 * `options` intentionally mirrors the existing quickstart options object.
 */
export function buildAgentPrompt({
  agentId,
  roles,
  options = {},
  language = 'en',
  planner,
  implementer,
  reviewer,
}) {
  const normalizedRoles = Array.isArray(roles) ? roles : [];
  const task = `${options.task || ''}`.trim()
    || (language === 'zh' ? '先询问我本轮的具体需求。' : 'Ask me for the concrete task for this round.');
  const template = `${options.template || 'feature'}`;
  const isDefaultCodex = agentId === 'codex' &&
    normalizedRoles.length === 2 && normalizedRoles.includes('planner') && normalizedRoles.includes('reviewer') && !normalizedRoles.includes('implementer') &&
    planner === 'codex' && reviewer === 'codex';
  const isDefaultAgy = agentId === 'antigravity' &&
    normalizedRoles.length === 1 && normalizedRoles.includes('implementer') && !normalizedRoles.includes('planner') && !normalizedRoles.includes('reviewer') &&
    implementer === 'antigravity';

  if (language === 'zh') {
    if (isDefaultCodex) {
      return `调用 $coordinate-agents 并以 Codex 角色恢复当前仓库的协作；如果宿主未注册该技能，直接阅读仓库内 skills/coordinate-agents/SKILL.md 并按其中流程执行。你只负责需求澄清、规格、验收标准、提交与证据审查及发布门禁，不修改产品代码。${taskGuidance(template, language)}\n\n本轮任务：${task}`;
    }
    if (isDefaultAgy) {
      return '调用 $coordinate-agents 并以 Antigravity 角色恢复当前仓库的协作；如果宿主未注册该技能，直接阅读仓库内 skills/coordinate-agents/SKILL.md 并按其中流程执行。立即等待 Codex；你是唯一的产品代码修改者，负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE；等待 review；不得发布。';
    }
    if (normalizedRoles.includes('planner') && normalizedRoles.includes('implementer') && normalizedRoles.includes('reviewer')) {
      return `调用 $coordinate-agents 并作为规划、实现与审查者（${agentId}）恢复当前仓库的协作。按规格实现、验证、提交并进行审查；未获明确授权不得发布。${taskGuidance(template, language)}\n\n本轮任务：${task}`;
    }
    if (normalizedRoles.includes('implementer') && normalizedRoles.includes('reviewer')) {
      return `调用 $coordinate-agents 并作为实现与审查者（${agentId}）恢复当前仓库的协作。负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE，同时负责审查；未获明确授权不得发布。${taskGuidance(template, language)}\n\n本轮任务：${task}`;
    }
    if (normalizedRoles.includes('planner') && normalizedRoles.includes('implementer')) {
      return `调用 $coordinate-agents 并作为规划与实现者（${agentId}）恢复当前仓库的协作。按规格实现、验证、提交并进行审查；未获明确授权不得发布。${taskGuidance(template, language)}\n\n本轮任务：${task}`;
    }
    if (normalizedRoles.includes('planner') || normalizedRoles.includes('reviewer')) {
      const label = normalizedRoles.includes('planner') && normalizedRoles.includes('reviewer') ? '规划与审查者' : (normalizedRoles.includes('planner') ? '规划者' : '审查者');
      return `调用 $coordinate-agents 并作为${label}（${agentId}）恢复当前仓库的协作。你负责需求澄清、规格编写、提交/证据审查与发布门禁，不修改产品代码。${taskGuidance(template, language)}\n\n本轮任务：${task}`;
    }
    return `调用 $coordinate-agents 并作为实现者（${agentId}）恢复当前仓库的协作。立即等待任务指令；你是唯一的产品代码修改者，负责实现、验证、提交并发送带证据的 IMPLEMENTATION_DONE；等待审查；不得发布。`;
  }

  if (isDefaultCodex) {
    return `Use $coordinate-agents as Codex and resume collaboration in this repository; if the host has not registered the skill, read skills/coordinate-agents/SKILL.md in this repository and follow it directly. Own only clarification, specification, acceptance criteria, commit/evidence review, and the release gate; do not edit product code. ${taskGuidance(template, language)}\n\nTask: ${task}`;
  }
  if (isDefaultAgy) {
    return 'Use $coordinate-agents as Antigravity and resume collaboration in this repository; if the host has not registered the skill, read skills/coordinate-agents/SKILL.md in this repository and follow it directly. Wait for Codex now; be the sole product-code writer; implement, validate, commit, and send IMPLEMENTATION_DONE with evidence; wait for review; never release.';
  }
  if (normalizedRoles.includes('planner') && normalizedRoles.includes('implementer') && normalizedRoles.includes('reviewer')) {
    return `Use $coordinate-agents as planner, implementer, and reviewer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, and review according to specifications; never release without explicit approval. ${taskGuidance(template, language)}\n\nTask: ${task}`;
  }
  if (normalizedRoles.includes('implementer') && normalizedRoles.includes('reviewer')) {
    return `Use $coordinate-agents as implementer and reviewer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, send IMPLEMENTATION_DONE with evidence, and perform reviews; never release without explicit approval. ${taskGuidance(template, language)}\n\nTask: ${task}`;
  }
  if (normalizedRoles.includes('planner') && normalizedRoles.includes('implementer')) {
    return `Use $coordinate-agents as planner and implementer (${agentId}) and resume collaboration in this repository. Implement, validate, commit, and review according to specifications; never release without explicit approval. ${taskGuidance(template, language)}\n\nTask: ${task}`;
  }
  if (normalizedRoles.includes('planner') || normalizedRoles.includes('reviewer')) {
    const label = normalizedRoles.includes('planner') && normalizedRoles.includes('reviewer') ? 'planner and reviewer' : (normalizedRoles.includes('planner') ? 'planner' : 'reviewer');
    return `Use $coordinate-agents as ${label} (${agentId}) and resume collaboration in this repository. Own clarification, specification, acceptance criteria, commit/evidence review, and the release gate; do not edit product code. ${taskGuidance(template, language)}\n\nTask: ${task}`;
  }
  return `Use $coordinate-agents as implementer (${agentId}) and resume collaboration in this repository. Wait for instructions; be the sole product-code writer; implement, validate, commit, and send IMPLEMENTATION_DONE with evidence; wait for review; never release.`;
}

export function workspaceRolePrompt(agentId, language = 'en') {
  const normalizedLanguage = `${language}`.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const isCodex = agentId === 'codex';
  return buildAgentPrompt({
    agentId,
    roles: isCodex ? ['planner', 'reviewer'] : ['implementer'],
    options: { task: '', template: 'feature' },
    language: normalizedLanguage,
    planner: 'codex',
    implementer: 'antigravity',
    reviewer: 'codex',
  });
}
