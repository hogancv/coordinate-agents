# Coordinate Agents

[简体中文](./README.zh-CN.md) · [Documentation](./docs/index.md) · [Security](./SECURITY.md)

Coordinate Agents is a local-first coordination protocol and runtime for Codex and external AI coding agents. It gives planning, implementation, review, recovery, and release approval explicit boundaries while keeping the repository—and its durable `.agent-bus` state—under your control.

The recommended distribution is the Codex Plugin from this GitHub repository. The npm package remains available for standalone runtime and compatibility workflows.

![End-to-end terminal demo](./assets/demo.gif)

The recording comes from `npm run demo` in an isolated Git repository. Its sanitized source transcript is available at [assets/demo-transcript.txt](./assets/demo-transcript.txt).

## Why Coordinate Agents

A capable coding agent can work alone. Coordination becomes useful when you want a second agent to implement while Codex keeps the specification and review boundary clear.

- Codex clarifies the task, records acceptance criteria, dispatches work, and reviews evidence.
- A configured Implementer CLI edits code and runs tests inside an owned execution session.
- The Agent Bus preserves task, message, review, session, and recovery facts locally.
- Release actions stay separate from implementation and require explicit user authorization.

## How It Works

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
- Additive Task Graph v1 validation plus durable graph create/status/inspect views, deterministic dependency frontiers, and one-subtask isolated worktree dispatch.
- Explicit Planner, Implementer, and Reviewer role boundaries.
- Adapter-based execution for exact configured CLI commands.
- Persistent, bounded, and inspectable execution sessions.
- Review rework that reuses healthy context without infinite retry loops.
- Recovery from interrupted coordination using canonical local facts.
- A local Inspector timeline for tasks, sessions, and events.
- Separate review and release gates with exact authorization semantics.

## Supported Agents and Adapters

The bundled reference workflow uses Codex as Planner and Reviewer. Implementers are selected through adapters:

| Adapter | Intended use |
| --- | --- |
| `antigravity-cli` | Google Antigravity CLI, including exact custom executables such as `agy-proxy` |
| `codex-cli` | Codex CLI when it is explicitly configured as an external runtime |
| `generic-cli` | Other interactive coding CLIs, such as a locally configured Claude command |

Project command configuration takes precedence over user configuration, which takes precedence over the adapter default. The final executable identity is never guessed. See [Codex CLI](./docs/codex-cli.md), [Antigravity CLI](./docs/antigravity-cli.md), and the [runtime comparison](./docs/comparison.md).

### Adapter Contract v1

The package and Plugin payload expose the versioned validation boundary at `adapter-sdk.mjs`; npm consumers import `@hogancv/coordinate-agents/adapter-sdk.mjs`. Contract v1 covers adapter identity, capabilities, detection, configuration compatibility, argument-array launch plans, persistent-session initial input, and launch policy. The Runtime continues to own executable/path validation, process and Session lifecycle, bounded output, durable state, review, and release gates.

The public [Adapter Conformance Kit](./docs/adapter-conformance.md) runs the same Contract v1 checks against deterministic fake executables in isolated temporary roots, including paths with spaces and shell metacharacters. It returns bounded CI diagnostics and never contacts a provider or mutates user configuration. Explicit local modules can be registered with `coordinate-agents adapter register <local-file>`; only the selected regular `.mjs`, `.js`, or `.cjs` path is loaded, and descriptor/configuration failures leave user and project state unchanged. The module is trusted code running with current Node.js permissions; contract validation is not a malicious-JavaScript sandbox. See the bundled [Adapter Contract v1 reference](./skills/coordinate-agents/references/adapter-contract-v1.md).

The built-in Codex CLI, Antigravity CLI, and generic CLI adapters are created through validated Contract v1 descriptors and pass this same conformance runner. Runtime session decisions use the frozen descriptor capabilities, while the legacy adapter metadata methods remain compatible.

For third-party authors, the [External Adapter Author Guide](./docs/adapter-author-guide.md)
walks through the public imports, Contract v1 methods, offline fixture, explicit
trusted-local registration, and package payload. The complete [minimal external
Adapter example](./examples/minimal-external-adapter/README.md) remains outside
the built-in registry and requires no provider access.

The repository [Adapter SDK acceptance gate](./docs/adapter-conformance.md#repository-acceptance-gate)
runs built-in and external descriptors through the same kit and covers the
Windows/macOS/Linux × Node.js 18/22 matrix without changing Task, Bus, Event
Journal, Inspector, MCP, review, or release ownership.

Setup discovery and the existing MCP setup/Task tools expose the same additive
`adapters` registry snapshot, including registered external identities and
Contract capabilities. Discovery does not launch an adapter; configured
external Agents contribute only their Contract-defined detection facts. Setup
can select an external adapter without merging Agent, Adapter, and executable
identities, and the canonical Task/persistent-Session path preserves exact
project command > user command > adapter default precedence.

## Local Inspector

Start the read-only local Inspector from a repository with an initialized Agent Bus:

```sh
npx @hogancv/coordinate-agents@latest inspector --port 3000
```

It presents task, session, and Event Journal timelines without making the browser the source of truth. Learn more in [Inspector](./docs/inspector.md) and [Event Journal](./docs/event-journal.md).

## Standalone npm Runtime

The compatibility package exposes the installer, doctor, quickstart, task, agent, session, MCP, and Inspector commands:

```sh
npx @hogancv/coordinate-agents@latest --help
```

Use this path for legacy standalone Skill installation, external automation, or protocol debugging. The full command workflows are maintained in [Getting Started](./docs/getting-started.md) and [MCP integration](./docs/mcp.md).

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

Implementation completion and `REVIEW_APPROVED` are not release authorization. Merge, push, tag, publish, deploy, GitHub Release, and release-workflow actions require a separately described plan and the exact user approval `RELEASE_APPROVED`. See [SECURITY.md](./SECURITY.md) for the complete boundary.

## Project Status

Coordinate Agents is maintained as a plugin-first, local-first project. The GitHub Plugin is the primary distribution; `@hogancv/coordinate-agents` is the compatibility distribution. CI and publishing policy are documented in [AGENTS.md](./AGENTS.md), and npm publishing remains a manual, explicitly approved workflow.

## Development

Contributor setup and required validation commands are defined in [AGENTS.md](./AGENTS.md). Focused behavior changes should include isolated tests and must not invoke live model accounts or modify a user's real project.

## License

[MIT](./LICENSE)
