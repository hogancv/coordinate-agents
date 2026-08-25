# Adapter Contract v1

Adapter Contract v1 is the public, machine-validated boundary for trusted local,
executable-backed adapters. Its major version is `1`; it does not follow the npm
package or Codex Plugin version.

Import the contract from the supported package entry:

```js
import {
  ADAPTER_CONTRACT_VERSION,
  defineAdapter,
  createAdapter,
  validateDetectionResult,
  validateConfigurationResult,
  validateLaunchResult,
  validateLaunchPolicy,
} from '@hogancv/coordinate-agents/adapter-sdk.mjs';
```

Inside a checked-out or cached Plugin payload, import `<plugin-root>/adapter-sdk.mjs`.
Do not deep-import the canonical implementation under `skills/`.

The runtime loads external modules only through explicit trusted-local
registration. Use `coordinate-agents adapter register <local-file>` (or the
equivalent Runtime API) before assigning the adapter in project setup. The
registered path is persisted in the user configuration; runtime loading is
deterministic and never scans directories or accepts URLs/import specifiers.

## Descriptor

Use `defineAdapter()` to validate and freeze a descriptor:

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
```

IDs use lowercase kebab-case and are at most 64 characters. `codex-cli`,
`antigravity-cli`, and `generic-cli` are reserved for built-ins. Callers pass
the current registry IDs to `registeredIds` when validating a registration so
duplicates fail before any process is spawned.

Contract v1 has exactly four capability flags:

| Capability | Required method when `true` |
| --- | --- |
| `detection` | `detect(options)` |
| `configuration` | `validateConfiguration(options)` |
| `oneShotLaunch` | `resolveLaunch(context)` |
| `persistentSession` | `resolveSessionLaunch(context)` |

At least one launch capability must be enabled. Every executable-backed adapter
also implements `launchPolicy()`. Contract v1 accepts the existing `one-shot`
and `bus-supervised` modes; it does not grant permission for automatic retries.

`createAdapter()` freezes a shallow copy of configuration, invokes the factory,
and validates the instance/capability relationship. A descriptor or instance
failure throws `AdapterContractError` with canonical code
`INVALID_ADAPTER_CONFIG` or `UNSUPPORTED_CAPABILITY`, `recoverable: false`, and
a deterministic `details.path`.

## Result shapes

Detection returns `available: boolean`. An unavailable result also supplies a
non-empty `code` and `details`; optional executable facts include `command`,
`runtimeCommand`, `resolvedCommand`, `prefix`, and `version`. When present,
`runtimeCommand`, `resolvedCommand`, and `prefix` are the exact facts that the
Runtime compares with the fresh launch plan before spawn.

Configuration validation returns `compatible: boolean`. An incompatible result
also supplies a non-empty canonical `code` and bounded human-readable `details`.

One-shot launch resolution returns:

```js
{
  command: '/exact/resolved/executable',
  prefix: [],
  args: ['--flag', 'value'],
  resolvedCommand: '/exact/resolved/executable', // optional
  cwd: '/requested/repository/root',             // optional
}
```

Persistent-session launch resolution uses the same shape and must add
`initialInputConsumed: boolean`. `true` means the launch arguments consumed the
initial instruction. `false` means the runtime must write it to the owned PTY
after startup. Commands are strings, and `prefix`/`args` are arrays of strings;
the contract has no shell-command-string form.

The public result validators validate shape only. They do not execute a process
or authorize a path. The runtime must revalidate the exact executable, argument
array, cwd/root containment, and input behavior immediately before execution.

## Ownership and trust boundary

An adapter owns only vendor-specific facts: identity, capabilities, detection,
configuration compatibility, launch-plan resolution, launch policy, and initial
input consumption.

The Coordinate Agents runtime remains the sole owner of executable validation,
configured-command precedence, filesystem/root containment, process and PTY
lifecycle, bounded/redacted I/O, retry and recovery, cleanup, Task/Bus/Event
Journal/Inspector state, review, and release authorization.

An explicitly registered local adapter module executes with the permissions of
the current Node.js process. It must be treated as trusted local code. Contract
validation is not a sandbox and does not protect against malicious JavaScript.
The loader accepts only the exact user-selected local file and includes no URL
imports, directory scanning, remote registry, download, or automatic npm
installation.
