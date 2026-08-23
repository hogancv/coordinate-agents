# Coordinate Agents Performance Benchmark

## Technical Summary

在这个可重复 fixture 中，Plugin 中位总耗时比 CLI 多 519 ms（17.798%）。两条路径的 Fake Implementer 耗时几乎相同（差异 2.414 ms），且都复用了同一个 Task Runtime 和同一个 Session；因此已观测增量主要来自 Plugin 的 MCP/编排边界，而不是 Implementer 或另一个 Runtime。Plugin 观察 profile 使用 17 次 MCP Tool Call，CLI 使用 5 次 CLI 命令调用；其中多出的 12 次为状态、检查和 Session 读取。

Runtime 执行包络（从工具/CLI 调用时长扣除 Fake Implementer 区间）中位数：CLI 1717.623 ms，Plugin 2185.171 ms，差异 467.548 ms。两条路径的 Task 状态序列都是 CREATED → SPEC_READY → IMPLEMENTING → REVIEWING → CHANGES_REQUESTED → IMPLEMENTING → REVIEWING → APPROVED；每次 rework 都复用同一个 Session。

按本次本地测量，移除全部 12 个可选状态/检查 Tool Call 仍预计为 2813.722 ms，没有仅靠减少 Tool Call 达到 CLI 的 80%（目标 2332.8 ms）；固定 Runtime/Implementer 下限仍占主导。

This is a deterministic local benchmark, not a live Codex/Antigravity/Claude benchmark. The Plugin case uses a persistent JSON-RPC MCP client to reproduce a verbose Skill → MCP → Runtime loop; it intentionally excludes real model reasoning and network latency. Conclusions are therefore strong for the measured Runtime/MCP path and not a claim about unmeasured Codex inference time.

## Environment

~~~yaml
commit: f15fd3d2c3e4330380d969d61d3d4608e67c728a
version: 2.1.2
node: v24.17.0
platform: darwin
arch: arm64
cpu: Apple M5
cpu_count: 10
task_spec_sha256: 0e7c493aae7773da076ce11ec4c2617ac94bc817e5dfda248b2b6bc2f9e1e76b
fake_implementer_wait_ms: 500
benchmark_runs_per_profile: 5

Latest CLI entry: bin/coordinate-agents.mjs
Plugin entry: .codex-plugin/plugin.json → skills/coordinate-agents/SKILL.md
MCP entry: mcp/server.mjs --stdio
Runtime entry: skills/coordinate-agents/scripts/runtime-entry.mjs (Plugin fallback) / skills/coordinate-agents/scripts/runtime-services.mjs (MCP transport) / bin/coordinate-agents.mjs exports (CLI)
Task runtime entry: skills/coordinate-agents/scripts/task-runtime.mjs
Session runtime entry: skills/coordinate-agents/scripts/session-manager.mjs + session-service.mjs + pty-runtime.mjs
~~~

## Benchmark Design

The same fixture and exact task specification were used for every profile:

~~~text
Build a simple Todo feature.

Requirements:

- Create todo item
- Mark todo completed
- Add regression test
~~~

The fake Implementer receives the Runtime's IMPLEMENT prompt, waits exactly 500 ms per round, sends one fixed IMPLEMENTATION_DONE message with commit 0123456789abcdef0123456789abcdef01234567, and remains alive for Session reuse. Each measured workflow performs one deterministic CHANGES_REQUESTED review, one re-dispatch, and a final REVIEW_APPROVED. No product files are written.

The CLI profile measures five user-level CLI commands: task.create, two task.dispatch calls, and two task.review calls. The Plugin verbose profile measures the same semantic workflow through a persistent MCP server plus explicit status/inspect/read observations. MCP Tool Call count excludes protocol handshake; initialize and tools/list are reported separately.

## Timing Comparison

Runtime is the measured CLI/MCP operation envelope after subtracting Fake Implementer intervals. Implementer is the observed implement_start → implementation_done interval. The columns are intentionally not treated as independent additive timers; the orchestration residual is calculated as Total − Runtime − Implementer.

| Workflow | Total | Runtime | Implementer | MCP Calls |
|---|---:|---:|---:|---:|
| Latest CLI | 2916 ms | 1717.623 ms | 1179.056 ms | 0 |
| Latest Plugin (verbose) | 3435 ms | 2185.171 ms | 1181.47 ms | 17 |

| Workflow | Task create | Dispatch total | Review total | Orchestration residual | Bus writes |
|---|---:|---:|---:|---:|---:|
| Latest CLI | 156.865 ms | 2170.538 ms | 572.887 ms | 20 ms | 6 |
| Latest Plugin (verbose) | 96.629 ms | 2115.619 ms | 536.754 ms | 77 ms | 6 |

### Repeated-run raw medians and ranges

