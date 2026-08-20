---
name: coordinate-setup
description: >-
  Discover coding CLIs on the current computer and configure a Coordinate
  Agents implementation agent. Use for setup, executable checks, registered
  agents, user-level configuration, and project-over-user precedence.
---

# Coordinate Setup

Use this skill for first-run onboarding. Run the read-only discovery command
before changing configuration:

```text
coordinate-agents setup --root "<repository>" --json
```

It checks `codex`, `claude`, `agy`, `agy-proxy`, and `gemini` by resolving the
actual executable. It reports unavailable commands and distinguishes
`detected-but-not-configured` agents. Detection never writes configuration.

When the user chooses an agent, inspect its native help and write only the
user-level setting, for example:

```text
coordinate-agents config set agent.claude.command claude
coordinate-agents config get agent.claude.command --json
coordinate-agents config list --json
```

User configuration is stored outside the plugin at
`~/.coordinate-agents/config.json` (Windows: `C:\Users\<username>\.coordinate-agents\config.json`).
An explicit project command in `.agent-bus/config.json` takes precedence over
the user file. Do not silently replace a missing explicit command with an
adapter default, and do not edit the installed Skill directory.

