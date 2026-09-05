import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { createTask, setTaskStatus } from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import { createTaskGraph } from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { createInspectorServer, startWorkspace, startInspector } from '../inspector/server/server.mjs';
import {
  COMPOSER_TITLE_MAX,
  CHAT_MAX_OUTPUT,
  deriveComposerParams,
  deriveSessionChatEntry,
  renderSessionChatCard,
} from '../inspector/web-workspace/composer-model.mjs';
import {
  isActiveTerminalSession,
  selectTerminalPanes,
  TERMINAL_MAX_BYTES,
  TERMINAL_MAX_LINES,
} from '../inspector/web-workspace/terminal-model.mjs';

const root = process.cwd();
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function git(repositoryRoot, args) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'coordinate-agents-workspace-'));
  git(repositoryRoot, ['init', '-q']);
  git(repositoryRoot, ['config', 'user.email', 'workspace-test@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'Workspace Test']);
  writeFileSync(join(repositoryRoot, 'README.md'), '# Workspace fixture\n', 'utf8');
  git(repositoryRoot, ['add', '-A']);
  git(repositoryRoot, ['commit', '-qm', 'chore: workspace fixture baseline']);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', repositoryRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return realpathSync(repositoryRoot);
}

function taskFixture(repositoryRoot) {
  const task = createTask(repositoryRoot, {
    id: 'task-workspace',
    title: 'Build Workspace fixture',
    spec: 'Show the local control plane without changing Runtime state.',
  });
  setTaskStatus(repositoryRoot, task.id, 'PLANNING');
  setTaskStatus(repositoryRoot, task.id, 'SPEC_READY');
  return repositoryRoot;
}

function graphFixture(repositoryRoot) {
  createTaskGraph(repositoryRoot, {
    schemaVersion: 1,
    parentTask: {
      id: 'task-workspace-graph',
      title: 'Build Graph Workspace fixture',
      spec: 'Demonstrate persisted Task Graph readability in the Workspace.',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'sub-a', implementer: 'antigravity', spec: 'Implement component A.', dependsOn: [] },
      { id: 'sub-b', implementer: 'codex', spec: 'Implement component B.', dependsOn: ['sub-a'] },
    ],
    maxConcurrency: 1,
  }, {
    configuredAgents: [{ id: 'codex', adapter: 'codex-cli' }, { id: 'antigravity', adapter: 'generic-cli' }],
  });
  return repositoryRoot;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const port = server.address().port;
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolvePromise => server.close(resolvePromise));
}

