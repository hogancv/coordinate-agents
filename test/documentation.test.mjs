import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const thisFile = fileURLToPath(import.meta.url);
const read = name => readFileSync(join(root, name), 'utf8');

test('skill entrypoint references resolve to available workflow resources', () => {
  for (const name of ['coordinate-agents', 'coordinate-task', 'coordinate-review',
    'coordinate-recover', 'coordinate-setup']) {
    const directory = join(root, 'skills', name);
    const skill = read(join('skills', name, 'SKILL.md'));
    for (const match of skill.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      assert.ok(existsSync(resolve(directory, match[1])),
        `${name} contains a broken resource link: ${match[1]}`);
    }
  }
});

test('AI installation guide defaults to Web and preserves the separate Legacy lifecycle', () => {
  const guide = read('docs/install-with-ai.md');
  for (const value of ['https://github.com/hogancv/coordinate-agents',
    '@hogancv/coordinate-agents', 'GitHub owner', 'dist-tags.latest',
    'node --version', 'git --version', 'codex --version', 'agy --version',
    '## Upgrade / 更新', '## Uninstall / 卸载', '## Troubleshooting / 故障排查',
    'structured-workflow.html', 'legacy-ai-install.html']) {
    assert.ok(guide.includes(value), `Installation guide is missing ${value}`);
  }
  assert.match(guide, /Never use `curl \| sh`/);
  assert.match(guide, /Never request, print, copy, or store a token, cookie, password/);
  assert.match(guide, /Do not run `quickstart`[\s\S]*unless\s+the user separately asks/);
  assert.match(guide, /non-zero[\s\S]*failed step/);
  assert.doesNotMatch(guide, /npx[^\n]* (?:install|doctor|quickstart)(?: |$)/m);

  const legacy = read('docs/legacy-ai-install.md');
  for (const fact of ['@hogancv/coordinate-agents@2.4.0',
    'doctor --lang zh-CN', 'doctor --codex --lang zh-CN',
    'doctor --antigravity --lang zh-CN', '~/.codex/skills/coordinate-agents',
    '~/.gemini/skills/coordinate-agents', 'coordinate-agents.backup-',
    '## Restore a backup / 恢复备份']) {
    assert.ok(legacy.includes(fact), `Legacy installation is missing ${fact}`);
  }
});

test('both READMEs lead with Web and source/release guidance before optional Plugin setup', () => {
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const document = read(name);
    const quickStart = document.indexOf('npx @hogancv/coordinate-agents@latest web');
    const sourceStart = document.indexOf('node bin/coordinate-agents.mjs web');
    const pluginInstall = document.indexOf('codex plugin marketplace add');
    assert.ok(quickStart >= 0 && sourceStart > quickStart && pluginInstall > sourceStart,
      `${name} must introduce Web and source before optional Plugin installation`);
    assert.ok(document.split(/\r?\n/).length < 250, `${name} should stay concise`);
    for (const link of ['docs/install-with-ai.md', 'docs/getting-started.md', 'docs/inspector.md',
      'docs/structured-workflow.md', 'docs/legacy-ai-install.md']) {
      assert.ok(document.includes(`](${link.startsWith('.') ? link : './' + link})`),
        `${name} must link ${link}`);
    }
    for (const fact of ['3.0.1', 'npm ci', '--port 0', 'workspace-message.mjs',
      'REVIEW_APPROVED', 'RELEASE_APPROVED']) assert.ok(document.includes(fact), `${name}: ${fact}`);
  }
});

test('README relative links resolve to repository files', () => {
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const document = read(name);
    const links = [...document.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]+)?\)/g)].map(match => match[1]);
    assert.ok(links.length >= 20, `${name} should provide useful documentation navigation`);
    for (const link of links) {
      assert.equal(existsSync(resolve(root, link)), true, `${name} contains a broken link: ${link}`);
    }
  }
});

