# V3 Web-first CI: daily scope and Windows verification

This second tightening is based on main `b4ebf051721f046c4dc382cef76398dff90dd077`
after PR #113. npm remains 3.0.0, Plugin remains 2.4.0, and `engines.node >=18`
is unchanged. Publishing is an explicit, separate maintainer action.

## Responsibilities and job counts

Counts mean executed runner jobs, excluding jobs skipped before runner allocation.

| Gate | Before this change | After | Automatic scope |
| --- | ---: | ---: | --- |
| Web CI | 5 | 3: Ubuntu 24, macOS 22, Windows 22 | Web source/tests and shared Session/Adapter/Workspace runtime |
| npm Package Acceptance | 3 | 1: Ubuntu 24 | Shipped runtime/payload, manifest/lockfile and artifact verifiers |
| Legacy Plugin CI | 4 when related | 4 when related | Plugin/Skills/MCP/SDK/Legacy CLI/Task Graph/Bus/Inspector and shared runtimes |
| Custom Pages Build on main push | 1 | 0 | Retained only for docs PRs and explicit manual checks |
| npm release acceptance matrix | 12 | 12 | Explicit release caller or full manual acceptance |
| Platform Pages deployment | 3 | 3 | GitHub-managed deployment, outside repository workflow changes |

Routine Web plus package jobs drop from **8 to 4**. A main push involving all
shared code previously ran **16** jobs including Legacy and both Pages builds;
the corresponding maximum is **11** after this change (3 + 1 + 4 + 3). A docs PR
can add one custom build because it has independent pre-merge validation value.
README edits run one package job because README is shipped by npm, rather than
cross-platform Web or Legacy matrices.

`npm run check:web` retains Web/PTY/Session/Workspace and shared Adapter tests;
Plugin suites remain independent. `npm run test:package` still makes and installs
a real tarball, validates its whitelist/import closure/production dependencies,
starts Web and mock terminal pairs, tests messages/isolation/restart/archives, and
confirms cleanup. No test or Node support line was removed to reduce job counts.

## Windows root causes and fixes

Complete logs were downloaded with `gh run view --log`:

