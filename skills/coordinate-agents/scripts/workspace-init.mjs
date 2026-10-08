import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_CONFIG, assertSafePath, readConfig, writeConfig } from './config.mjs';
export function initializeWorkspace(root) {
  const bus = assertSafePath(root, join(root, '.agent-bus'));
  for (const name of ['tmp', 'locks']) {
    const path = assertSafePath(root, join(bus, name));
    mkdirSync(path, { recursive: true }); assertSafePath(root, path);
  }
  if (!existsSync(join(bus, 'config.json'))) writeConfig(bus, DEFAULT_CONFIG);
  readConfig(bus);
  let exclude = execFileSync('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
  if (!isAbsolute(exclude)) exclude = resolve(root, exclude);
  mkdirSync(dirname(exclude), { recursive: true });
  const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes('.agent-bus/')) appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}.agent-bus/\n`);
  return bus;
}
