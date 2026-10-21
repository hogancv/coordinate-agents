---
title: Documentation migration and URL map
description: Content inventory, version audit, URL compatibility, translation status and deployment steps.
---

<div id="文档迁移与路径映射" class="doc-anchor" aria-hidden="true"></div>

# Documentation migration and URL map


This migration replaces Jekyll/Minima with stable VitePress 1.6.4. The domain remains `https://hogancv.github.io`, with base `/coordinate-agents/`, English at root and Simplified Chinese at `/zh-CN/`. Baseline: `1341ae73daf182cca9b63df728e0e2e1a0b821a9`; audited 2026-10-21.

<div id="改动清单" class="doc-anchor" aria-hidden="true"></div>

## Change list

- Independent documentation dependency/lockfile and GitHub Actions build, checks and deployment.
- Standard language menu, independent navigation, mobile menu, themes, local search, outline and code copy.
- Separate Web and structured Plugin paths; complete bilingual onboarding, installation, troubleshooting, security, protocol, Session and changelog.
- Correct stale release claims and mixed-language articles while retaining safety, permission, receipt and Runtime limits.
- Exact source archives, historical snapshot, preserved URLs/fragments and an automated link crawler.
- No changes to application implementation, CLI, protocol, root dependencies or npm file selection.

<div id="内容清单与版本依据" class="doc-anchor" aria-hidden="true"></div>

## Inventory and version evidence

The audit covers all **63 tracked Markdown files (47 in docs)**, recording paths, line counts, SHA-256 hashes, headings and links.

[Markdown inventory](/audits/content-inventory.json) · [Machine-readable route map](/audits/route-map.json)

| Component | Verified version | Evidence |
| --- | --- | --- |
| Web source | 3.0.2 | `package.json`, root lockfile |
| npm latest | 3.0.2 | `npm view @hogancv/coordinate-agents dist-tags --json` |
| GitHub release | v3.0.2 | `gh release view v3.0.2` |
| Structured Plugin | 2.4.0 | `.codex-plugin/plugin.json` (independent version) |
| VitePress stable | 1.6.4 | `npm view vitepress dist-tags --json`; `2.0.0-alpha.20` is next |

These are dated audit facts, not future release promises. Source, Web npm and Plugin releases are independent; v3.1 in engineering records is a planning label.

<div id="旧新路径映射" class="doc-anchor" aria-hidden="true"></div>

## Old-to-new URL map

Every existing Markdown page retains its route and `.html` extension. Product links stay within their language; technical entry pages disclose pending translations. Paths below are relative to `/coordinate-agents/`.

