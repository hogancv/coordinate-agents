import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const thisFile = fileURLToPath(import.meta.url);
const read = name => readFileSync(join(root, name), 'utf8');

test('skill description carries explicit discovery triggers and exclusions', () => {
  const skill = read(join('skills', 'coordinate-agents', 'SKILL.md'));
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  for (const value of [
    'coordinate-agents',
    'multi-agent',
    'Agent Bus',
    'role-based',
    'adapters',
    'recover',
    'review',
    'release',
    'Codex CLI',
    'Google Antigravity CLI',
  ]) assert.ok(frontmatter.includes(value), `SKILL.md description is missing ${value}`);
  assert.match(frontmatter, /Do not use for ordinary single-agent tasks/);
  assert.match(frontmatter, /unsafe concurrent writes to the\s+same worktree/);
});

test('AI installation guide defines canonical identity and the complete safe lifecycle', () => {
  const guide = read('AI_INSTALL.md');
  for (const value of [
    'https://github.com/hogancv/coordinate-agents',
    '@hogancv/coordinate-agents',
    'GitHub owner',
    'dist-tags.latest',
    'node --version',
    'git --version',
    'codex --version',
    'agy --version',
    'doctor --lang zh-CN',
    'doctor --codex --lang zh-CN',
    'doctor --antigravity --lang zh-CN',
    '~/.codex/skills/coordinate-agents',
    '~/.gemini/skills/coordinate-agents',
    'coordinate-agents.backup-',
    '## Upgrade / 更新',
    '## Uninstall / 卸载',
    '## Restore a backup / 恢复备份',
    '## Troubleshooting / 故障排查',
  ]) assert.ok(guide.includes(value), `AI_INSTALL.md is missing ${value}`);

  assert.match(guide, /Never use `curl \| sh`/);
  assert.match(guide, /Never request, print, copy, or store a token, cookie, password/);
  assert.match(guide, /Do not run `quickstart`[\s\S]*unless the user separately asks/);
  assert.match(guide, /non-zero[\s\S]*failed installation/);
});

test('both READMEs expose three AI installation prompts beside quick start', () => {
  const english = read('README.md');
  const chinese = read('README.zh-CN.md');
  assert.ok(english.indexOf('## Let an AI install it') < english.indexOf('## Requirements'));
  assert.ok(chinese.indexOf('## 让 AI 帮你安装') < chinese.indexOf('## 环境要求'));
  for (const document of [english, chinese]) {
    assert.match(document, /AI_INSTALL\.md/);
    assert.match(document, /doctor --codex/);
    assert.match(document, /doctor --antigravity/);
    assert.match(document, /hogancv\/coordinate-agents/);
  }
  assert.match(english, /Do not use a third-party fork, request credentials/);
  assert.match(chinese, /不要使用第三方 Fork，不要索取凭据/);
});

test('README FAQ answers natural-language discovery questions', () => {
  const english = read('README.md');
  const chinese = read('README.zh-CN.md');
  for (const question of [
    'What is coordinate-agents?',
    'How do I coordinate Codex CLI and Antigravity CLI?',
    'How do I use two coding agents in one Git repository?',
    'How does it prevent two AI agents from editing code simultaneously?',
    'How do I install a Codex Skill from npm?',
    'What are the Codex CLI vs Antigravity CLI roles?',
    'How do I recover interrupted multi-agent coding work?',
    'Is `.agent-bus` secure?',
    'How do I uninstall coordinate-agents?',
  ]) assert.ok(english.includes(`### ${question}`), `README FAQ is missing ${question}`);
  assert.match(english, /https:\/\/github\.com\/hogancv\/coordinate-agents/);
  assert.match(english, /AI_INSTALL\.md/);
  assert.match(english, /SECURITY\.md/);
  for (const phrase of [
    '## 常见问题',
    '如何让 Codex CLI 和 Antigravity CLI 协作？',
    '如何防止两个 AI 代理同时修改代码？',
    '如何从 npm 安装 Codex Skill？',
    '如何恢复被中断的多代理开发工作？',
    '如何卸载 coordinate-agents？',
  ]) assert.ok(chinese.includes(phrase), `Chinese README FAQ is missing ${phrase}`);
});

