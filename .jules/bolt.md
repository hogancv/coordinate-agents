# Bolt's Journal - Critical Learnings

## 2025-05-19 - Pattern compilation in scope audit
**Learning:** `patternToRegex` in scope-audit parsed and compiled a new RegExp instance on every path evaluation during scope audits.
**Action:** Always cache compiled pattern regexes in a bounded Map when evaluating batch paths against intent globs.

## 2025-05-20 - Pre-compiling task matching regexes in inbox message scans
**Learning:** `findSubtaskImplementationMessages` and `implementationMessages` instantiated new RegExp objects inside loops for every inbox message file, causing repetitive compilation during task bus syncs.
**Action:** Always pre-compile task/subtask ID matching RegExp instances before iterating over inbox stages and message files.
