import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROLE_PROMPT_VERSION, workspaceRolePrompt } from '../skills/coordinate-agents/scripts/role-prompts.mjs';

const root = process.cwd();
const cli = join(root, 'bin', 'coordinate-agents.mjs');

test('CLI quickstart and Workspace use the exact bilingual v2.3 role prompts', () => {
  assert.equal(ROLE_PROMPT_VERSION, '2.3.0');
  for (const language of ['en', 'zh-CN']) {
    const repository = mkdtempSync(join(tmpdir(), 'coordinate-agents-role-prompts-'));
    try {
      const initialized = spawnSync('git', ['init', '-q', repository], { encoding: 'utf8', windowsHide: true });
      assert.equal(initialized.status, 0, initialized.stderr);
      const result = spawnSync(process.execPath, [
        cli,
        'quickstart',
        '--root', repository,
        '--template', 'feature',
        '--lang', language,
      ], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);

      for (const agent of ['codex', 'antigravity']) {
        const promptPath = join(repository, '.agent-bus', 'launch', `${agent}.txt`);
        assert.equal(existsSync(promptPath), true);
        assert.equal(
          readFileSync(promptPath, 'utf8').trim(),
          workspaceRolePrompt(agent, language),
          `${agent} ${language} prompt must come from the shared v2.3 source`,
        );
      }
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  }
});