test('Web Workspace renders the repository and the dual-terminal task workbench', async () => {
  const repositoryRoot = taskFixture(repository());
  graphFixture(repositoryRoot);
  const expectedBranch = git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    assert.equal(started.server.address().address, '127.0.0.1');
    assert.equal(started.url, `http://localhost:${started.port}`);

    const page = await (await fetch(`${started.url}/`)).text();
    assert.match(page, /Coordinate Agents Workspace/);
    assert.match(page, /BOUND REPOSITORY/);
    assert.match(page, /id="repository"/);
    assert.match(page, /id="repo-name"/);
    assert.match(page, /id="repo-branch"/);
    assert.match(page, /id="workspace-task-list"/);
    assert.match(page, /id="agent-terminal-grid"/);
    assert.match(page, /Codex and Antigravity terminals/);
    assert.match(page, /id="terminal-settings-button"/);
    assert.match(page, /id="terminal-settings-dialog"/);
    assert.doesNotMatch(page, /id="composer"|id="chat-feed"|id="graph-map"|id="view-agents"|id="view-sessions"|id="view-activity"/);

    const repositoryFacts = await (await fetch(`${started.url}/api/repository`)).json();
    assert.equal(repositoryFacts.root, repositoryRoot);
    assert.equal(repositoryFacts.name, basename(repositoryRoot));
    assert.equal(repositoryFacts.branch, expectedBranch);
    assert.equal(repositoryFacts.detached, false);
    assert.ok(repositoryFacts.head);
    assert.match(repositoryFacts.head.short, /^[0-9a-f]{4,}$/);
    assert.equal(repositoryFacts.head.subject, 'chore: workspace fixture baseline');
    assert.equal(repositoryFacts.remoteUrl, null);
    assert.equal(repositoryFacts.error, undefined);

    const tasks = await (await fetch(`${started.url}/api/tasks`)).json();
    assert.equal(tasks.length, 2);
    assert.ok(tasks.some(item => item.id === 'task-workspace' && item.graph === false));
    const graphParent = tasks.find(item => item.graph === true);
    assert.ok(graphParent, 'Task Graph parent must appear in the Workspace overview');
    assert.equal(graphParent.id, 'task-workspace-graph');
    assert.equal(graphParent.subtaskCount, 2);

    const workspaceTasks = await (await fetch(`${started.url}/api/workspace-tasks`)).json();
    assert.deepEqual(workspaceTasks, [], 'standard Task and Graph records stay hidden from the Workspace task list');

    const workspaceSettings = await (await fetch(`${started.url}/api/workspace-settings`)).json();
    assert.deepEqual(Object.keys(workspaceSettings).sort(), ['antigravity', 'codex']);
    assert.equal(workspaceSettings.codex.adapter, 'codex-cli');
    assert.equal(workspaceSettings.antigravity.adapter, 'antigravity-cli');
    assert.ok(workspaceSettings.codex.command);
    assert.ok(workspaceSettings.antigravity.command);

    // Persisted #36 Task Graph records remain readable through the Workspace.
    const graphDetail = await (await fetch(`${started.url}/api/tasks/task-workspace-graph`)).json();
    assert.equal(graphDetail.graph, true);
    assert.equal(graphDetail.subtasks.length, 2);
    assert.deepEqual(graphDetail.subtasks.find(item => item.id === 'sub-b').dependsOn, ['sub-a']);

    const js = await (await fetch(`${started.url}/app.js`)).text();
    assert.match(js, /renderRepository/);
    assert.match(js, /\/api\/workspace-tasks/);
    assert.match(js, /workspaceTaskCreate/);
    assert.match(js, /workspace-settings/);
    assert.match(js, /setupConfigure/);
    assert.match(js, /sessionResize/);
    assert.doesNotMatch(js, /\/api\/tasks/);
    const css = await (await fetch(`${started.url}/styles.css`)).text();
    assert.match(css, /\.repository-card/);
    assert.match(css, /\.terminal-grid/);
    assert.match(css, /\.repo-facts/);
    assert.match(css, /overflow-x: hidden/);

    const mutation = await fetch(`${started.url}/api/repository`, { method: 'POST' });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET');
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('coordinate-agents web CLI starts the localhost Workspace on a selected port', async () => {
  const repositoryRoot = taskFixture(repository());
  const port = await freePort();
  const child = spawn(process.execPath, [cli, 'web', '--root', repositoryRoot, '--port', `${port}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  const started = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Workspace CLI did not start. stdout=${stdout} stderr=${stderr}`)), 8_000);
    child.stdout.on('data', chunk => {
      stdout += `${chunk}`;
      if (stdout.includes(`http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
    child.stderr.on('data', chunk => { stderr += `${chunk}`; });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  try {
    await started;
    const page = await (await fetch(`http://localhost:${port}/`)).text();
    assert.match(page, /Coordinate Agents Workspace/);
    const repositoryFacts = await (await fetch(`http://localhost:${port}/api/repository`)).json();
    assert.equal(repositoryFacts.root, repositoryRoot);
    const tasks = await (await fetch(`http://localhost:${port}/api/tasks`)).json();
    assert.equal(tasks[0].id, 'task-workspace');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Web Workspace page loads, task selection, and event reads stay strictly read-only', async () => {
  const repositoryRoot = taskFixture(repository());
  graphFixture(repositoryRoot);
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    function snapshotDir(directory) {
      const entries = [];
      function walk(current) {
        if (!existsSync(current)) return;
        for (const name of readdirSync(current).sort()) {
          const full = join(current, name);
          entries.push(full.slice(directory.length));
          try {
            const stat = readFileSync(full);
            entries.push(stat.byteLength);
          } catch {
            walk(full);
          }
        }
      }
      walk(directory);
      return entries;
    }

    const before = snapshotDir(join(repositoryRoot, '.agent-bus'));

    await fetch(`${started.url}/api/repository`);
    await fetch(`${started.url}/api/tasks`);
    await fetch(`${started.url}/api/tasks/task-workspace`);
    await fetch(`${started.url}/api/tasks/task-workspace-graph`);
    await fetch(`${started.url}/api/workspace-tasks`);
    await fetch(`${started.url}/api/agents`);
    await fetch(`${started.url}/api/sessions`);
    await fetch(`${started.url}/api/events?limit=100`);
    await fetch(`${started.url}/api/events/stream`, { signal: AbortSignal.timeout(150) }).catch(() => {});

    const after = snapshotDir(join(repositoryRoot, '.agent-bus'));
    assert.deepEqual(before, after, 'Workspace reads must not create Bus files, Sessions, events, or state transitions');

    const porcelain = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    assert.equal(porcelain.status, 0);
    assert.equal(porcelain.stdout.trim(), '', 'Workspace reads must not dirty the Git worktree');
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Web Workspace fails closed for non-Git, missing, and uncommitted-unsafe entry points', async () => {
  const repositoryRoot = taskFixture(repository());
  const plainDirectory = mkdtempSync(join(tmpdir(), 'coordinate-agents-workspace-plain-'));
  try {
    // Direct server entry requires an initialized Git repository.
    assert.throws(() => startWorkspace({ root: plainDirectory, port: 0 }), /initialized Git repository/);
    assert.throws(() => startWorkspace({ root: join(plainDirectory, 'missing'), port: 0 }), /initialized Git repository/);

    // CLI entry fails closed with the documented repository error.
    for (const badRoot of [plainDirectory, join(plainDirectory, 'missing')]) {
      const result = spawnSync(process.execPath, [cli, 'web', '--root', badRoot], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(result.status, 1, badRoot);
      assert.match(result.stderr || result.stdout, /Not a Git repository/);
    }
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(plainDirectory, { recursive: true, force: true });
  }
});

test('Web Workspace hides standard Task Graph UI while compatibility APIs remain readable', async () => {
  const repositoryRoot = graphFixture(taskFixture(repository()));
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    const page = await (await fetch(`${started.url}/`)).text();
    assert.doesNotMatch(page, /graph-map|Task Graph|Graph dependency/);
    assert.match(page, /id="workspace-task-list"/);
    assert.match(page, /id="agent-terminal-grid"/);

    const js = await (await fetch(`${started.url}/app.js`)).text();
    assert.doesNotMatch(js, /renderGraphMap|graphNodeLevels|GRAPH_MAP_MAX_NODES|graph-map-edge/);

    const css = await (await fetch(`${started.url}/styles.css`)).text();
    assert.doesNotMatch(css, /graph-map-region|graph-map-canvas|graph-map-node|graph-map-edge/);

    // The map consumes the bounded authoritative graph detail API; facts are
    // not invented in the browser.
    const detail = await (await fetch(`${started.url}/api/graphs/task-workspace-graph`)).json();
    assert.equal(detail.graph, true);
    assert.ok(detail.subtasks.length >= 2);
    for (const subtask of detail.subtasks) {
      assert.ok(typeof subtask.implementer === 'string');
      assert.ok(subtask.agent && typeof subtask.agent.adapter === 'string');
    }
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Workspace metadata ships in the package payload, CLI help, and web assets directory', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(packageJson.files.includes('inspector'));
  assert.ok(existsSync(join(root, 'inspector', 'web-workspace', 'index.html')));
  assert.ok(existsSync(join(root, 'inspector', 'web-workspace', 'app.js')));
  assert.ok(existsSync(join(root, 'inspector', 'web-workspace', 'styles.css')));
  const help = spawnSync(process.execPath, [cli, 'help', '--lang', 'en'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /web\s+Launch the local Web Workspace over the selected Git repository/);
  assert.match(help.stdout, /inspector\s+Start the local read-only Web UI Inspector/);
});

test('chat composer keeps the full single-line input as the Task spec', () => {
  // Regression: a single-line prompt previously lost its spec entirely.
  const single = deriveComposerParams('Fix the login redirect');
  assert.equal(single.title, 'Fix the login redirect');
  assert.equal(single.spec, 'Fix the login redirect');
  assert.equal(single.firstLine, single.title);
});

test('chat composer writes multi-line input whole and truncates only the title safely', () => {
  const multi = deriveComposerParams('  First line title\n\nSecond paragraph with details.\nThird line.  ');
  assert.equal(multi.title, 'First line title');
  assert.equal(multi.spec, 'First line title\n\nSecond paragraph with details.\nThird line.');
  assert.equal(multi.firstLine, 'First line title');
  assert.ok(multi.spec.length > multi.title.length, 'the spec is never truncated');

  const longLine = 'x'.repeat(COMPOSER_TITLE_MAX + 40);
  const truncated = deriveComposerParams(longLine);
  assert.equal(truncated.title.length, COMPOSER_TITLE_MAX);
  assert.equal(truncated.spec, longLine, 'spec must stay intact when the title is shortened');
  assert.equal(truncated.title, longLine.slice(0, COMPOSER_TITLE_MAX));

  assert.equal(deriveComposerParams('   \n  '), null, 'blank composer input creates nothing');
});

test('Workspace serves the composer model module for the browser bundle', async () => {
  const repositoryRoot = taskFixture(repository());
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    const response = await fetch(`${started.url}/composer-model.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    const body = await response.text();
    assert.match(body, /export function deriveComposerParams/);
    assert.match(body, /COMPOSER_TITLE_MAX/);

    const terminalModel = await (await fetch(`${started.url}/terminal-model.mjs`)).text();
    assert.match(terminalModel, /selectTerminalPanes/);
    const xterm = await fetch(`${started.url}/vendor/xterm.js`);
    assert.equal(xterm.status, 200);
    assert.match(xterm.headers.get('content-type'), /text\/javascript/);
    assert.match(await xterm.text(), /Terminal/);
    const xtermCss = await fetch(`${started.url}/vendor/xterm.css`);
    assert.equal(xtermCss.status, 200);
    assert.match(xtermCss.headers.get('content-type'), /text\/css/);
    const missingSession = await fetch(`${started.url}/api/sessions/session_missing1/read`);
    assert.equal(missingSession.status, 404);
    assert.match((await missingSession.json()).code, /SESSION_NOT_FOUND/);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Workspace terminal panes only select the saved Codex and Antigravity pair', () => {
  const panes = selectTerminalPanes({
    workspaceTask: {
      id: 'workspace-terminal-12345678',
      sessions: {
        codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: 'session-codex-new' },
        antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: 'session-task' },
      },
    },
  });
  assert.equal(panes.length, 2);
  assert.deepEqual(panes.map(pane => pane.agentId), ['codex', 'antigravity']);
  assert.deepEqual(panes.map(pane => pane.sessionId), ['session-codex-new', 'session-task']);
  assert.ok(panes.every(pane => pane.source === 'workspace-task'));

  const empty = selectTerminalPanes({
    workspaceTask: {
      sessions: {
        codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: null },
        antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null },
      },
    },
    count: 2,
  });
  assert.equal(empty.length, 2);
  assert.ok(empty.every(pane => pane.source === 'none' && pane.sessionId === null));
  assert.equal(isActiveTerminalSession({ status: 'running' }), true);
  assert.equal(isActiveTerminalSession({ state: 'exited' }), false);
  assert.equal(TERMINAL_MAX_LINES, 200);
  assert.equal(TERMINAL_MAX_BYTES, 32 * 1024);
});

test('Workspace exposes bounded cursor Session reads but Inspector does not', async () => {
  const repositoryRoot = taskFixture(repository());
  const payloads = [];
  const data = {
    async readSessionOutput(sessionId, options) {
      payloads.push({ sessionId, options });
      return {
        session: {
          id: sessionId,
          agent: 'codex',
          state: 'running',
          exitCode: null,
          signal: null,
          error: null,
        },
        output: {
          output: '\u001b[32mhello',
          nextCursor: 9,
          truncated: false,
        },
      };
    },
  };
  const server = createInspectorServer({ root: repositoryRoot, data, ui: 'workspace' });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/session_terminal/read?cursor=7&maxLines=999&maxBytes=999999`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.session.id, 'session_terminal');
    assert.equal(body.output.nextCursor, 9);
    assert.equal(body.output.output, '\u001b[32mhello');
    assert.deepEqual(payloads[0], {
      sessionId: 'session_terminal',
      options: { cursor: 7, maxLines: 200, maxBytes: 32 * 1024 },
    });

    const inspector = createInspectorServer({ root: repositoryRoot, data, ui: 'inspector' });
    await new Promise((resolvePromise, reject) => {
      inspector.once('error', reject);
      inspector.listen(0, '127.0.0.1', resolvePromise);
    });
    try {
      const missing = await fetch(`http://127.0.0.1:${inspector.address().port}/api/sessions/session_terminal/read`);
      assert.equal(missing.status, 404);
    } finally {
      await closeServer(inspector);
    }
  } finally {
    await closeServer(server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector does not return 500 for Workspace-only composer model asset', async () => {
  const repositoryRoot = taskFixture(repository());
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    const response = await fetch(`${started.url}/composer-model.mjs`);
    assert.notEqual(response.status, 500, 'Inspector must not return 500 for missing composer model');
    assert.equal(response.status, 404);
    const jsonBody = await response.json();
    assert.match(jsonBody.error, /not found/i);

    // Inspector still serves its own valid assets:
    const indexRes = await fetch(`${started.url}/index.html`);
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.headers.get('content-type'), /text\/html/);
    const appRes = await fetch(`${started.url}/app.js`);
    assert.equal(appRes.status, 200);
    assert.match(appRes.headers.get('content-type'), /text\/javascript/);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Session output card uses current Task sessionId and ignores mismatched sessions', () => {
  const task = { id: 'task-abc', sessionId: 'session-target-123', implementer: 'codex' };
  const matchingSession = {
    sessionId: 'session-target-123',
    agent: 'codex',
    status: 'running',
    recentOutput: 'agent compiling code...',
  };
  const mismatchedSession = {
    sessionId: 'session-other-999',
    agent: 'antigravity',
    status: 'running',
    recentOutput: 'unrelated output',
  };

  // Matching session produces an entry with matching sessionId
  const entry = deriveSessionChatEntry(task, matchingSession);
  assert.ok(entry);
  assert.equal(entry.kind, 'session');
  assert.equal(entry.sessionId, 'session-target-123');
  assert.match(entry.title, /codex/);
  assert.match(entry.body, /agent compiling code/);

  // Mismatched session returns null (never attached to the wrong task)
  assert.equal(deriveSessionChatEntry(task, mismatchedSession), null);

  // Task without sessionId returns null
  assert.equal(deriveSessionChatEntry({ id: 'task-no-session' }, matchingSession), null);
  assert.equal(deriveSessionChatEntry(null, matchingSession), null);
});

test('Session chat entry handles no output, running, ended, failed, and review states', () => {
  const task = { id: 'task-states', sessionId: 'session-s1' };

  // 1. 无输出 (no output) - localized fallback, no invented agent reply
  const noOutputSession = {
    sessionId: 'session-s1',
    agent: 'codex',
    status: 'running',
    recentOutput: '   ',
  };
  const noOutputEn = deriveSessionChatEntry(task, noOutputSession, { locale: 'en-US' });
  assert.equal(noOutputEn.body, 'No recent output available.');
  const noOutputZh = deriveSessionChatEntry(task, noOutputSession, { locale: 'zh-CN' });
  assert.equal(noOutputZh.body, '暂无输出');

  // 2. 运行中 (running)
  const runningSession = {
    sessionId: 'session-s1',
    agent: 'antigravity',
    status: 'running',
    recentOutput: 'Step 1: analyzing workspace...',
  };
  const runningEntry = deriveSessionChatEntry(task, runningSession, { locale: 'zh-CN' });
  assert.equal(runningEntry.pill, 'running');
  assert.equal(runningEntry.dot, 'running');
  assert.equal(runningEntry.body, 'Step 1: analyzing workspace...');
  assert.match(runningEntry.sub, /session-s1/);

  // 3. 已结束 (ended / exited) - exitCode and signal facts
  const exitedSuccess = {
    sessionId: 'session-s1',
    agent: 'codex',
    status: 'exited',
    exitCode: 0,
    signal: null,
    recentOutput: 'Build succeeded.',
  };
  const exitSuccessEntry = deriveSessionChatEntry(task, exitedSuccess, { locale: 'zh-CN' });
  assert.equal(exitSuccessEntry.pill, 'exited');
  assert.equal(exitSuccessEntry.dot, 'ok');
  assert.match(exitSuccessEntry.sub, /退出代码 0/);

  const exitedSignal = {
    sessionId: 'session-s1',
    agent: 'codex',
    status: 'exited',
    exitCode: 137,
    signal: 'SIGKILL',
    recentOutput: 'Killed',
  };
  const exitSignalEntry = deriveSessionChatEntry(task, exitedSignal, { locale: 'en-US' });
  assert.equal(exitSignalEntry.pill, 'exited');
  assert.equal(exitSignalEntry.dot, 'failed');
  assert.match(exitSignalEntry.sub, /exit 137/);
  assert.match(exitSignalEntry.sub, /signal SIGKILL/);

  // 4. 失败 (failed / error) - includes error details
  const failedSession = {
    sessionId: 'session-s1',
    agent: 'antigravity',
    status: 'failed',
    error: 'Spawn ENOENT agy-proxy',
    recentOutput: '',
  };
  const failedEntry = deriveSessionChatEntry(task, failedSession, { locale: 'zh-CN' });
  assert.equal(failedEntry.pill, 'failed');
  assert.equal(failedEntry.dot, 'failed');
  assert.match(failedEntry.sub, /错误: Spawn ENOENT agy-proxy/);
  assert.match(failedEntry.raw, /Spawn ENOENT agy-proxy/);

  // 5. 等待中 (waiting) and 评审中 (reviewing) and 已停止 (stopped)
  const waitingSession = { sessionId: 'session-s1', status: 'waiting', recentOutput: '' };
  assert.equal(deriveSessionChatEntry(task, waitingSession).dot, 'waiting');

  const reviewingSession = { sessionId: 'session-s1', status: 'reviewing', recentOutput: '' };
  assert.equal(deriveSessionChatEntry(task, reviewingSession).dot, 'reviewing');

  const stoppedSession = { sessionId: 'session-s1', status: 'stopped', recentOutput: '' };
  assert.equal(deriveSessionChatEntry(task, stoppedSession).dot, 'stopped');

  // HTML escaping check
  const xssSession = {
    sessionId: 'session-s1',
    agent: '<script>alert(1)</script>',
    status: 'running',
    recentOutput: '<b>output</b>',
  };
  const cardHtml = renderSessionChatCard(task, xssSession);
  assert.ok(!cardHtml.includes('<script>'), 'agent name must be escaped');
  assert.ok(cardHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(cardHtml.includes('&lt;b&gt;output&lt;/b&gt;'), 'output body must be escaped');
  assert.ok(cardHtml.includes('data-session-id="session-s1"'));

  // Bounded output length check
  const hugeSession = {
    sessionId: 'session-s1',
    status: 'running',
    recentOutput: 'a'.repeat(CHAT_MAX_OUTPUT + 100),
  };
  const boundedEntry = deriveSessionChatEntry(task, hugeSession);
  assert.equal(boundedEntry.body.length, CHAT_MAX_OUTPUT);
});

test('Bilingual Workspace text describes the fixed dual-terminal flow', () => {
  const appJs = readFileSync(join(root, 'inspector', 'web-workspace', 'app.js'), 'utf8');

  assert.match(appJs, /Create a task to open fresh Codex and Antigravity terminals/);
  assert.match(appJs, /新建任务会打开全新的 Codex 与 Antigravity 终端/);
  assert.match(appJs, /workspaceTaskCreate/);
  assert.match(appJs, /workspaceTaskRestart/);
  assert.equal(appJs.includes('Nothing runs automatically'), false);
});
