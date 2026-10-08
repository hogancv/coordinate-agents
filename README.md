# Coordinate Agents

[简体中文](./README.zh-CN.md) · [Documentation](./docs/index.md) · [Security](./SECURITY.md)

Coordinate Agents is a local Web Workspace for Codex + Antigravity collaboration.
**npm 3.0.0 is the Web-first distribution**: a small standalone workbench with
paired terminals, project/task persistence and lightweight role prompts.

```sh
npx @hogancv/coordinate-agents@latest web
# Select a folder and port (0 selects a free port):
npx @hogancv/coordinate-agents@3.0.0 web --root "/path/to/project" --port 3000
```

Install Node.js >=18, Git, and the Codex/Antigravity CLIs separately; sign in to
each CLI before starting a task. Open the printed localhost URL. Use terminal
settings for custom commands such as `agy-proxy`, Codex model and reasoning.
Create a task, enter requirements in Codex, and let it send the implementation
to the task's Antigravity through `workspace-message`. Codex reviews the reply
and reports to you. Multiple projects, raw terminal I/O, resize, close/restart,
refresh and reconnection to independent Session Hosts remain available.

Native PTY availability follows the existing platform policy: Node 18 and
Windows Node >=22 use the owned stdio fallback; supported native combinations
use node-pty. A fallback preserves Session I/O/lifecycle but may not support an
agent's full interactive TUI. Node 18 support is retained; upgrading Node is
appropriate when your installed CLI requires native terminal behavior.

The **GitHub Plugin / Legacy CLI / MCP / Task Graph source remains complete**, including its local-first coordination protocol and runtime.
Install the GitHub Plugin for structured collaboration; its version is managed
independently (currently 2.4.0). npm 3.x excludes Plugin manifests, Skill
resources, MCP, Task Graph, Adapter SDK/conformance/examples, tests and developer
tooling. Only the required shared `.mjs` modules remain under `skills/` in the
tarball; this is not a packaged Codex Skill. No build or prepack step is needed.

## Two collaboration modes

| Mode | Execution and guarantees |
| --- | --- |
| Web Workspace | Fresh paired PTYs, lightweight role prompts, and task-bound terminal messaging. Enter requirements in Codex; Antigravity implements. No automatic skill invocation or Task/Graph lifecycle. |
| Structured Skill / CLI / MCP | Agent Bus messages, durable Tasks and Task Graphs, recorded implementation evidence, review decisions, and explicit recovery. |

Web task-group status describes terminal lifecycle, **not implementation or review completion**. Role prompts guide agent behavior; they are not an enforced workflow state machine. Both modes retain explicit user authorization for commit, push, and release as applicable to their workflow. The Web prompt forbids these actions without authorization.

### Web Workspace preview

The Web Workspace pairs Codex with a configured Implementer in a local,
side-by-side browser workspace:

