import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('obsolete benchmark, performance report, and test-support paths are absent from repository root', () => {
  const obsoletePaths = [
    'benchmark',
    'PERFORMANCE_REPORT.md',
    'test-support',
    join('benchmark', 'coordinate-agents-performance.mjs'),
    join('benchmark', 'fixtures'),
    join('benchmark', 'results'),
    join('test-support', 'external-adapter-registration-child.mjs'),
  ];

  for (const relativePath of obsoletePaths) {
    assert.equal(
      existsSync(join(root, relativePath)),
      false,
      `Expected obsolete path ${relativePath} to be absent from repository`
    );
  }
});

test('test/support fixture is present and located in test/support', () => {
  const fixturePath = join(root, 'test', 'support', 'external-adapter-registration-child.mjs');
  assert.equal(existsSync(fixturePath), true, 'Expected test/support/external-adapter-registration-child.mjs to exist');
  assert.equal(statSync(fixturePath).isFile(), true, 'Expected fixture to be a regular file');
});

test('tracked root .gitignore exists and covers required runtime, build, environment, log, tarball, and OS clutter', () => {
  const gitignorePath = join(root, '.gitignore');
  assert.equal(existsSync(gitignorePath), true, 'Expected root .gitignore to exist');

  const content = readFileSync(gitignorePath, 'utf8');
  const requiredPatterns = [
    '.agent-bus/',
    'node_modules/',
    'dist/',
    'coverage/',
    '.env',
    '.env.*',
    '!.env.example',
    'npm-debug.log*',
    '*.tgz',
    '.DS_Store',
    'Thumbs.db',
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(
      content.includes(pattern),
      `Expected .gitignore to include pattern: ${pattern}`
    );
  }

  // Ensure .codexignore remains present and distinct for plugin packaging / security boundaries
  const codexignorePath = join(root, '.codexignore');
  assert.equal(existsSync(codexignorePath), true, 'Expected root .codexignore to exist');
  const codexignoreContent = readFileSync(codexignorePath, 'utf8');
  for (const pattern of ['node_modules/', 'dist/', '.agent-bus/', '.env*']) {
    assert.ok(
      codexignoreContent.includes(pattern),
      `Expected .codexignore to include pattern: ${pattern}`
    );
  }
});

test('required root contract, public documentation, configuration, and runtime directories remain present', () => {
  const expectedDirectories = [
    '.agents',
    '.codex-plugin',
    '.github',
    'assets',
    'bin',
    'docs',
    'examples',
    'inspector',
    'lib',
    'mcp',
    'schemas',
    'scripts',
    'skills',
    'test',
  ];

  for (const dir of expectedDirectories) {
    const dirPath = join(root, dir);
    assert.equal(existsSync(dirPath), true, `Expected required directory ${dir} to exist`);
    assert.equal(statSync(dirPath).isDirectory(), true, `Expected ${dir} to be a directory`);
  }

  const expectedFiles = [
    '.gitignore',
    '.codexignore',
    '.gitattributes',
    '.mcp.json',
    'AGENTS.md',
    'AI_INSTALL.md',
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'README.zh-CN.md',
    'SECURITY.md',
    'adapter-sdk.mjs',
    'llms.txt',
    'package.json',
    'package-lock.json',
  ];

  for (const file of expectedFiles) {
    const filePath = join(root, file);
    assert.equal(existsSync(filePath), true, `Expected required file ${file} to exist`);
    assert.equal(statSync(filePath).isFile(), true, `Expected ${file} to be a regular file`);
  }
});
