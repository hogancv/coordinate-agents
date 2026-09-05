import { accessSync, closeSync, existsSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, delimiter, extname, isAbsolute, join } from 'node:path';
import { X_OK } from 'node:constants';

export const EXECUTABLE_CODES = Object.freeze({
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  COMMAND_NOT_EXECUTABLE: 'COMMAND_NOT_EXECUTABLE',
  UNSAFE_WINDOWS_ENTRYPOINT: 'UNSAFE_WINDOWS_ENTRYPOINT',
  VERSION_CHECK_FAILED: 'VERSION_CHECK_FAILED',
});

export const MAX_OUTPUT_TAIL = 8 * 1024;

function tail(value, limit = MAX_OUTPUT_TAIL) {
  const text = `${value || ''}`;
  return text.length > limit ? text.slice(-limit) : text;
}

export function redactOutput(value, limit = MAX_OUTPUT_TAIL) {
  return tail(value, limit)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s\r\n]+/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[^\s\r\n]+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|passwd|secret|api[_-]?key|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function resultFailure(command, code, details, extra = {}) {
  return {
    available: false,
    code,
    command,
    details,
    ...extra,
  };
}

function isPathLike(command) {
  return isAbsolute(command) || command.includes('/') || command.includes('\\');
}

function windowsCandidates(command) {
  const candidates = [];
  if (existsSync(command)) candidates.push(command);
  if (candidates.length > 0 || isPathLike(command)) return candidates;

  try {
    const output = execFileSync('where.exe', [command], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const candidate of output.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  } catch {
    // The caller receives COMMAND_NOT_FOUND below. Do not turn lookup errors
    // into a vendor-specific fallback command.
  }
  return candidates;
}

function windowsEntrypoint(candidate, { windowsEntrypoint } = {}) {
  if (!existsSync(candidate)) return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_FOUND, `Executable does not exist: ${candidate}`);
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Executable is not a regular file: ${candidate}`);
  }

  const extension = extname(candidate).toLowerCase();
  if (extension === '.exe' || extension === '.com') {
    return { available: true, command: candidate, prefix: [], resolvedCommand: candidate, safe: true };
  }
  if (extension === '.js' || extension === '.cjs') {
    return { available: true, command: process.execPath, prefix: [candidate], resolvedCommand: candidate, safe: true };
  }
  if (extension === '.cmd' || extension === '.bat') {
    const adapterEntrypoint = typeof windowsEntrypoint === 'function' ? windowsEntrypoint(candidate) : null;
    if (adapterEntrypoint && existsSync(adapterEntrypoint)) {
      return { available: true, command: process.execPath, prefix: [adapterEntrypoint], resolvedCommand: candidate, safe: true };
    }
    const jsSibling = candidate.replace(/\.(cmd|bat)$/i, '.js');
    const cjsSibling = candidate.replace(/\.(cmd|bat)$/i, '.cjs');
    if (existsSync(jsSibling)) {
      return { available: true, command: process.execPath, prefix: [jsSibling], resolvedCommand: candidate, safe: true };
    }
    if (existsSync(cjsSibling)) {
      return { available: true, command: process.execPath, prefix: [cjsSibling], resolvedCommand: candidate, safe: true };
    }
    return resultFailure(
      candidate,
      EXECUTABLE_CODES.UNSAFE_WINDOWS_ENTRYPOINT,
      `Windows wrapper '${candidate}' has no safe .js or .cjs entrypoint`,
      { resolvedCommand: candidate, prefix: [], safe: false },
    );
  }
  if (extension === '.ps1') {
    const hosts = [];
    if (process.env.SystemRoot) hosts.push(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    try {
      const output = execFileSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      hosts.push(...output.split(/\r?\n/).map(value => value.trim()).filter(Boolean));
    } catch { /* Try the inbox Windows PowerShell path below. */ }
    try {
      const output = execFileSync('where.exe', ['powershell.exe'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      hosts.push(...output.split(/\r?\n/).map(value => value.trim()).filter(Boolean));
    } catch { /* The configured script will fail closed if no host is available. */ }
    const host = hosts.find(value => existsSync(value));
    if (host) {
      return {
        available: true,
        command: host,
        prefix: ['-NoProfile', '-File', candidate],
        resolvedCommand: candidate,
        safe: true,
      };
    }
    return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_FOUND, `PowerShell host is unavailable for: ${candidate}`, { resolvedCommand: candidate, prefix: [], safe: false });
  }
  return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Unsupported Windows executable entrypoint: ${candidate}`);
}

