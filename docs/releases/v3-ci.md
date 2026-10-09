# V3 Web-first CI

The npm 3.x Web distribution and repository Plugin 2.4.x are independent. CI now
uses three responsibilities; npm publishing remains an explicit manual action.

| Gate | Automatic scope | Daily matrix | What it proves |
| --- | --- | --- | --- |
| Web CI | Web source/tests, shared Adapter/Session runtime, npm manifest/lockfile | Ubuntu Node 18/24; macOS 22; Windows 22/24 (5 jobs) | Web behavior, guarded project/task/terminal APIs, shared runtime and Adapter contracts |
| npm Package Acceptance | Files shipped by npm, manifest/lockfile, verifier and package tests | Ubuntu 24; macOS 22; Windows 22 (3 jobs) | Real `npm pack`, isolated production install, payload/import checks, offline dual-terminal acceptance, archive and process cleanup |
| Legacy Plugin CI | Plugin/MCP/Legacy CLI/Task Graph/SDK and shared Adapter/Session source/tests, or manual dispatch | Ubuntu 18/22; macOS 22; Windows 22 (4 jobs) | Adapter SDK/external descriptors, Legacy CLI/gateway, independent Plugin/MCP compatibility |

`test:web` no longer packs npm or runs Plugin tests. `test:package` owns real
artifact verification. `test:shared` covers the Session and Adapter components
used by Web; `test:adapters`, `test:legacy`, and `test:plugin` retain independent
source/Plugin coverage. The default `npm test` core suite is unchanged.

A manifest/lockfile-only npm version bump does not trigger Legacy CI. Shared
Adapter, Session, PTY, configuration and runtime contract/event source changes
still trigger it. Manifest/dependency-only changes receive Web/shared runtime
checks and real installation acceptance; explicitly dispatch Legacy CI to
assess dependency effects on Plugin/SDK consumers. No tag automatically grants
release authority. README/CHANGELOG changes trigger package acceptance because
these files are shipped; other documentation-only edits avoid runtime matrices.

## Release matrix and publishing

Full manual package acceptance and the reusable release gate cover
Linux/macOS/Windows × Node 18/20/22/24 (12 jobs). Node 20 is included because the
package declares `engines.node >=18`; the daily matrix is intentionally smaller.
This is a tested compatibility baseline, not an exhaustive check of every odd
or future Node version, CPU architecture, or OS distribution.

`release.yml` still requires `confirmation=PUBLISH`, an existing tag matching
`package.json`, and verification of version/source SHA/tag candidate facts.
Its verification job creates, independently installs and uploads the real
tarball. The reusable package matrix downloads that exact artifact, installs
production dependencies in an isolated consumer/home on each combination, and
runs the offline installed Web acceptance. Publishing needs both verification
and the entire matrix, downloads the same artifact, and retains npm Trusted
Publishing, `id-token: write`, `publishConfig.provenance=true`, and no npm token.
Acceptance jobs have read-only repository permissions and cannot publish.

## Failure analysis

