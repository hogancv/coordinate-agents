---
layout: page
title: Troubleshooting
description: Diagnose installation, CLI discovery, queue, recovery, and launch problems.
---

# Troubleshooting

Start with:

```sh
npx @hogancv/coordinate-cli-agents@latest doctor
```

- **A CLI is missing:** authenticate and verify `codex --version` or `agy --version`, then restart the terminal.
- **A Skill is missing or damaged:** run `install` or `update`; do not overwrite an unknown directory without inspecting and backing it up.
- **No message arrives:** verify both terminals point to the same Git root and inspect bus `status`.
- **A terminal was interrupted:** inspect queued and processing messages before using `recover`.
- **Quickstart refuses existing prompts:** resume the existing task or explicitly clean the previous bus after preserving any needed evidence.
- **A release is blocked:** `REVIEW_APPROVED` is not release permission; the user must authorize the described plan with `RELEASE_APPROVED`.

See the complete bilingual [AI installation troubleshooting guide](https://github.com/hogancv/coordinate-cli-agents/blob/main/AI_INSTALL.md#troubleshooting--故障排查).

