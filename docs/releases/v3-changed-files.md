# V3 actual changed files

108 modified/added files for the Web-first refactor and Workspace archive follow-up. Source-only SDK examples and Legacy tests use explicit source entry points or independent distribution assumptions. No historical Plugin/MCP/Graph source tree was deleted.

## Runtime and npm distribution

- `bin/coordinate-agents-legacy.mjs`
- `bin/coordinate-agents.mjs`
- `inspector/server/action-gateway.mjs`
- `inspector/server/http-server.mjs`
- `inspector/server/inspector-data.mjs`
- `inspector/server/legacy-action-gateway.mjs`
- `inspector/server/server.mjs`
- `inspector/server/workspace-data.mjs`
- `inspector/server/workspace-projects.mjs`
- `inspector/server/workspace-server.mjs`
- `inspector/web-workspace/app.js`
- `inspector/web-workspace/index.html`
- `inspector/web-workspace/styles.css`
- `lib/cli-core.mjs`
- `lib/web-cli.mjs`
- `package-lock.json`
- `package.json`
- `skills/coordinate-agents/scripts/role-prompts.mjs`
- `skills/coordinate-agents/scripts/runtime-entry.mjs`
- `skills/coordinate-agents/scripts/session-manager.mjs`
- `skills/coordinate-agents/scripts/workspace-init.mjs`
- `skills/coordinate-agents/scripts/workspace-message.mjs`
- `skills/coordinate-agents/scripts/workspace-role-prompts.mjs`
- `skills/coordinate-agents/scripts/workspace-services.mjs`
- `skills/coordinate-agents/scripts/workspace-task-runtime.mjs`

## Release and verification tooling

- `.github/workflows/release.yml`
- `.github/workflows/web-package-acceptance.yml`
- `scripts/measure-web-package.mjs`
- `scripts/verify-release-artifact.mjs`
- `scripts/verify-workspace-install.mjs`

## Documentation and measured evidence

- `AGENTS.md`
- `AI_INSTALL.md`
- `CHANGELOG.md`
- `README.md`
- `README.zh-CN.md`
- `docs/adapter-author-guide.md`
- `docs/adapter-conformance.md`
- `docs/antigravity-cli.md`
- `docs/faq.md`
- `docs/getting-started.md`
- `docs/index.md`
- `docs/inspector.md`
- `docs/install-with-ai.md`
- `docs/llms.txt`
- `docs/mcp.md`
- `docs/plugin-e2e.md`
- `docs/releases/node18-verification.json`
- `docs/releases/node22-verification.json`
- `docs/releases/node24-verification.json`
- `docs/releases/v2-dependencies.json`
- `docs/releases/v2-pack.json`
- `docs/releases/v2-startup-modules.json`
- `docs/releases/v3-baseline.json`
- `docs/releases/v3-changed-files.md`
- `docs/releases/v3-dependencies.json`
- `docs/releases/v3-metrics.json`
- `docs/releases/v3-pack.json`
- `docs/releases/v3-startup-modules.json`
- `docs/releases/v3-web-first.md`
- `docs/releases/workspace-archive-verification.json`
- `docs/releases/workspace-archive.md`
- `docs/superpowers/plans/2026-10-08-web-first-v3.md`
- `docs/superpowers/specs/2026-10-08-web-first-v3-design.md`
- `docs/troubleshooting.md`
- `docs/zh-CN/index.md`
- `examples/minimal-external-adapter/README.md`
- `examples/minimal-external-adapter/adapter.mjs`
- `examples/minimal-external-adapter/run-conformance.mjs`
- `llms.txt`
- `skills/coordinate-agents/SKILL.md`

## Tests

- `test/action-gateway.test.mjs`
- `test/adapter-contract.test.mjs`
- `test/cli-modules.test.mjs`
- `test/cli.test.mjs`
- `test/documentation.test.mjs`
- `test/external-adapter-example.test.mjs`
- `test/inspector.test.mjs`
- `test/intent-map-v1.test.mjs`
- `test/mcp-server.test.mjs`
- `test/plugin-e2e.test.mjs`
- `test/plugin-p0.test.mjs`
- `test/plugin.test.mjs`
- `test/release-artifact.test.mjs`
- `test/reliability.test.mjs`
- `test/role-prompts.test.mjs`
- `test/session-runtime.test.mjs`
- `test/support/external-adapter-registration-child.mjs`
- `test/support/legacy-workspace-server.mjs`
- `test/support/workspace-server.mjs`
- `test/task-graph-acceptance.test.mjs`
- `test/task-graph-advance.test.mjs`
- `test/task-graph-contract.test.mjs`
- `test/task-graph-integration.test.mjs`
- `test/task-graph-intent-scheduler.test.mjs`
- `test/task-graph-parallel-run.test.mjs`
- `test/task-graph-persistence.test.mjs`
- `test/task-graph-recovery.test.mjs`
- `test/task-graph-scheduler.test.mjs`
- `test/task-graph-scope-audit.test.mjs`
- `test/task-graph-worktree-dispatch.test.mjs`
- `test/trusted-local-adapter.test.mjs`
- `test/user-config.test.mjs`
- `test/web-acceptance-gate.test.mjs`
- `test/web-distribution.test.mjs`
- `test/workspace-archive.test.mjs`
- `test/workspace-message.test.mjs`
- `test/workspace-projects.test.mjs`
- `test/workspace.test.mjs`
