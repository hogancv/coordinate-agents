// Pure helpers; user Prompts remain text, never HTML or instructions to the app.
export function customTerminalDefaults(settings = {}) {
  const saved = settings.custom;
  return { terminal1: { command: saved?.terminal1?.command || settings.codex?.command || 'codex' },
    terminal2: { command: saved?.terminal2?.command || settings.antigravity?.command || 'agy' },
    prompts: { project: saved?.prompts?.project || '', terminal1: saved?.prompts?.terminal1 || '', terminal2: saved?.prompts?.terminal2 || '' } };
}

export function customTerminalPrompt(task, slot) {
  if (task?.mode !== 'custom' || !['terminal1', 'terminal2'].includes(slot)) return '';
  return [task.custom?.prompts?.project || '', task.custom?.prompts?.[slot] || ''].filter(text => text.length > 0).join('\n\n---\n\n');
}

export function sameCustomPromptTarget(target, current) {
  return Boolean(target && current && ['projectId', 'projectEpoch', 'taskId', 'slot', 'sessionId'].every(key => target[key] === current[key]));
}
