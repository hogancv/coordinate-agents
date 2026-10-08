# npm 3.0.0 Web-first release evidence

> The measurements and tarball integrity below describe the initial Web-first refactor snapshot, before the subsequent Workspace archive feature. Archive follow-up verification is recorded separately in `workspace-archive.md`.

The npm product is Web Workspace; the GitHub Plugin remains version 2.4.0 and retains its complete source/structured workflow. No publish, push, tag, merge, Release or workflow dispatch was performed during this initial verification.

## Baseline

Recorded before code changes using npm pack --dry-run --json --ignore-scripts, a real npm pack, production installation in a temporary consumer with isolated user directories, du -sk node_modules, and five process-to-server-ready measurements. See [baseline JSON](v3-baseline.json) and [baseline static dependency closure](v2-dependencies.json).

The baseline tarball is 811,800 bytes, unpacked payload 2,175,886 bytes, 122 files, one direct production dependency and three installed production packages (including this package). Installed node_modules uses 66,312 KiB allocated disk on macOS arm64 / Node 24.17.0 / npm 11.13.0. Startup samples in milliseconds: 154.488, 95.055, 92.675, 96.017, 95.276; median 95.276. These are local measurements, not general performance guarantees.

The complete actual file list is [V3 changed files](v3-changed-files.md).

## Architecture and dependency audit

- Before: bin → cli-core (5,120 lines) → Task/Graph/Agent Bus/Adapter/CLI; web dynamically imports server → inspector-data → Task Graph/Bus; gateway → runtime-services → cli-core. Project registration spawns agent-bus init. The closure includes 47 local modules/resources; tracing loaded 44 file modules including subprocess initialization.
- After: bin → web-cli → lazy workspace-server → shared HTTP transport, Workspace data, projects and Workspace action map → Session/Workspace persistence/roles → stable manager → detached session-host → PTY. The directed workspace-message helper references only task/session operations.
- Static references include the package metadata, Workspace web/vendor resources, forked Session Host and the absolute message helper in the Codex prompt. All are tracked-source whitelist entries; no build/prepack output is required.
- node-pty is the sole external production dependency. It is dynamically imported by the Session Host under the existing platform/Node policy; resolution is checked from the installed package. Configured trusted Adapter imports accept only validated local regular-file paths, as before. The built-in registry/contract/loader remain for compatibility; SDK exports, conformance and author examples do not ship.
- Config, sessions, events and Workspace tasks continue to use the existing .agent-bus storage and path/lock protections. Web initializes config/tmp/locks without invoking Bus messaging/state setup. Models come from the isolated or user-selected CODEX_HOME/models_cache.json; project registry/user command configuration use their existing home paths.
- Legacy CLI, MCP, Inspector, Graph, Skill metadata and Adapter authoring remain source-only. Plugin runtime-entry prefers its bundled Legacy launcher and rejects npm 3 Web roots as a structured runtime. npm/Plugin versions need not match.
- The default gateway allows projects, settings, Workspace task lifecycle and Workspace-owned session I/O only. Loopback bind, Host/Origin, constant-time capability checks, body/argument/input limits, bound roots and persisted session ownership remain. Legacy writable operations are an explicit source-only gateway.

## Validation and comparison

All package sizes come from real npm pack metadata, not source estimates. The V2.4.0 baseline is the initial checkout packed before edits; V3.0.0 is the final working-tree payload. See [V2 pack listing](v2-pack.json), [V3 pack listing](v3-pack.json), [V3 metrics](v3-metrics.json), and [V3 static dependencies](v3-dependencies.json).

| Metric | V2.4.0 | V3.0.0 |
| --- | ---: | ---: |
| Compressed tarball, bytes | 811,800 | 227,407 |
| Unpacked payload, bytes | 2,175,886 | 888,776 |
| Published file count | 122 | 42 |
| Direct production dependencies | 1 | 1 |
| Installed production packages, including this package | 3 | 3 |
| Allocated node_modules disk, KiB | 66,312 | 64,872 |
| Web startup median of 5, ms | 95.276 | 56.519 |
| Installed Web pair/message/project/reconnect acceptance | passed | passed |
| Source Plugin end-to-end baseline / final full regression | 7/7 Plugin E2E | 374/374 full tests |

Tarball reduction is **71.99%**, unpacked payload reduction **59.15%**, and file reduction **65.57%**. The ≥50% compressed-size target is met. Production dependencies are unchanged: node-pty and its node-addon-api dependency remain installed. The measured dependency directory is dominated by node-pty (63,480 KiB); node-addon-api is 432 KiB and this package is 956 KiB. Platform prebuilds account for most of the installed footprint, so dependency disk decreases only 2.17%; required platform binaries were not deleted.

| Main unpacked directory, bytes | V2.4.0 | V3.0.0 |
| --- | ---: | ---: |
| assets | 388,021 | 0 |
| inspector | 701,602 | 637,080 |
| skills | 517,430 | 196,723 |
| lib | 251,644 | 3,561 |
| docs | 99,221 | 0 |
| schemas | 50,020 | 0 |
| mcp | 34,877 | 0 |
| scripts | 23,702 | 0 |
| .codex-plugin | 1,688 | 0 |
| .agents | 373 | 0 |