function posixCandidate(command) {
  if (isPathLike(command)) {
    // Keep the candidate shape consistent with PATH lookup.  The caller
    // performs the final entrypoint check and expects either a path or null;
    // returning a failure object here would pass that object to lstatSync.
    if (!existsSync(command)) return null;
    return command;
  }

  const pathValue = process.env.PATH || '';
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readShebang(candidate) {
  let descriptor = null;
  try {
    descriptor = openSync(candidate, 'r');
    const buffer = Buffer.alloc(256);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/, 1)[0].trim();
    if (!firstLine.startsWith('#!')) return null;
    const tokens = firstLine.slice(2).trim().match(/\S+/g) || [];
    return tokens.length > 0 ? tokens : { invalid: true };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* The descriptor is best effort after a read failure. */ }
    }
  }
}

function resolveShebangInterpreter(interpreter, args, candidate) {
  let interpreterName = interpreter;
  let interpreterArgs = [...args];
  if (basename(interpreter) === 'env') {
    if (interpreterArgs[0] === '-S') interpreterArgs = interpreterArgs.slice(1);
    if (!interpreterArgs[0] || interpreterArgs[0].startsWith('-')) {
      return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Unsupported shebang interpreter: ${interpreter} ${args.join(' ')}`, { resolvedCommand: candidate });
    }
    [interpreterName, ...interpreterArgs] = interpreterArgs;
  }
  const interpreterCandidate = isPathLike(interpreterName)
    ? interpreterName
    : posixCandidate(interpreterName);
  let canonicalInterpreter = interpreterCandidate;
  try {
    // System shebangs commonly use stable symlinks such as /bin/sh. Resolve
    // only the interpreter to its real file; directly configured commands
    // retain the stricter no-symlink rule in posixEntrypoint.
    canonicalInterpreter = interpreterCandidate ? realpathSync(interpreterCandidate) : null;
  } catch {
    canonicalInterpreter = null;
  }
  const resolved = posixEntrypoint(interpreterName, canonicalInterpreter);
  if (!resolved.available) {
    return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Shebang interpreter is unavailable: ${interpreterName}`, { resolvedCommand: candidate });
  }
  return {
    available: true,
    command: resolved.command,
    prefix: [...resolved.prefix, ...interpreterArgs, candidate],
    resolvedCommand: candidate,
    safe: true,
  };
}

