#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = '@hogancv/coordinate-agents';
const PLUGIN_NAME = 'coordinate-agents';
const REPOSITORY_URL = 'https://github.com/hogancv/coordinate-agents';
const MAX_OUTPUT = 20_000;

const REQUIRED_FILES = [
  'adapter-sdk.mjs',
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'bin/coordinate-agents.mjs',
  'lib/cli-core.mjs',
  'lib/cli/parse-args.mjs',
  'lib/commands/index.mjs',
  'skills/coordinate-agents/SKILL.md',
  'skills/coordinate-setup/SKILL.md',
  'skills/coordinate-agents/adapters/contract-v1.mjs',
  'skills/coordinate-agents/adapters/conformance.mjs',
  'skills/coordinate-agents/scripts/runtime-entry.mjs',
  'docs/adapter-conformance.md',
  'docs/adapter-author-guide.md',
  'docs/llms.txt',
  'llms.txt',
  'CHANGELOG.md',
  'examples/minimal-external-adapter/adapter.mjs',
  'examples/minimal-external-adapter/fake-agent.mjs',
  'examples/minimal-external-adapter/README.md',
  'examples/minimal-external-adapter/run-conformance.mjs',
];

class VerificationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'VerificationError';
    this.details = details;
  }
}

function usage() {
  return 'Usage: node scripts/verify-release-artifact.mjs <package.tgz> --expected-version <semver> --expected-source-commit <commit> --expected-tag <tag>';
}

function parseArgs(argv) {
  let artifact = null;
  let expectedVersion = null;
  let expectedSourceCommit = null;
  let expectedTag = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--expected-version') {
      expectedVersion = argv[index + 1];
      if (!expectedVersion || expectedVersion.startsWith('-')) {
        throw new VerificationError(`Missing value for --expected-version. ${usage()}`);
      }
      index += 1;
    } else if (value === '--expected-source-commit') {
      expectedSourceCommit = argv[index + 1];
      if (!expectedSourceCommit || expectedSourceCommit.startsWith('-')) {
        throw new VerificationError(`Missing value for --expected-source-commit. ${usage()}`);
      }
      index += 1;
    } else if (value === '--expected-tag') {
      expectedTag = argv[index + 1];
      if (!expectedTag || expectedTag.startsWith('-')) {
        throw new VerificationError(`Missing value for --expected-tag. ${usage()}`);
      }
      index += 1;
    } else if (value.startsWith('-')) {
      throw new VerificationError(`Unknown option: ${value}. ${usage()}`);
    } else if (artifact === null) {
      artifact = value;
    } else {
      throw new VerificationError(`Unexpected argument: ${value}. ${usage()}`);
    }
  }
  if (!artifact || !expectedVersion || !expectedSourceCommit || !expectedTag) {
    throw new VerificationError(usage());
  }
  return {
    artifact: resolve(artifact),
    expectedVersion,
    expectedSourceCommit,
    expectedTag,
  };
}

function compact(value) {
  return String(value || '').trim().slice(-MAX_OUTPUT);
}

function run(command, args, { cwd, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    throw new VerificationError(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new VerificationError(`${command} ${args.join(' ')} exited with ${result.status}.`, {
      stdout: compact(result.stdout),
      stderr: compact(result.stderr),
    });
  }
  return result;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new VerificationError(`Could not read ${label}: ${error.message}`);
  }
}

function assertRegularFile(path, label) {
  if (!existsSync(path)) throw new VerificationError(`${label} is missing: ${path}`);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new VerificationError(`${label} is not a regular file: ${path}`);
  }
}

function assertNoSymlinks(root, current = root) {
  const entries = readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) throw new VerificationError(`Artifact contains a symbolic link: ${relative(root, path)}`);
    if (entry.isDirectory()) assertNoSymlinks(root, path);
  }
}

function parseChildJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new VerificationError(`${label} did not return JSON: ${error.message}`, {
      stdout: compact(result.stdout),
      stderr: compact(result.stderr),
    });
  }
}

function isolatedEnvironment(home, extra = {}) {
  return {
    ...process.env,
    COORDINATE_AGENTS_HOME: home,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, '.codex'),
    GEMINI_HOME: join(home, '.gemini'),
    ...extra,
  };
}