| Old | New | Chinese counterpart |
| --- | --- | --- |
| `MCP_TROUBLESHOOTING.html` | [MCP_TROUBLESHOOTING.html](/MCP_TROUBLESHOOTING.html) | [zh-CN/MCP_TROUBLESHOOTING.html](/zh-CN/MCP_TROUBLESHOOTING.html) |
| `adapter-author-guide.html` | [adapter-author-guide.html](/adapter-author-guide.html) | [zh-CN/adapter-author-guide.html](/zh-CN/adapter-author-guide.html) |
| `adapter-conformance.html` | [adapter-conformance.html](/adapter-conformance.html) | [zh-CN/adapter-conformance.html](/zh-CN/adapter-conformance.html) |
| `antigravity-cli.html` | [antigravity-cli.html](/antigravity-cli.html) | [zh-CN/antigravity-cli.html](/zh-CN/antigravity-cli.html) |
| `changelog.html` | [changelog.html](/changelog.html) | [zh-CN/changelog.html](/zh-CN/changelog.html) |
| `codex-cli.html` | [codex-cli.html](/codex-cli.html) | [zh-CN/codex-cli.html](/zh-CN/codex-cli.html) |
| `codex-conversation-resume.html` | [codex-conversation-resume.html](/codex-conversation-resume.html) | [zh-CN/codex-conversation-resume.html](/zh-CN/codex-conversation-resume.html) |
| `codex-native-auto-binding.html` | [codex-native-auto-binding.html](/codex-native-auto-binding.html) | [zh-CN/codex-native-auto-binding.html](/zh-CN/codex-native-auto-binding.html) |
| `comparison.html` | [comparison.html](/comparison.html) | [zh-CN/comparison.html](/zh-CN/comparison.html) |
| `development/performance-notes.html` | [development/performance-notes.html](/development/performance-notes.html) | [zh-CN/development/performance-notes.html](/zh-CN/development/performance-notes.html) |
| `development/v3.1-conpty-reliability.html` | [development/v3.1-conpty-reliability.html](/development/v3.1-conpty-reliability.html) | [zh-CN/development/v3.1-conpty-reliability.html](/zh-CN/development/v3.1-conpty-reliability.html) |
| `diagnostics/codex-conversation-resume-macos.html` | [diagnostics/codex-conversation-resume-macos.html](/diagnostics/codex-conversation-resume-macos.html) | [zh-CN/diagnostics/codex-conversation-resume-macos.html](/zh-CN/diagnostics/codex-conversation-resume-macos.html) |
| `diagnostics/windows-native-conpty.html` | [diagnostics/windows-native-conpty.html](/diagnostics/windows-native-conpty.html) | [zh-CN/diagnostics/windows-native-conpty.html](/zh-CN/diagnostics/windows-native-conpty.html) |
| `event-journal.html` | [event-journal.html](/event-journal.html) | [zh-CN/event-journal.html](/zh-CN/event-journal.html) |
| `faq.html` | [faq.html](/faq.html) | [zh-CN/faq.html](/zh-CN/faq.html) |
| `getting-started.html` | [getting-started.html](/getting-started.html) | [zh-CN/getting-started.html](/zh-CN/getting-started.html) |
| `/` | [/](/) | [zh-CN/](/zh-CN/) |
| `inspector.html` | [inspector.html](/inspector.html) | [zh-CN/inspector.html](/zh-CN/inspector.html) |
| `install-with-ai.html` | [install-with-ai.html](/install-with-ai.html) | [zh-CN/install-with-ai.html](/zh-CN/install-with-ai.html) |
| `legacy-ai-install.html` | [legacy-ai-install.html](/legacy-ai-install.html) | [zh-CN/legacy-ai-install.html](/zh-CN/legacy-ai-install.html) |
| `mcp.html` | [mcp.html](/mcp.html) | [zh-CN/mcp.html](/zh-CN/mcp.html) |
| `native-auto-binding-plan.html` | [native-auto-binding-plan.html](/native-auto-binding-plan.html) | [zh-CN/native-auto-binding-plan.html](/zh-CN/native-auto-binding-plan.html) |
| `native-conversation-identity-store.html` | [native-conversation-identity-store.html](/native-conversation-identity-store.html) | [zh-CN/native-conversation-identity-store.html](/zh-CN/native-conversation-identity-store.html) |
| `plugin-e2e.html` | [plugin-e2e.html](/plugin-e2e.html) | [zh-CN/plugin-e2e.html](/zh-CN/plugin-e2e.html) |
| `protocol.html` | [protocol.html](/protocol.html) | [zh-CN/protocol.html](/zh-CN/protocol.html) |
| `releases/v3-changed-files.html` | [releases/v3-changed-files.html](/releases/v3-changed-files.html) | [zh-CN/releases/v3-changed-files.html](/zh-CN/releases/v3-changed-files.html) |
| `releases/v3-ci.html` | [releases/v3-ci.html](/releases/v3-ci.html) | [zh-CN/releases/v3-ci.html](/zh-CN/releases/v3-ci.html) |
| `releases/v3-web-first.html` | [releases/v3-web-first.html](/releases/v3-web-first.html) | [zh-CN/releases/v3-web-first.html](/zh-CN/releases/v3-web-first.html) |
| `releases/workspace-archive.html` | [releases/workspace-archive.html](/releases/workspace-archive.html) | [zh-CN/releases/workspace-archive.html](/zh-CN/releases/workspace-archive.html) |
| `security.html` | [security.html](/security.html) | [zh-CN/security.html](/zh-CN/security.html) |
| `session-runtime.html` | [session-runtime.html](/session-runtime.html) | [zh-CN/session-runtime.html](/zh-CN/session-runtime.html) |
| `structured-workflow.html` | [structured-workflow.html](/structured-workflow.html) | [zh-CN/structured-workflow.html](/zh-CN/structured-workflow.html) |
| `superpowers/plans/2026-10-08-web-first-v3.html` | [superpowers/plans/2026-10-08-web-first-v3.html](/superpowers/plans/2026-10-08-web-first-v3.html) | [zh-CN/superpowers/plans/2026-10-08-web-first-v3.html](/zh-CN/superpowers/plans/2026-10-08-web-first-v3.html) |
| `superpowers/plans/2026-10-14-custom-terminal-workspace.html` | [superpowers/plans/2026-10-14-custom-terminal-workspace.html](/superpowers/plans/2026-10-14-custom-terminal-workspace.html) | [zh-CN/superpowers/plans/2026-10-14-custom-terminal-workspace.html](/zh-CN/superpowers/plans/2026-10-14-custom-terminal-workspace.html) |
| `superpowers/plans/2026-10-15-native-desktop-notifications.html` | [superpowers/plans/2026-10-15-native-desktop-notifications.html](/superpowers/plans/2026-10-15-native-desktop-notifications.html) | [zh-CN/superpowers/plans/2026-10-15-native-desktop-notifications.html](/zh-CN/superpowers/plans/2026-10-15-native-desktop-notifications.html) |
| `superpowers/plans/2026-10-16-collaboration-review-fixes.html` | [superpowers/plans/2026-10-16-collaboration-review-fixes.html](/superpowers/plans/2026-10-16-collaboration-review-fixes.html) | [zh-CN/superpowers/plans/2026-10-16-collaboration-review-fixes.html](/zh-CN/superpowers/plans/2026-10-16-collaboration-review-fixes.html) |
| `superpowers/plans/2026-10-16-collaboration-timeline.html` | [superpowers/plans/2026-10-16-collaboration-timeline.html](/superpowers/plans/2026-10-16-collaboration-timeline.html) | [zh-CN/superpowers/plans/2026-10-16-collaboration-timeline.html](/zh-CN/superpowers/plans/2026-10-16-collaboration-timeline.html) |
| `superpowers/plans/2026-10-19-native-identity-store.html` | [superpowers/plans/2026-10-19-native-identity-store.html](/superpowers/plans/2026-10-19-native-identity-store.html) | [zh-CN/superpowers/plans/2026-10-19-native-identity-store.html](/zh-CN/superpowers/plans/2026-10-19-native-identity-store.html) |
| `superpowers/plans/2026-10-20-codex-conversation-resume.html` | [superpowers/plans/2026-10-20-codex-conversation-resume.html](/superpowers/plans/2026-10-20-codex-conversation-resume.html) | [zh-CN/superpowers/plans/2026-10-20-codex-conversation-resume.html](/zh-CN/superpowers/plans/2026-10-20-codex-conversation-resume.html) |
| `superpowers/specs/2026-10-08-web-first-v3-design.html` | [superpowers/specs/2026-10-08-web-first-v3-design.html](/superpowers/specs/2026-10-08-web-first-v3-design.html) | [zh-CN/superpowers/specs/2026-10-08-web-first-v3-design.html](/zh-CN/superpowers/specs/2026-10-08-web-first-v3-design.html) |
| `superpowers/specs/2026-10-20-codex-conversation-resume-design.html` | [superpowers/specs/2026-10-20-codex-conversation-resume-design.html](/superpowers/specs/2026-10-20-codex-conversation-resume-design.html) | [zh-CN/superpowers/specs/2026-10-20-codex-conversation-resume-design.html](/zh-CN/superpowers/specs/2026-10-20-codex-conversation-resume-design.html) |
| `superpowers/specs/2026-10-21-local-workbench-roadmap.html` | [superpowers/specs/2026-10-21-local-workbench-roadmap.html](/superpowers/specs/2026-10-21-local-workbench-roadmap.html) | [zh-CN/superpowers/specs/2026-10-21-local-workbench-roadmap.html](/zh-CN/superpowers/specs/2026-10-21-local-workbench-roadmap.html) |
| `task-graph-v1.html` | [task-graph-v1.html](/task-graph-v1.html) | [zh-CN/task-graph-v1.html](/zh-CN/task-graph-v1.html) |
| `troubleshooting.html` | [troubleshooting.html](/troubleshooting.html) | [zh-CN/troubleshooting.html](/zh-CN/troubleshooting.html) |
| `v2.4.html` | [v2.4.html](/v2.4.html) | [zh-CN/v2.4.html](/zh-CN/v2.4.html) |

