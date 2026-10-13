#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = '@hogancv/coordinate-agents';
const REPOSITORY_URL = 'https://github.com/hogancv/coordinate-agents';
const MAX_OUTPUT = 20_000;

const REQUIRED_FILES = [
  'bin/coordinate-agents.mjs', 'lib/web-cli.mjs',
  'inspector/server/workspace-server.mjs', 'inspector/server/http-server.mjs',
  'inspector/server/workspace-data.mjs', 'inspector/server/action-gateway.mjs',
  'inspector/server/workspace-projects.mjs', 'inspector/server/native-folder-picker.mjs',
  ...['index.html', 'app.js', 'styles.css', 'composer-model.mjs', 'terminal-model.mjs', 'vendor/xterm.js', 'vendor/xterm.css', 'vendor/xterm.LICENSE'].map(file => `inspector/web-workspace/${file}`),
  ...['pty-runtime', 'session-host', 'session-manager', 'session-service', 'workspace-task-runtime', 'workspace-message', 'workspace-services', 'workspace-init', 'config', 'user-config', 'runtime-contract', 'runtime-events', 'workspace-role-prompts'].map(file => `skills/coordinate-agents/scripts/${file}.mjs`),
  ...['index', 'base', 'codex-cli', 'antigravity-cli', 'generic-cli', 'executable', 'contract-v1', 'trusted-local'].map(file => `skills/coordinate-agents/adapters/${file}.mjs`),
  'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE', 'package.json',
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
  if (packageJson.name !== PACKAGE_NAME) throw new VerificationError(`Unexpected package name: ${packageJson.name}`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(packageJson.version) || packageJson.version !== expectedVersion) throw new VerificationError(`Expected stable package version ${expectedVersion}, received ${packageJson.version}`);
  if (packageJson.repository?.url !== `git+${REPOSITORY_URL}.git`) throw new VerificationError('Unexpected package repository URL.');
  if (packageJson.bin?.['coordinate-agents'] !== 'bin/coordinate-agents.mjs') throw new VerificationError('npm bin does not point at the Web executable.');
  if (JSON.stringify(packageJson.exports) !== JSON.stringify({ './package.json': './package.json' })) throw new VerificationError('npm exports must contain only package metadata.');
  if (packageJson.dependencies?.['node-pty'] !== '1.1.0') throw new VerificationError('Expected production node-pty dependency.');
  return { packageJson };
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

export function verifyPayload(packageRoot) {
  const manifest = readJson(join(packageRoot, 'package.json'), 'package.json');
  const allowed = new Set(REQUIRED_FILES);
  if (!Array.isArray(manifest.files) || manifest.files.some(file => !allowed.has(file))) throw new VerificationError('Package files must be an exact Web runtime whitelist.');
  const files = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else { assertRegularFile(path, 'payload entry'); files.push(relative(packageRoot, path).split(sep).join('/')); }
    }
  }
  scan(packageRoot);
  for (const file of REQUIRED_FILES) assertRegularFile(join(packageRoot, file), file);
  for (const file of files) if (!allowed.has(file)) throw new VerificationError(`Unexpected or Legacy payload file: ${file}`);
  const imports = [];
  for (const file of files.filter(file => file.endsWith('.mjs') || file.endsWith('.js'))) {
    const source = readFileSync(join(packageRoot, file), 'utf8');
    const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']|new URL\(\s*["']([^"']+)["']\s*,\s*import.meta.url/g;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] || match[2];
      if (!specifier.startsWith('.')) continue;
      const target = resolve(packageRoot, file, '..', specifier);
      const local = relative(packageRoot, target).split(sep).join('/');
      if (local.startsWith('../') || !existsSync(target)) throw new VerificationError(`Unresolved runtime reference: ${file} -> ${specifier}`);
      imports.push({ file, target: local });
    }
  }
  return { files: files.length, runtimeReferences: imports.length, legacyAbsent: true };
}

function npmInstall(artifact, consumer, env) {
  const npmEntry = process.env.npm_execpath;
  if (npmEntry && existsSync(npmEntry)) return run(process.execPath, [npmEntry, 'install', '--omit=dev', '--no-audit', '--no-fund', artifact], { cwd: consumer, env });
  if (process.platform === 'win32') {
    const nodeDir = resolve(process.execPath, '..');
    const candidate = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!existsSync(candidate)) throw new VerificationError('Cannot locate npm-cli.js; run via npm run release:verify.');
    return run(process.execPath, [candidate, 'install', '--omit=dev', '--no-audit', '--no-fund', artifact], { cwd: consumer, env });
  }
  return run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', artifact], { cwd: consumer, env });
}

