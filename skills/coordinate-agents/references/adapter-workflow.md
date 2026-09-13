# Adapter workflow

Read when authoring or registering an adapter.

Adapter authors must use the public `adapter-sdk.mjs` entry and the frozen
Contract v1 boundary documented in `adapter-contract-v1.md`. Run
the public Adapter Conformance Kit documented in `../../../docs/adapter-conformance.md`
and follow the complete author workflow in `../../../docs/adapter-author-guide.md`
against deterministic fixtures before proposing an adapter. The bundled minimal
external example lives at `../../../examples/minimal-external-adapter/` and is not
part of the built-in registry. To use one, register
the exact local module explicitly with `coordinate-agents adapter register
<local-file>`; the loader rejects URLs, scans, symlinked/junctioned paths,
duplicate or built-in IDs, bad exports, and unsupported Contract versions before
configuration or spawn. Registered modules are trusted code running with the
current Node.js permissions. The repository-owned Codex CLI, Antigravity CLI,
and generic CLI adapters are created through validated Contract v1 descriptors
and are covered by the same conformance suite.

Setup and MCP expose one additive `adapters` registry snapshot containing the
same registered identities and Contract capabilities. Discovery does not
launch an adapter or resolve a launch plan; for an already configured external
Agent it invokes only the adapter's defined `detect()` operation. The existing
setup and Task MCP tool names and input shapes remain compatible, and an
external adapter selected by setup follows the same exact command precedence,
Task, and persistent-Session path as a built-in adapter.
