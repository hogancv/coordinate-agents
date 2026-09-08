import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkspace as start } from '../../inspector/server/server.mjs';
export function startWorkspace(options) {
  const home = mkdtempSync(join(tmpdir(), 'workspace-project-home-'));
  try {
    return start({ ...options, projectHome: home }).then(result => {
      result.server.once('close', () => rmSync(home, { recursive: true, force: true }));
      return result;
    }, error => { rmSync(home, { recursive: true, force: true }); throw error; });
  } catch (error) { rmSync(home, { recursive: true, force: true }); throw error; }
}
