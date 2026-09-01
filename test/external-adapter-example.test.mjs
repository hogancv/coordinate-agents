import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import descriptor, {
  MINIMAL_EXTERNAL_ADAPTER_ID,
} from '../examples/minimal-external-adapter/adapter.mjs';
import {
  assertAdapterConformance,
} from '../adapter-sdk.mjs';
import {
  listAdapters,
} from '../skills/coordinate-agents/adapters/index.mjs';

const exampleRoot = join(process.cwd(), 'examples', 'minimal-external-adapter');
const exampleModule = join(exampleRoot, 'adapter.mjs');
const builtinRegistrySource = join(process.cwd(), 'skills', 'coordinate-agents', 'adapters', 'index.mjs');
const registrationChild = join(process.cwd(), 'test', 'support', 'external-adapter-registration-child.mjs');

test('minimal external Adapter uses only the public SDK and passes offline conformance', () => {
  assert.equal(listAdapters().includes(MINIMAL_EXTERNAL_ADAPTER_ID), false);
  const source = readFileSync(exampleModule, 'utf8');
  assert.match(source, /@hogancv\/coordinate-agents\/adapter-sdk\.mjs/);
  assert.doesNotMatch(source, /skills[\\/]/);
  assert.doesNotMatch(readFileSync(builtinRegistrySource, 'utf8'), new RegExp(MINIMAL_EXTERNAL_ADAPTER_ID));
  const report = assertAdapterConformance(descriptor);
  assert.equal(report.ok, true);
  assert.equal(report.adapterId, MINIMAL_EXTERNAL_ADAPTER_ID);
  assert.equal(report.contractVersion, 1);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.observations.persistentSession.initialInputConsumed, false);
  assert.equal(report.observations.persistentSession.initialInputVerified, true);
});

test('minimal external Adapter follows explicit registration and persistent Session flow', () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'coordinate-agents-example-child-home-'));
  try {
    const result = spawnSync(process.execPath, [registrationChild], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        COORDINATE_AGENTS_HOME: home,
        HOME: home,
        USERPROFILE: home,
      },
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true, result.stdout);
    assert.equal(payload.adapter, MINIMAL_EXTERNAL_ADAPTER_ID);
    assert.equal(payload.agent, 'minimal-example');
    assert.equal(payload.persistentPrompt, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
