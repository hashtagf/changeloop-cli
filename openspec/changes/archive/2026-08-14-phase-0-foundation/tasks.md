# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** Rebrand binary and app identity — add bin entry `changeloop` in
  `packages/opencode/package.json` (+ `bin/` script), keeping the `opencode`
  bin and the package name `opencode` (npm rename deferred); `const app =
  "changeloop"` in `packages/core/src/global.ts` with legacy-dir fallback:
  when no `changeloop` data/config dir exists and an `opencode` one does, keep
  using the legacy paths — verify: CLI entrypoint runs `--version` exit 0
  under the `changeloop` bin name; both bin entries present; unit test covers
  legacy-dir fallback [repo:root] [paths:packages/opencode/**,packages/core/src/global.ts,packages/core/test/global/**] [claims:rebrand-cli,app-dir-fallback]
- [x] **T002** Config and env fallback — `packages/core/src/config.ts` reads
  `changeloop.json(c)` with `opencode.json(c)` fallback;
  `packages/core/src/flag/flag.ts` reads `CHANGELOOP_*` with `OPENCODE_*`
  fallback; unit tests cover precedence and fallback both ways — verify:
  `bun test` config/flag suites pass [repo:root] [paths:packages/core/src/config.ts,packages/core/src/flag/**,packages/core/test/config/**,packages/core/test/flag/**] [claims:config-fallback,env-fallback]
- [x] **T003** Upstream sync policy — `docs/sync/UPSTREAM.md` with upstream
  remote URL, `upstream/main` → `dev` branch layout, merge cadence, branding
  file allowlist, conflict playbook; add the `upstream` remote; add
  `script/check-sync-doc.ts` asserting the required sections — verify:
  checker script exits 0 [repo:root] [paths:docs/sync/**,script/check-sync-doc.ts] [claims:sync-policy]
- [x] **T004** Plugin scaffold and CI — template plugin on the v2
  draft-transform API under `packages/plugin/` with a load test in an example
  workspace; `.github/workflows/plugin.yml` builds and tests it; add
  `script/check-workflows.ts` asserting workflows parse and `plugin.yml` has
  build + test steps — verify: plugin load test passes; checker exits 0 [repo:root] [paths:packages/plugin/**,.github/workflows/plugin.yml,script/check-workflows.ts] [depends:T001] [claims:plugin-scaffold,plugin-ci]
- [x] **T005** Evidence reporter — `script/evidence-test.ts` runs the scoped
  `bun test` suites (config, flag, plugin — including the template plugin
  load test wherever T004 places it) with the JUnit reporter and writes
  `test-results/evidence-test.json` (`{"tests": N, "failures": M}`), exiting
  with bun's status — verify: script emits the JSON report and mirrors the
  test exit code [repo:root] [paths:script/evidence-test.ts] [depends:T002] [claims:rebrand-cli,app-dir-fallback,config-fallback,env-fallback,plugin-scaffold]
