# Bolt's Journal - Critical Learnings

## 2025-05-19 - Pattern compilation in scope audit
**Learning:** `patternToRegex` in scope-audit parsed and compiled a new RegExp instance on every path evaluation during scope audits.
**Action:** Always cache compiled pattern regexes in a bounded Map when evaluating batch paths against intent globs.

## 2025-05-20 - Subtask declaration indexing in intent map contract
**Learning:** `writeIntentConflictBetween` and `intentCoverageFacts` mapped over `intentMap.subtasks` and constructed a new `Map` instance on every call during conflict evaluation and wave scheduling.
**Action:** Use a `WeakMap` cache keyed by `intentMap` to retain the subtask declaration map across repeated pairwise scheduling checks.