function posixEntrypoint(command, candidate) {
  if (!candidate) return resultFailure(command, EXECUTABLE_CODES.COMMAND_NOT_FOUND, `Command not found: ${command}`);
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return resultFailure(command, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Command is not a regular file: ${candidate}`, { resolvedCommand: candidate });
  }
  const extension = extname(candidate).toLowerCase();
  if (extension === '.js' || extension === '.cjs') {
    return { available: true, command: process.execPath, prefix: [candidate], resolvedCommand: candidate, safe: true };
  }
  try {
    accessSync(candidate, X_OK);
  } catch {
    return resultFailure(command, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Command is not executable: ${candidate}`, { resolvedCommand: candidate });
  }
  const shebang = readShebang(candidate);
  if (shebang) {
    if (shebang.invalid) {
      return resultFailure(command, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Command has an invalid shebang: ${candidate}`, { resolvedCommand: candidate });
    }
    return resolveShebangInterpreter(shebang[0], shebang.slice(1), candidate);
  }
  return { available: true, command: candidate, prefix: [], resolvedCommand: candidate, safe: true };
}

export function resolveExecutable(command, options = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    return resultFailure(command || '', EXECUTABLE_CODES.COMMAND_NOT_FOUND, 'No executable command was configured.');
  }

  if (process.platform === 'win32') {
    const candidates = windowsCandidates(command);
    if (candidates.length === 0) return resultFailure(command, EXECUTABLE_CODES.COMMAND_NOT_FOUND, `Command not found: ${command}`);
    const failures = [];
    for (const candidate of candidates) {
      const resolved = windowsEntrypoint(candidate, options);
      if (resolved.available) return { ...resolved, commandInput: command };
      failures.push(resolved);
    }
    const unsafe = failures.find(item => item.code === EXECUTABLE_CODES.UNSAFE_WINDOWS_ENTRYPOINT);
    return { ...(unsafe || failures[0]), command, commandInput: command };
  }

  const candidate = posixCandidate(command);
  return { ...posixEntrypoint(command, candidate), commandInput: command };
}

function conformanceExecutable(command, fixture) {
  if (!fixture
    || command !== process.execPath
    || fixture.command !== process.execPath
    || typeof fixture.script !== 'string'
    || !Array.isArray(fixture.prefix)
    || fixture.prefix.length !== 1
    || fixture.prefix[0] !== fixture.script
    || !existsSync(fixture.script)) {
    return null;
  }
  return {
    available: true,
    command: process.execPath,
    prefix: [...fixture.prefix],
    resolvedCommand: process.execPath,
    safe: true,
    conformanceFixture: true,
  };
}

/**
 * Resolve a configured executable, with an explicit deterministic fixture
 * escape hatch used only by the public Adapter Conformance Kit. Normal
 * runtime callers always use the regular executable resolver.
 */
export function resolveAdapterExecutable(command, options = {}) {
  const fixture = conformanceExecutable(command, options.conformanceFixture);
  if (fixture) return { ...fixture, commandInput: command };
  const { conformanceFixture: _ignored, ...resolveOptions } = options;
  return resolveExecutable(command, resolveOptions);
}

/**
 * Check a configured executable while preserving the same fixture boundary as
 * resolveAdapterExecutable().
 */
export function checkAdapterExecutable(command, options = {}) {
  const fixture = conformanceExecutable(command, options.conformanceFixture);
  if (fixture) {
    return {
      ...fixture,
      command,
      runtimeCommand: fixture.command,
      version: 'fixture-1.0.0',
    };
  }
  const { conformanceFixture: _ignored, ...checkOptions } = options;
  return checkExecutable(command, checkOptions);
}

function executeVersion(resolved, versionArgs) {
  try {
    return {
      status: 0,
      stdout: execFileSync(resolved.command, [...resolved.prefix, ...versionArgs], {
        encoding: 'utf8',
        windowsHide: true,
      }),
      stderr: '',
    };
  } catch (error) {
    return {
      status: Number.isInteger(error.status) ? error.status : 1,
      stdout: `${error.stdout || ''}`,
      stderr: `${error.stderr || ''}`,
      error,
    };
  }
}

export function checkExecutable(command, { versionArgs = ['--version'], ...resolveOptions } = {}) {
  const resolved = resolveExecutable(command, resolveOptions);
  if (!resolved.available) return resolved;
  if (versionArgs === null) {
    return {
      ...resolved,
      command,
      runtimeCommand: resolved.command,
      available: true,
    };
  }

  const result = executeVersion(resolved, versionArgs);
  if (result.error || result.status !== 0) {
    const osCode = result.error?.code;
    const code = osCode === 'ENOENT'
      ? EXECUTABLE_CODES.COMMAND_NOT_FOUND
      : osCode === 'EACCES'
        ? EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE
        : EXECUTABLE_CODES.VERSION_CHECK_FAILED;
    return {
      ...resultFailure(
        command,
        code,
        result.error?.message || `Version check failed with status ${result.status}`,
        { resolvedCommand: resolved.resolvedCommand, prefix: resolved.prefix, runtimeCommand: resolved.command },
      ),
      stdoutTail: redactOutput(result.stdout),
      stderrTail: redactOutput(result.stderr),
    };
  }
  const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
  return {
    ...resolved,
    command,
    runtimeCommand: resolved.command,
    available: true,
    version,
  };
}

export function executableError(result, message = 'Executable check failed') {
  const error = new Error(`${message}: ${result.code || 'UNKNOWN'}${result.details ? `: ${result.details}` : ''}`);
  error.code = result.code || 'EXECUTABLE_CHECK_FAILED';
  error.executable = result;
  return error;
}