test('documents direct Codex App usage and concrete Implementer commands', () => {
  const english = read('README.md');
  const chinese = read('README.zh-CN.md');
  const skill = read(join('skills', 'coordinate-agents', 'SKILL.md'));
  const gettingStarted = read(join('docs', 'getting-started.md'));
  for (const document of [english, chinese, skill, gettingStarted]) {
    assert.match(document, /Codex App/);
    assert.match(document, /coordinate-agents/);
    assert.match(document, /\.git/);
    assert.match(document, /agy/);
    assert.match(document, /claude/);
  }
  assert.match(english, /do not need to open two CLI windows/i);
  assert.match(chinese, /不需要手动打开两个 CLI 窗口/);
  assert.match(skill, /actual local executable/);
  assert.match(english, /Use \$coordinate-agents to configure Claude Code/i);
  assert.match(chinese, /使用 \$coordinate-agents，帮我把 Claude Code 配置/);
  assert.match(english, /does \*\*not\*\* automatically append[\s\S]*dangerously-skip-permissions/i);
  assert.match(chinese, /不会[\s\S]*自动[\s\S]*dangerously-skip-permissions/);
});

test('documentation site exposes stable task-focused pages and canonical metadata', () => {
  const pages = [
    'index.md',
    'getting-started.md',
    'install-with-ai.md',
    'codex-cli.md',
    'antigravity-cli.md',
    'protocol.md',
    'security.md',
    'troubleshooting.md',
    'comparison.md',
    'faq.md',
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

test('published llms index is canonical, synchronized, and points to rendered documentation', () => {
  const canonical = read(join('docs', 'llms.txt'));
  assert.equal(read('llms.txt'), canonical);
  for (const url of [
    'https://hogancv.github.io/coordinate-agents/',
    'https://hogancv.github.io/coordinate-agents/getting-started.html',
    'https://hogancv.github.io/coordinate-agents/install-with-ai.html',
    'https://hogancv.github.io/coordinate-agents/security.html',
    'https://hogancv.github.io/coordinate-agents/faq.html',
  ]) assert.ok(canonical.includes(url), `docs/llms.txt is missing ${url}`);
  assert.match(read(join('docs', 'index.md')), /\[Machine-readable documentation index\]\(\.\/llms\.txt\)/);
});

test('evidence-focused docs contain complete workflows, comparison, and concrete failures', () => {
  const gettingStarted = read(join('docs', 'getting-started.md'));
  for (const evidence of ['about **5 minutes**', 'Before installation', 'IMPLEMENTATION_DONE',
    'REVIEW_APPROVED', 'RELEASE_APPROVED', 'npm run demo', 'Success and failure signals']) {
    assert.ok(gettingStarted.includes(evidence), `getting-started is missing ${evidence}`);
  }
  const install = read(join('docs', 'install-with-ai.md'));
  for (const evidence of ['Codex installation conversation', 'Antigravity installation conversation',
    'Commands the AI may execute', 'Commands the AI must not execute implicitly',
    'Common failures and recovery', 'Installation result report', 'doctor` exit status `0`']) {
    assert.ok(install.includes(evidence), `install-with-ai is missing ${evidence}`);
  }
  const comparison = read(join('docs', 'comparison.md'));
  for (const evidence of ['Single agent', 'Manual dual terminals', '`coordinate-agents`',
    'Configured Implementer', 'Configured Reviewer', 'Local persistent `.agent-bus`',
    'Exact user authorization', 'Do not use this project when']) {
    assert.ok(comparison.includes(evidence), `comparison is missing ${evidence}`);
  }
  const troubleshooting = read(join('docs', 'troubleshooting.md'));
  for (const evidence of ['Skill not discovered', 'Node version too low',
    '`codex` or `agy` is not found', 'Unknown installation directory',
    '`doctor` fails after installation', 'Message remains in `processing`',
    '`.agent-bus` is damaged or unsafe', 'Windows path normalization',
    'npm registry metadata is inconsistent', 'npm ERR! code ETARGET']) {
    assert.ok(troubleshooting.includes(evidence), `troubleshooting is missing ${evidence}`);
  }
});

test('repository AI, security, and machine index files have distinct documented roles', () => {
  const agents = read('AGENTS.md');
  const security = read('SECURITY.md');
  const llms = read('llms.txt');
  assert.match(agents, /not the installation entry point/i);
  assert.match(agents, /npm run check/);
  assert.match(agents, /README\.md.*README\.zh-CN\.md.*AI_INSTALL\.md.*SKILL\.md.*SECURITY\.md.*llms\.txt/s);
  assert.match(agents, /RELEASE_APPROVED/);
  assert.match(security, /private vulnerability reporting/i);
  assert.match(security, /\.agent-bus\/.*local plaintext/s);
  assert.match(llms, /Canonical repository: https:\/\/github\.com\/hogancv\/coordinate-agents/);
  assert.match(llms, /AI_INSTALL\.md/);
});

test('npm package carries machine installation and security documentation', () => {
  const packageJson = JSON.parse(read('package.json'));
  for (const name of ['AI_INSTALL.md', 'SECURITY.md', 'llms.txt', 'docs/llms.txt']) {
    assert.ok(packageJson.files.includes(name), `${name} is absent from package files`);
  }
  assert.match(packageJson.scripts['check:llms'], /sync-llms\.mjs --check/);
});

test('doctor never pipes a downloaded Antigravity installer directly into a shell', () => {
  const cli = read(join('bin', 'coordinate-agents.mjs'));
  assert.doesNotMatch(cli, /install\.(?:sh|ps1)['"]?\s*\|\s*(?:bash|sh|iex)/i);
  assert.match(cli, /Review the downloaded official script/);
});

test('documentation defines agent-agnostic runtime, adapter architecture, and dynamic registration in both language flows', () => {
  const english = read('README.md');
  const chinese = read('README.zh-CN.md');

  for (const phrase of [
    'Agent Bus, Adapters, and Roles',
    'Coordination Layer',
    'Agent Bus Protocol Layer',
    'Adapters & Runtime Layer',
    'generic-cli',
    'Desktop Adapter Extension Model',
    'Receive',
    'Execute',
    'Observe',
    'Result',
    'Report',
    'agent add',
    'agent list',
    'agent doctor',
  ]) {
    assert.ok(english.includes(phrase), `English README missing architectural term: ${phrase}`);
  }

  for (const phrase of [
    '架构：代理总线、适配器与工作流角色',
    '协作编排层',
    '代理总线协议层',
    '适配器与运行时层',
    'generic-cli',
    '桌面代理扩展模型',
    'Receive（接收）',
    'Execute（执行）',
    'Observe（观测）',
    'Result（产出）',
    'Report（汇报）',
    'agent add',
    'agent list',
    'agent doctor',
  ]) {
    assert.ok(chinese.includes(phrase), `Chinese README missing architectural term: ${phrase}`);
  }
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

  const gettingStarted = read(join('docs', 'getting-started.md'));
  assert.match(gettingStarted, /default reference workflow/i);

  const troubleshooting = read(join('docs', 'troubleshooting.md'));
  assert.match(troubleshooting, /default Codex and Antigravity reference adapters/i);

  const codexDoc = read(join('docs', 'codex-cli.md'));
  assert.match(codexDoc, /Reference planner/i);
  assert.match(codexDoc, /default reference workflow/i);

  const agyDoc = read(join('docs', 'antigravity-cli.md'));
  assert.match(agyDoc, /Reference implementer/i);
  assert.match(agyDoc, /default reference workflow/i);

  const demoTranscript = read(join('assets', 'demo-transcript.txt'));
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
    if (relPath === join('test', 'cli.test.mjs')) continue;
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
  const binContent = read('bin/coordinate-agents.mjs');
  assert.match(binContent, /adapter\.resolveLaunch\(\{\s*root,\s*prompt:\s*activationPrompt,\s*agent:\s*agentId,/);
  assert.doesNotMatch(binContent, /adapter\.resolveLaunch\([^)]*role:\s*agentId/);

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