- [Web 37874550313](https://github.com/hogancv/coordinate-agents/actions/runs/37874550313): Windows Node 22/24 failed the first persistent Session test with EBUSY/EPERM in its final directory removal.
- [Legacy 37874550340](https://github.com/hogancv/coordinate-agents/actions/runs/37874550340): Windows Node 22 discovered zero Inspector Sessions instead of one.
- [Package 37874550350](https://github.com/hogancv/coordinate-agents/actions/runs/37874550350): all three installed-tarball jobs passed; this did not prove the two source regressions.

The Session fixture returned a lexical temporary root and compared the manager's
native `runneradmin` cwd with JS `realpathSync`'s retained `RUNNER~1` spelling.
The assertion occurred before close. Its `finally` removed the tree without
closing the already launched Session, so a genuine fixture process leak locked
the root and masked the initial assertion. Extending removal retries could not
fix that leak.

The fixture now uses native canonical roots and preserves the cwd assertion.
Every root cleanup enumerates its own persisted Sessions, closes them through
the actual Session service, and checks the stored host and CLI PIDs for exit
before removing files. Process liveness treats EPERM as alive. Failure to close
or exit is an explicit test failure. Only after confirming exit does Windows
receive bounded file-removal retries (10 × 100 ms) for delayed handle release.
Environment overrides are restored between tests. The injected post-launch
assertion regression proves the original error survives cleanup and both owned
processes have exited. No arbitrary PID or caller-provided process is killed.
The diagnosed issue required no PTY redesign or production timeout relaxation.

Inspector used `listRecords(root)` with a lexical root. The manager found the
Session directory through a native canonical path but passed the original root
to record parsing. Lexical containment then rejected the valid file and the
list's corrupt-record filter silently omitted it. `listRecords` now uses one
canonical repository for discovery and parsing. The shared Inspector/Web
`canonicalRoot` also uses native realpath. Historical cwd aliases remain
readable; no persisted Session is rewritten. A real parent symlink/junction
alias regression requires exactly one Session and checks unchanged file bytes.
Existing linked-record, malformed ID, capability/origin and containment guards
remain intact.

Local success does not prove NTFS or Windows process behavior. The explicit
Web CI input `windows_regression=true` selects Windows Node 22/24, runs the Web
and shared Session suite, and additionally runs the Inspector suite. This is a
manual repair-verification mode; routine Web remains three jobs.

## Shared dependency audit and trigger tests

Legacy references are actual code dependencies, not filename assumptions:

- `lib/cli-core.mjs` loads `inspector/server/server.mjs`; that module re-exports the Workspace server and shares HTTP transport.
- Legacy Inspector imports `workspace-data.mjs` and `workspace-task-runtime.mjs`.
- `runtime-services.mjs` exposes Workspace task operations.
- `action-gateway.mjs` imports Workspace services; those depend on Workspace task persistence and role prompts.
- Workspace task prompts reference the message helper as an executable resource.

Therefore shared Workspace scripts and server modules trigger both Web and
Legacy. The previous blanket Workspace exclusion is removed. npm-only
`lib/web-cli.mjs`, Workspace UI/CSS and npm metadata alone do not trigger Legacy.
Package triggers name the shipped adapters, avoiding packing for SDK/conformance
code absent from the npm whitelist. General repository documentation does not
trigger runtime matrices.

The YAML paths were evaluated with ordered positive/negative glob rules for
sixteen scenarios; the main requested cases are:

| Changed file / event | Web | npm | Legacy | Custom Pages |
| --- | --- | --- | --- | --- |
| Web CSS | 3 | 1 | — | — |
| npm-only Web CLI runtime | 3 | 1 | — | — |
| Shared Workspace task runtime | 3 | 1 | 4 | — |
| Session Manager | 3 | 1 | 4 | — |
| Plugin Skill | — | — | 4 | — |
| Adapter SDK root module | — | — | 4 | — |
| README | — | 1 | — | — |
| package.json / lockfile | 3 | 1 | — | — |
| docs-only PR | — | — | — | 1 |
| Formal npm release | verify job | 12 artifact consumers | — | — |

The table excludes the unchanged GitHub platform Pages deployment. Manual full
package acceptance runs **one producer plus twelve consumers**; the matrix itself
is still twelve combinations. Regular npm acceptance runs only its one Ubuntu
job. Formal publishing runs verify + twelve consumers + publish, as before.

## One artifact, full release coverage

Full manual acceptance now packs **once**, uploads the candidate and SHA-256
sidecar, and makes all twelve consumers download that candidate. It no longer
creates a different tarball in each matrix environment. Release acceptance uses
the artifact supplied by `release.yml`, skipping the independent producer.
Failed producers or consumers cannot satisfy the publication dependency.

Consumers verify the sidecar hash with Node crypto, then install production
dependencies into independent consumer/home directories and run the installed
Web acceptance. The publish job rechecks the downloaded hash before publishing
that same tarball. Artifact upload/download actions remain pinned. Explicit
PUBLISH, existing tag/version matching, expected source SHA/tag verification,
OIDC `id-token: write`, Trusted Publishing and provenance remain in place.
Acceptance has no publish or OIDC write permission. No publishing workflow is
executed for repair verification.

## Pages and required checks

Read-only GitHub API inspection confirmed Pages is **legacy**, source branch
**main**, path **/docs**, with active `pages-build-deployment`. The repository
custom job only built Jekyll and never deployed. It now validates docs PRs and
manual runs, leaving platform deployment/source/permissions unchanged. A main
push no longer repeats the custom Jekyll job before the platform build.

The traditional main branch-protection endpoint returned 404 (not protected),
and the repository rulesets endpoint returned an empty list. No required-check
configuration was changed. Do not mark these path-filtered workflow names as
unconditional required checks: unrelated PRs would leave them pending. If the
maintainer later requires one stable mandatory gate, use a workflow that always
starts on PRs, evaluates scope internally, and exposes one aggregate status that
fails for any required suite failure; set only that aggregate status as required.
That future settings/policy change is outside this request.

## Verifiable timing and costs

Job timestamps on the failed main baseline recorded:

| Workflow | Executed jobs | Total raw runner seconds |
| --- | ---: | ---: |
| Web | 5 | 896 |
| npm package | 3 | 167 |
| Legacy | 4 | 373 |
| Custom Pages | 1 | 18 |
| Platform Pages | 3 | 35 |
| Total | 16 | 1,489 (24.82 minutes) |

Two Web Windows jobs and one Legacy Windows job failed, so this is not a green
baseline and is not comparable to a successful run without qualification.
Job count reductions are deterministic: daily Web/npm 8 → 4 (50%); a full-scope
main push 16 → 11 (31.25%). Removed baseline jobs accounted for 509 raw seconds,
but that is historical work avoided, not a measured future billing saving.
Successful branch CI timings must be reported separately by platform/workflow.
No currency saving or unexecuted runtime duration is claimed; pricing, caching,
runner setup and failure paths affect actual cost. Full manual/release coverage
intentionally retains its cost.

## Verification and handoff

Local verification uses macOS arm64 with Node 24.17.0. Core **190/190**, Web
**57/57**, shared runtime **70/70**, Legacy **114/114**, Adapter **33/33**, real
package acceptance **6/6**, and affected Session/Inspector **19/19** passed.
Actionlint 1.7.12, whitespace checks and the sixteen trigger/matrix scenarios
passed. Independent read-only review found no critical or important issues.

Hosted verification is required before declaring the Windows repair complete:
Windows Node 22/24 Session and Inspector tests, the normal three Web jobs, four
Legacy jobs for these shared changes, and the manual twelve-consumer exact
artifact matrix. Full local regressions and hosted results are recorded in the
final task handoff. macOS results alone are not Windows/Linux evidence. Native
OS chooser UI and real paid provider authentication remain outside mock tests;
no paid Agent was launched or real user configuration modified.

Code review passes. Merge readiness remains conditional on the actual hosted
checks. Feature-branch pushes and non-publishing CI are used for verification;
main pushes, merges, tags, GitHub Releases and npm publishing remain unauthorized.