![Web Workspace preview](https://raw.githubusercontent.com/hogancv/coordinate-agents/main/assets/web-workspace.jpg)

The end-to-end terminal recording below shows the same lightweight workflow
in action:

![End-to-end terminal demo](https://raw.githubusercontent.com/hogancv/coordinate-agents/main/assets/demo.gif)

The recording comes from `npm run demo` in an isolated Git repository. Its sanitized source transcript is available at [assets/demo-transcript.txt](./assets/demo-transcript.txt).

## Why Coordinate Agents

A capable coding agent can work alone. Coordination becomes useful when you want a second agent to implement while Codex keeps the specification and review boundary clear.

- Codex clarifies the task, records acceptance criteria, dispatches work, and reviews evidence.
- A configured Implementer CLI edits code and runs tests inside an owned execution session.
- The Agent Bus preserves task, message, review, session, and recovery facts locally.
- Release actions stay separate from implementation and require explicit user authorization.

## How the structured workflow works

```text
You
 |
 v
Codex: clarify -> specify -> dispatch --------------------+
 |                                                        |
 v                                                        |
Local Agent Bus -> configured adapter -> Implementer CLI  |
 ^                                      |                 |
 |                                      v                 |
 +----------- durable result + evidence -----------------+
 |
 v
Codex: review -> approve changes or request rework
```

The runtime owns only sessions it creates. Healthy sessions can be reused for review rework; failed or exited sessions require an explicit new dispatch. Detailed task, message, and session contracts live in the [protocol documentation](./docs/protocol.md).

## Quick Start

Install the Plugin from the canonical GitHub marketplace:

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

Then open a Git repository in Codex App and start with one of these prompts:

```text
Use $coordinate-agents to inspect this repository and explain the available coordination setup.
```

```text
Use $coordinate-agents to configure my installed Antigravity or other coding-agent CLI as the Implementer.
```

```text
Use $coordinate-agents to implement this task. Clarify acceptance criteria first, dispatch implementation, then review the result: <task>
```

The Plugin path does not require a global npm installation. For prerequisites, verification, upgrades, and uninstall steps, see [Getting Started](./docs/getting-started.md), [Install with AI](./docs/install-with-ai.md), and the [Plugin end-to-end guide](./docs/plugin-e2e.md).

## Example

Suppose you ask:

```text
Use $coordinate-agents to fix the intermittent cache invalidation test. Preserve the public API, add a regression test, and do not release anything.
```

Codex turns that into a durable task, selects the configured Implementer adapter, opens or reuses an owned execution session, waits for implementation evidence, and reviews the diff and tests. A failed review returns concrete findings through the same task; a passing review still does not authorize a release.

## Key Capabilities

- Durable local tasks, messages, review decisions, and runtime events.
- Additive Task Graph v1 validation with optional Intent Map v1 write-scope declarations, deterministic conflict-aware Graph Preflight with bounded risks and resource estimates, explicit bounded multi-wave advance, post-execution scope auditing, isolated aggregate integration/review, and facts-first recovery across worktrees and Sessions.
- Explicit Planner, Implementer, and Reviewer role boundaries.
- Adapter-based execution for exact configured CLI commands.
- Persistent, bounded, and inspectable execution sessions.
- Review rework that reuses healthy context without infinite retry loops.
- Recovery, explicit resume, bounded stop, and ownership-safe cleanup for interrupted graph execution; no filename/prose success inference or automatic retry loop.
- Explicit graph integration verifies completed subtask refs and applies them in sorted order in a separate review worktree; review refuses stale source facts or uncommitted aggregate changes, while conflicts remain inspectable and never modify the user checkout.
- A local Inspector timeline for tasks, sessions, and events.
- Separate review and release gates with exact authorization semantics.

Task Graph users can explicitly run `task graph-integrate` after all required
subtasks succeed, then use `task graph-review` or the matching MCP tools to
inspect and record the aggregate decision. The integration worktree, source
refs, applied commits, conflict facts, and review evidence are durable; a
`REVIEW_APPROVED` result never authorizes merge, push, tag, publish, deploy,
or release.

At graph creation, users may add `--intent-map <intent-map.json>` or the MCP
`intentMap` object. The companion map covers every subtask exactly once,
defaults to `scopePolicy: "warn"`, and records normalized repository-relative
write patterns. Status, inspect, and plan distinguish legacy unavailable
coverage from an explicitly empty `writeIntent` declaration.
When coverage is available, planning greedily selects the stable subtask-ID
order up to `maxConcurrency`, skips conservatively overlapping write intents,
and returns bounded `WRITE_INTENT_CONFLICT` facts. After verified completion,
the Runtime compares committed and uncommitted changes with the declaration
before unlocking dependents. `observe` records drift, `warn` also exposes an
`INTENT_SCOPE_DRIFT` warning while keeping success, and `strict` preserves the
commit/worktree but records a recoverable failure. These checks never create
dependency edges or mutate the user checkout.

## Supported Agents and Adapters

The bundled reference workflow uses Codex as Planner and Reviewer. Implementers are selected through adapters:

| Adapter | Intended use |
| --- | --- |
| `antigravity-cli` | Google Antigravity CLI, including exact custom executables such as `agy-proxy` |
| `codex-cli` | Codex CLI when it is explicitly configured as an external runtime |
| `generic-cli` | Other interactive coding CLIs, such as a locally configured Claude command |

Project command configuration takes precedence over user configuration, which takes precedence over the adapter default. The final executable identity is never guessed. See [Codex CLI](./docs/codex-cli.md), [Antigravity CLI](./docs/antigravity-cli.md), and the [runtime comparison](./docs/comparison.md).

### Adapter Contract v1

The GitHub source/Plugin and **npm 2.4.0** expose the versioned validation boundary at `adapter-sdk.mjs`; npm 2.x consumers import `@hogancv/coordinate-agents/adapter-sdk.mjs`. npm 3.x removes the SDK export and conformance resources. Contract v1 covers adapter identity, capabilities, detection, configuration compatibility, argument-array launch plans, persistent-session initial input, and launch policy. The Runtime continues to own executable/path validation, process and Session lifecycle, bounded output, durable state, review, and release gates.

The public [Adapter Conformance Kit](./docs/adapter-conformance.md) runs the same Contract v1 checks against deterministic fake executables in isolated temporary roots, including paths with spaces and shell metacharacters. It returns bounded CI diagnostics and never contacts a provider or mutates user configuration. Explicit local modules can be registered with `coordinate-agents adapter register <local-file>`; only the selected regular `.mjs`, `.js`, or `.cjs` path is loaded, and descriptor/configuration failures leave user and project state unchanged. The module is trusted code running with current Node.js permissions; contract validation is not a malicious-JavaScript sandbox. See the bundled [Adapter Contract v1 reference](./skills/coordinate-agents/references/adapter-contract-v1.md).

The built-in Codex CLI, Antigravity CLI, and generic CLI adapters are created through validated Contract v1 descriptors and pass this same conformance runner. Runtime session decisions use the frozen descriptor capabilities, while the legacy adapter metadata methods remain compatible.

For third-party authors, the [External Adapter Author Guide](./docs/adapter-author-guide.md)
walks through the public imports, Contract v1 methods, offline fixture, explicit
trusted-local registration, and package payload. The complete [minimal external
Adapter example](./examples/minimal-external-adapter/README.md) remains outside
the built-in registry and requires no provider access.

The repository [Adapter SDK acceptance gate](./docs/adapter-conformance.md#repository-acceptance-gate)
automatically runs a focused cross-platform matrix only when the package version changes. Tag and
explicit manual runs remain available for release and maintenance verification. The gate
runs built-in and external descriptors through the same kit and covers Node.js 18 on Linux plus
Node.js 22 on Windows, macOS, and Linux without changing Task, Bus, Event Journal, Inspector,
MCP, review, or release ownership.

Setup discovery and the existing MCP setup/Task tools expose the same additive
`adapters` registry snapshot, including registered external identities and
Contract capabilities. Discovery does not launch an adapter; configured
external Agents contribute only their Contract-defined detection facts. Setup
can select an external adapter without merging Agent, Adapter, and executable
identities, and the canonical Task/persistent-Session path preserves exact
project command > user command > adapter default precedence.

## Web Workspace and Local Inspector

The **Web Workspace** is the primary local browser entry. From a folder
it starts a loopback-only, multi-project dual-terminal
workbench — no Codex Plugin or global installation required (agent CLIs still use their configured providers):

```sh
npx @hogancv/coordinate-agents@latest web --port 3000
```

The bilingual (`zh-CN` / `en-US`) sidebar groups Workspace tasks by project.
The startup folder is registered automatically (Git subfolders use their repository root).
**New project** browses local folders; ordinary folders require explicit Git and
Workspace storage initialization, without a commit. Switching projects keeps terminals running.
Terminal settings and close-all apply only to the selected project.
Right-click a conversation or project heading to archive it. Archiving closes its owned terminals and hides the records; project source files remain. Settings provides one-click permanent clearing of archived conversations across all registered projects. Archived projects stay hidden after refresh/restart; explicitly adding the same folder shows the project again.
**New task** starts a fresh Codex + Antigravity pair with Web-lite prompts;
enter requirements directly in the Codex terminal. Terminal settings accept
custom executable commands such as `agy-proxy`, plus Codex model and reasoning
choices. Refresh, close, restart, and close-all-terminal controls are available.
There is no Composer, chat timeline, or Graph/Agents/Sessions/Activity page.

Workspace groups live in `.agent-bus/workspace-tasks/*.json`, separately from
standard Tasks. Selection and refresh never launch sessions; explicit actions
use the guarded `POST /api/action` gateway. Task/Graph actions and reads are absent from the default Web API. Existing structured CLI/MCP and read-only Inspector contracts remain in the GitHub source through the Legacy entry. For this checkout's new Web
behavior, run `node bin/coordinate-agents.mjs web --port 3000`; merging to main
does not publish a new npm version. Learn more in
[Inspector & Web Workspace](./docs/inspector.md) and
[Event Journal](./docs/event-journal.md).

## npm 3.0 migration

The public npm CLI is `coordinate-agents web`, `coordinate-agents --help`, and
`coordinate-agents --version` (with Web `--root`, `--port`, `--json`). Legacy
`install`, `update`, `uninstall`, `doctor`, `quickstart`, `launch`, `setup`,
`discover`, `config`, `adapter`, `agent`, `task`, `status` and `inspector` are no
longer npm 3.x commands. Unsupported commands fail with migration guidance,
without trying to import absent modules. Wildcard internal exports and
`./adapter-sdk` / `./adapter-sdk.mjs` are removed; only `./package.json` is public.
The task-specific message helper path is supplied by the Codex role prompt.

Use an explicit older version for the previous npm CLI:

```sh
npx @hogancv/coordinate-agents@2.4.0 --help
npx @hogancv/coordinate-agents@2.4.0 doctor
# Full structured CLI from a GitHub source checkout:
node bin/coordinate-agents-legacy.mjs --help
node bin/coordinate-agents-legacy.mjs inspector --port 3000
```

The Plugin automatically selects its bundled Legacy launcher. npm and Plugin
validation/versioning are separate. See [V3 distribution and release evidence](./docs/releases/v3-web-first.md).

## Local Development

The default test command runs the focused core suite (~20–30 seconds), which
covers the CLI dispatcher, Web Workspace, Inspector, documentation, repository
layout, shared Runtime contracts, and Web terminal messaging:

```sh
npm test
```

For the complete local regression suite, use the explicit command below. It is
kept out of the default and cross-platform CI paths because it includes slower
Task Graph, Session, Plugin, and MCP integration guards:

```sh
npm run test:full
```

`npm run check` is the fast help/index/core check; `npm run check:full` adds
the complete local regression suite.

## Documentation

- Start here: [AI installation contract](./AI_INSTALL.md), [Getting Started](./docs/getting-started.md), [Install with AI](./docs/install-with-ai.md), [FAQ](./docs/faq.md), [Changelog](./CHANGELOG.md)
- Core runtime: [Protocol](./docs/protocol.md), [Execution Sessions](./docs/session-runtime.md), [Event Journal](./docs/event-journal.md), [MCP](./docs/mcp.md)
- Task Graph: [Task Graph v1 contract](./docs/task-graph-v1.md)
- Operations: [Inspector](./docs/inspector.md), [Troubleshooting](./docs/troubleshooting.md), [MCP troubleshooting](./docs/MCP_TROUBLESHOOTING.md), [Security](./docs/security.md)
- Agents and choices: [Codex CLI](./docs/codex-cli.md), [Antigravity CLI](./docs/antigravity-cli.md), [Comparison](./docs/comparison.md)
- Adapter authors: [Author guide](./docs/adapter-author-guide.md), [minimal external Adapter example](./examples/minimal-external-adapter/README.md)
- Machine-readable index: [llms.txt](./docs/llms.txt)

## Safety and Release Boundary

`.agent-bus` is local plaintext state and should stay excluded from version control. Never put credentials, tokens, cookies, private keys, or unredacted sensitive output in task records, fixtures, logs, or commits. The runtime refuses unsafe paths and never attaches to arbitrary processes.

Implementation completion and `REVIEW_APPROVED` are not release authorization.
Web-lite prompts forbid commit, push, or release without user authorization;
they do not enforce a technical release gate. The structured workflow retains
its separately described release plan and exact `RELEASE_APPROVED` gate for
merge, push, tag, publish, deploy, GitHub Release, and release workflows. See
[SECURITY.md](./SECURITY.md) for the structured boundary.

## Project Status

Coordinate Agents is a local-first project with lightweight Web and structured
Plugin / CLI / MCP modes. The GitHub Plugin distributes the structured skills;
`@hogancv/coordinate-agents` distributes the standalone Runtime and Web entry.
CI and publishing policy are documented in [AGENTS.md](./AGENTS.md); npm
publishing remains a separate manual, explicitly approved workflow.

## Development

Contributor setup and required validation commands are defined in [AGENTS.md](./AGENTS.md). Focused behavior changes should include isolated tests and must not invoke live model accounts or modify a user's real project.

## License

[MIT](./LICENSE)
