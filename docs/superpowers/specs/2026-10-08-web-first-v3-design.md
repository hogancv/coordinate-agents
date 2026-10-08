# Web-first npm 3.0 design

The user authorizes autonomous implementation and decisions, with no questions or release actions. The target is the existing dual-terminal Workspace, preserving role prompts, persistence, independent Session Host recovery, custom executable paths/arguments, and all loopback/capability/path/session guards. GitHub Plugin, MCP, Inspector, Task Graph and Adapter authoring remain source products with independent versions.

## Choice

Use a separate lightweight npm CLI and explicit repository-only Legacy CLI. Extract the existing HTTP transport so Workspace selects a lightweight data factory; the Legacy Inspector supplies its existing data factory. Extract a Web Session/Workspace operation map and retain an explicit source-only Legacy gateway. Initialize only Workspace storage/config rather than running Agent Bus initialization. Keep the mature Session Manager and built-in Adapter launch/validation contract; exclude the conformance kit, SDK entry, examples and Skill resources. This has less compatibility risk than replacing adapters or moving/copying the whole runtime into dist.

## Distribution

An exact package.json file whitelist includes only runtime modules, all Workspace assets (including xterm license), README, LICENSE, CHANGELOG and metadata. No build/prepack output is required: npm pack/publish --ignore-scripts use the same tracked sources. Remove wildcard and Adapter SDK exports. Public CLI: web, --help, --version; repository Plugin resolves the Legacy launcher. Unsupported npm commands show a 2.4.0 migration command.

## Validation

Measure actual tarballs and isolated production installs on the same host; report allocated node_modules disk and five startup samples, with no cross-platform claims. Tarball verifier independently installs dependencies and runs help/version, static import closure and dynamic import loading, HTTP assets/APIs, mock dual CLI startup, role injection, task isolation, input/read/resize, directed messaging, reconnect/restart and cleanup. Fake CLIs run offline in isolated homes. CI adds Windows/macOS/Linux with supported Node versions. Trusted Publishing/OIDC and manual PUBLISH remain; publish the exact verified tarball. No publish/tag/release/push/merge is authorized.

## Integration follow-up — 2026-10-08

After implementation and verification, the user explicitly requested `push`, authorizing a source commit and push to the existing branch. npm publishing, version tags, GitHub Releases and release-workflow dispatch remain outside this authorization.