test('documentation site exposes stable task-focused pages and canonical metadata', () => {
  const pages = [
    'index.md',
    'getting-started.md',
    'structured-workflow.md',
    'legacy-ai-install.md',
    'v2.4.md',
    'install-with-ai.md',
    'changelog.md',
    'codex-cli.md',
    'antigravity-cli.md',
    'protocol.md',
    'security.md',
    'troubleshooting.md',
    'comparison.md',
    'faq.md',
    'adapter-author-guide.md',
    join('zh-CN', 'index.md'),
  ];
  for (const page of pages) {
    const content = read(join('docs', page));
    assert.match(content, /^---\r?\n[\s\S]*?description:/, `${page} has no page metadata`);
  }
  const config = read(join('docs', '_config.yml'));
  assert.match(config, /url: https:\/\/hogancv\.github\.io/);
  assert.match(config, /baseurl: \/coordinate-agents/);
  assert.match(config, /jekyll-sitemap/);
  assert.match(read(join('docs', 'index.md')), /https:\/\/github\.com\/hogancv\/coordinate-agents/);
});

test('external Adapter author guide links the public SDK and shipped example', () => {
  const guide = read(join('docs', 'adapter-author-guide.md'));
  assert.match(guide, /@hogancv\/coordinate-agents\/adapter-sdk\.mjs/);
  assert.match(guide, /ADAPTER_CONTRACT_VERSION/);
  assert.match(guide, /INVALID_ADAPTER_CONFIG/);
  assert.match(guide, /trusted local code/i);
  for (const path of [
    join('examples', 'minimal-external-adapter', 'adapter.mjs'),
    join('examples', 'minimal-external-adapter', 'fake-agent.mjs'),
    join('examples', 'minimal-external-adapter', 'README.md'),
  ]) assert.ok(existsSync(join(root, path)), `Missing shipped external Adapter example file: ${path}`);
});

test('the sole llms index is canonical and points to rendered documentation', () => {
  const canonical = read(join('docs', 'llms.txt'));
  assert.equal(existsSync(join(root, 'llms.txt')), false, 'Do not recreate a duplicate root index');
  for (const url of [
    'https://hogancv.github.io/coordinate-agents/',
    'https://hogancv.github.io/coordinate-agents/getting-started.html',
    'https://hogancv.github.io/coordinate-agents/install-with-ai.html',
    'https://hogancv.github.io/coordinate-agents/security.html',
    'https://hogancv.github.io/coordinate-agents/faq.html',
  ]) assert.ok(canonical.includes(url), `docs/llms.txt is missing ${url}`);
  assert.match(read(join('docs', 'index.md')), /\[Machine-readable documentation index\]\(\.\/llms\.txt\)/);
});

test('onboarding separates Web first-use evidence from retained structured lifecycle', () => {
  const gettingStarted = read('docs/getting-started.md');
  for (const fact of ['--port 0', '--root', 'npm ci', 'blank input prompt',
    'Success and failure signals', 'structured-workflow.html']) {
    assert.ok(gettingStarted.includes(fact), `getting-started is missing ${fact}`);
  }
  assert.doesNotMatch(gettingStarted, /npx[^\n]* (?:install|doctor|quickstart)(?: |$)/m);
  const structured = read('docs/structured-workflow.md');
  for (const fact of ['IMPLEMENTATION_DONE', 'REVIEW_APPROVED', 'RELEASE_APPROVED',
    'npm run demo', 'default reference workflow', '@hogancv/coordinate-agents@2.4.0']) {
    assert.ok(structured.includes(fact), `Structured workflow is missing ${fact}`);
  }
  const install = read('docs/install-with-ai.md');
  for (const heading of ['Commands the AI may execute', 'Commands the AI must not execute implicitly',
    'Installation result report']) assert.ok(install.includes(heading));
  const troubleshooting = read('docs/troubleshooting.md');
  for (const fact of ['The server cannot start', 'Terminal display or resize',
    'A desktop notification is missing', 'Structured Plugin / Legacy troubleshooting',
    'Skill not discovered', 'npm ERR! code ETARGET']) assert.ok(troubleshooting.includes(fact));
});

