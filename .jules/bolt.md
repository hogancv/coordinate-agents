# Bolt's Journal - Critical Learnings

## 2025-05-19 - Pattern compilation in scope audit
**Learning:** `patternToRegex` in scope-audit parsed and compiled a new RegExp instance on every path evaluation during scope audits.
**Action:** Always cache compiled pattern regexes in a bounded Map when evaluating batch paths against intent globs.

## 2025-05-20 - Precomputed declarations and pattern facts in Intent Map scheduling
**Learning:** `intentSchedulingWave` evaluated subtask conflict pairs by instantiating `new Map` and parsing `patternLiteralPrefix` on every `writeIntentConflictBetween` check, resulting in O(N^2) allocations during wave calculation.
**Action:** Build declarative maps and pre-parse pattern literal prefixes once per scheduling wave before candidate iteration.
## 2025-05-20 - Write-intent conflict detection and wave scheduling
**Learning:** `patternLiteralPrefix` repeatedly performed string splits and regex matching per pair comparison in `writeIntentPatternsMayOverlap`, and `writeIntentConflictBetween` reconstructed a subtask-declarations Map on every pair check within wave scheduling loops.
**Action:** Cache literal prefixes in a bounded Map and pass pre-constructed declarations Maps across batch conflict checks in scheduling loops.

## 2025-05-21 - Precomputed declarations Map in validateStoredGraph scope evidence check
**Learning:** `validateStoredGraph` validated subtask scope evidence by calling `graph.intentMap.subtasks.find` on every subtask, creating O(N^2) linear searches during graph validation.
**Action:** Pre-build a declarations Map once in `validateStoredGraph` before checking subtask scope evidence in batch graph validation loops.

## 2025-05-21 - Regex-guaranteed lowercase ASCII strings in Agent and Subtask ID validation
**Learning:** `validateAgentId`, `validSubtaskId`, and `validateSubtaskId` performed `.toLowerCase()`, `.split('.')[0]`, and duplicate Set lookups after checking `/^[a-z][a-z0-9_-]{0,63}$/`. The regex strictly guarantees lowercase ASCII characters without dots, making lowercasing and splitting redundant string/array allocations.
**Action:** When a preceding regex enforces strict lowercase ASCII character sets without delimiters, skip redundant `.toLowerCase()` and `.split()` calls.

## 2026-09-17 - Single-pass parent state evaluation
**Learning:** `parentStateFor` created a temporary state array and made repeated passes over it for each subtask state check.
**Action:** Evaluate lifecycle precedence in one pass with early returns and no state array allocation.

## 2026-09-18 - Single-pass subtask state counting and pre-aggregated agent roles in Inspector data
**Learning:** `graphSummary` performed 7 separate `.filter()` array-allocating passes over subtasks per task graph, and `readAgents` scanned workflow config per agent. Switch-based single-pass state counting avoided 7 array allocations per graph call and improved summary calculation speed by ~4x.
**Action:** Accumulate state counts in a single loop using fixed-property switches or object counters instead of multiple `.filter()` passes over subtasks.
## 2026-09-18 - Pre-indexed tasks Map in readSessions
**Learning:** `readSessions` performed `tasks.filter(task => task.sessionId === record.id)` inside `records.map`, causing O(S * T) array filtering allocations for every session lookup.
**Action:** Pre-index tasks by `sessionId` into a `Map` once before mapping session records to reduce lookup complexity to O(S + T).
## 2026-09-18 - Precomputed conflictDeferred Set in taskGraphPlanCommand
**Learning:** `taskGraphPlanCommand` searched `scheduling.wave.conflictDeferred` using `Array.includes()` for every subtask in every scheduling wave conflict, creating $O(M \times N)$ linear array scans when building `conflictById`.
**Action:** Always wrap array lookup collections into a `Set` before running batch `.find()` or `.map()` loops over related items.