Existing `/zh-CN/` and `/zh-CN/codex-conversation-resume.html` also remain. Both directory indexes and explicit `index.html` work. Important old homepage links need no server rewrite or redirect. `llms.txt` and `sitemap.xml` remain available; the previous empty Atom `feed.xml` is retained for compatibility. Use the changelog for current releases.

<div id="精确历史快照" class="doc-anchor" aria-hidden="true"></div>

## Exact historical snapshots

- <a href="/coordinate-agents/archive/v2.4.0/README.md" download>v2.4.0 original README</a>
- <a href="/coordinate-agents/archive/v2.4.0/README.zh-CN.md" download>v2.4.0 original Chinese README</a>
- <a href="/coordinate-agents/archive/v2.4.0/docs/index.md" download>v2.4.0 original docs index</a>
- <a href="/coordinate-agents/archive/v2.4.0/AI_INSTALL.md" download>v2.4.0 original installation</a>
- <a href="/coordinate-agents/reference-original/docs/index.md" download>Pre-migration docs index</a>

The `public/archive/v2.4.0/` snapshot comes from pinned commit `3e36942ce52004ad3136c6f24be57a8255361c75`, preserving its original tree and bytes. All 47 pre-migration docs have exact copies under `public/reference-original/docs/`, verifiable against the inventory hashes. These are raw Markdown archives, excluded from current search; historical links inside them are intentionally unchanged.

<div id="剩余未翻译页面" class="doc-anchor" aria-hidden="true"></div>

