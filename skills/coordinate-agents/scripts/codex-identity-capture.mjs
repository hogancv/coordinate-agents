import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readCodexConversation, codexConversationId } from './codex-conversation.mjs';

const MAX_BODY = 1024 * 1024;
const MAX_EVENTS = 64;

// Deliberately version gated to the wire format checked with the actual CLI.
// Unknown versions/wrappers retain ordinary PTY launch and manual recovery.
export async function codexIdentityCaptureVersion(launch) {
  if (launch.args.some(arg => /^--remote(?:=|$)/.test(arg))) return null;
  const script = /(?:^|[\\/])node(?:\.exe)?$/i.test(launch.command) && /\.[cm]?js$/i.test(launch.args[0] || '') ? [launch.args[0]] : [];
  return new Promise(resolve => {
    execFile(launch.command, [...(launch.prefix || []), ...script, '--version'], { timeout: 1500, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      resolve(!error ? stdout.trim().match(/^codex-cli (0\.163\.\d+)$/)?.[1] || null : null);
    });
  });
}

function attributes(log) {
  if (!Array.isArray(log.attributes) || log.attributes.length > 128) return null;
  const map = new Map();
  for (const item of log.attributes) {
    if (typeof item.key !== 'string' || map.has(item.key)) return null;
    map.set(item.key, item.value?.stringValue);
  }
  return map;
}

// Private process-scoped receiver, never an HTTP Workspace action. Capability,
// payload, prompts, account fields and exporter arguments stay in Host memory.
// Local same-user code/config is the trust boundary, as with the existing PTY.
export async function createCodexIdentityCapture({ root, codexHome, version, isActive, observe, onState = () => {} }) {
  const path = `/identity/${randomBytes(32).toString('hex')}`;
  const startedAt = Date.now();
  let closed = false, busy = false, accepted = 0;
  let lastTimestamp = '';
  let verifiedId = null;
  const timers = new Set();
  const state = (value, reason) => onState({ state: value, reason });
  const apply = async candidate => {
    if (closed || !isActive() || Date.now() - Date.parse(candidate.observedAt) > 15000) return;
    if (candidate.conversationId === verifiedId || candidate.observedAt < lastTimestamp) return;
    try {
      readCodexConversation({ root, codexHome, conversationId: candidate.conversationId, maxEntries: 4096,
        provenance: { version, originator: candidate.originator } });
      await observe({ conversationId: candidate.conversationId, observedAt: candidate.observedAt, source: { id: 'codex-otel', version } });
      verifiedId = candidate.conversationId;
      lastTimestamp = candidate.observedAt;
      state('BOUND', 'NATIVE_EVENT_AND_METADATA');
    } catch (error) {
      // Only association/file publication races merit a short bounded retry.
      // Never overwrite bindings, restart a CLI, or poll disk indefinitely.
      if (candidate.attempt < 4 && !closed && isActive()
        && (/not found|Incomplete/.test(error.message) || ['RUNTIME_MISMATCH', 'REVISION_MISMATCH'].includes(error.details?.reason))) {
        const timer = setTimeout(() => { timers.delete(timer); void apply({ ...candidate, attempt: candidate.attempt + 1 }); }, [250, 500, 1000, 2000][candidate.attempt]);
        timer.unref(); timers.add(timer);
      } else state('UNAVAILABLE', ['RUNTIME_MISMATCH', 'REVISION_MISMATCH', 'RUNTIME_UNAVAILABLE', 'TASK_UNAVAILABLE',
        'CONVERSATION_ALREADY_BOUND', 'RESUME_TARGET_MISMATCH', 'OUT_OF_ORDER', 'INVALID_OBSERVATION'].includes(error.details?.reason)
        ? error.details.reason : 'NATIVE_METADATA_UNAVAILABLE');
    }
  };
  const handle = async body => {
    let count = 0;
    if (!Array.isArray(body.resourceLogs) || body.resourceLogs.length > MAX_EVENTS) return;
    for (const resource of body.resourceLogs) {
      if (!Array.isArray(resource.scopeLogs) || resource.scopeLogs.length > MAX_EVENTS) continue;
      for (const scope of resource.scopeLogs) {
        if (!Array.isArray(scope.logRecords) || scope.logRecords.length > 4096) continue;
        for (const log of scope.logRecords) {
          if (++count > 4096) return;
          const a = attributes(log);
          if (!['codex.conversation_starts', 'codex.user_prompt'].includes(a?.get('event.name')) || a.get('app.version') !== version) continue;
          const timestamp = a.get('event.timestamp');
          if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))
            || Date.now() - Date.parse(timestamp) > 15000 || Date.parse(timestamp) > Date.now() + 1000
            || Date.parse(timestamp) < startedAt - 1000 || timestamp < lastTimestamp) continue;
          let id; try { id = codexConversationId(a.get('conversation.id')); } catch { continue; }
          if (id === verifiedId) continue; // Same-identity prompts are not new candidate work or live proofs.
          const originator = a.get('originator');
          if (!['codex_cli_rs', 'codex-tui', 'Codex_Desktop'].includes(originator)) continue;
          if (++accepted > 256) { state('UNAVAILABLE', 'EVENT_LIMIT'); return; }
          // Keep only bounded sanitized claims. Never retain the OTLP payload.
          state('DISCOVERED', 'CHECKING_NATIVE_METADATA');
          await apply({ conversationId: id, observedAt: timestamp, originator, attempt: 0 });
        }
      }
    }
  };
  const server = createServer(async (request, response) => {
    if (closed || request.method !== 'POST' || request.url !== path || request.headers.origin) {
      request.resume(); response.writeHead(403).end(); return;
    }
    if (busy || !isActive()) { request.resume(); response.writeHead(429).end(); return; }
    busy = true;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400).end(); return; }
      await handle(body);
      response.setHeader('content-type', 'application/json'); response.end('{}');
    } catch { if (!response.headersSent) response.writeHead(400).end(); }
    finally { busy = false; }
  });
  server.requestTimeout = 2000; server.headersTimeout = 2000; server.maxConnections = 4;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.on('error', () => state('UNAVAILABLE', 'COLLECTOR_UNAVAILABLE'));
  const endpoint = `http://127.0.0.1:${server.address().port}${path}`;
  state('LISTENING', 'WAITING_FOR_NATIVE_EVENT');
  const unavailable = setTimeout(() => { if (!accepted) state('UNAVAILABLE', 'NO_NATIVE_EVENT'); }, 30000);
  unavailable.unref(); timers.add(unavailable);
  return {
    endpoint,
    args: ['--no-daemon', '-c', `otel.exporter={otlp-http={endpoint=${JSON.stringify(endpoint)},protocol="json"}}`,
      '-c', 'otel.log_user_prompt=false', '-c', 'otel.log_agent_responses=false'],
    close() {
      closed = true; for (const timer of timers) clearTimeout(timer); timers.clear();
      server.closeAllConnections?.(); server.close();
    },
  };
}
