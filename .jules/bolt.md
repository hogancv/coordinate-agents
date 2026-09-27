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