function verifyIdentity(packageRoot, expectedVersion) {
  const packageJson = readJson(join(packageRoot, 'package.json'), 'package.json');
  const pluginJson = readJson(join(packageRoot, '.codex-plugin', 'plugin.json'), '.codex-plugin/plugin.json');
  if (packageJson.name !== PACKAGE_NAME) throw new VerificationError(`Unexpected package name: ${packageJson.name}`);
  if (pluginJson.name !== PLUGIN_NAME) throw new VerificationError(`Unexpected Plugin name: ${pluginJson.name}`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(packageJson.version)) {
    throw new VerificationError(`Package version is not stable SemVer: ${packageJson.version}`);
  }
  if (expectedVersion && packageJson.version !== expectedVersion) {
    throw new VerificationError(`Expected package version ${expectedVersion}, received ${packageJson.version}`);
  }
  if (pluginJson.version !== packageJson.version) {
    throw new VerificationError(`Package/Plugin version mismatch: ${packageJson.version} vs ${pluginJson.version}`);
  }
  if (packageJson.repository?.url !== `git+${REPOSITORY_URL}.git`) {
    throw new VerificationError(`Unexpected package repository URL: ${packageJson.repository?.url}`);
  }
  if (pluginJson.repository !== REPOSITORY_URL) {
    throw new VerificationError(`Unexpected Plugin repository URL: ${pluginJson.repository}`);
  }
  if (pluginJson.skills !== './skills/' || pluginJson.mcpServers !== './.mcp.json') {
    throw new VerificationError('Plugin manifest does not point at the packaged skills and MCP server payload.');
  }
  if (packageJson.exports?.['./adapter-sdk'] !== './adapter-sdk.mjs') {
    throw new VerificationError('The public ./adapter-sdk export is missing or points at another file.');
  }
  return { packageJson, pluginJson };
}

function verifyCandidateFacts(packageJson, expectedSourceCommit, expectedTag) {
  if (!/^[0-9a-f]{40}$/i.test(expectedSourceCommit)) {
    throw new VerificationError(`Expected source commit must be a full 40-character Git SHA: ${expectedSourceCommit}`);
  }
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(expectedTag)) {
    throw new VerificationError(`Expected tag must be a stable version tag: ${expectedTag}`);
  }
  if (expectedTag !== `v${packageJson.version}`) {
    throw new VerificationError(`Expected tag ${expectedTag} does not match package version ${packageJson.version}.`);
  }
  return {
    sourceCommit: expectedSourceCommit,
    tag: expectedTag,
    version: packageJson.version,
  };
}

function verifyPayload(packageRoot) {
  for (const file of REQUIRED_FILES) assertRegularFile(join(packageRoot, file), file);
  const llms = readFileSync(join(packageRoot, 'llms.txt'), 'utf8');
  const docsLlms = readFileSync(join(packageRoot, 'docs', 'llms.txt'), 'utf8');
  if (llms !== docsLlms) throw new VerificationError('Packaged llms.txt is not synchronized with docs/llms.txt.');
  return { files: REQUIRED_FILES.length, llmsSynchronized: true };
}

function verifyExternalExample(packageRoot, env) {
  const result = run(process.execPath, [
    join('examples', 'minimal-external-adapter', 'run-conformance.mjs'),
  ], { cwd: packageRoot, env });
  const report = parseChildJson(result, 'external Adapter example');
  if (report.ok !== true || report.contractVersion !== 1 || report.summary?.failed !== 0) {
    throw new VerificationError('Packaged external Adapter example did not pass offline conformance.', report);
  }
  return {
    adapter: report.adapter,
    contractVersion: report.contractVersion,
    kitVersion: report.kitVersion,
    summary: report.summary,
  };
}

