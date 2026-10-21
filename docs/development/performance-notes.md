---
search: false
title: "Historical performance notes"
description: Retained technical reference; applicability follows the implementation stage described in this document.
---

::: info Historical engineering record
This page preserves the design, plan or acceptance evidence for its recorded implementation stage. Earlier behavior, proposed capabilities and old deployment settings do not supersede the [current Workspace guide](/inspector.html) or [release history](/changelog.html).
:::

<div id="技术参考-historical-performance-notes" class="doc-anchor" aria-hidden="true"></div>

# Historical performance notes

Preserved from the former `.jules/bolt.md` automation journal. These entries
record observations from earlier work, not current instructions or verified
performance claims. Check the present implementation before reusing a suggestion.

<div id="bolts-journal---critical-learnings" class="doc-anchor" aria-hidden="true"></div>

# Bolt's Journal - Critical Learnings

<div id="2025-05-19---pattern-compilation-in-scope-audit" class="doc-anchor" aria-hidden="true"></div>

## 2025-05-19 - Pattern compilation in scope audit
**Learning:** `patternToRegex` in scope-audit parsed and compiled a new RegExp instance on every path evaluation during scope audits.
**Action:** Always cache compiled pattern regexes in a bounded Map when evaluating batch paths against intent globs.

<div id="2025-05-20---precomputed-declarations-and-pattern-facts-in-intent-map-scheduling" class="doc-anchor" aria-hidden="true"></div>

## 2025-05-20 - Precomputed declarations and pattern facts in Intent Map scheduling
**Learning:** `intentSchedulingWave` evaluated subtask conflict pairs by instantiating `new Map` and parsing `patternLiteralPrefix` on every `writeIntentConflictBetween` check, resulting in O(N^2) allocations during wave calculation.
**Action:** Build declarative maps and pre-parse pattern literal prefixes once per scheduling wave before candidate iteration.
<div id="2025-05-20---write-intent-conflict-detection-and-wave-scheduling" class="doc-anchor" aria-hidden="true"></div>

## 2025-05-20 - Write-intent conflict detection and wave scheduling
**Learning:** `patternLiteralPrefix` repeatedly performed string splits and regex matching per pair comparison in `writeIntentPatternsMayOverlap`, and `writeIntentConflictBetween` reconstructed a subtask-declarations Map on every pair check within wave scheduling loops.
**Action:** Cache literal prefixes in a bounded Map and pass pre-constructed declarations Maps across batch conflict checks in scheduling loops.

<div id="2025-05-21---precomputed-declarations-map-in-validatestoredgraph-scope-evidence-check" class="doc-anchor" aria-hidden="true"></div>

## 2025-05-21 - Precomputed declarations Map in validateStoredGraph scope evidence check
**Learning:** `validateStoredGraph` validated subtask scope evidence by calling `graph.intentMap.subtasks.find` on every subtask, creating O(N^2) linear searches during graph validation.
**Action:** Pre-build a declarations Map once in `validateStoredGraph` before checking subtask scope evidence in batch graph validation loops.

<div id="2025-05-21---regex-guaranteed-lowercase-ascii-strings-in-agent-and-subtask-id-validation" class="doc-anchor" aria-hidden="true"></div>

## 2025-05-21 - Regex-guaranteed lowercase ASCII strings in Agent and Subtask ID validation
**Learning:** `validateAgentId`, `validSubtaskId`, and `validateSubtaskId` performed `.toLowerCase()`, `.split('.')[0]`, and duplicate Set lookups after checking `/^[a-z][a-z0-9_-]{0,63}$/`. The regex strictly guarantees lowercase ASCII characters without dots, making lowercasing and splitting redundant string/array allocations.
**Action:** When a preceding regex enforces strict lowercase ASCII character sets without delimiters, skip redundant `.toLowerCase()` and `.split()` calls.

<div id="2026-09-17---single-pass-parent-state-evaluation" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-17 - Single-pass parent state evaluation
**Learning:** `parentStateFor` created a temporary state array and made repeated passes over it for each subtask state check.
**Action:** Evaluate lifecycle precedence in one pass with early returns and no state array allocation.

