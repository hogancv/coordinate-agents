import { accessSync, existsSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, extname, isAbsolute, join } from 'node:path';
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
  return resultFailure(candidate, EXECUTABLE_CODES.COMMAND_NOT_EXECUTABLE, `Unsupported Windows executable entrypoint: ${candidate}`);
}

function posixCandidate(command) {
  if (isPathLike(command)) {
    if (!existsSync(command)) return resultFailure(command, EXECUTABLE_CODES.COMMAND_NOT_FOUND, `Executable does not exist: ${command}`);
    return command;
  }

  const pathValue = process.env.PATH || '';
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
  if (versionArgs === null) return { ...resolved, command, available: true };

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
        { resolvedCommand: resolved.resolvedCommand, prefix: resolved.prefix },
      ),
      stdoutTail: redactOutput(result.stdout),
      stderrTail: redactOutput(result.stderr),
    };
  }
  const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] || 'available';
  return {
    ...resolved,
    command,
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
