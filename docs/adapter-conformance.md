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

## Run the kit

The runner creates a temporary repository and a deterministic Node.js fake
executable. The fixture path intentionally contains spaces and shell
metacharacters. Launch plans are executed only when their command, prefix, and
cwd point at that generated fixture; an arbitrary command is rejected before
spawn.

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
