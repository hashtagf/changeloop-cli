# Tasks

> Add `[claims:<claim-id>]` after each stable task ID once evidence claims exist.
> A multi-repository change also annotates `[repo:<id>]`, `[kind:<kind>]`,
> `[paths:<glob,glob>]`, `[depends:<T00n>]`, and `[resources:<token>]` for any
> genuinely shared resource. Annotations are what let tasks run in parallel.

- [x] **T001** Resolve and cache the Foundation-owned protocol-1 agent contract,
  fail closed on endpoint errors, preserve opt-out/ownership behavior, and update
  focused evidence plus configuration documentation.
  [claims:add-a-built-in-system-prompt-that-explains-the-changeloop-claude-outcome]
  — verify: `bun run script/evidence-foundation-workflow-test.ts`
