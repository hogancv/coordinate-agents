import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = name => readFileSync(join(root, name), 'utf8');

test('skill description carries explicit discovery triggers and exclusions', () => {
  const skill = read('SKILL.md');
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  for (const value of [
    'OpenAI Codex CLI',
    'Google Antigravity CLI (agy)',
    'multi-agent collaboration',
    'specification',
    'implementation',
    'review commits',
    'release gate',
    'install',
    'diagnose',
    'resume',
    'recover',
    'update',
    'uninstall',
  ]) assert.ok(frontmatter.includes(value), `SKILL.md description is missing ${value}`);
  assert.match(frontmatter, /Do not use for single-agent coding tasks/);
  assert.match(frontmatter, /both agents may edit product code/);
});

test('AI installation guide defines canonical identity and the complete safe lifecycle', () => {
  const guide = read('AI_INSTALL.md');
  for (const value of [
    'https://github.com/hogancv/coordinate-cli-agents',
    '@hogancv/coordinate-cli-agents',
    'GitHub owner',
    'dist-tags.latest',
    'node --version',
    'git --version',
    'codex --version',
    'agy --version',
    'doctor --lang zh-CN',
    'doctor --codex --lang zh-CN',
    'doctor --antigravity --lang zh-CN',
    '~/.codex/skills/coordinate-cli-agents',
    '~/.gemini/skills/coordinate-cli-agents',
    'coordinate-cli-agents.backup-',
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
    assert.match(document, /hogancv\/coordinate-cli-agents/);
  }
  assert.match(english, /Do not use a third-party fork, request credentials/);
  assert.match(chinese, /不要使用第三方 Fork，不要索取凭据/);
});

test('README FAQ answers natural-language discovery questions', () => {
  const english = read('README.md');
  const chinese = read('README.zh-CN.md');
  for (const question of [
    'What is coordinate-cli-agents?',
    'How do I coordinate Codex CLI and Antigravity CLI?',
    'How do I use two coding agents in one Git repository?',
    'How does it prevent two AI agents from editing code simultaneously?',
    'How do I install a Codex Skill from npm?',
    'What are the Codex CLI vs Antigravity CLI roles?',
    'How do I recover interrupted multi-agent coding work?',
    'Is `.agent-bus` secure?',
    'How do I uninstall coordinate-cli-agents?',
  ]) assert.ok(english.includes(`### ${question}`), `README FAQ is missing ${question}`);
  assert.match(english, /https:\/\/github\.com\/hogancv\/coordinate-cli-agents/);
  assert.match(english, /AI_INSTALL\.md/);
  assert.match(english, /SECURITY\.md/);
  for (const phrase of [
    '## 常见问题',
    '如何让 Codex CLI 和 Antigravity CLI 协作？',
    '如何防止两个 AI 代理同时修改代码？',
    '如何从 npm 安装 Codex Skill？',
    '如何恢复被中断的多代理开发工作？',
    '如何卸载 coordinate-cli-agents？',
  ]) assert.ok(chinese.includes(phrase), `Chinese README FAQ is missing ${phrase}`);
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
  assert.match(config, /baseurl: \/coordinate-cli-agents/);
  assert.match(config, /jekyll-sitemap/);
  assert.match(read(join('docs', 'index.md')), /https:\/\/github\.com\/hogancv\/coordinate-cli-agents/);
});

test('published llms index is canonical, synchronized, and points to rendered documentation', () => {
  const canonical = read(join('docs', 'llms.txt'));
  assert.equal(read('llms.txt'), canonical);
  for (const url of [
    'https://hogancv.github.io/coordinate-cli-agents/',
    'https://hogancv.github.io/coordinate-cli-agents/getting-started.html',
    'https://hogancv.github.io/coordinate-cli-agents/install-with-ai.html',
    'https://hogancv.github.io/coordinate-cli-agents/security.html',
    'https://hogancv.github.io/coordinate-cli-agents/faq.html',
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
  for (const evidence of ['Single agent', 'Manual dual terminals', '`coordinate-cli-agents`',
    'Antigravity only', 'Codex only', 'Local persistent `.agent-bus`',
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
  assert.match(llms, /Canonical repository: https:\/\/github\.com\/hogancv\/coordinate-cli-agents/);
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
  const cli = read(join('bin', 'coordinate-cli-agents.mjs'));
  assert.doesNotMatch(cli, /install\.(?:sh|ps1)['"]?\s*\|\s*(?:bash|sh|iex)/i);
  assert.match(cli, /Review the downloaded official script/);
});
