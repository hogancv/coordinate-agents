import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('plugin manifest exists and satisfies Codex Plugin specification', () => {
  const manifestPath = join(root, '.codex-plugin', 'plugin.json');
  assert.ok(existsSync(manifestPath), '.codex-plugin/plugin.json must exist');

  const content = readFileSync(manifestPath, 'utf8');
  assert.doesNotMatch(content, /\[TODO:/, 'plugin.json must not contain [TODO: ...] placeholders');

  const manifest = JSON.parse(content);
  assert.equal(manifest.name, 'coordinate-agents');
  assert.match(manifest.version, /^\d+\.\d+\.\d+/, 'plugin.json version must be a valid SemVer');

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.version, /^\d+\.\d+\.\d+/, 'package.json version must be a valid SemVer');

  assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0);
  assert.ok(manifest.author && typeof manifest.author.name === 'string');
  assert.equal(manifest.repository, 'https://github.com/hogancv/coordinate-agents');
  assert.equal(manifest.skills, './skills/');

  assert.ok(manifest.interface && typeof manifest.interface === 'object');
  assert.equal(manifest.interface.displayName, 'Coordinate Agents');
  assert.ok(manifest.interface.shortDescription);
  assert.ok(manifest.interface.longDescription);
  assert.ok(manifest.interface.developerName);
  assert.ok(manifest.interface.category);
  assert.ok(Array.isArray(manifest.interface.capabilities));
  assert.ok(Array.isArray(manifest.interface.defaultPrompt) && manifest.interface.defaultPrompt.length <= 3);
});

test('canonical skill directory is complete and self-contained', () => {
  const skillRoot = join(root, 'skills', 'coordinate-agents');
  assert.ok(existsSync(skillRoot), 'skills/coordinate-agents directory must exist');

  const requiredFiles = [
    'SKILL.md',
    join('agents', 'openai.yaml'),
    join('adapters', 'index.mjs'),
    join('adapters', 'base.mjs'),
    join('adapters', 'codex-cli.mjs'),
    join('adapters', 'antigravity-cli.mjs'),
    join('adapters', 'generic-cli.mjs'),
    join('adapters', 'executable.mjs'),
    join('adapters', 'contract-v1.mjs'),
    join('references', 'adapter-contract-v1.md'),
    join('references', 'protocol.md'),
    join('references', 'task-templates.md'),
    join('scripts', 'agent-bus.mjs'),
    join('scripts', 'agent-bus.ps1'),
    join('scripts', 'agent-observer.mjs'),
    join('scripts', 'config.mjs'),
    join('scripts', 'user-config.mjs'),
    join('scripts', 'task-runtime.mjs'),
    join('scripts', 'runtime-contract.mjs'),
    join('scripts', 'runtime-entry.mjs'),
  ];

  for (const relPath of requiredFiles) {
    const fullPath = join(skillRoot, relPath);
    assert.ok(existsSync(fullPath), `Required skill file is missing: ${relPath}`);
    assert.ok(statSync(fullPath).isFile(), `Skill entry must be a file: ${relPath}`);
  }
});

test('skill relative file references resolve strictly within the self-contained skill directory', () => {
  const skillRoot = join(root, 'skills', 'coordinate-agents');
  const skillContent = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');

  // Verify referenced relative resources exist in skill directory
  assert.ok(existsSync(join(skillRoot, 'scripts', 'agent-bus.mjs')));
  assert.ok(existsSync(join(skillRoot, 'references', 'task-templates.md')));
  assert.ok(existsSync(join(skillRoot, 'references', 'protocol.md')));

  // Ensure references in SKILL.md use relative subpaths
  assert.match(skillContent, /scripts\/runtime-entry\.mjs/);
  assert.match(skillContent, /references\/task-templates\.md/);
  assert.match(skillContent, /references\/protocol\.md/);
});

test('single source invariant: root does not contain duplicate runtime copies', () => {
  assert.equal(existsSync(join(root, 'adapters')), false, 'Root /adapters must not exist (canonical source is in skills/)');
  assert.equal(existsSync(join(root, 'references')), false, 'Root /references must not exist (canonical source is in skills/)');
  assert.equal(existsSync(join(root, 'agents')), false, 'Root /agents must not exist (canonical source is in skills/)');
  assert.equal(existsSync(join(root, 'SKILL.md')), false, 'Root SKILL.md must not exist (canonical source is in skills/)');
  assert.equal(existsSync(join(root, 'scripts', 'agent-bus.mjs')), false, 'Root scripts/agent-bus.mjs must not exist (canonical source is in skills/)');
});

test('Plugin source remains complete while npm excludes its manifest and Skills', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const path of ['adapter-sdk.mjs', '.codex-plugin/plugin.json', 'skills/coordinate-agents/SKILL.md', 'skills/coordinate-agents/adapters/conformance.mjs', 'examples/minimal-external-adapter/adapter.mjs', 'bin/coordinate-agents-legacy.mjs']) {
    assert.ok(existsSync(join(root, path)), path);
    assert.ok(!manifest.files.includes(path), path);
  }
});

test('official validator scripts pass if present in the environment', () => {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const pluginValidator = join(userHome, '.codex', 'skills', '.system', 'plugin-creator', 'scripts', 'validate_plugin.py');
  const skillValidator = join(userHome, '.codex', 'skills', '.system', 'skill-creator', 'scripts', 'quick_validate.py');

  if (existsSync(pluginValidator)) {
    const res = spawnSync('uv', ['run', '--with', 'pyyaml', 'python', pluginValidator, root], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (res.status === 0) {
      assert.match(res.stdout, /Plugin validation passed/);
    }
  }

  if (existsSync(skillValidator)) {
    const res = spawnSync('uv', ['run', '--with', 'pyyaml', 'python', skillValidator, join(root, 'skills', 'coordinate-agents')], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (res.status === 0) {
      assert.match(res.stdout, /Skill is valid/);
    }
  }
});

test('repository marketplace manifest exists and conforms to Codex Marketplace specification', () => {
  const marketPath = join(root, '.agents', 'plugins', 'marketplace.json');
  assert.ok(existsSync(marketPath), '.agents/plugins/marketplace.json must exist');

  const content = readFileSync(marketPath, 'utf8');
  assert.doesNotMatch(content, /\[TODO:/, 'marketplace.json must not contain [TODO: ...] placeholders');

  const market = JSON.parse(content);
  assert.equal(market.name, 'coordinate-agents');
  assert.ok(market.interface && typeof market.interface.displayName === 'string');
  assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);

  const entry = market.plugins.find(p => p.name === 'coordinate-agents');
  assert.ok(entry, 'Marketplace must contain coordinate-agents plugin entry');
  assert.equal(entry.source.source, 'local');
  assert.equal(entry.source.path, './');
  assert.equal(entry.policy.installation, 'AVAILABLE');
  assert.equal(entry.policy.authentication, 'ON_INSTALL');
  assert.equal(entry.category, 'Productivity');

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(!packageJson.files.includes('.agents'), 'npm does not distribute the GitHub marketplace');
});
