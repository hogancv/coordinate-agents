# Task templates

Use one template with `quickstart --template <type> --task "<summary>"`. The selected checklist is embedded in the generated Codex prompt; Codex turns it into the full implementation specification before messaging Antigravity.

## Bug fix (`bug`)

Provide:

- Symptom and affected user flow
- Reproduction steps or failing input
- Expected behavior versus actual behavior
- Relevant environment, version, logs, or screenshots
- Severity and known scope

Codex must require Antigravity to reproduce first, identify the root cause, make the smallest safe fix, add a regression test, and verify related behavior.

Example:

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --template bug --task "Saving an edited Todo crashes when the title contains an emoji"
```

## Feature development (`feature`)

Provide:

- User problem and desired outcome
- Observable behavior and UX/API expectations
- In-scope and out-of-scope behavior
- Edge cases and compatibility constraints
- Acceptance criteria and validation method

Codex must resolve material ambiguity and produce an implementation-ready specification before Antigravity writes code.

Example:

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --template feature --task "Add due dates and an overdue filter to the Todo app"
```

## Refactor (`refactor`)

Provide:

- Code area and maintainability problem
- Observable behavior that must remain unchanged
- Architectural target and explicit non-goals
- Current green baseline and relevant performance constraints
- Completion evidence expected

Codex must define invariants. Antigravity must capture a baseline, refactor incrementally, and compare tests/build (and performance when relevant) before and after.

Example:

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --template refactor --task "Extract Todo persistence into a repository module without changing UI behavior"
```
