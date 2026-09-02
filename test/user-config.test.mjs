import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  defaultUserConfig,
  readUserConfig,
  resolveAgentConfig,
  setUserConfigValue,
  userConfigPath,
  writeUserConfig,
} from '../skills/coordinate-agents/scripts/user-config.mjs';
import { runtimeSetupConfigure } from '../bin/coordinate-agents.mjs';
import { getAdapter } from '../skills/coordinate-agents/adapters/index.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hashOf(content) {
  return createHash('sha256').update(content).digest('hex');
}

function tempGitRepository(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Repository\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function fakeAgentCommand(directory, name) {
  mkdirSync(directory, { recursive: true });
  const script = join(directory, `${name}.cjs`);
  writeFileSync(
    script,
    "if (process.argv[2] === '--version') { console.log('coordinate-agents-test-fixture 1.0.0'); process.exit(0); }\nconsole.log('fixture agent invoked'); process.exit(0);\n",
    'utf8',
  );
  if (process.platform === 'win32') {
    const cmd = join(directory, `${name}.cmd`);
    writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return cmd;
  }
  const cmd = join(directory, name);
  writeFileSync(cmd, `#!${process.execPath}\nrequire(${JSON.stringify(script)});\n`, 'utf8');
  return cmd;
}

function saveHomeEnv() {
  return {
    COORDINATE_AGENTS_HOME: process.env.COORDINATE_AGENTS_HOME,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
}

function restoreHomeEnv(saved) {
  for (const key of ['COORDINATE_AGENTS_HOME', 'HOME', 'USERPROFILE']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

test('user configuration resolves under the injected home and preserves command precedence', () => {
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-'));
  try {
    const path = userConfigPath({ home });
    assert.equal(path, join(home, '.coordinate-agents', 'config.json'));
    assert.deepEqual(readUserConfig({ home }), defaultUserConfig());

    const config = readUserConfig({ home });
    setUserConfigValue(config, 'agent.antigravity.command', 'agy-proxy');
    setUserConfigValue(config, 'agent.antigravity.args', []);
    writeUserConfig(config, { home });

    assert.equal(readFileSync(path, 'utf8').includes('agy-proxy'), true);
    assert.deepEqual(resolveAgentConfig({ id: 'antigravity', adapter: 'antigravity-cli' }, readUserConfig({ home })), {
      id: 'antigravity',
      adapter: 'antigravity-cli',
      command: 'agy-proxy',
      args: [],
      commandSource: 'user',
      argsSource: 'user',
    });
    assert.equal(resolveAgentConfig({ id: 'antigravity', adapter: 'antigravity-cli', command: 'agy-special' }, readUserConfig({ home })).command, 'agy-special');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('writing user configuration creates only the user-level directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-persist-'));
  try {
    writeUserConfig({ version: 1, agents: { antigravity: { command: 'agy-proxy' } } }, { home });
    assert.ok(existsSync(join(home, '.coordinate-agents', 'config.json')));
    assert.equal(existsSync(join(home, 'skills')), false);
    assert.equal(existsSync(join(home, '.codex-plugin')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('real user config is byte-for-byte untouched by an isolated setup-configure transaction', async () => {
  const realPath = userConfigPath();
  const realExisted = existsSync(realPath);
  const realContent = realExisted ? readFileSync(realPath, 'utf8') : null;
  const realHash = realExisted ? hashOf(realContent) : null;

  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-sentinel-home-'));
  const repository = tempGitRepository('coordinate-agents-user-config-sentinel-repo-');
  const bin = join(home, 'bin');
  const command = fakeAgentCommand(bin, 'antigravity-fixture');
  const saved = saveHomeEnv();
  process.env.COORDINATE_AGENTS_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await runtimeSetupConfigure({
      root: repository,
      agent: 'antigravity',
      command,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });
    // The transaction wrote the isolated file, not the real one.
    const isolatedPath = userConfigPath({ home });
    assert.ok(existsSync(isolatedPath), 'isolated user config must exist');
    assert.ok(readFileSync(isolatedPath, 'utf8').includes('antigravity-fixture'));
    if (realExisted) {
      assert.equal(existsSync(realPath), true);
      assert.equal(readFileSync(realPath, 'utf8'), realContent, 'real config content must not change');
      assert.equal(hashOf(readFileSync(realPath, 'utf8')), realHash, 'real config hash must not change');
    } else {
      assert.equal(existsSync(realPath), false, 'real config must not be created');
    }
  } finally {
    restoreHomeEnv(saved);
    rmSync(home, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test('concurrent isolated configure runs do not cross-pollute each other or the real config', async () => {
  const realPath = userConfigPath();
  const realExisted = existsSync(realPath);
  const realContent = realExisted ? readFileSync(realPath, 'utf8') : null;

  const rootA = tempGitRepository('coordinate-agents-user-config-concurrent-a-');
  const rootB = tempGitRepository('coordinate-agents-user-config-concurrent-b-');
  const homeA = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-home-a-'));
  const homeB = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-home-b-'));
  const commandA = fakeAgentCommand(homeA, 'antigravity-a');
  const commandB = fakeAgentCommand(homeB, 'antigravity-b');
  const cli = join(packageRoot, 'bin', 'coordinate-agents.mjs');
  const saved = saveHomeEnv();

  function spawnConfigure(home, root, command) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [
        cli, 'setup', 'configure',
        '--root', root,
        '--agent', 'antigravity',
        '--command', command,
        '--adapter', 'generic-cli',
        '--args', '["{prompt}"]',
        '--json',
      ], {
        env: { ...process.env, COORDINATE_AGENTS_HOME: home, HOME: home, USERPROFILE: home },
        cwd: process.cwd(),
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += `${chunk}`; });
      child.stderr.on('data', chunk => { stderr += `${chunk}`; });
      child.once('error', reject);
      child.once('exit', code => {
        if (code !== 0) reject(new Error(`configure exited ${code}: ${stderr || stdout}`));
        else resolvePromise();
      });
    });
  }

  try {
    await Promise.all([
      spawnConfigure(homeA, rootA, commandA),
      spawnConfigure(homeB, rootB, commandB),
    ]);

    const configA = readUserConfig({ home: homeA });
    const configB = readUserConfig({ home: homeB });
    const serializedA = JSON.stringify(configA);
    const serializedB = JSON.stringify(configB);
    assert.ok(serializedA.includes('antigravity-a'), 'home A config carries its own command');
    assert.ok(serializedB.includes('antigravity-b'), 'home B config carries its own command');
    assert.equal(serializedA.includes('antigravity-b'), false, 'home A must not contain home B command');
    assert.equal(serializedB.includes('antigravity-a'), false, 'home B must not contain home A command');
    if (realExisted) {
      assert.equal(readFileSync(realPath, 'utf8'), realContent, 'real config must stay untouched');
    } else {
      assert.equal(existsSync(realPath), false, 'real config must not be created');
    }
  } finally {
    restoreHomeEnv(saved);
    rmSync(homeA, { recursive: true, force: true });
    rmSync(homeB, { recursive: true, force: true });
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test('exact command contract: defaults, precedence, and agy argument templates are never mixed', () => {
  const agyDefaults = resolveAgentConfig({ id: 'antigravity', adapter: 'antigravity-cli' });
  assert.equal(agyDefaults.command, 'agy');
  assert.equal(agyDefaults.commandSource, 'adapter-default');
  assert.equal(agyDefaults.args, undefined);
  assert.equal(agyDefaults.argsSource, null);

  const codexDefaults = resolveAgentConfig({ id: 'codex', adapter: 'codex-cli' });
  assert.equal(codexDefaults.command, 'codex');
  assert.equal(codexDefaults.commandSource, 'adapter-default');

  // User command overrides the Adapter default without touching the project.
  const userWins = resolveAgentConfig(
    { id: 'antigravity', adapter: 'antigravity-cli' },
    { version: 1, agents: { antigravity: { command: 'agy-proxy', args: ['{prompt}'] } } },
  );
  assert.equal(userWins.command, 'agy-proxy');
  assert.equal(userWins.commandSource, 'user');
  assert.deepEqual(userWins.args, ['{prompt}']);
  assert.equal(userWins.argsSource, 'user');

  // Project command and args override the user file; nothing is mixed.
  const projectWins = resolveAgentConfig(
    { id: 'antigravity', adapter: 'antigravity-cli', command: 'agy-project', args: ['--flag'] },
    { version: 1, agents: { antigravity: { command: 'agy-proxy', args: ['--prompt-interactive', '{prompt}'] } } },
  );
  assert.equal(projectWins.command, 'agy-project');
  assert.equal(projectWins.commandSource, 'project');
  assert.deepEqual(projectWins.args, ['--flag']);
  assert.equal(projectWins.argsSource, 'project');

  // An explicit saved command is never silently replaced by absence at a
  // higher level: user config stays authoritative until a project override
  // actually exists.
  const missingProject = resolveAgentConfig(
    { id: 'antigravity', adapter: 'antigravity-cli' },
    { version: 1, agents: { antigravity: { command: 'agy-proxy' } } },
  );
  assert.equal(missingProject.command, 'agy-proxy');
  assert.equal(missingProject.commandSource, 'user');
});

test('agy-proxy and agy templates launch with exactly their own arguments', () => {
  // Command resolution asserts the exact executable; here the *argument*
  // template fidelity is proven with a real executable that passes detection.
  // agy-proxy + [{prompt}]: the prompt template is replaced in place and the
  // adapter never injects its own --prompt-interactive flag.
  const proxy = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
    args: ['{prompt}'],
  });
  const proxySession = proxy.resolveSessionLaunch({ root: '.', initialPrompt: 'Implement feature', agent: 'antigravity', language: 'en' });
  assert.equal(proxySession.args.includes('Implement feature'), true);
  assert.equal(proxySession.args.filter(arg => arg === '--prompt-interactive').length, 1, 'never a duplicate interactive flag');
  assert.equal(proxySession.initialInputConsumed, true);

  // agy + [--prompt-interactive, {prompt}]: exactly that pair, no duplicate flag.
  const agy = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
    args: ['--prompt-interactive', '{prompt}'],
  });
  const agySession = agy.resolveSessionLaunch({ root: '.', initialPrompt: 'Implement feature', agent: 'antigravity', language: 'en' });
  assert.deepEqual(agySession.args, ['--prompt-interactive', 'Implement feature']);
  assert.equal(agySession.args.includes('--prompt-interactive'), true);
  assert.equal(agySession.args.filter(arg => arg === '--prompt-interactive').length, 1);
  assert.equal(agySession.initialInputConsumed, true);

  // A configured interactive flag with a missing value starts the session
  // with an empty value (the PTY receives the first instruction): the flag is
  // completed, never duplicated, and the prompt is not double-injected.
  const incomplete = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
    args: ['--prompt-interactive'],
  });
  const incompleteSession = incomplete.resolveSessionLaunch({ initialPrompt: 'Implement feature' });
  assert.deepEqual(incompleteSession.args, ['--prompt-interactive', '']);
  assert.equal(incompleteSession.initialInputConsumed, false);

  // Default Adapter surface (no user args) still yields agy's interactive form.
  const defaulted = getAdapter('antigravity-cli', { id: 'antigravity', command: process.execPath });
  const launch = defaulted.resolveLaunch({ prompt: 'Implement feature' });
  assert.deepEqual(launch.args, ['--prompt-interactive', 'Implement feature']);
});

test('test-runner discovery of the registration fixture never writes the real user config', () => {
  // node --test discovers every file under test/, including the child fixture.
  // Its registration flow must be inert under the runner (NODE_TEST_CONTEXT) so
  // the real user config is never touched even by full-suite discovery.
  const realPath = userConfigPath();
  const realExisted = existsSync(realPath);
  const realContent = realExisted ? readFileSync(realPath, 'utf8') : null;
  const fixture = join(packageRoot, 'test', 'support', 'external-adapter-registration-child.mjs');
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', fixture], {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (realExisted) {
    assert.equal(readFileSync(realPath, 'utf8'), realContent, 'real config must stay byte-for-byte identical');
  } else {
    assert.equal(existsSync(realPath), false, 'real config must not be created');
  }
});