test('Web documentation distinguishes lightweight terminal groups from structured Tasks', () => {
  for (const path of ['README.md', 'README.zh-CN.md', 'docs/inspector.md', 'docs/getting-started.md', 'docs/llms.txt']) {
    const content = read(path);
    assert.match(content, /Web/);
    assert.match(content, /Task/);
    assert.doesNotMatch(content, /three-column AI-chat|chat-first, three-column|三栏 AI 聊天式|primary read-only local browser entry/);
  }
  const web = read('docs/inspector.md');
  const promptVersion = read('skills/coordinate-agents/scripts/workspace-role-prompts.mjs')
    .match(/WORKSPACE_ROLE_PROMPT_VERSION = '([^']+)'/)[1];
  for (const fact of [promptVersion, 'workspace-message.mjs', '.agent-bus/workspace-tasks/',
    'not implementation or', 'not an enforced state machine', 'does not publish npm',
    'sessionResize', 'x-coordinate-agents-capability', 'does not\ncreate an isolated Git worktree']) {
    assert.ok(web.includes(fact), `Web documentation missing boundary: ${fact}`);
  }
  assert.match(read('README.zh-CN.md'), /不代表实现或审查完成/);
});

test('repository AI, security, and machine index files have distinct documented roles', () => {
  const agents = read('AGENTS.md');
  const security = read('.github/SECURITY.md');
  const llms = read('docs/llms.txt');
  assert.match(agents, /not the installation entry point/i);
  assert.match(agents, /npm run check/);
  assert.match(agents, /RELEASE_APPROVED/);
  assert.match(security, /private vulnerability reporting/i);
  assert.match(security, /\.agent-bus\/.*local plaintext/s);
  assert.match(llms, /Canonical repository: https:\/\/github\.com\/hogancv\/coordinate-agents/);
  assert.match(llms, /install-with-ai\.html/);
});

test('npm excludes source-only installation and machine documentation', () => {
  const packageJson = JSON.parse(read('package.json'));
  for (const name of ['docs/install-with-ai.md', '.github/SECURITY.md', 'llms.txt', 'docs/llms.txt']) {
    assert.ok(!packageJson.files.includes(name), `${name} must remain source-only`);
  }
  assert.match(packageJson.scripts['check:llms'], /check-llms\.mjs/);
});

test('doctor never pipes a downloaded Antigravity installer directly into a shell', () => {
  const cli = `${read(join('bin', 'coordinate-agents.mjs'))}\n${read(join('lib', 'cli-core.mjs'))}`;
  assert.doesNotMatch(cli, /install\.(?:sh|ps1)['"]?\s*\|\s*(?:bash|sh|iex)/i);
  assert.match(cli, /Review the downloaded official script/);
});

test('advanced runtime documentation remains reachable without dominating Web onboarding', () => {
  const structured = read('docs/structured-workflow.md');
  for (const fact of ['Planner/Reviewer', 'Implementer', 'Agent Bus',
    'generic-cli', 'sessionId', 'task dispatch']) assert.ok(structured.includes(fact));
  for (const name of ['protocol.md', 'task-graph-v1.md', 'adapter-author-guide.md',
    'adapter-conformance.md', 'event-journal.md', 'plugin-e2e.md', 'codex-cli.md',
    'antigravity-cli.md']) {
    assert.match(read(`docs/${name}`), /Structured workflow[\s\S]*npm 3\.x Web/,
      `${name} must identify its product surface`);
  }
  assert.match(read('docs/zh-CN/index.md'), /本地优先协调协议与运行时/);
});

test('canonical index, site pages, and demo prose distinguish runtime protocol from default reference workflow', () => {
  const llms = read(join('docs', 'llms.txt'));
  assert.match(llms, /local-first coordination protocol and runtime/i);
  assert.match(llms, /reference adapters/i);
  assert.match(llms, /default reference workflow/i);

  const faq = read(join('docs', 'faq.md'));
  assert.match(faq, /local-first coordination protocol, runtime/i);
  assert.match(faq, /reference adapters/i);
  assert.match(faq, /generic-cli/);

  const zhIndex = read(join('docs', 'zh-CN', 'index.md'));
  assert.match(zhIndex, /本地优先协调协议与运行时/);
  assert.match(zhIndex, /参考适配器/);

  const comparison = read(join('docs', 'comparison.md'));
  assert.match(comparison, /Protocol & Runtime/);
  assert.match(comparison, /default reference workflow/i);

  const structured = read(join('docs', 'structured-workflow.md'));
  assert.match(structured, /default reference workflow/i);

  const pluginE2E = read(join('docs', 'plugin-e2e.md'));
  for (const evidence of ['Plugin-only Runtime', 'Setup transaction', 'Task dispatch',
    'IMPLEMENTATION_DONE', 'EXECUTABLE_NOT_FOUND', 'RELEASE_APPROVED']) {
    assert.ok(pluginE2E.includes(evidence), `plugin-e2e is missing ${evidence}`);
  }
  assert.match(read(join('docs', 'index.md')), /plugin-e2e\.html/);

  const troubleshooting = read(join('docs', 'troubleshooting.md'));
  assert.match(troubleshooting, /default Codex and Antigravity reference adapters/i);

  const codexDoc = read(join('docs', 'codex-cli.md'));
  assert.match(codexDoc, /Reference planner/i);
  assert.match(codexDoc, /default reference workflow/i);

  const agyDoc = read(join('docs', 'antigravity-cli.md'));
  assert.match(agyDoc, /Reference implementer/i);
  assert.match(agyDoc, /default reference workflow/i);

  const demoTranscript = read(join('docs', 'assets', 'demo-transcript.txt'));
  assert.match(demoTranscript, /Default reference workflow/i);
});

function getRepositoryFiles(dir = root, fileList = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'coverage', 'dist', 'build', '.tmp', 'temp'].includes(entry.name)) {
        continue;
      }
      getRepositoryFiles(fullPath, fileList);
    } else if (entry.isFile()) {
      if (/\.(gif|png|jpg|jpeg|ico|gz|tgz|tar|zip)$/i.test(entry.name)) continue;
      fileList.push(fullPath);
    }
  }
  return fileList;
}