| Run | Workflow | Total | Runtime | Implementer | Calls | Bus writes |
|---|---|---:|---:|---:|---:|---:|
| cli-latest-cli-01 | CLI | 2894 ms | 1707.915 ms | 1166.085 ms | 5 | 6 |
| cli-latest-cli-02 | CLI | 2912 ms | 1725.944 ms | 1179.056 ms | 5 | 6 |
| cli-latest-cli-03 | CLI | 2916 ms | 1713.017 ms | 1182.983 ms | 5 | 6 |
| cli-latest-cli-04 | CLI | 2922 ms | 1717.623 ms | 1181.377 ms | 5 | 6 |
| cli-latest-cli-05 | CLI | 2917 ms | 1718.03 ms | 1178.97 ms | 5 | 6 |
| plugin-verbose-01 | Plugin verbose | 3436 ms | 2185.171 ms | 1180.829 ms | 17 | 6 |
| plugin-verbose-02 | Plugin verbose | 3434 ms | 2167.052 ms | 1187.948 ms | 17 | 6 |
| plugin-verbose-03 | Plugin verbose | 3449 ms | 2190.313 ms | 1181.687 ms | 17 | 6 |
| plugin-verbose-04 | Plugin verbose | 3429 ms | 2167.53 ms | 1181.47 ms | 17 | 6 |
| plugin-verbose-05 | Plugin verbose | 3435 ms | 2189.743 ms | 1177.257 ms | 17 | 6 |

## MCP Tool Round Trips

The verbose Plugin simulation used a median of 17 MCP Tool Calls per task. The CLI has no MCP Tool Calls; it used 5 user-level CLI command invocations. The Plugin sequence adds 12 model-visible status/inspection calls beyond the five semantic calls needed for create, two dispatches, and two review decisions.

| Tool | Calls per run | Median call duration |
|---|---:|---:|
| `coordinate_agents_task_dispatch` | 2 | 1056.858 ms |
| `coordinate_agents_task_review` | 2 | 267.651 ms |
| `coordinate_agents_task_inspect` | 2 | 105.982 ms |
| `coordinate_agents_task_create` | 1 | 96.507 ms |
| `coordinate_agents_task_status` | 4 | 95.249 ms |
| `coordinate_agents_session_status` | 2 | 4.848 ms |
| `coordinate_agents_session_read` | 2 | 4.736 ms |
| `coordinate_agents_session_inspect` | 2 | 4.575 ms |

The measured extra status/inspection/read calls contribute 606.914 ms of call-envelope time in the verbose profile. Even where an individual local call is cheap, each call is an additional boundary at which a real Plugin may perform planning, response parsing, or another status decision. Those model-side delays are intentionally not fabricated or included here.

The 80% counterfactual below sums the per-tool medians for the 12 removable calls. It is therefore not computed as the verbose total minus the median of each run's summed extra-call duration; medians of sums and sums of medians can differ.

## Runtime and Session Difference

Runtime 执行包络（从工具/CLI 调用时长扣除 Fake Implementer 区间）中位数：CLI 1717.623 ms，Plugin 2185.171 ms，差异 467.548 ms。两条路径的 Task 状态序列都是 CREATED → SPEC_READY → IMPLEMENTING → REVIEWING → CHANGES_REQUESTED → IMPLEMENTING → REVIEWING → APPROVED；每次 rework 都复用同一个 Session。

Observed evidence:

- Both CLI and MCP import the same runtimeTaskCreate / runtimeTaskOperation implementation from skills/coordinate-agents/scripts/runtime-services.mjs.
- Both workflows produced the same fixed implementation commit and the same two-round Task state sequence.
- Both workflows reused the same Session ID from round 1 to round 2; no duplicate Session was created for rework.
- The CLI dispatch performs its Task sync and Session status polling inside one CLI invocation. The Plugin profile additionally exposes task_status, task_inspect, session_status, session_inspect, and session_read as separate MCP calls.
- Bus writes were six logical message publications per run: two IMPLEMENT handoffs, two IMPLEMENTATION_DONE messages, and two review messages. The count is the same for both profiles; the difference is visibility and transport boundaries, not Bus semantics.

No evidence was found in this benchmark for duplicate Runtime initialization, duplicate config loading, or duplicate Agent Bus initialization per task. The persistent MCP server was started once per Plugin run, and the Runtime state remained in the same fixture repository.

## Bottleneck Ranking

~~~yaml
P0:
  - name: Extra MCP status/inspect/read round trips
    evidence: "17 Plugin Tool Calls vs 5 CLI commands; 12 optional observation calls"
    measured_median_ms: 606.914
    scope: "Plugin verbose profile"
P1:
  - name: Plugin orchestration residual
    evidence: "Total - Runtime envelope - Implementer = 77 ms median"
    measured_median_ms: 77
    scope: "Includes Skill routing, MCP handshake, call gaps, and transport envelope not attributable to fake work"
P1:
  - name: MCP handshake and Skill routing
    evidence: "Skill routing 0.114 ms; initialize/tools/list 59.695 ms median"
    measured_median_ms: 59.809
    scope: "Plugin process startup path"
