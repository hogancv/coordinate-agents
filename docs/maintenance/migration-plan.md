# Documentation migration plan

**Goal:** Replace Jekyll/Minima with stable VitePress, preserving the public domain, `/coordinate-agents/` base, important URLs and historical technical evidence. Give English and Chinese readers complete product paths.

**Scope:** Documentation, documentation tooling and Pages workflow only. Application commands, protocols, production dependencies and npm payload selection remain unchanged.

## Design decisions

- Pin VitePress 1.6.4 in an independent docs package and lockfile; use Node 22 for documentation builds.
- Keep `.html` routes and existing relative paths. English is root; Chinese mirrors `/zh-CN/`. Use the default theme's language switch, navigation, search, outline, copy and responsive controls.
- Fully translate primary Web and structured onboarding pages. Identify remaining technical references honestly with localized reference landing pages rather than pretend they are translated.
- Preserve the original v2.4.0 Markdown byte-for-byte in public archives and retain commit-pinned GitHub links. Preserve pre-migration documents in a separate source archive when editorial cleanup is necessary.
- Check version claims against package.json, Plugin metadata, GitHub releases and npm registry metadata, dated 2026-10-21.
- Pages builds on PRs; deployment on main/manual runs uses upload-pages-artifact/deploy-pages and a protected GitHub environment. Repository setting changes and publication happen after the concrete local result is reviewable.

## Tasks and verification

- [x] Inventory all 63 tracked Markdown files (47 in docs), record hashes, headings and links before edits.
- [x] Implement bilingual site configuration, independent dependencies and Pages workflow.
- [x] Complete primary bilingual content, preserve reference documents and historical snapshots.
- [x] Generate path mapping and explicit untranslated-page list from inventory and locale pairs.
- [x] Build with strict dead-link checking; crawl built HTML for missing paths, fragments and base leaks, including archived links.
- [x] Exercise language switching, local search, code copying, theme persistence and mobile navigation in browser.
- [x] Review documentation-only scope, existing relevant regression tests and package file selection; record final evidence and rollout steps.

## Review focus

1. Direct visits to old `.html` URLs and nested technical references remain valid.
2. Language switching preserves page identity in both directions; reference landing pages disclose incomplete translation.
3. Base-prefixed CSS/JS/search resources load on Pages rather than only localhost root.
4. Chinese primary links stay in Chinese; state reports never become verified success or release authorization.
5. Snapshot content remains exact; old plans and diagnostics cannot masquerade as current release behavior.

## Execution record

- User supplied detailed scope and acceptance criteria; proceed within that authorization without additional design approval gates.
- Translation tasks are independent files, delegated using dispatching-parallel-agents; site configuration and unified validation remain in the primary session.
- Initial online Pages check: build_type=legacy, main:/docs, no custom domain, canonical https://hogancv.github.io/coordinate-agents/.
- Registry: @hogancv/coordinate-agents latest=3.0.2; vitepress latest=1.6.4, next=2.0.0-alpha.20. Plugin metadata=2.4.0.

- Final compatibility check caught three inherited `layout: default` values hiding technical content; removing Jekyll layout metadata restored the MCP and Task Graph pages. Built HTML now verifies every legacy heading, not only URL existence.
- Native VitePress language menus preserve the hash. Reciprocal heading aliases and captured legacy heading aliases keep translated sections and old links valid. Full primary translations have aligned heading levels/order.
- User explicitly authorized all decisions, push and live Pages update on 2026-10-22; publication will proceed after final local checks and review.
