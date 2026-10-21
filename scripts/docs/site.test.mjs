import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(resolve(root, p), 'utf8');

test('documentation builds independently with a pinned stable release', () => {
  const pkg = JSON.parse(read('docs/package.json'));
  assert.equal(pkg.devDependencies.vitepress, '1.6.4');
  assert.ok(existsSync(resolve(root, 'docs/package-lock.json')));
  assert.equal(JSON.parse(read('package.json')).dependencies['node-pty'], '1.1.0');
});

test('Pages validates pull requests and only deploys trusted main builds', () => {
  const workflow = read('.github/workflows/pages-build.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /npm ci --prefix docs/);
  assert.match(workflow, /npm run build --prefix docs/);
  assert.match(workflow, /npm run check --prefix docs/);
  assert.match(workflow, /actions\/deploy-pages@/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /jekyll/);
});

test('all primary reader journeys have complete locale pairs', () => {
  for (const page of ['index', 'getting-started', 'inspector', 'install-with-ai',
    'troubleshooting', 'faq', 'comparison', 'security', 'structured-workflow',
    'v2.4', 'codex-conversation-resume', 'changelog']) {
    for (const lang of ['', 'zh-CN/']) {
      const text = read(`docs/${lang}${page}.md`);
      assert.doesNotMatch(text, /translationPending: true/, `${lang}${page}`);
      assert.match(text, /^---\n[\s\S]*?description:/, `${lang}${page}`);
    }
  }
});

test('pre-migration Markdown archives retain every recorded byte', async () => {
  const { createHash } = await import('node:crypto');
  const inventory = JSON.parse(read('docs/maintenance/content-inventory.json'));
  for (const file of inventory.files.filter(row => row.path.startsWith('docs/'))) {
    const archived = readFileSync(resolve(root, 'docs/public/reference-original', file.path));
    assert.equal(createHash('sha256').update(archived).digest('hex'), file.sha256, file.path);
  }
});

test('v2.4 snapshot metadata identifies the immutable release', async () => {
  const { execFileSync } = await import('node:child_process');
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', '3e36942ce52004ad3136c6f24be57a8255361c75', 'docs', 'README.md', 'README.zh-CN.md', 'AI_INSTALL.md'], {cwd:root, encoding:'utf8'}).trim().split('\n');
  for (const path of paths) {
    const original = execFileSync('git', ['show', `3e36942ce52004ad3136c6f24be57a8255361c75:${path}`], {cwd:root});
    assert.deepEqual(readFileSync(resolve(root, 'docs/public/archive/v2.4.0', path)), original, path);
  }
});