<div id="2026-09-18---pre-built-adaptermap-in-task-graph-planning" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - Pre-built adapterMap in task graph planning
**Learning:** `taskGraphPlanCommand` scanned the adapter registry for every implementer. Batch recovery caches can retain outdated worktree ownership after asynchronous operations.
**Action:** Pre-index registered adapters once during planning. Recovery and stop operations retain fresh targeted subtask inspections rather than caching worktree ownership.
<div id="2026-09-18---weakmap-declarations-lookup-cache-and-set-lookups-in-task-graph-scheduling" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - WeakMap declarations lookup cache and Set lookups in task graph scheduling
**Learning:** `subtaskScopeIntent` performed O(N) `.find()` searches on `graph.intentMap.subtasks` on every scope intent lookup, and `taskGraphPlanCommand` scanned `scheduling.wave.conflictDeferred` with O(N) `.includes()` inside conflict mapping loops.
**Action:** Cache frozen declaration arrays with frozen entries in a `WeakMap` for O(1) lookups. Mutable graph records retain live array lookups; pre-convert candidate arrays to `Set` instances before iteration loops.
<div id="2026-09-18---allocation-free-subtask-frontier-state-evaluation" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - Allocation-free subtask frontier state evaluation
**Learning:** `deriveFrontierState` allocated temporary `{ id, state }` objects via `dependencyStates` and chained `.map()`, `.filter()`, `.some()`, and `.every()` on every pass of `reconcileSubtasks`.
**Action:** Query dependency states directly from `byId` Map in single-pass loops to evaluate subtask frontier states without intermediate object or array allocations.
<div id="2026-09-18---targeted-subtask-filtering-in-inspecttaskgraphrecovery" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - Targeted subtask filtering in inspectTaskGraphRecovery
**Learning:** `inspectTaskGraphRecovery` inspected worktrees and Git facts for every subtask in the graph on every call. Loops in `taskGraphRecoverCommand`, `cleanupGraphSubtask`, and `taskGraphStopCommand` called `inspectTaskGraphRecovery` per subtask, causing O(N^2) worktree inspections and Git process invocations.
**Action:** Support an optional `subtaskId` parameter in `inspectTaskGraphRecovery` to filter target subtasks before running worktree and Git probes.
<div id="2026-09-18---single-pass-subtask-state-counting-and-pre-aggregated-agent-roles-in-inspector-data" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - Single-pass subtask state counting and pre-aggregated agent roles in Inspector data
**Learning:** `graphSummary` performed 7 separate `.filter()` array-allocating passes over subtasks per task graph, and `readAgents` scanned workflow config per agent. Switch-based single-pass state counting avoided 7 array allocations per graph call and improved summary calculation speed by ~4x.
**Action:** Accumulate state counts in a single loop using fixed-property switches or object counters instead of multiple `.filter()` passes over subtasks.
<div id="2026-09-18---pre-indexed-tasks-map-in-readsessions" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - Pre-indexed tasks Map in readSessions
**Learning:** `readSessions` performed `tasks.filter(task => task.sessionId === record.id)` inside `records.map`, causing O(S * T) array filtering allocations for every session lookup.
**Action:** Pre-index tasks by `sessionId` into a `Map` once before mapping session records to reduce lookup complexity to O(S + T).
<div id="2026-09-18---precomputed-conflictdeferred-set-in-taskgraphplancommand" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-18 - Precomputed conflictDeferred Set in taskGraphPlanCommand
**Learning:** `taskGraphPlanCommand` searched `scheduling.wave.conflictDeferred` using `Array.includes()` for every subtask in every scheduling wave conflict, creating $O(M \times N)$ linear array scans when building `conflictById`.
**Action:** Always wrap array lookup collections into a `Set` before running batch `.find()` or `.map()` loops over related items.

<div id="2026-09-19---single-pass-configured-agents-set-and-array-allocations-in-task-graph-validation" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-19 - Single-pass configured agents Set and array allocations in Task Graph validation
**Learning:** `validateTaskGraphV1` converted `configuredAgents` to array via spread operator, `.map()`, and `.filter(Boolean)`, sorted normalized subtasks twice, allocated `Set` instances for empty or 1-item dependency arrays, and `cyclePath` re-copied and re-sorted already-sorted `dependsOn` arrays and `dependencies.keys()`.
**Action:** Populate Sets via `for...of` loops without intermediate array allocations, sort collections once, skip Set lookups for length <= 1, and reuse already-sorted subtask array properties in graph graph processing.

<div id="2026-09-20---targeted-session-fact-lookups-in-single-task-reads" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-20 - Targeted Session Fact Lookups in Single-Task Reads
**Learning:** `readWorkspaceTask` called `sessionFactMap` which invoked `listRecords` to re-scan and parse all `.agent-bus/sessions/*.json` files on every single task view request, causing $O(N_{\text{sessions}})$ directory reads instead of $O(1)$ lookups for the task's owned sessions.
**Action:** Pass `sessionIdsFor(record)` to `sessionFactMap` on single-task reads so `sessionFactMap` performs targeted `readRecord` calls for owned session IDs only.