P2:
  - name: Fixed Implementer floor
    evidence: "Two deterministic 500 ms waits per workflow; Implementer median 1181.47 ms Plugin vs 1179.056 ms CLI"
    measured_median_ms: 1181.47
    scope: "Common to both workflows; not a Plugin-specific regression"
P2:
  - name: Required semantic Runtime envelope
    evidence: "After removing optional observation calls and MCP handshake from the Plugin Runtime envelope, the remaining semantic workflow still has a 1518.562 ms median envelope"
    measured_median_ms: 1518.562
    scope: "Workflow floor; not a Plugin-specific regression by itself"
~~~

## Root Cause

在这个可重复 fixture 中，Plugin 中位总耗时比 CLI 多 519 ms（17.798%）。两条路径的 Fake Implementer 耗时几乎相同（差异 2.414 ms），且都复用了同一个 Task Runtime 和同一个 Session；因此已观测增量主要来自 Plugin 的 MCP/编排边界，而不是 Implementer 或另一个 Runtime。Plugin 观察 profile 使用 17 次 MCP Tool Call，CLI 使用 5 次 CLI 命令调用；其中多出的 12 次为状态、检查和 Session 读取。

The evidence does not support a claim that Plugin enters a different or slower Task/Session Runtime. The current Plugin and CLI are two transport surfaces over the same Runtime source. The measured Plugin-specific difference is the number of externally visible MCP interactions and the residual time around them. A real Codex run may add reasoning time between those calls, but that variable is outside this deterministic benchmark and is not silently estimated.

## 80% Target and High-level Workflow API Question

CLI 80% target: **2332.8 ms**.

Verbose Plugin: **3435 ms**, 17 Tool Calls.

Compact semantic Plugin sensitivity: **2802 ms**, 5 Tool Calls.

按本次本地测量，移除全部 12 个可选状态/检查 Tool Call 仍预计为 2813.722 ms，没有仅靠减少 Tool Call 达到 CLI 的 80%（目标 2332.8 ms）；固定 Runtime/Implementer 下限仍占主导。

This directly informs task_start(), task_run(), and task_rework(): if the compact five-call sensitivity reaches the target, a higher-level workflow API can remove 12 model-visible calls from the verbose path. If it does not, reducing calls alone is insufficient under this host; the fixed Runtime/Implementer floor or unmeasured model-side reasoning must be addressed separately.

## Optimization Suggestions (No Code Changes Made)

~~~yaml
MCP API:
  - Provide a high-level task workflow operation that returns the post-dispatch Task and Session facts in one bounded response.
  - Keep status/inspect/read as explicit diagnostic tools, but avoid requiring them for the happy path.
  - Preserve one-call review/rework semantics so CHANGES_REQUESTED can lead directly to the next dispatch.
Runtime:
  - Keep the current single Runtime/Session owner; verify with a server-side operation trace before changing lifecycle ownership.
  - Expose bounded phase timings (Task sync, Session open/reuse, PTY spawn) so Plugin clients do not need repeated inspection to infer progress.
Plugin workflow:
  - Route the normal happy path through create → dispatch → review/rework → approve, using diagnostics only on failure or explicit inspection requests.
  - Record MCP call counts and elapsed time per activation to make orchestration regressions visible.
Task lifecycle:
  - Consider task_start(), task_run(), and task_rework() only after the compact sensitivity and the 80% calculation are confirmed on a real Plugin trace.
  - Maintain explicit review and recovery gates; do not hide CHANGES_REQUESTED or automatic retry semantics inside a convenience API.
~~~

## Limitations and Robustness Checks

- The benchmark uses local stdio MCP, so it measures local JSON-RPC and Runtime boundary cost, not remote MCP latency.
- No real Codex, Antigravity, Claude, or model reasoning was invoked. Skill routing is a deterministic file/rule lookup; it is a lower bound for live Codex routing.
- The Implementer wait is deterministic but process scheduling, PTY backend, filesystem cache state, and host load still create small variance; medians across 5 runs are the primary comparison.
- Trace phase boundaries are external observation points. The benchmark does not patch production Runtime code; Session/PTY events are inferred from persisted Session records and fake-process markers.
- Generated raw traces contain event metadata only; no Task body, prompt, credentials, or raw Agent Bus message payload is persisted.

## Reproducibility and Artifacts

Run from the repository root:

~~~sh
node benchmark/coordinate-agents-performance.mjs --runs 5
~~~

The run generated:

- PERFORMANCE_REPORT.md — this report.
- benchmark/results/benchmark-results.json — environment, per-run metrics, aggregate statistics, and sensitivity result.
- benchmark/results/benchmark-trace.json — unified event trace with the requested Task, Session, PTY, Implementer, Bus, sync, and review events.

## Next Questions

1. Capture one real Codex Plugin activation with the same event schema, including model turn timestamps, to measure the unobserved Skill/reasoning gap.
2. Repeat the compact five-call profile through the actual Plugin host and compare its p50/p95 against the CLI target.
3. If compact Plugin remains above 2332.8 ms, decompose Runtime server-side phases before adding a high-level API; the current benchmark cannot attribute that residual to MCP calls alone.
