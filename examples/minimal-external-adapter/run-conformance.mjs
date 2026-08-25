import {
  assertAdapterConformance,
} from '@hogancv/coordinate-agents/adapter-sdk.mjs';

import descriptor from './adapter.mjs';

const report = assertAdapterConformance(descriptor);
console.log(JSON.stringify({
  adapter: report.adapterId,
  contractVersion: report.contractVersion,
  kitVersion: report.kitVersion,
  ok: report.ok,
  summary: report.summary,
  observations: report.observations,
}, null, 2));
