# Bolt's Journal - Critical Learnings

## 2025-05-19 - Pattern compilation in scope audit
**Learning:** `patternToRegex` in scope-audit parsed and compiled a new RegExp instance on every path evaluation during scope audits.
**Action:** Always cache compiled pattern regexes in a bounded Map when evaluating batch paths against intent globs.

## 2025-05-20 - Subtask intent map declaration lookups and literal prefix caching in scheduling waves
**Learning:** `intentSchedulingWave` evaluated subtask write-intent conflicts in nested candidate/blocker loops where `writeIntentConflictBetween` re-instantiated a subtask-to-intent Map on every comparison, and `patternLiteralPrefix` repeatedly performed `String.prototype.split` and regex checks on identical patterns (~30x bottleneck).
**Action:** Always pre-build declarations maps once per wave pass and cache pattern literal prefixes in a bounded Map when evaluating wave conflict frontiers.
