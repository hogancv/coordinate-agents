# Minimal external Adapter example

This directory is intentionally outside the built-in Adapter registry. It is
an offline example of the public Contract v1 boundary:

- `adapter.mjs` imports the SDK only from
  `@hogancv/coordinate-agents/adapter-sdk.mjs`;
- `fake-agent.mjs` is a deterministic local executable with one-shot and
  persistent input behavior; and
- `run-conformance.mjs` runs the public Conformance Kit without a provider,
  account, token, network request, or real user configuration.

Run the example from the repository or a packed package checkout:

```sh
node examples/minimal-external-adapter/run-conformance.mjs
```

For the registration and persistent-Session flow, follow the
[Adapter author guide](../../docs/adapter-author-guide.md). The example is
not automatically registered and is not a production provider integration.
