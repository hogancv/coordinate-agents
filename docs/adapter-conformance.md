---
layout: page
title: Adapter Conformance Kit
description: Run deterministic, offline Adapter Contract v1 checks for built-in and third-party adapters.
permalink: /adapter-conformance.html
---

# Adapter Conformance Kit

The public Adapter Conformance Kit lets an adapter author run the same
Contract v1 checks used by the project without a provider account, token,
network connection, or real user configuration. It accepts a validated
descriptor or an instance factory with explicit public metadata.

## Public import

Import the kit from the package entry point; do not deep-import files below
`skills/`:

```js
import {
  ADAPTER_CONTRACT_VERSION,
  defineAdapter,
  runAdapterConformance,
  assertAdapterConformance,
} from '@hogancv/coordinate-agents/adapter-sdk.mjs';
```

The package and Plugin versions are independent from both
`ADAPTER_CONTRACT_VERSION` and `ADAPTER_CONFORMANCE_KIT_VERSION`.

For a complete external module, offline executable, and explicit registration
walkthrough, see the [External Adapter Author Guide](./adapter-author-guide.md)
and the [minimal external Adapter example](../examples/minimal-external-adapter/README.md).

## Run the kit

The runner creates a temporary repository and a deterministic Node.js fake
executable. The fixture path intentionally contains spaces and shell
metacharacters. Launch plans are executed only when their command, prefix, and
cwd point at that generated fixture; an arbitrary command is rejected before
spawn.

The three repository-owned adapters expose the same descriptors and are checked
by the same runner: `CODEX_CLI_ADAPTER_DESCRIPTOR`,
`ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR`, and `GENERIC_CLI_ADAPTER_DESCRIPTOR`.
Built-in IDs are reserved, so maintainer conformance calls opt into
`allowReserved: true`; third-party adapters must use a new ID.

```js
const descriptor = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: 'example-cli',
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  create(config) {
    const fixture = config.conformanceFixture;
    return new ExampleAdapter({ ...config, command: fixture.command });
  },
});

const report = runAdapterConformance(descriptor, {
  // The callback receives the generated, isolated fixture. The runner also
  // injects it as config.conformanceFixture for the adapter factory.
  config: fixture => ({ vendorMode: 'fixture', command: fixture.command }),
});

if (!report.ok) {
  for (const diagnostic of report.diagnostics) console.error(diagnostic);
  process.exitCode = 1;
}
```

For CI code that should fail immediately, use `assertAdapterConformance()`;
it throws `AdapterConformanceError` with the bounded report attached as
`error.report`. A factory function can be passed directly when `id` and
`capabilities` are supplied in the options:

```js
const report = assertAdapterConformance(createExampleAdapter, {
  id: 'example-cli',
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  config: fixture => ({ command: fixture.command }),
});
```

The `config` option may be an object or a function receiving this immutable
fixture description:

```js
{
  root,       // temporary repository containing spaces and shell metacharacters
  command,    // process.execPath
  script,     // deterministic fake executable script
  prefix,     // [script]
  marker,
  prompt,
  repository, // true; an isolated Git repository is initialized at root
}
```

The runner adds `conformanceFixture` to the factory configuration and does not
mutate the caller's object. `registeredIds` may be supplied to exercise
duplicate-identity rejection. `execute: false` performs contract and launch
shape checks without spawning; the default is to execute both declared launch
plans against the fake process. Temporary roots are removed in a `finally`
path. For local debugging or custom harnesses, callers may use
`createConformanceFixture()` directly and must call its `cleanup()` method.

The built-in registry creates its three adapters through their validated
Contract v1 descriptors. Runtime code reads the frozen descriptor capabilities
when it chooses persistent-session behavior; the legacy `capabilities()` method
remains available for compatibility metadata.

## Explicit trusted-local modules

An adapter module can be added only through an explicit local path supplied by
the user or an already persisted `adapters` entry:

```sh
npx @hogancv/coordinate-agents adapter register "C:\\path\\to\\adapter.mjs" --json
npx @hogancv/coordinate-agents adapter list --json
npx @hogancv/coordinate-agents adapter remove "C:\\path\\to\\adapter.mjs" --json
```

Registration accepts only an existing regular `.mjs`, `.js`, or `.cjs` file
whose path contains no symlink, junction, or hard link. The module is imported
from that exact canonical path, its single exported Contract v1 descriptor is
validated against the built-in and already registered IDs, and only then is
the user configuration updated. A failed registration leaves both the user
configuration and project `.agent-bus` unchanged. There is no directory scan,
URL/import-specifier loading, download, registry lookup, or automatic npm
installation. The module is trusted local JavaScript and runs with the current
Node.js process permissions; Contract validation is not a JavaScript sandbox.

## What is proved

The report contains bounded `checks`, `failures`, `diagnostics`, and structured
`observations` for:

- Contract v1 descriptor, identity, reserved/duplicate IDs, and capabilities;
- detection and configuration compatibility results;
- one-shot and persistent-session launch result shapes;
- launch policy and optional runtime capability facts;
- deterministic fake-process execution and persistent initial-prompt delivery;
- malformed or unsafe launch plans, with zero spawn for pre-spawn rejection.

Failures use canonical Contract v1 codes where applicable, including
`INVALID_ADAPTER_CONFIG` and `UNSUPPORTED_CAPABILITY`. Conformance-specific
codes include `UNSAFE_LAUNCH`, `PROCESS_FAILED`, and
`INITIAL_INPUT_MISMATCH`. Diagnostic messages are bounded and redact common
secret forms; raw process output and temporary absolute paths are not placed in
the report.

The kit validates behavior and launch-plan safety at its boundary. It is not a
JavaScript sandbox: a local adapter module is trusted code executed by the
current Node.js process. The kit does not scan directories, import URLs,
download packages, install dependencies, access a live provider, or edit a
user's configuration.

## Repository acceptance gate

The repository gate runs the built-in descriptors and the bundled external
example through this same public kit, then exercises the complete external
setup, Task dispatch, persistent Session reuse, input/output, close, and
trusted-local cleanup path. The ordinary regression suite also protects the
Task, Agent Bus, Event Journal, Inspector, MCP, review, executable-precedence,
and release-authorization boundaries.

Run the local gate from a clean checkout:

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
```

The authoritative matrix is defined in
`.github/workflows/adapter-sdk-acceptance.yml` and runs these checks on
Windows, macOS, and Linux with Node.js 18 and Node.js 22. Local results prove
only the current host; the matrix workflow is the cross-platform evidence. Automatic pull-request
and `main` runs are limited to `package.json` changes and proceed only when its `version` differs
from the base revision. Version tags and explicit manual dispatches remain available for release
and maintenance verification.