test('repository-wide invariant: recursive scan finds zero stale legacy identity references', () => {
  const stalePatterns = [
    'coordinate-cli-agents',
    '@hogancv/coordinate-cli-agents',
    'Coordinate CLI Agents',
    'hogancv/coordinate-cli-agents',
    'hogancv.github.io/coordinate-cli-agents',
  ];
  const allFiles = getRepositoryFiles();
  assert.ok(allFiles.length > 25, `Expected repository walk to find files, found ${allFiles.length}`);

  for (const fullPath of allFiles) {
    if (fullPath === thisFile) continue;
    const relPath = relative(root, fullPath);
    const content = readFileSync(fullPath, 'utf8');
    for (const pattern of stalePatterns) {
      assert.equal(
        content.includes(pattern),
        false,
        `Found stale legacy pattern "${pattern}" in ${relPath}`
      );
    }
  }
});

test('repository-wide invariant: zero deprecated CLI --role alias across repository', () => {
  const allFiles = getRepositoryFiles();
  for (const fullPath of allFiles) {
    const relPath = relative(root, fullPath);
    // test/cli.test.mjs is permitted only for testing unknown option rejection
    // setup configure has a scoped workflow-role option; launch/task still
    // reject the historical role alias.
    if (
      relPath === join('test', 'cli.test.mjs')
      || relPath === join('lib', 'cli', 'parse-args.mjs')
      || relPath === join('lib', 'cli-core.mjs')
      || relPath === join('skills', 'coordinate-setup', 'SKILL.md')
    ) continue;
    if (fullPath === thisFile) continue;

    const content = readFileSync(fullPath, 'utf8');
    assert.doesNotMatch(
      content,
      /(?:^|['"\s])--role(?:\s|=|['"]|$)/,
      `Found deprecated CLI flag "--role" in ${relPath}; use "--agent" instead`
    );
  }
});

test('repository-wide invariant: zero {role} placeholder in generic CLI or docs', () => {
  const allFiles = getRepositoryFiles();
  for (const fullPath of allFiles) {
    const relPath = relative(root, fullPath);
    // test/adapters.test.mjs and adapters/generic-cli.mjs test and implement rejection of {role}
    if (relPath === join('test', 'adapters.test.mjs')) continue;
    if (relPath === join('skills', 'coordinate-agents', 'adapters', 'generic-cli.mjs')) continue;
    if (fullPath === thisFile) continue;

    const content = readFileSync(fullPath, 'utf8');
    assert.doesNotMatch(
      content,
      /(?<!\$)\{role\}/,
      `Found forbidden placeholder "{role}" in ${relPath}; use "{agent}" for agent identity`
    );
  }
});

test('repository-wide invariant: adapter resolveLaunch contracts use agent, not role', () => {
  const cliContent = `${read('bin/coordinate-agents.mjs')}\n${read('lib/cli-core.mjs')}`;
  assert.match(cliContent, /adapter\.resolveLaunch\(\{\s*root,\s*prompt:\s*activationPrompt,\s*agent:\s*agentId,/);
  assert.doesNotMatch(cliContent, /adapter\.resolveLaunch\([^)]*role:\s*agentId/);

  const genericAdapterContent = read('skills/coordinate-agents/adapters/generic-cli.mjs');
  assert.match(genericAdapterContent, /resolveLaunch\(\{\s*root,\s*prompt,\s*agent,\s*language\s*\}\)/);
  assert.doesNotMatch(genericAdapterContent, /resolveLaunch\([^)]*\brole\b/);
});

test('documentation forbids unscoped npx coordinate-agents invocations', () => {
  const allFiles = getRepositoryFiles();
  const docFiles = allFiles.filter(p => /\.md$/i.test(p));
  assert.ok(docFiles.length > 5, 'Expected to scan documentation markdown files');

  for (const fullPath of docFiles) {
    const relPath = relative(root, fullPath);
    const content = readFileSync(fullPath, 'utf8');
    assert.doesNotMatch(
      content,
      /npx (?!@hogancv\/)coordinate-agents\b/,
      `Unscoped "npx coordinate-agents" found in ${relPath}; must use "npx @hogancv/coordinate-agents"`
    );
  }
});


test('public documentation links resolve, including rendered HTML page routes', () => {
  const paths = ['README.md', 'README.zh-CN.md', '.github/SECURITY.md',
    ...readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`),
    'docs/zh-CN/index.md'];
  for (const path of paths) {
    const directory = resolve(root, path, '..');
    for (const match of read(path).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|\/)/i.test(target)) continue;
      let resolved = resolve(directory, target);
      if (resolved.endsWith('.html')) resolved = resolved.slice(0, -5) + '.md';
      assert.ok(existsSync(resolved), `${path} has a broken link: ${target}`);
    }
  }
});

test('public standalone structured npm commands pin the Legacy package', () => {
  const paths = ['README.md', 'README.zh-CN.md', '.github/SECURITY.md',
    ...readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
  for (const path of paths) {
    assert.doesNotMatch(read(path),
      /npx (?:--yes )?@hogancv\/coordinate-agents(?:@latest)? (?:install|update|uninstall|doctor|config|quickstart|task|agent|adapter|inspector)\b/,
      `${path} must not route structured commands to Web-only npm latest`);
  }
});


test('v2.4 readers have visible migration routes and immutable release documentation', () => {
  for (const path of ['README.md', 'README.zh-CN.md', 'docs/install-with-ai.md', 'docs/index.md',
    'docs/zh-CN/index.md', 'docs/changelog.md']) {
    assert.match(read(path), /\]\([^)]*v2\.4\.(?:md|html)\)/, `${path} must link the v2.4 entry`);
  }
  assert.ok(read('docs/_config.yml').includes('  - v2.4.md'));
  assert.ok(read('docs/llms.txt').includes('/v2.4.html'));

  const archive = read('docs/v2.4.md');
  const snapshot = '3e36942ce52004ad3136c6f24be57a8255361c75';
  for (const path of ['README.md', 'README.zh-CN.md', 'AI_INSTALL.md',
    'docs/index.md', 'docs/getting-started.md', 'docs/inspector.md']) {
    assert.ok(archive.includes(`blob/${snapshot}/${path}`), `Missing original v2.4.0 ${path}`);
  }
  assert.ok(archive.includes(`tree/${snapshot}/docs`));
  for (const path of ['structured-workflow.md', 'legacy-ai-install.md', 'protocol.md',
    'task-graph-v1.md', 'adapter-author-guide.md', 'adapter-conformance.md', 'event-journal.md',
    'plugin-e2e.md', 'codex-cli.md', 'antigravity-cli.md', 'mcp.md', 'MCP_TROUBLESHOOTING.md',
    'session-runtime.md']) {
    const document = read(`docs/${path}`);
    const firstSection = document.indexOf('\n## ');
    const annotation = document.indexOf('v2.4 lineage');
    assert.ok(annotation >= 0 && (firstSection < 0 || annotation < firstSection),
      `${path} must identify the retained version lineage before detailed instructions`);
    assert.ok(document.includes('](./v2.4.html)'), `${path} must link the historical docs`);
  }
});
