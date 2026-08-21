---
name: coordinate-setup
description: >-
  Discover coding CLIs on the current computer and configure a Coordinate
  Agents implementation agent. Use for setup, executable checks, registered
  agents, user-level configuration, and project-over-user precedence.
---

# Coordinate Setup

Use this skill for first-run onboarding. Use the Coordinate Agents MCP tools
for normal setup operations; do not generate a shell command for the user.
The Plugin bundles the Runtime, but `coordinate-agents` is not guaranteed to be
on `PATH`.

Normal MCP operations:

```text
coordinate_agents_setup_discover
coordinate_agents_setup_configure
```

Only if MCP is unavailable, or if the user explicitly requests debugging, let
`<skill-dir>` be the absolute directory containing this loaded `SKILL.md` and
use the bundled fallback. The following shell syntax is not the normal Plugin
path:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

For the normal Plugin path, call `coordinate_agents_setup_discover` with
`{ "root": "<repository>" }` before changing configuration. The equivalent
fallback/debug invocation is:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup --root "<repository>" --json
```

It checks `codex`, `claude`, `agy`, `agy-proxy`, and `gemini` by resolving the
actual executable. It reports unavailable commands and distinguishes
`detected-but-not-configured` agents. Detection never writes configuration.

When the user chooses an agent, inspect its native help and perform one
high-level setup transaction through `coordinate_agents_setup_configure`. It
writes the machine-specific executable to
`~/.coordinate-agents/config.json`, registers/updates the project Agent,
assigns the workflow role, checks executable availability, and returns READY
facts. Do not manually compose `config set`, `agent add`, workflow editing,
and doctor calls:

Fallback/debug syntax only:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup configure \
  --agent antigravity --command agy-proxy --adapter antigravity-cli \
  --role implementer --root "<repository>" --json
```

For a generic CLI, pass an explicit argument template containing `{prompt}`
after checking that CLI's own `--help`; otherwise Runtime returns
`UNSUPPORTED_CAPABILITY` rather than claiming that executable detection means
adapter compatibility:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup configure \
  --agent claude --command claude --adapter generic-cli \
  --args '["--print","{prompt}"]' --role implementer \
  --root "<repository>" --json
```

User configuration is stored outside the plugin at
`~/.coordinate-agents/config.json` (Windows: `C:\Users\<username>\.coordinate-agents\config.json`).
An explicit project command in `.agent-bus/config.json` takes precedence over
the user file. Setup configure does not write the selected machine path to
project config unless a project override already exists; it refuses to replace
an existing explicit project command. Agent identity, Adapter, and executable
remain separate, so `antigravity` may use `agy-proxy` without falling back to
`agy`.
