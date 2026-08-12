# coordinate-cli-agents

[简体中文](./README.zh-CN.md) | English

Install a persistent, recoverable collaboration workflow for **OpenAI Codex CLI** and **Google Antigravity CLI (`agy`)**. The two agents communicate through a project-local `.agent-bus` while keeping their native accounts, subscriptions, and model access.

No CAO server, daemon, database, or shared API credential is required.

![End-to-end terminal demo](./assets/demo.gif)

The recording is generated from a real isolated Git repository by `npm run demo`. It exercises requirement submission, Antigravity's implementation and commit, automated tests, Codex's commit/evidence review, and `REVIEW_APPROVED`. The sanitized source transcript is in [`assets/demo-transcript.txt`](./assets/demo-transcript.txt).

## Role contract

- **Codex** clarifies requirements, writes implementation specifications, reviews committed changes and validation evidence, plans releases, and performs approved release actions. It never edits product code.
- **Antigravity** is the only implementation writer. It owns source code, tests, UI, build fixes, and browser validation. It never releases.

```text
User request
    │
    ▼
 Codex ── IMPLEMENT ──▶ .agent-bus ──▶ Antigravity
    ▲                                      │
    └── IMPLEMENTATION_DONE + commit ──────┘
    │
    ├── CHANGES_REQUESTED ───────────────▶ revise
    └── REVIEW_APPROVED ─────────────────▶ wait
```

## Requirements

- Windows, macOS, or Linux
- Node.js 18 or newer
- Git
- Authenticated Codex CLI
- Authenticated Antigravity CLI

## Install from npm

Install or update both CLI skills without adding a dependency to your project:

```sh
npx @hogancv/coordinate-cli-agents@latest install
```

The installer copies a permanent skill payload to:

```text
~/.codex/skills/coordinate-cli-agents
~/.gemini/skills/coordinate-cli-agents
```

It does **not** link either location to the temporary npm cache. Existing package-managed installations are backed up before replacement. An unrecognized or locally modified directory is preserved unless you explicitly pass `--force`.

Verify the installation:

```sh
npx @hogancv/coordinate-cli-agents@latest doctor
```

Useful variants:

```sh
# Codex only
npx @hogancv/coordinate-cli-agents@latest install --codex

# Antigravity only
npx @hogancv/coordinate-cli-agents@latest install --antigravity

# Explicit update
npx @hogancv/coordinate-cli-agents@latest update

# Chinese output
npx @hogancv/coordinate-cli-agents@latest doctor --lang zh-CN

# Remove package-managed installations
npx @hogancv/coordinate-cli-agents@latest uninstall
```

The installer honors `CODEX_HOME` and `GEMINI_HOME`. Custom roots can also be passed with `--codex-home <path>` and `--antigravity-home <path>`.

Restart both CLIs after installation so they rediscover the skill.

Alternatively, install the command globally and use it without `npx`:

```sh
npm install --global @hogancv/coordinate-cli-agents
coordinate-cli-agents install
coordinate-cli-agents doctor
```

## Start a collaboration

Open two terminals in the **same Git repository**.

### Codex terminal

```text
Use $coordinate-cli-agents and enter collaboration mode. You are Codex. Only clarify requirements, write specifications and acceptance criteria, review committed work and validation evidence, and manage the release gate. Never modify product code. Send an implementation-ready specification to Antigravity, wait for IMPLEMENTATION_DONE, review the real commit and evidence, then send CHANGES_REQUESTED or REVIEW_APPROVED. Do not release until I enter the exact authorization RELEASE_APPROVED.

Requirement: Build a Todo List web application with add, complete, delete, and local persistence.
```

### Antigravity terminal

```text
Use $coordinate-cli-agents and enter collaboration mode. You are Antigravity and the only agent allowed to modify product code. Check the agent bus immediately and wait for IMPLEMENT or CHANGES_REQUESTED from Codex. Implement the specification, run relevant formatting, linting, type checks, tests, production build, and browser validation, commit the completed round, save evidence, send IMPLEMENTATION_DONE with the commit hash, then wait for review. Never release.
```

Continue giving requirements and clarification answers in the Codex terminal. Antigravity receives implementation work through the file bus.

## Release gate

`REVIEW_APPROVED` is not release authorization. Codex may merge, tag, push, deploy, or publish only after the user enters this exact authorization for the described release plan:

```text
RELEASE_APPROVED
```

## Recovery and waiting

- `wait` polls every five seconds for up to 120 minutes by default.
- Waiting continues only while the CLI session and its Node.js process remain alive.
- Messages and state survive terminal restarts. Invoke the skill again to inspect and resume `new` or role-owned `processing` messages.
- `.agent-bus/` is added to the repository's local `.git/info/exclude`, not its tracked `.gitignore`.
- Never let both roles perform Git writes at the same time.

Claims have a four-hour lease by default. Recover a message left behind by an interrupted process only after confirming that no matching work, commit, or reply already exists:

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"
node "$BUS_TOOL" recover --root "$REPO" --role antigravity --stale-after-seconds 14400
```

Use `--dedupe-key <stable-round-id>` when retrying a send. Concurrent sends with the same sender, recipient, and dedupe key resolve to one message. Message publication uses a same-volume temporary file, flush/close, and atomic rename; claiming uses an atomic rename; completion is idempotent. Invalid messages are quarantined instead of delivered, and status falls back to the newest valid append-only state record.

## Security and data boundary

`.agent-bus/` is **local plaintext working data**, not a secret store. It may contain:

- complete prompts, requirements, specifications, questions, and review comments;
- commit hashes, file paths, validation logs, diffs or source excerpts placed in evidence;
- role state, process/host metadata, message leases, deduplication records, and queue history.

Do not place access tokens, cookies, passwords, private keys, or unnecessary production data in a bus message. The bus inherits the repository directory's operating-system permissions and is not encrypted by this package. `.git/info/exclude` prevents ordinary Git tracking, but does **not** prevent local administrators, backup tools, cloud-sync clients, malware, or other processes running as your user from reading it. Before sharing diagnostics, inspect and redact `.agent-bus/`.

Normal recovery preserves history. After the collaboration and any audit need are finished, delete all bus data with an explicit confirmation:

```sh
node "$BUS_TOOL" clean --root "$REPO" --confirm DELETE_AGENT_BUS
```

This permanently removes specifications, messages, evidence, reviews, releases, logs, state, leases, and deduplication records under `.agent-bus/`; it does not delete product files or Git commits.

## Manual diagnostics

Normally the skill calls the bus script automatically. For troubleshooting:

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"

node "$BUS_TOOL" init --root "$REPO"
node "$BUS_TOOL" status --root "$REPO"
```

Supported bus commands: `init`, `send`, `wait`, `complete`, `recover`, `state`, `status`, and `clean`.

## Development

```sh
npm test
npm run check
npm run demo
npm pack --dry-run
```

## Release integrity

- CI tests Node.js 18 and 22 on Linux, Windows, and macOS.
- Publishing is triggered only by a GitHub Release whose `vX.Y.Z` tag exactly matches `package.json`.
- Stable releases use npm tag `latest`; GitHub prereleases use `next`.
- `.github/workflows/release.yml` uses npm trusted publishing (OIDC), not a long-lived publish token, and npm provenance is enabled in `publishConfig`.
- Maintainers must configure npm's trusted publisher for `hogancv/coordinate-cli-agents`, repository `coordinate-cli-agents`, workflow `release.yml`, allowed action `npm publish` before the first automated release.

## License

[MIT](./LICENSE)
