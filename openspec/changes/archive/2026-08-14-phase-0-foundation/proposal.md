# Change: phase-0-foundation

## Why

Roadmap Phase 0 (`docs/plan/ROADMAP.md`): every later phase ships under the
`changeloop` name and as plugins. Before any of that can start, the fork needs
its own identity, a documented upstream-sync policy that caps merge cost, and a
plugin scaffold with CI so Phase 1 work has a place to land.

## What changes

- The CLI runs as `changeloop`: binary name, app identity
  (`packages/core/src/global.ts`), and config discovery prefer
  `changeloop.json(c)` and `CHANGELOOP_*` env vars, while `opencode.json(c)`
  and `OPENCODE_*` keep working as fallbacks.
- Upstream sync strategy is documented and wired: `upstream` remote, branch
  layout (`upstream/main` → `dev`), merge cadence, and the exact allowlist of
  core files a branding edit may touch.
- A template plugin on the v2 draft-transform API builds, loads in an example
  workspace, and is exercised by a CI pipeline.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code (`packages/core`, `packages/opencode`,
  `packages/plugin`), CI workflows, docs
- **Security triggers:** none

## Non-goals

- Renaming the npm scope `@opencode-ai/*` (~30 packages) or service tags
  `@opencode/v2/*` — deferred until the fork is stable (roadmap Phase 3).
- Executing the first real upstream merge round — that is its own change after
  this one lands; this change only establishes the policy and remote.
- Any Phase 1 feature (model router, workflow agents, verify step, OpsX).