<div id="2026-09-20---skipping-full-object-sanitization-on-summary-views-and-single-pass-graph-detail-mapping" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-20 - Skipping full object sanitization on summary views and single-pass graph detail mapping
**Learning:** `readTasks` invoked `sanitizeTask` on every task object during summary generation, allocating and truncating specs, evidence arrays, review histories, and error objects that `taskSummary` immediately threw away. `graphDetail` also allocated intermediate arrays during dependency flattening (`flatMap` + `.map`) and implementer agent flow mapping (`[...new Set(map)]`).
**Action:** Skip deep nested object sanitization on summary listing paths where `taskSummary` explicitly bounds scalar fields, and use single-pass loops for graph dependency flattening and agent flow collection.

<div id="2026-09-20---pre-indexed-session-task-map-and-pre-read-session-records-in-workspace-archive-cleanup" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-20 - Pre-indexed session task map and pre-read session records in workspace archive cleanup
**Learning:** `runtimeWorkspaceArchivesClear` repeatedly invoked `ownedTaskSessionFiles` per archived task record, causing $O(A \times S)$ disk reads and JSON parses for session files, and evaluated cross-task session references using `records.some(other => ...includes(file.id))` ($O(A \times S \times R)$ array/Set allocations).
**Action:** Pre-read session records once and pre-build a `sessionTaskMap` (`Map<sessionId, Set<taskId>>`) before looping over archived task records. Pass pre-read session records to child functions to avoid redundant file I/O.

<div id="2026-09-20---fast-path-byte-length-check-and-precomputed-path-reuse-in-readruntimeevents" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-20 - Fast-path byte length check and precomputed path reuse in readRuntimeEvents
**Learning:** `readRuntimeEvents` called `realpathSync.native` redundantly on every read even though `eventPaths(root)` already computed the canonical repository path. Furthermore, calling `Buffer.byteLength` on every JSON event line forced UTF-8 byte counting overhead. Fast-pathing string lengths where `line.length <= MAX_EVENT_LINE_BYTES / 4` avoids `Buffer.byteLength` calculation altogether.
**Action:** Reuse pre-calculated canonical paths from path resolution helpers, and guard expensive string byte-length measurement calls with mathematical string length limits.

<div id="2026-09-21---fast-path-length-checks-and-bounded-slicing-for-code-point-arrays-in-string-summary-generation" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-21 - Fast-path length checks and bounded slicing for code point arrays in string summary generation
**Learning:** `collaborationSummary` executed `Array.from(text)` unconditionally to count Unicode code points for truncation, allocating full arrays of single-character strings even for short strings. Guarding with `text.length <= 240` (since UTF-16 code units always $\ge$ code points) skips string array allocation for short strings (~135x speedup), while slicing `text.slice(0, 482)` before `Array.from()` bounds memory allocations for long strings (~3x speedup).
**Action:** Before converting a string to a code point array via `Array.from()`, check string length (`length <= target`) and slice bounded code units (`target * 2 + 2`) to avoid unnecessary array allocations.

<div id="2026-09-21---precomputed-valid_from_statuses-set-and-string-length-fast-path-in-workspace-collaboration" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-21 - Precomputed VALID_FROM_STATUSES Set and string length fast-path in workspace collaboration
**Learning:** `validateCollaborationEvents` spread `STATUSES` into a new `['IDLE', ...STATUSES]` array on every event iteration in `.map()`, causing $O(N)$ allocations and linear scans. `collaborationSummary` allocated `Array.from(text)` character arrays for every string even when `text.length <= 240`.
**Action:** Precompute static state transition Sets at module scope and fast-path scalar string length checks (`length <= threshold`) before allocating unicode character arrays.

<div id="2026-09-21---single-pass-maximum-filename-search-in-currentstate" class="doc-anchor" aria-hidden="true"></div>

## 2026-09-21 - Single-pass maximum filename search in currentState
**Learning:** `currentState` in `agent-observer.mjs` used `readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse()[0]`, which created 3 intermediate arrays (`.filter`, `.sort`, `.reverse`) and performed an $O(N \log N)$ sorting pass to find a single maximum filename.
**Action:** Use a single-pass `for...of` loop over `readdirSync` to find the lexicographically maximum file string in $O(N)$ time with zero extra array allocations.