The complete logs were downloaded with `gh run view --log` for Web runs
[37751758445](https://github.com/hogancv/coordinate-agents/actions/runs/37751758445),
[37836132404](https://github.com/hogancv/coordinate-agents/actions/runs/37836132404),
and Adapter run
[37751758599](https://github.com/hogancv/coordinate-agents/actions/runs/37751758599).
The first two requested runs used main `c670799`; the latest Web run used
`9a2fa33`, a separate config-path patch not present in current main. Node 24 uses
a different test reporter; its Windows failures were also inspected.

- JS `realpathSync` can retain Windows `RUNNER~1`, while Git/native filesystem
  paths use `runneradmin`. Registration before `git init` stored the short path;
  later Git root discovery returned the long path. Strict identity comparisons
  then duplicated projects, rejected scoped APIs, marked existing projects
  unavailable and skipped their archive/cleanup. Native realpath now normalizes
  project and shared runtime paths; existing registry records retain their IDs
  and archived state. Registries already containing aliases of the same real
  directory consolidate to the first registered ID and retain any archive fact;
  unrelated directories are never combined. Tabs holding a discarded duplicate
  ID must reload the project list.
- Path containment compared canonical children with lexical roots. Both sides
  now use native canonical paths after the original lexical containment and
  symlink/junction checks. Transcript ownership still requires the same real
  project, task ID and permitted agent; other-project records remain rejected.
- Task runtime fixtures were executable Unix shebang files without a Windows
  extension. They now launch the actual Node executable with a `.cjs` fixture
  argument, preserving startup/failure/authentication/raw-input assertions.
- Node 18 tarball cleanup reported `EPERM` for a still-running `mock node.exe`,
  masking the underlying failure. Verifier directories are canonicalized;
  acceptance explicitly waits for its launched CLIs/hosts to exit, including
  launches whose Session records were removed by archive cleanup. Deletion has
  bounded retries for Windows handle release and does not suppress failure.

## Job count and cost model

Counts exclude the unchanged, manually dispatched Pages build. They count
expanded runner jobs, not YAML job keys, and depend on changed-file scope.

| Event | Before | After |
| --- | ---: | ---: |
| Shipped Web source change, no npm version bump | 9 | 8 = 5 Web + 3 npm |
| npm manifest/lockfile version bump | 15 = 9 Web + 6 Adapter/version/payload | 8 |
| Shared Adapter/Session source change, no version bump | 9 (Adapter gate did not trigger) | 12 = 5 Web + 3 npm + 4 Legacy |
| Legacy-only source change | 9 | 4 |
| Non-shipped docs-only change | 9 | 0 |
| Manual npm publication | 2 | 14 = verify + 12 exact-artifact combinations + publish |

Daily Web+Plugin repetitions drop from 9 to 0. Real tarball installations drop
from 9 to 3 for routine shipped Web changes. Legacy Plugin checks run only in
its four independent jobs when relevant.

The latest old Web run consumed **27.88 raw runner minutes** across 9 jobs;
Windows jobs failed, so this is not a successful baseline. Successful Ubuntu
and macOS jobs spent about 2.58–2.73 minutes in combined Web/tarball tests and
0.32–0.53 minutes in repeated Plugin tests. The earlier version-triggered
Adapter run added **3.48 raw runner minutes**, including its detection/payload
jobs. These values come from job/step timestamps, not billing records.

Given the narrower Web matrix, six fewer daily tarball installs, removed Plugin
repetition, and added focused shared-runtime tests, routine Web changes are
expected to use roughly **25–45% fewer raw runner minutes**. Version bumps and
Legacy/docs-only changes save more. Shared-runtime changes intentionally add
Legacy compatibility coverage that the old trigger missed; release validation
intentionally costs more. Runner setup, caching, native dependency installation
and OS billing rates can change actual cost. Measure successful hosted runs
before treating this estimate as a billing reduction.

## Verification and remaining risks

Local verification is on macOS arm64. Regression tests reproduce the native vs
JS path split, retain existing project IDs/archive facts, and reject cleanup of
another project's transcript. Existing negative tests still protect arbitrary
paths, capability/origin checks, missing payload files and linked records.

Executed on this host after the final fixes:

- `npm run test:full`: **394/394 passed**; `npm test`: **189/189 passed**.
- `npm run check:web`: **57 Web + 69 shared-runtime tests passed**.
- `npm run test:legacy`: **113/113 passed**; Adapter suite **33/33** and
  independent Plugin/MCP suite **27/27** passed (also included in the full run).
- Real tarball package acceptance: **6/6 passed per version** on macOS arm64
  Node **18.20.8, 20.20.2, 22.23.3, 24.17.0**. Production dependencies were
  installed into separate consumers; no source tree dependency was used.
- Node 18 project/archive/task-runtime checks: **23/23 passed**; final path/event
  security and project-registry checks: **18/18 passed**.
- An isolated installed-package probe injected a failure immediately after the
  terminal pair launched: both owned mock CLIs exited and the original failure
  remained visible. It created no provider sessions or persistent user state.
- Actionlint **1.7.12**, index synchronization, offline demo, documentation guards,
  whitespace checks and twelve trigger-scope scenarios passed. Independent
  read-only review found no remaining major issues after fixes.

Local results do not prove Windows/Linux, NTFS 8.3 behavior, ConPTY, native folder-picker UI,
real provider authentication, or OIDC issuance. Hosted Web's five combinations,
Legacy's four combinations for shared changes, and the full twelve-combination
package gate must pass before release approval. Node 18 and Windows Node >=22
retain the existing stdio fallback; native PTY is exercised on supported local
Node 22/24 combinations. Newer Node generations remain an unverified risk of
the open-ended engines declaration.

If branch protection names the old workflows/jobs as required checks, update
those required-check names to the new gates. Path-filtered workflows can stay
pending when required unconditionally; choose requirements consistent with the
changed-file scope. No branch-protection settings are changed by this task.
Implementation and local verification were completed without pushing or publishing.
The maintainer subsequently authorized pushing the source branch separately;
merge, tag creation, npm publishing and release dispatch remain unauthorized.

## Modified files

- `.github/workflows/adapter-sdk-acceptance.yml`
- `.github/workflows/release.yml`
- `.github/workflows/web-ci.yml`
- `.github/workflows/web-package-acceptance.yml`
- `README.md`
- `README.zh-CN.md`
- `docs/adapter-conformance.md`
- `docs/releases/v3-ci.md`
- `docs/releases/v3-web-first.md`
- `docs/task-graph-v1.md`
- `inspector/server/workspace-projects.mjs`
- `package.json`
- `scripts/verify-release-artifact.mjs`
- `scripts/verify-workspace-install.mjs`
- `skills/coordinate-agents/scripts/config.mjs`
- `skills/coordinate-agents/scripts/runtime-events.mjs`
- `skills/coordinate-agents/scripts/session-manager.mjs`
- `skills/coordinate-agents/scripts/workspace-task-runtime.mjs`
- `test/adapter-acceptance-gate.test.mjs`
- `test/release-workflow.test.mjs`
- `test/runtime-events.test.mjs`
- `test/task-graph-acceptance-gate.test.mjs`
- `test/workspace-archive.test.mjs`
- `test/workspace-projects.test.mjs`
- `test/workspace-task-runtime.test.mjs`
- `test/workspace.test.mjs`
