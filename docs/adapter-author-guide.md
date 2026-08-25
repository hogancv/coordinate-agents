---
layout: page
title: External Adapter Author Guide
description: Build, validate, and explicitly register a local external Adapter Contract v1 module.
permalink: /adapter-author-guide.html
---

# External Adapter Author Guide

This guide describes the smallest supported external Adapter Contract v1
module. The complete offline example is
[`examples/minimal-external-adapter/adapter.mjs`](../examples/minimal-external-adapter/adapter.mjs),
with a deterministic executable in
[`fake-agent.mjs`](../examples/minimal-external-adapter/fake-agent.mjs). It is
not imported by the built-in registry: an adapter becomes available only after
the user explicitly registers its exact local module path.

## Public boundary

Import the SDK only from the documented package entry. Do not import files below
`skills/` or rely on private Runtime helpers:

```js
import {
  ADAPTER_CONTRACT_VERSION,
  defineAdapter,
} from '@hogancv/coordinate-agents/adapter-sdk.mjs';
```

The package/Plugin version and `ADAPTER_CONTRACT_VERSION` are independent. A
Contract v1 descriptor has a lowercase kebab-case `id`, exactly four boolean
capability flags, and a `create(config)` factory. The ID must not be one of the
built-in IDs (`codex-cli`, `antigravity-cli`, or `generic-cli`) and must not
duplicate another registered adapter.

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
    return new ExampleAdapter(config);
  },
});

export default descriptor;
```

`create()` receives a frozen configuration copy. Keep vendor-specific state in
the adapter, but leave executable precedence, path safety, process/PTY
lifecycle, bounded output, Task/Session state, recovery, and release policy to
Coordinate Agents Runtime.

## Required methods and facts

Implement the method required by each declared capability:

| Method | Responsibility |
| --- | --- |
| `detect({ version })` | Return executable facts. If unavailable, return `available: false` plus non-empty `code` and `details`. |
| `validateConfiguration({ setup: true })` | Return `{ compatible: true, code: null, details: null }`, or a canonical failure with `compatible: false`. |
| `resolveLaunch({ root, prompt, agent, language })` | Return exact `command`, `prefix`, string-array `args`, and preferably `resolvedCommand`/`cwd`. |
| `resolveSessionLaunch({ root, initialPrompt, agent, language })` | Return the persistent launch shape plus `initialInputConsumed`. |
| `launchPolicy()` | Return `mode: 'one-shot'` or `mode: 'bus-supervised'`; this does not authorize retries. |

`prefix` is for a safe executable wrapper such as a Node.js script. Never
return a shell command string. The Runtime revalidates the command, prefix,
`resolvedCommand`, repository `cwd`, and input-delivery facts immediately
before spawn. For a persistent Session, `initialInputConsumed: false` means the
Runtime writes `initialPrompt` to the owned PTY after startup; `true` means the
adapter placed it in the launch arguments and must be able to prove that fact.

Use the Contract validators through the public entry point when a custom test
harness needs to inspect results. Contract errors use the canonical
`INVALID_ADAPTER_CONFIG` and `UNSUPPORTED_CAPABILITY` codes. Detection and
runtime failures should use a stable non-empty code and bounded details; do not
invent MCP-specific error codes or hide failures behind a successful result.

## Offline conformance

Run the published deterministic Conformance Kit before registration:

```sh
node examples/minimal-external-adapter/run-conformance.mjs
```

The runner creates a temporary Git repository and fake executable whose path
contains spaces and shell metacharacters. It checks descriptor identity,
capabilities, detection, configuration, launch policy, one-shot launch,
persistent launch, and initial prompt delivery. It rejects unsafe or malformed
plans before spawning. The fixture is removed in a `finally` path.

For an adapter outside this repository, use the same public imports in a small
CI script:

```js
import {
  assertAdapterConformance,
} from '@hogancv/coordinate-agents/adapter-sdk.mjs';
import descriptor from './adapter.mjs';

assertAdapterConformance(descriptor);
```

This example uses only a local Node.js fake executable. It does not require a
provider account, token, network, live model, or real user configuration.

## Explicit trusted-local registration

Registration is a deliberate local-code boundary. Register the exact module;
there is no directory scan, URL import, remote lookup, download, or automatic
npm installation:

```sh
node bin/coordinate-agents.mjs adapter register \
  "<repository>/examples/minimal-external-adapter/adapter.mjs" --json
node bin/coordinate-agents.mjs adapter list --json
```

Then configure the example with the exact Node.js executable and fake-agent
script. Use absolute paths when the host process may not start in the project
root:

```text
Agent: minimal-example
Adapter: minimal-external-adapter
Command: <absolute path returned by `node -p "process.execPath"`>
Args: ["<repository>/examples/minimal-external-adapter/fake-agent.mjs"]
```

The equivalent Runtime setup transaction is:

```sh
node bin/coordinate-agents.mjs setup configure \
  --agent minimal-example \
  --command "<node-executable>" \
  --adapter minimal-external-adapter \
  --args '["<repository>/examples/minimal-external-adapter/fake-agent.mjs"]' \
  --root "<repository>" --json
```

The registered module is trusted local code and executes with the current
Node.js process permissions. Contract validation is not a JavaScript sandbox,
so only register code that is trusted and reviewable. A failed registration or setup validation must leave
the persisted user configuration and project Agent Bus unchanged.

## Packaging and identity checklist

An external adapter must remain outside the built-in registry source. Ship the
public `adapter-sdk.mjs` entry and the example together, and test the actual
package payload with `npm pack --dry-run`. Keep these identities distinct:

1. Adapter ID: the Contract descriptor's unique lowercase kebab-case ID.
2. Agent ID: the project workflow identity selected during setup.
3. Executable identity: the exact configured command, resolved by project
   command > user command > adapter default precedence.

The Runtime owns the third identity and the process. The Adapter only supplies
vendor-specific detection and launch facts.
