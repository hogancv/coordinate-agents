import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ADAPTER_CONTRACT_VERSION,
  AdapterContractError,
  createAdapter,
  validateAdapterDescriptor,
  validateConfigurationResult,
  validateDetectionResult,
  validateLaunchPolicy,
  validateLaunchResult,
} from './contract-v1.mjs';

export const ADAPTER_CONFORMANCE_KIT_VERSION = 1;

export const ADAPTER_CONFORMANCE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  ADAPTER_METHOD_FAILED: 'ADAPTER_METHOD_FAILED',
  UNSAFE_LAUNCH: 'UNSAFE_LAUNCH',
  PROCESS_FAILED: 'PROCESS_FAILED',
  INITIAL_INPUT_MISMATCH: 'INITIAL_INPUT_MISMATCH',
  FIXTURE_FAILED: 'FIXTURE_FAILED',
});

export const CONFORMANCE_FIXTURE_MARKER = 'COORDINATE_ADAPTER_CONFORMANCE:';
export const DEFAULT_CONFORMANCE_PROMPT = 'conformance prompt with spaces & [argv]';

const MAX_DIAGNOSTIC_LENGTH = 512;
const MAX_DIAGNOSTICS = 32;
const DEFAULT_TIMEOUT_MS = 2_000;
const DESCRIPTOR_KEYS = new Set(['contractVersion', 'id', 'capabilities', 'create']);