export function extractArtifact(artifact, tempRoot) {
  if (!existsSync(artifact)) throw new VerificationError(`Package artifact is missing: ${artifact}`);
  const metadata = lstatSync(artifact);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new VerificationError(`Package artifact is not a regular file: ${artifact}`);
  const extractionRoot = join(tempRoot, 'extract');
  mkdirSync(extractionRoot, { recursive: true });
  const tarFlags = detectTarExtractionFlags();
  // GNU tar needs --force-local to treat Windows drive-letter paths (C:\…)
  // as local files instead of remote hosts. BSD tar (macOS/bsdtar) does not
  // understand that GNU-only flag, so it must never receive it.
  const entries = run('tar', ['-tzf', artifact, ...tarFlags], { cwd: tempRoot }).stdout.trim().split(/\r?\n/);
  if (entries.some(entry => !entry.startsWith('package/') || entry.split(/[\\/]/).includes('..'))) throw new VerificationError('Unsafe artifact entry path.');
  // A process cwd is portable across BSD tar and Git Bash's GNU tar. The
  // latter accepts the archive with --force-local but rejects native Windows
  // absolute directory arguments to -C. Extraction remains isolated here.
  run('tar', ['-xzf', artifact, ...tarFlags], { cwd: extractionRoot, env: process.env });
  const packageRoot = join(extractionRoot, 'package');
  if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory()) {
    throw new VerificationError(`Package artifact did not extract a package/ directory: ${basename(artifact)}`);
  }
  assertNoSymlinks(packageRoot);
  return packageRoot;
}

export function selectTarExtractionFlags(versionOutput) {
  // Capability detection, not platform guessing: only a GNU tar receives the
  // GNU-only --force-local flag; BSD tar (bsdtar) handles drive letters and
  // must not be passed flags it rejects.
  return /GNU tar/i.test(`${versionOutput || ''}`) ? ['--force-local'] : [];
}

export function detectTarExtractionFlags() {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8', windowsHide: true });
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  return selectTarExtractionFlags(output);
}

export function loaderNodeOptions(loader) {
  return `--experimental-loader=${pathToFileURL(loader).href}`;
}

async function main() {
  const { artifact, expectedVersion, expectedSourceCommit, expectedTag } = parseArgs(process.argv.slice(2));
  const tempRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'coordinate-agents-release-')));
  try {
    const packageRoot = extractArtifact(artifact, tempRoot);
    const { packageJson } = verifyIdentity(packageRoot, expectedVersion);
    const candidate = verifyCandidateFacts(packageJson, expectedSourceCommit, expectedTag);
    const payload = verifyPayload(packageRoot);
    const home = join(tempRoot, 'isolated-home');
    const consumer = join(tempRoot, 'consumer');
    mkdirSync(home, { recursive: true }); mkdirSync(consumer, { recursive: true });
    const env = isolatedEnvironment(home, { NODE_PATH: '', NODE_OPTIONS: '' });
    // npm must execute dependency installation scripts, unlike pack/publish.
    npmInstall(artifact, consumer, env);
    const installed = join(consumer, 'node_modules', '@hogancv', 'coordinate-agents');
    verifyPayload(installed);
    const checker = join(consumer, 'verify-workspace-install.mjs');
    writeFileSync(checker, readFileSync(new URL('./verify-workspace-install.mjs', import.meta.url)));
    const loader = join(consumer, 'trace-loader.mjs');
    const trace = join(consumer, 'loaded-modules.txt');
    writeFileSync(loader, `import { appendFileSync } from 'node:fs';
export async function load(url, context, next) { if (url.startsWith('file:')) appendFileSync(${JSON.stringify(trace)},url+'\\n'); return next(url,context); }`);
    const runtime = parseChildJson(run(process.execPath, [checker, installed, consumer, expectedVersion], { cwd: consumer, env: { ...env, NODE_OPTIONS: loaderNodeOptions(loader) } }), 'installed Web acceptance');
    if (runtime.ok !== true) throw new VerificationError('Installed Workspace acceptance failed.', runtime);
    const loaded = readFileSync(trace, 'utf8').trim().split(/\r?\n/);
    if (loaded.some(url => /cli-core|task-graph|\/task-runtime\.mjs|agent-bus\.mjs|runtime-services\.mjs|inspector-data|conformance/.test(url))) throw new VerificationError('Workspace loaded Legacy code.');
    console.log(JSON.stringify({ ok: true, artifact, candidate, package: { name: packageJson.name, version: packageJson.version, repository: packageJson.repository.url }, payload, installation: { productionDependencies: true, isolatedHome: true, isolatedConsumer: true, loadedModules: new Set(loaded).size }, runtime }, null, 2));
  } finally { rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof VerificationError ? error.message : (error?.message || String(error));
    console.error(`Release artifact verification failed: ${message}`);
    if (error?.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  }
}
