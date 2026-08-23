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
  validateAdapterCapabilities,
  validateAdapterDescriptor,
  validateAdapterIdentity,
  validateAdapterInstance,
  validateConfigurationResult,
  validateDetectionResult,
  validateLaunchPolicy,
  validateLaunchResult,
} from './skills/coordinate-agents/adapters/contract-v1.mjs';
