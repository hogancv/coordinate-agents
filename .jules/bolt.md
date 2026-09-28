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

## 2026-09-17 - Single-pass parent state evaluation and declarative lookup in graph validation
**Learning:** `parentStateFor` created temporary state arrays and executed up to 5 array iteration passes (`.some()`, `.every()`) on every subtask state check, while `validateSubtaskScopeEvidenceAgainstGraph` executed O(N^2) `.find()` searches on `intentMap.subtasks` during graph reads.
**Action:** Use single-pass loops with early returns for state hierarchy checks and pass pre-built Map lookups across batch validation loops.
