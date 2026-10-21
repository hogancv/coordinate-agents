---
layout: page
title: Durable Runtime Event Journal
description: The repository-local append-only lifecycle history used by Inspector and recovery diagnostics.
---

# Durable Runtime Event Journal

## Purpose

The Event Journal records key Runtime lifecycle transitions as repository-local,
append-only observability history. It provides an audit trail, deterministic
ordering, Inspector timelines, and bounded recovery context.

It is **not Event Sourcing**. Task records, Session records, Agent Bus queues,
and Agent state remain the canonical current state. The Runtime never rebuilds
those records by replaying events.

## Architecture

```text
Canonical Runtime
  ├─ Task state
  ├─ Session state
  ├─ Agent Bus
  └─ Event Journal
       └─ .agent-bus/events/runtime.jsonl
                    |
                    ├─ Recovery inspection
                    └─ Local Inspector + SSE
```

Runtime producers do not depend on the Inspector server. Events continue to be
recorded when the Inspector or browser is stopped.

## Contract and storage

Each line in `.agent-bus/events/runtime.jsonl` is one complete JSON object with
Event `schemaVersion: 1`. Event schema versions are independent from Task schema
versions. Every event includes a unique `eventId`, repository-monotonic
`sequence`, ISO timestamp, uppercase `type`, and sanitized `data`. Optional
associations include `taskId`, `sessionId`, `agentId`, `role`, and `messageId`.
The formal contract is [`schemas/event.schema.json`](../schemas/event.schema.json).

The writer serializes appenders with a bounded repository-local lock, appends
without rewriting the journal, and fsyncs the appended line. Current state is
persisted before its corresponding event; an event append failure is returned
explicitly as `RUNTIME_EVENT_WRITE_FAILED`, so callers can inspect the durable
current-state fact and recover without pretending the event exists.

The reader returns at most 500 records, skips malformed or partial lines, orders
results by sequence, and supports latest-N, `after`, Task, Session, and type
filters.

## Recorded transitions

The initial contract covers Task creation, dispatch, status changes, resume,
stop and errors; implementation receipt and review decisions; Session starting,
start, reuse, busy/idle, exit/failure and close observations; and Agent Bus
send, processing, and processed transitions. Events are written only at hooks
where the Runtime knows the transition occurred.

## Security

The journal is local plaintext under `.agent-bus`; it is not a credential
store. Payloads are bounded and recursively redact credential-bearing keys and
known secret patterns. Events omit the repository root because the journal is
already repository-local. Never put credentials, tokens, cookies, passwords,
private keys, environment dumps, or unnecessary production data in Runtime
messages or evidence.

## Compatibility

Existing `.agent-bus` repositories require no migration. The Runtime creates
the events directory on the first new event and never fabricates older history.
When a Task or Session predates the journal, Inspector labels its reconstructed
view as **Derived / Legacy History** instead of presenting it as recorded truth.