function createCodexFixture(tempRoot) {
  const bin = join(tempRoot, 'doctor-bin');
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    const script = join(bin, 'codex.cjs');
    writeFileSync(script, "console.log('codex-fixture-1.0.0');\n", 'utf8');
    writeFileSync(join(bin, 'codex.cmd'), `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
  } else {
    const executable = join(bin, 'codex');
    writeFileSync(executable, '#!/bin/sh\necho codex-fixture-1.0.0\n', 'utf8');
    chmodSync(executable, 0o755);
  }
  return bin;
}

function verifyRuntime(packageRoot, tempRoot, env, expectedVersion) {
  const cli = join(packageRoot, 'bin', 'coordinate-agents.mjs');
  const repository = join(tempRoot, 'consumer-repository');
  const home = join(tempRoot, 'consumer-home');
  const fixtureBin = createCodexFixture(tempRoot);
  const existingPath = env.PATH || env.Path || process.env.PATH || process.env.Path || '';
  const doctorEnv = {
    ...env,
    PATH: `${fixtureBin}${delimiter}${existingPath}`,
  };
  mkdirSync(repository, { recursive: true });
  mkdirSync(home, { recursive: true });
  run('git', ['init', repository], { cwd: packageRoot, env });

  const version = run(process.execPath, [cli, '--version'], { cwd: packageRoot, env }).stdout.trim();
  if (version !== expectedVersion) throw new VerificationError(`Packaged Runtime reports ${version}, expected ${expectedVersion}.`);
  const setup = parseChildJson(run(process.execPath, [cli, 'setup', '--root', repository, '--json'], { cwd: packageRoot, env }), 'Plugin setup discovery');
  if (setup.ok !== true || !Array.isArray(setup.adapters)) {
    throw new VerificationError('Packaged Plugin setup discovery did not return a valid registry snapshot.', setup);
  }
  const adapterIds = new Set(setup.adapters.map(adapter => adapter.id));
  for (const id of ['codex-cli', 'antigravity-cli', 'generic-cli']) {
    if (!adapterIds.has(id)) throw new VerificationError(`Packaged setup discovery is missing built-in adapter ${id}.`, setup);
  }

  run(process.execPath, [
    cli, 'install', '--codex', '--codex-home', join(home, '.codex'),
  ], { cwd: packageRoot, env: isolatedEnvironment(home) });

  const doctor = parseChildJson(run(process.execPath, [
    cli, 'doctor', '--codex', '--codex-home', join(home, '.codex'),
    '--root', repository, '--json',
  ], { cwd: packageRoot, env: doctorEnv }), 'Plugin doctor');
  if (doctor.ok !== true) throw new VerificationError('Packaged Plugin doctor did not pass in an isolated home.', doctor);

  return {
    version,
    setup: { ok: setup.ok, adapterCount: setup.adapters.length },
    doctor: { ok: doctor.ok },
    isolatedRepository: true,
    isolatedHome: true,
  };
}

function extractArtifact(artifact, tempRoot) {
  if (!existsSync(artifact)) throw new VerificationError(`Package artifact is missing: ${artifact}`);
  const metadata = lstatSync(artifact);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new VerificationError(`Package artifact is not a regular file: ${artifact}`);
  const extractionRoot = join(tempRoot, 'extract');
  mkdirSync(extractionRoot, { recursive: true });
  run('tar', ['-xzf', artifact, '-C', extractionRoot], { cwd: tempRoot, env: process.env });
  const packageRoot = join(extractionRoot, 'package');
  if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory()) {
    throw new VerificationError(`Package artifact did not extract a package/ directory: ${basename(artifact)}`);
  }
  assertNoSymlinks(packageRoot);
  return packageRoot;
}

function main() {
  const {
    artifact,
    expectedVersion,
    expectedSourceCommit,
    expectedTag,
  } = parseArgs(process.argv.slice(2));
  const tempRoot = mkdtempSync(join(tmpdir(), 'coordinate-agents-release-'));
  try {
    const packageRoot = extractArtifact(artifact, tempRoot);
    const identity = verifyIdentity(packageRoot, expectedVersion);
    const candidate = verifyCandidateFacts(identity.packageJson, expectedSourceCommit, expectedTag);
    const payload = verifyPayload(packageRoot);
    const home = join(tempRoot, 'example-home');
    mkdirSync(home, { recursive: true });
    const env = isolatedEnvironment(home);
    const example = verifyExternalExample(packageRoot, env);
    const runtime = verifyRuntime(packageRoot, tempRoot, env, identity.packageJson.version);
    console.log(JSON.stringify({
      ok: true,
      artifact,
      candidate,
      package: {
        name: identity.packageJson.name,
        version: identity.packageJson.version,
        repository: identity.packageJson.repository.url,
      },
      plugin: {
        name: identity.pluginJson.name,
        version: identity.pluginJson.version,
        repository: identity.pluginJson.repository,
      },
      payload,
      externalExample: example,
      runtime,
    }, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof VerificationError ? error.message : (error?.message || String(error));
  console.error(`Release artifact verification failed: ${message}`);
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
}