## Remaining full translations

This is the complete pending list; localized index pages do not count as full translations. Primary product journeys and structured Plugin onboarding are fully translated.

| Language needed | Page |
| --- | --- |
| zh-CN | [zh-CN/MCP_TROUBLESHOOTING.md](/zh-CN/MCP_TROUBLESHOOTING.html) |
| zh-CN | [zh-CN/adapter-author-guide.md](/zh-CN/adapter-author-guide.html) |
| zh-CN | [zh-CN/adapter-conformance.md](/zh-CN/adapter-conformance.html) |
| zh-CN | [zh-CN/antigravity-cli.md](/zh-CN/antigravity-cli.html) |
| zh-CN | [zh-CN/codex-cli.md](/zh-CN/codex-cli.html) |
| zh-CN | [zh-CN/codex-native-auto-binding.md](/zh-CN/codex-native-auto-binding.html) |
| zh-CN | [zh-CN/development/performance-notes.md](/zh-CN/development/performance-notes.html) |
| en | [development/v3.1-conpty-reliability.md](/development/v3.1-conpty-reliability.html) |
| zh-CN | [zh-CN/diagnostics/codex-conversation-resume-macos.md](/zh-CN/diagnostics/codex-conversation-resume-macos.html) |
| en | [diagnostics/windows-native-conpty.md](/diagnostics/windows-native-conpty.html) |
| zh-CN | [zh-CN/event-journal.md](/zh-CN/event-journal.html) |
| zh-CN | [zh-CN/mcp.md](/zh-CN/mcp.html) |
| zh-CN | [zh-CN/native-auto-binding-plan.md](/zh-CN/native-auto-binding-plan.html) |
| zh-CN | [zh-CN/native-conversation-identity-store.md](/zh-CN/native-conversation-identity-store.html) |
| zh-CN | [zh-CN/plugin-e2e.md](/zh-CN/plugin-e2e.html) |
| zh-CN | [zh-CN/releases/v3-changed-files.md](/zh-CN/releases/v3-changed-files.html) |
| zh-CN | [zh-CN/releases/v3-ci.md](/zh-CN/releases/v3-ci.html) |
| zh-CN | [zh-CN/releases/v3-web-first.md](/zh-CN/releases/v3-web-first.html) |
| zh-CN | [zh-CN/releases/workspace-archive.md](/zh-CN/releases/workspace-archive.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-08-web-first-v3.md](/zh-CN/superpowers/plans/2026-10-08-web-first-v3.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-14-custom-terminal-workspace.md](/zh-CN/superpowers/plans/2026-10-14-custom-terminal-workspace.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-15-native-desktop-notifications.md](/zh-CN/superpowers/plans/2026-10-15-native-desktop-notifications.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-16-collaboration-review-fixes.md](/zh-CN/superpowers/plans/2026-10-16-collaboration-review-fixes.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-16-collaboration-timeline.md](/zh-CN/superpowers/plans/2026-10-16-collaboration-timeline.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-19-native-identity-store.md](/zh-CN/superpowers/plans/2026-10-19-native-identity-store.html) |
| zh-CN | [zh-CN/superpowers/plans/2026-10-20-codex-conversation-resume.md](/zh-CN/superpowers/plans/2026-10-20-codex-conversation-resume.html) |
| zh-CN | [zh-CN/superpowers/specs/2026-10-08-web-first-v3-design.md](/zh-CN/superpowers/specs/2026-10-08-web-first-v3-design.html) |
| zh-CN | [zh-CN/superpowers/specs/2026-10-20-codex-conversation-resume-design.md](/zh-CN/superpowers/specs/2026-10-20-codex-conversation-resume-design.html) |
| en | [superpowers/specs/2026-10-21-local-workbench-roadmap.md](/superpowers/specs/2026-10-21-local-workbench-roadmap.html) |
| zh-CN | [zh-CN/task-graph-v1.md](/zh-CN/task-graph-v1.html) |

<div id="构建与上线" class="doc-anchor" aria-hidden="true"></div>

## Build and rollout

```sh
npm ci --prefix docs
npm test --prefix docs
npm run build --prefix docs
npm run check --prefix docs
npm run dev --prefix docs -- --host 127.0.0.1
```

Pull requests only build/check. Main pushes or manual main runs upload and deploy. The previous live setting was `legacy / main:/docs`; first merge this change into main, then change Source to GitHub Actions and dispatch via the CLI below. The domain and HTTPS settings remain. A failed rollout can be reverted to the old commit and Pages Source. See the maintenance verification record for actual deployment status; a local build does not imply publication.

```sh
gh api --method PUT repos/hogancv/coordinate-agents/pages -f build_type=workflow
gh workflow run pages-build.yml --ref main
gh run list --workflow pages-build.yml --limit 5
```
