---
title: 文档迁移与路径映射
description: 内容清单、版本核对、路径兼容、翻译状态及部署步骤。
---

<div id="documentation-migration-and-url-map" class="doc-anchor" aria-hidden="true"></div>

# 文档迁移与路径映射


本次以稳定版 VitePress 1.6.4 替换 Jekyll/Minima。域名保持 `https://hogancv.github.io`，base 保持 `/coordinate-agents/`。英文为根语言，简体中文为 `/zh-CN/`。审计基线为 `1341ae73daf182cca9b63df728e0e2e1a0b821a9`，日期 2026-10-21。

<div id="change-list" class="doc-anchor" aria-hidden="true"></div>

## 改动清单

- 独立文档依赖和锁文件；GitHub Actions 构建、检查与部署。
- 原生语言菜单、独立中英文导航、移动导航、明暗主题、本地搜索、目录及代码复制。
- Web 产品主路径与结构化 Plugin 分区；完整双语上手、安装、排障、安全、协议、Session 与版本记录。
- 清理过期版本表述与整页双语混排；保留安全、权限、回执与 Runtime 限制。
- 保存精确原文、旧版快照、原地址和片段兼容；附自动链接检查。
- 应用实现、CLI、协议、根依赖与 npm 发布文件选择未改动。

<div id="inventory-and-version-evidence" class="doc-anchor" aria-hidden="true"></div>

## 内容清单与版本依据

审计覆盖全部 **63 份已跟踪 Markdown（docs 内 47 份）**，记录路径、行数、SHA-256、标题和链接。

[Markdown inventory](/audits/content-inventory.json) · [Machine-readable route map](/audits/route-map.json)

| Component | Verified version | Evidence |
| --- | --- | --- |
| Web source | 3.0.2 | `package.json`, root lockfile |
| npm latest | 3.0.2 | `npm view @hogancv/coordinate-agents dist-tags --json` |
| GitHub release | v3.0.2 | `gh release view v3.0.2` |
| Structured Plugin | 2.4.0 | `.codex-plugin/plugin.json` (independent version) |
| VitePress stable | 1.6.4 | `npm view vitepress dist-tags --json`; `2.0.0-alpha.20` is next |

以上是审计日期的事实，不是未来版本承诺。源码、Web npm 包与 Plugin 的发布独立；历史开发记录中的 v3.1 是计划名称。

<div id="old-to-new-url-map" class="doc-anchor" aria-hidden="true"></div>

## 旧新路径映射

所有既有 Markdown 页面地址均原地保留，继续使用 `.html`。中文产品链接进入对应中文页；原文技术页不冒充完整译文。以下均相对于 `/coordinate-agents/`。

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

已有 `/zh-CN/` 和 `/zh-CN/codex-conversation-resume.html` 同样保持。`index.html` 与目录首页均可直接访问。原站首页列出的重要入口不需要额外跳转；不存在服务器重写依赖。`llms.txt`、`sitemap.xml` 继续提供，旧的空 Atom `feed.xml` 保留兼容访问；新版版本信息以版本记录为准。

<div id="exact-historical-snapshots" class="doc-anchor" aria-hidden="true"></div>

## 精确历史快照

- <a href="/coordinate-agents/archive/v2.4.0/README.md" download>v2.4.0 original README</a>
- <a href="/coordinate-agents/archive/v2.4.0/README.zh-CN.md" download>v2.4.0 original Chinese README</a>
- <a href="/coordinate-agents/archive/v2.4.0/docs/index.md" download>v2.4.0 original docs index</a>
- <a href="/coordinate-agents/archive/v2.4.0/AI_INSTALL.md" download>v2.4.0 original installation</a>
- <a href="/coordinate-agents/reference-original/docs/index.md" download>Pre-migration docs index</a>

快照位于 `public/archive/v2.4.0/`，来自固定提交 `3e36942ce52004ad3136c6f24be57a8255361c75`，保留完整原目录与文件内容。重构前 47 份文档的完整副本位于 `public/reference-original/docs/`，SHA-256 可与内容清单核对。它们是原始 Markdown，不进入当前文档搜索，不重写其内部历史链接。

<div id="remaining-full-translations" class="doc-anchor" aria-hidden="true"></div>

## 剩余未翻译页面

以下为完整、明确的待翻译清单；本地化导航入口不计为全文翻译。主产品阅读路径及结构化 Plugin 上手已全文翻译。

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

<div id="build-and-rollout" class="doc-anchor" aria-hidden="true"></div>

## 构建与上线

```sh
npm ci --prefix docs
npm test --prefix docs
npm run build --prefix docs
npm run check --prefix docs
npm run dev --prefix docs -- --host 127.0.0.1
```

工作流在 PR 中只构建检查；合并到 main 或在 main 手动运行时上传并部署。线上当前配置曾为 `legacy / main:/docs`，切换前必须先将本次变更合并至 main，再用下列 CLI 将 Source 改为 GitHub Actions 并触发工作流。域名和 HTTPS 配置不变；若部署失败可切回旧提交与旧 Pages Source。实际线上部署状态见维护验收记录，本页不声称本地构建已经上线。

```sh
gh api --method PUT repos/hogancv/coordinate-agents/pages -f build_type=workflow
gh workflow run pages-build.yml --ref main
gh run list --workflow pages-build.yml --limit 5
```