Final startup samples, ms: 112.782, 53.910, 56.519, 57.467, 52.608. Startup is measured from spawning the installed CLI to its JSON server-ready line. Samples include one cold project initialization and four subsequent starts; browser rendering and agent startup are excluded. Both measurements use macOS arm64, Node 24.17.0 and npm 11.13.0 on this host. The lower median is a local observation, not a cross-platform guarantee. [V2 startup module trace](v2-startup-modules.json) records 44 loaded file modules; [V3 startup trace](v3-startup-modules.json) records 26, without Legacy CLI, Inspector data, Task/Graph or Bus modules.

### Executed verification

- `npm run check`: **176/176 passed**, including help, synchronized repository index and focused regressions.
- `npm run test:full`: **374/374 passed**, including source CLI, Plugin, MCP, Inspector, Adapter conformance, Task Graph, Session/Workspace, release and documentation tests.
- `node --test test/session-runtime.test.mjs`: **6/6 passed**, including delayed detached-host initialization. The new regression first reproduced loss of init under slow imports; the host now owns IPC disconnect after consuming init.
- `node --test test/web-distribution.test.mjs test/cli-modules.test.mjs test/documentation.test.mjs test/release-workflow.test.mjs`: **28/28 passed** for the changed boundaries; the full suite additionally includes negative payload checks for missing Session Host, added Plugin/Skill/test files and `.env`.
- `node scripts/verify-release-artifact.mjs <real-tarball> --expected-version 3.0.0 --expected-source-commit <full-SHA> --expected-tag v3.0.0`: passed on **macOS arm64 with Node 18.20.8, 22.23.3 and 24.17.0**. [Node 18 report](node18-verification.json), [Node 22 report](node22-verification.json), [Node 24 report](node24-verification.json). Node 18 used stdio fallback; Node 22/24 used native PTY. Every run used mock CLIs and an independent user directory, installed production dependencies from the tarball and closed all owned hosts/sockets.
- An isolated source snapshot was committed only in a disposable temporary repository to represent a clean checkout. `npm ci` and `npm pack --ignore-scripts` reproduced an artifact with **identical SHA-512 integrity** to the measured tarball; `npm run release:verify` passed from that clean snapshot. No generated build/prepack resource was needed. The working checkout was left uncommitted at that validation stage.
- Installed V2.4.0 passed the same offline functional acceptance (using its valid selected port and explicit read limits), and its archived source passed **7/7 Plugin E2E tests**. Two historical metadata-format assertions were stale before this change; current source tests accept valid scalar descriptions and the current router references.
- `ego-browser` exercised the installed Workspace: create task/pair, keyboard/paste I/O and visible replies, reload with identical Session IDs, two-project switching and independent pairs, Zen layout/resize, task close and pair restart with fresh Session IDs. Both projects' six mock Session records were terminal after cleanup; the browser space and test server were closed. Project registration was performed through the authorized local API; native OS folder-picker UI was not manually exercised.
- Independent read-only review found the Windows/space-path loader problem and a test fixture leak; both were fixed and covered by regressions. The follow-up review accepted child-owned IPC cleanup. No outstanding important findings remain.

**Platform limits:** Windows/Linux were not executed locally, and hosted CI was not triggered. The new `.github/workflows/web-package-acceptance.yml` supplies Windows/macOS/Linux × Node 18/22/24 jobs with real tarball tests and separate Plugin/MCP checks. Native folder pickers and real Codex/Antigravity provider behavior were not tested; no paid service was invoked. Existing Windows Node ≥22 and Node 18 stdio fallbacks remain, including their original TUI limitations. `engines.node` remains `>=18` based on real Node 18/22/24 installation results and unchanged platform guards.

### Release readiness

The local npm 3.0.0 payload meets the Web-first scope, size target, independent installation, import closure, mock functional acceptance, security boundaries and source compatibility checks. It is ready for maintainer review and cross-platform CI. Publishing readiness still requires committing/reviewing these files, passing hosted platform checks, an authorized version tag and explicit manual `PUBLISH`; no claim of publishing/OIDC issuance or unexecuted platform success is made.

The npm interfaces removed are installer/update/uninstall, doctor, quickstart/launch, setup/discover/config, adapter/agent/task/status and Inspector commands; the full source CLI is `bin/coordinate-agents-legacy.mjs` or npm 2.4.0. Wildcard internal exports and Adapter SDK subpaths are removed; `./package.json` remains public. All Web project/task/terminal settings, Codex model/reasoning options, bounded terminal I/O, task-directed messages, persistence and independent host recovery remain.

## Manual release steps

After reviewing/committing this change and obtaining explicit release authorization, run npm ci, npm run check, npm run test:web and npm run test:plugin from a clean checkout. Pack with npm pack --ignore-scripts --json --pack-destination <temporary-directory>. Run npm run release:verify -- <tarball> --expected-version 3.0.0 --expected-source-commit <full-commit-SHA> --expected-tag v3.0.0. The verifier's tag argument asserts candidate facts; it does not create a tag.

An authorized maintainer may then create/push v3.0.0 and manually dispatch .github/workflows/release.yml with release_tag=v3.0.0 and confirmation=PUBLISH. The workflow verifies the tag/version, installs/tests the actual tarball, transfers that exact artifact and publishes with Trusted Publishing/OIDC/provenance. Do not add a long-lived npm token. The original development request did not authorize tag/push/workflow execution. A subsequent user request authorized committing and pushing the source changes; npm publishing, tags and release dispatch remain separate.