function runFile(command, args, options) {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, options),
      stderr: '',
      error: null,
    };
  } catch (error) {
    return {
      status: Number.isInteger(error?.status) ? error.status : null,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? '',
      error,
    };
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, limit = MAX_DIAGNOSTIC_LENGTH) {
  const text = `${value ?? ''}`.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function sanitizeMessage(value, fixture) {
  let message = bounded(value || 'Adapter method failed.');
  for (const path of [fixture?.root, fixture?.tempRoot, fixture?.script]) {
    if (path) message = message.split(path).join('[fixture-path]');
  }
  return bounded(message.replace(/((?:token|password|passwd|secret|api[_-]?key|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'));
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function stableError(error, fixture) {
  if (error instanceof AdapterContractError) {
    return {
      code: error.code,
      path: error.details?.path || 'adapter',
      message: sanitizeMessage(error.message, fixture),
    };
  }
  return {
    code: error?.code || ADAPTER_CONFORMANCE_ERROR_CODES.ADAPTER_METHOD_FAILED,
    path: error?.path || 'adapter',
    message: sanitizeMessage(error?.message || error, fixture),
  };
}

function addFailure(report, check, error, fixture, fallbackCode = ADAPTER_CONFORMANCE_ERROR_CODES.ADAPTER_METHOD_FAILED) {
  const normalized = stableError(error, fixture);
  const failure = {
    check,
    code: normalized.code || fallbackCode,
    path: normalized.path || check,
    message: normalized.message,
  };
  report.failures.push(failure);
  report.checks.push({ name: check, status: 'failed', code: failure.code, path: failure.path });
  return failure;
}

function pass(report, check) {
  report.checks.push({ name: check, status: 'passed' });
}

function skip(report, check, reason) {
  report.checks.push({ name: check, status: 'skipped', reason });
}

function descriptorLike(value) {
  return isRecord(value) && Object.keys(value).some(key => DESCRIPTOR_KEYS.has(key));
}

function normalizeDescriptor(input, options) {
  if (isRecord(input) && 'descriptor' in input) return input.descriptor;
  if (isRecord(input) && 'factory' in input) {
    return {
      contractVersion: input.contractVersion ?? options.contractVersion ?? ADAPTER_CONTRACT_VERSION,
      id: input.id ?? options.id,
      capabilities: input.capabilities ?? options.capabilities,
      create: input.factory,
    };
  }
  if (typeof input === 'function') {
    if (options.id !== undefined
      || options.capabilities !== undefined
      || input.id !== undefined
      || input.capabilities !== undefined
      || input.contractVersion !== undefined) {
      return {
        contractVersion: options.contractVersion ?? input.contractVersion ?? ADAPTER_CONTRACT_VERSION,
        id: options.id ?? input.id,
        capabilities: options.capabilities ?? input.capabilities,
        create: input,
      };
    }
    const candidate = input();
    if (descriptorLike(candidate)) return candidate;
    throw new AdapterContractError(
      ADAPTER_CONFORMANCE_ERROR_CODES.INVALID_INPUT,
      'factory: provide id and capabilities metadata when the input is an instance factory.',
      { path: 'factory' },
    );
  }
  return input;
}

function makeFakeExecutableSource() {
  return `
const marker = ${JSON.stringify(CONFORMANCE_FIXTURE_MARKER)};
const chunks = [];
let emitted = false;

function emit() {
  if (emitted) return;
  emitted = true;
  process.stdout.write(marker + JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdin: chunks.join(''),
  }) + '\\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', emit);
setTimeout(emit, 50);
`;
}

/**
 * Create the deterministic process fixture used by the conformance runner.
 * The caller owns the returned fixture and must call cleanup().
 */
export function createConformanceFixture({ prompt = DEFAULT_CONFORMANCE_PROMPT } = {}) {
  // macOS exposes the system temporary directory through a /var alias. A
  // child process reports its canonical /private/var cwd, so create the
  // fixture under the canonical temporary root to keep the observation and
  // launch plan equivalent on every supported platform.
  const tempRoot = mkdtempSync(join(realpathSync(tmpdir()), 'coordinate-agents-conformance-'));
  const root = join(tempRoot, 'repository with spaces & [fixture]');
  const script = join(tempRoot, 'fake adapter with spaces & [fixture].mjs');
  try {
    mkdirSync(root, { recursive: true });
    const init = runFile('git', ['init', '--quiet', root], {
      cwd: tempRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (init.error || init.status !== 0) throw new Error('unable to initialize the isolated Git fixture');
    writeFileSync(script, makeFakeExecutableSource(), 'utf8');
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }

  let cleaned = false;
  let spawned = 0;
  const publicFixture = Object.freeze({
    root,
    command: process.execPath,
    script,
    prefix: Object.freeze([script]),
    marker: CONFORMANCE_FIXTURE_MARKER,
    prompt,
    repository: true,
  });

  return {
    ...publicFixture,
    tempRoot,
    get spawned() {
      return spawned;
    },
    public: publicFixture,
    spawn(plan, { input = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      spawned += 1;
      return runFile(plan.command, [...plan.prefix, ...plan.args], {
        cwd: plan.cwd || root,
        env: { ...process.env },
        encoding: 'utf8',
        input,
        shell: false,
        timeout: timeoutMs,
        windowsHide: true,
      });
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

function parseFixtureOutput(stdout, fixture) {
  const output = `${stdout || ''}`;
  const markerIndex = output.indexOf(fixture.marker);
  if (markerIndex < 0) {
    throw new Error('isolated fixture did not return its conformance marker');
  }
  const payloadText = output.slice(markerIndex + fixture.marker.length).trim().split(/\r?\n/, 1)[0];
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error('isolated fixture returned malformed JSON');
  }
  if (!isRecord(payload)
    || !Array.isArray(payload.argv)
    || typeof payload.cwd !== 'string'
    || typeof payload.stdin !== 'string') {
    throw new Error('isolated fixture returned an invalid observation');
  }
  return payload;
}

function isolatedPlanError(plan, fixture) {
  if (plan.command !== fixture.command) return 'launch.command must target the isolated fixture executable';
  if (!sameStringArray(plan.prefix, fixture.prefix)) return 'launch.prefix must target the isolated fixture script';
  if (plan.cwd !== undefined && resolve(plan.cwd) !== resolve(fixture.root)) {
    return 'launch.cwd must remain inside the isolated fixture repository';
  }
  return null;
}

function executePlan(plan, fixture, { input = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  assertIsolatedPlan(plan, fixture);
  const result = fixture.spawn(plan, { input, timeoutMs });
  if (result.error) {
    const error = new Error('isolated fixture process failed to start or timed out');
    error.code = ADAPTER_CONFORMANCE_ERROR_CODES.PROCESS_FAILED;
    error.path = 'launch.process';
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error('isolated fixture process exited unsuccessfully');
    error.code = ADAPTER_CONFORMANCE_ERROR_CODES.PROCESS_FAILED;
    error.path = 'launch.process';
    throw error;
  }
  const observation = parseFixtureOutput(result.stdout, fixture);
  if (resolve(observation.cwd) !== resolve(fixture.root)) {
    const error = new Error('isolated fixture observed an unexpected working directory');
    error.code = ADAPTER_CONFORMANCE_ERROR_CODES.UNSAFE_LAUNCH;
    error.path = 'launch.cwd';
    throw error;
  }
  return observation;
}

function assertIsolatedPlan(plan, fixture) {
  const unsafe = isolatedPlanError(plan, fixture);
  if (!unsafe) return;
  const error = new Error(unsafe);
  error.code = ADAPTER_CONFORMANCE_ERROR_CODES.UNSAFE_LAUNCH;
  error.path = 'launch';
  throw error;
}

function reportFailureDiagnostic(failure) {
  return bounded(`${failure.check} [${failure.code}] ${failure.path}: ${failure.message}`);
}

function finalizeReport(report, fixture) {
  report.fixture.spawned = fixture.spawned;
  report.fixture.cleaned = true;
  report.summary = {
    passed: report.checks.filter(check => check.status === 'passed').length,
    skipped: report.checks.filter(check => check.status === 'skipped').length,
    failed: report.failures.length,
  };
  report.ok = report.failures.length === 0;
  report.diagnostics = report.failures.slice(0, MAX_DIAGNOSTICS).map(reportFailureDiagnostic);
  fixture.cleanup();
  return report;
}

function createReport() {
  return {
    ok: false,
    kitVersion: ADAPTER_CONFORMANCE_KIT_VERSION,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    adapterId: null,
    checks: [],
    failures: [],
    diagnostics: [],
    observations: {},
    fixture: {
      isolated: true,
      repository: true,
      pathContainsSpaces: true,
      pathContainsShellMetacharacters: true,
      spawned: 0,
      cleaned: false,
    },
    summary: { passed: 0, skipped: 0, failed: 0 },
  };
}

function methodResult(instance, method, args, check, report, fixture) {
  try {
    const result = instance[method](args);
    if (result && typeof result.then === 'function') {
      throw new Error(`${method}() must return a synchronous Contract v1 result`);
    }
    return result;
  } catch (error) {
    addFailure(report, check, error, fixture);
    return null;
  }
}

function validateResult(result, validator, options, check, report, fixture) {
  if (result === null) return null;
  try {
    return validator(result, options);
  } catch (error) {
    addFailure(report, check, error, fixture);
    return null;
  }
}

function recordObservation(report, key, value) {
  report.observations[key] = value;
}

/**
 * Run the public Adapter Contract v1 checks against a descriptor or factory.
 * No external command is trusted: launch plans must point at the generated
 * fake executable before the runner will spawn anything.
 */
export function runAdapterConformance(input, options = {}) {
  const report = createReport();
  let fixture;
  try {
    fixture = createConformanceFixture({ prompt: options.prompt || DEFAULT_CONFORMANCE_PROMPT });
  } catch (error) {
    report.fixture.isolated = false;
    addFailure(report, 'fixture', error, { root: '', tempRoot: '', script: '' }, ADAPTER_CONFORMANCE_ERROR_CODES.FIXTURE_FAILED);
    report.summary = { passed: 0, skipped: 0, failed: report.failures.length };
    report.ok = false;
    report.diagnostics = report.failures.map(reportFailureDiagnostic);
    return report;
  }

  try {
    let descriptor;
    try {
      descriptor = normalizeDescriptor(input, options);
    } catch (error) {
      addFailure(report, 'descriptor', error, fixture, ADAPTER_CONFORMANCE_ERROR_CODES.INVALID_INPUT);
      return finalizeReport(report, fixture);
    }

    let validated;
    try {
      validated = validateAdapterDescriptor(descriptor, {
        registeredIds: options.registeredIds,
        allowReserved: options.allowReserved === true,
      });
      report.adapterId = validated.id;
      pass(report, 'descriptor');
      recordObservation(report, 'capabilities', validated.capabilities);
      pass(report, 'capabilities');
    } catch (error) {
      if (isRecord(descriptor) && typeof descriptor.id === 'string') report.adapterId = descriptor.id;
      addFailure(report, 'descriptor', error, fixture);
      return finalizeReport(report, fixture);
    }

    let suppliedConfig = {};
    try {
      suppliedConfig = typeof options.config === 'function'
        ? options.config(fixture.public)
        : (options.config || {});
      if (!isRecord(suppliedConfig)) {
        throw new AdapterContractError(
          ADAPTER_CONFORMANCE_ERROR_CODES.INVALID_INPUT,
          'config: must be an object or a function returning an object.',
          { path: 'config' },
        );
      }
      if (suppliedConfig.command !== undefined && suppliedConfig.command !== fixture.command) {
        throw new AdapterContractError(
          ADAPTER_CONFORMANCE_ERROR_CODES.UNSAFE_LAUNCH,
          'config.command: conformance runs must target the generated fixture executable.',
          { path: 'config.command' },
        );
      }
    } catch (error) {
      addFailure(report, 'configuration-input', error, fixture, ADAPTER_CONFORMANCE_ERROR_CODES.INVALID_INPUT);
      return finalizeReport(report, fixture);
    }

    const config = Object.freeze({
      command: fixture.command,
      ...suppliedConfig,
      conformanceFixture: fixture.public,
    });

    let instance;
    try {
      instance = createAdapter(validated, config, {
        registeredIds: options.registeredIds,
        allowReserved: options.allowReserved === true,
      });
      pass(report, 'instance');
    } catch (error) {
      addFailure(report, 'instance', error, fixture);
      return finalizeReport(report, fixture);
    }

    const context = Object.freeze({
      root: fixture.root,
      prompt: fixture.prompt,
      initialPrompt: fixture.prompt,
      agent: validated.id,
      language: 'en',
      conformanceFixture: fixture.public,
    });

    if (validated.capabilities.detection) {
      const detection = methodResult(instance, 'detect', {
        version: true,
        root: fixture.root,
        conformanceFixture: fixture.public,
      }, 'detection', report, fixture);
      const checked = validateResult(detection, validateDetectionResult, undefined, 'detection', report, fixture);
      if (checked) {
        recordObservation(report, 'detection', {
          available: checked.available,
          command: checked.command || null,
          resolvedCommand: checked.resolvedCommand || null,
          version: checked.version || null,
        });
        if (checked.available) {
          pass(report, 'detection-result');
        } else {
          const error = new AdapterContractError(
            ADAPTER_CONFORMANCE_ERROR_CODES.ADAPTER_METHOD_FAILED,
            'detection.available: the deterministic conformance executable was not reported as available.',
            { path: 'detection.available' },
          );
          addFailure(report, 'detection-result', error, fixture);
        }
      }
    } else {
      skip(report, 'detection', 'capability-not-declared');
    }

    if (validated.capabilities.configuration) {
      const configuration = methodResult(instance, 'validateConfiguration', {
        setup: true,
        root: fixture.root,
        conformanceFixture: fixture.public,
      }, 'configuration', report, fixture);
      const checked = validateResult(configuration, validateConfigurationResult, undefined, 'configuration', report, fixture);
      if (checked) {
        recordObservation(report, 'configuration', {
          compatible: checked.compatible,
          code: checked.code || null,
        });
        if (checked.compatible) {
          pass(report, 'configuration-result');
        } else {
          const error = new AdapterContractError(
            ADAPTER_CONFORMANCE_ERROR_CODES.ADAPTER_METHOD_FAILED,
            'configuration.compatible: the deterministic fixture configuration was rejected.',
            { path: 'configuration.compatible' },
          );
          addFailure(report, 'configuration-result', error, fixture);
        }
      }
    } else {
      skip(report, 'configuration', 'capability-not-declared');
    }

    const policy = methodResult(instance, 'launchPolicy', {}, 'launch-policy', report, fixture);
    const checkedPolicy = validateResult(policy, validateLaunchPolicy, undefined, 'launch-policy', report, fixture);
    if (checkedPolicy) {
      recordObservation(report, 'launchPolicy', { mode: checkedPolicy.mode, pollIntervalMs: checkedPolicy.pollIntervalMs || null });
      pass(report, 'launch-policy-result');
    }

    if (validated.capabilities.oneShotLaunch) {
      const launch = methodResult(instance, 'resolveLaunch', context, 'one-shot-launch', report, fixture);
      const checkedLaunch = validateResult(launch, validateLaunchResult, undefined, 'one-shot-launch', report, fixture);
      if (checkedLaunch) {
        try {
          const observation = options.execute === false
            ? null
            : executePlan(checkedLaunch, fixture, { timeoutMs: options.timeoutMs });
          recordObservation(report, 'oneShotLaunch', {
            validated: true,
            executed: options.execute !== false,
            processSucceeded: options.execute === false ? null : true,
            markerReceived: observation ? true : null,
          });
          pass(report, 'one-shot-launch-result');
        } catch (error) {
          addFailure(report, 'one-shot-launch-execution', error, fixture);
        }
      }
    } else {
      skip(report, 'one-shot-launch', 'capability-not-declared');
    }

    if (validated.capabilities.persistentSession) {
      const sessionLaunch = methodResult(instance, 'resolveSessionLaunch', context, 'persistent-launch', report, fixture);
      const checkedSessionLaunch = validateResult(
        sessionLaunch,
        validateLaunchResult,
        { kind: 'persistent-session' },
        'persistent-launch',
        report,
        fixture,
      );
      if (checkedSessionLaunch) {
        try {
          const observation = options.execute === false
            ? null
            : executePlan(checkedSessionLaunch, fixture, {
              input: checkedSessionLaunch.initialInputConsumed ? '' : fixture.prompt,
              timeoutMs: options.timeoutMs,
            });
          let initialInputVerified = null;
          if (observation) {
            const promptInArguments = observation.argv.some(value => value.includes(fixture.prompt));
            const promptInStdin = observation.stdin.includes(fixture.prompt);
            initialInputVerified = checkedSessionLaunch.initialInputConsumed
              ? promptInArguments && !promptInStdin
              : promptInStdin && !promptInArguments;
            if (!initialInputVerified) {
              const error = new Error('persistent launch initialInputConsumed does not match observed argv/stdin delivery');
              error.code = ADAPTER_CONFORMANCE_ERROR_CODES.INITIAL_INPUT_MISMATCH;
              error.path = 'launch.initialInputConsumed';
              throw error;
            }
          }
          recordObservation(report, 'persistentSession', {
            validated: true,
            executed: options.execute !== false,
            processSucceeded: options.execute === false ? null : true,
            initialInputConsumed: checkedSessionLaunch.initialInputConsumed,
            initialInputVerified,
          });
          pass(report, 'persistent-launch-result');
          pass(report, 'initial-input');
        } catch (error) {
          addFailure(report, 'persistent-launch-execution', error, fixture);
        }
      }
    } else {
      skip(report, 'persistent-launch', 'capability-not-declared');
    }

    if (typeof instance.capabilities === 'function') {
      const runtimeCapabilities = methodResult(instance, 'capabilities', {}, 'runtime-capabilities', report, fixture);
      if (runtimeCapabilities !== null) {
        if (!isRecord(runtimeCapabilities)) {
          addFailure(report, 'runtime-capabilities', new AdapterContractError(
            ADAPTER_CONFORMANCE_ERROR_CODES.INVALID_INPUT,
            'instance.capabilities: must return an object.',
            { path: 'instance.capabilities' },
          ), fixture);
        } else {
          recordObservation(report, 'runtimeCapabilities', Object.keys(runtimeCapabilities).sort());
          pass(report, 'runtime-capabilities-result');
        }
      }
    } else {
      skip(report, 'runtime-capabilities', 'optional-method-not-implemented');
    }
  } catch (error) {
    addFailure(report, 'runner', error, fixture, ADAPTER_CONFORMANCE_ERROR_CODES.FIXTURE_FAILED);
  }
  return finalizeReport(report, fixture);
}

export class AdapterConformanceError extends Error {
  constructor(report) {
    const first = report.failures[0];
    super(report.diagnostics.join('\n') || 'Adapter Contract conformance failed.');
    this.name = 'AdapterConformanceError';
    this.code = first?.code || ADAPTER_CONFORMANCE_ERROR_CODES.INVALID_INPUT;
    this.report = report;
    this.details = Object.freeze({
      check: first?.check || null,
      path: first?.path || null,
      failureCount: report.failures.length,
    });
  }
}

export function assertAdapterConformance(input, options = {}) {
  const report = runAdapterConformance(input, options);
  if (!report.ok) throw new AdapterConformanceError(report);
  return report;
}
