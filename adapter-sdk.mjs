/**
 * Public Adapter SDK entry point.
 *
 * npm:    @hogancv/coordinate-agents/adapter-sdk.mjs
 * Plugin: <plugin-root>/adapter-sdk.mjs
 */
export {
  ADAPTER_CAPABILITIES,
  ADAPTER_CAPABILITY_KEYS,
  ADAPTER_CONTRACT_ERROR_CODES,
  ADAPTER_CONTRACT_VERSION,
  RESERVED_ADAPTER_IDS,
  AdapterContractError,
  createAdapter,
  defineAdapter,
  getAdapterContract,
  validateAdapterCapabilities,
  validateAdapterDescriptor,
  validateAdapterIdentity,
  validateAdapterInstance,
  validateConfigurationResult,
  validateDetectionResult,
  validateLaunchPolicy,
  validateLaunchResult,
} from './skills/coordinate-agents/adapters/contract-v1.mjs';

export {
  ADAPTER_CONFORMANCE_ERROR_CODES,
  ADAPTER_CONFORMANCE_KIT_VERSION,
  AdapterConformanceError,
  CONFORMANCE_FIXTURE_MARKER,
  DEFAULT_CONFORMANCE_PROMPT,
  assertAdapterConformance,
  createConformanceFixture,
  runAdapterConformance,
} from './skills/coordinate-agents/adapters/conformance.mjs';

export {
  ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR,
  BUILTIN_ADAPTER_DESCRIPTORS,
  CODEX_CLI_ADAPTER_DESCRIPTOR,
  GENERIC_CLI_ADAPTER_DESCRIPTOR,
} from './skills/coordinate-agents/adapters/index.mjs';
