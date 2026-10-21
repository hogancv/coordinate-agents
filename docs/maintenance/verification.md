# Documentation migration verification

Local verification completed on 2026-10-22 (Asia/Shanghai). Baseline source: `1341ae73daf182cca9b63df728e0e2e1a0b821a9`.

| Check | Result |
| --- | --- |
| Clean docs lockfile install | `npm ci --prefix docs`: 126 packages installed |
| Documentation tests | `npm test --prefix docs`: 7 passed, including exact pre-migration SHA-256 and v2.4.0 byte comparison |
| VitePress build | Stable 1.6.4, 95 HTML pages, strict dead-link validation enabled |
| Built link/asset crawler | 4,656 local references, zero errors |
| Legacy compatibility | 47 original routes, 371 captured live heading IDs, zero errors |
| Full paired root content | 17 complete English/Chinese pairs; reciprocal heading targets checked |
| Related repository regression | Documentation, repository layout, release workflow, Web distribution: 37 passed |
| npm payload check | Dry-run: 60 files, no VitePress/tooling/new docs included; root manifest/lockfile unchanged |
| Action pin verification | checkout/setup-node/upload-pages-artifact/deploy-pages commits resolved through `gh api`; deploy-pages v4.0.5 uses `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |
| Independent review | Recovery translation omissions corrected; literal code placeholder rendering corrected; final follow-up found no remaining blockers |

Browser verification used Ego Browser against the built production preview under `/coordinate-agents/`:

- Checked native language menu href and document language on all 94 locale routes: zero failures.
- Clicked language transitions in both directions and preserved a deep `#desktop-notifications` target at the matching translated section.
- English query `notifications` and Chinese query `通知` returned matching locale results, including desktop notifications.
- Code-copy button reached its successful `copied` state.
- Switched dark/light theme and confirmed dark mode survived a full reload.
- Emulated 390×844 mobile viewport: Chinese homepage and full guide have document width 390, without horizontal page overflow. Code blocks scroll internally.
- Exercised mobile main navigation, language menu, Chinese sidebar and page outline. Mobile language navigation reached the matching English page.
- Visually inspected Chinese mobile homepage/guide and English desktop homepage screenshots. Screenshots and exhaustive route results are in `.test-results/docs-migration/` (ignored verification output).

The checks validate the documentation system, not live agent execution. This change does not claim any new application, CLI, native Resume, PTY or OS-notification acceptance.

Remaining full translations: 27 Chinese detailed technical/history pages and 3 English original-Chinese engineering records. Localized entry pages disclose the gap; they are not counted as completed translations. See `docs/documentation-migration.md`, its Chinese counterpart, and `docs/maintenance/route-map.json` for the full lists.

Publication was authorized and completed: `main` received commit `0dd998af23060585c124613b58c1fd8ef87d53f6`; Pages Source changed from legacy `main:/docs` to `workflow`, retaining the domain and HTTPS. [Pages build/deploy run 39632155635](https://github.com/hogancv/coordinate-agents/actions/runs/39632155635) succeeded, and both remote homepages report VitePress 1.6.4 with the correct language and canonical URLs.

The first remote Legacy CI run exposed an existing Pages assertion hardcoded to require Jekyll and forbid deployment. That obsolete assertion was reproduced locally and updated to verify pinned VitePress build/deploy actions and main-only deployment. This follow-up changes the documentation workflow test, not Adapter/CLI/runtime behavior. Final remote checks and follow-up CI run URLs are included in the task handoff.
