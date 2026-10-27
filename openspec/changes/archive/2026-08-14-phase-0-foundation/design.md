# Design

## Current state

- `packages/core/src/global.ts:10` — `const app = "opencode"` drives data/
  config/cache directory names.
- `packages/core/src/flag/flag.ts` — reads ~20 `OPENCODE_*` env vars directly.
- `packages/core/src/config.ts` — discovers `opencode.json`/`opencode.jsonc`.
- `packages/opencode/package.json` — `"name": "opencode"`, bin
  `"opencode": "./bin/opencode"`.
- `packages/plugin/` — plugin package with a `v2/` API directory
  (draft-transform); examples exist (`example.ts`, `example-workspace.ts`).
- Git has a single `origin` remote (`hashtagf/changeloop-cli`); no `upstream`
  remote and only the `dev` branch.
- `bun test` (bun 1.2.22) is the test runner in `packages/core`
  (`test/config/`, `test/plugin/`, …); its only structured reporter is JUnit
  XML.

## Decisions

- **Decision:** Alias, do not replace — read `CHANGELOOP_*` first and fall
  back to `OPENCODE_*`; read `changeloop.json(c)` first and fall back to
  `opencode.json(c)`.
  - **Why:** Upstream is mid v1→v2 rewrite; every replaced identifier is a
    permanent merge conflict. Fallback keeps existing setups working.
  - **Rejected:** Wholesale rename of env vars and config keys — breaks users
    and makes every upstream merge conflict on mechanical lines.
  - Scope note: env aliasing lives in `packages/core/src/flag/flag.ts` only;
    other packages (e.g. the Go TUI) reading `OPENCODE_*` directly are
    untouched in Phase 0.
- **Decision:** Add a `changeloop` bin entry alongside the kept `opencode`
  bin; the package name stays `opencode`.
  - **Why:** The roadmap defers npm renames until the fork is stable; a second
    bin entry is zero merge cost and keeps existing invocations working.
  - **Rejected:** Renaming the package — churns the lockfile and every
    workspace dependency for no Phase 0 value.
- **Decision:** Legacy state-directory fallback, no migration — when no
  `changeloop` data/config directory exists and a legacy `opencode` one does,
  `global.ts` keeps resolving to the legacy paths.
  - **Why:** `const app` drives data/config/cache dir names; without fallback,
    existing installs silently lose sessions, auth, and cache.
  - **Rejected:** Copy-migration (risk of partial state, doubles disk) and
    fresh-state (silent data loss for existing users).
- **Decision:** Confine branding edits to a named allowlist of core files
  (`global.ts`, `flag/flag.ts`, `config.ts`, `packages/opencode/package.json`
  + bin); everything else ships as a plugin.
  - **Why:** Caps the lifetime merge cost of the fork (roadmap principle 2).
  - **Rejected:** Deep fork edits — merge cost grows without bound.
- **Decision:** Sync layout `upstream/main` → `dev` with a documented cadence;
  the first real merge round runs as its own change after this lands.
  - **Why:** A live upstream merge is nondeterministic (network, moving HEAD)
    and cannot be content-bound evidence inside this change.
  - **Rejected:** Vendoring upstream snapshots — loses history and makes
    conflict review impossible.
- **Decision:** Add a small project-owned reporter script that runs the scoped
  `bun test` suites and emits a JSON summary (`tests`, `failures`) for the
  harness `test-discovery` adapter.
  - **Why:** Bun 1.2.22 emits only JUnit XML; the evidence adapter needs JSON
    or TAP with a structured test count.
  - **Rejected:** Switching test runners for evidence purposes.

## Compatibility and migration

Public contract: existing `opencode.json(c)` projects and `OPENCODE_*`
environments keep working unchanged (fallback path). npm scope and service
tags are untouched. Rollback: revert the branding commits; no persisted data
or migration involved.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Upstream v1→v2 rewrite moves the v2 plugin API | Pin the template to the v2 draft-transform API; sync policy requires reading release notes each merge round | test |
| Branding files conflict on every upstream merge | Keep the allowlist minimal and documented in the sync policy | static |
| Fallback ordering regressions break legacy setups | Unit tests cover both precedence and fallback for config and env | test |
