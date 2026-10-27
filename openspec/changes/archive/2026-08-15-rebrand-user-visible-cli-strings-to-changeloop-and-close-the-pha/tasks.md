# Tasks

> This is the sole implementation ledger.

- [x] **T001** User-visible strings in packages/opencode/src say changeloop (describes, printed messages, command hints), help snapshots regenerated, and a brand test pins the surface [kind:implementation] [paths:packages/opencode/src,packages/opencode/test/cli/help,packages/opencode/test/brand.test.ts] — verify: `bun test test/cli/help/help-snapshots.test.ts test/brand.test.ts (cwd packages/opencode)`
- [x] **T002** packages/core/package.json has dual bin entries (changeloop and opencode) pointing at the same launcher [kind:implementation] [paths:packages/core/package.json,packages/core/test/bin.test.ts] — verify: `bun test bin.test.ts (cwd packages/core)`
- [x] **T003** Global config discovery in packages/opencode/src/config/config.ts prefers changeloop.json(c) with opencode.json(c)/config.json fallback and changeloop-wins merge order [kind:implementation] [paths:packages/opencode/src/config/config.ts,packages/opencode/test/config/global-config.test.ts] — verify: `bun test test/config/global-config.test.ts (cwd packages/opencode)`
- [x] **T004** packages/core/src/global.ts honors CHANGELOOP_TEST_HOME and falls back to OPENCODE_TEST_HOME [kind:implementation] [paths:packages/core/src/global.ts,packages/core/test/global.test.ts] — verify: `bun test global.test.ts (cwd packages/core)`
- [x] **T005** Project config discovery walks .changeloop before .opencode in paths.ts, core config.ts, and core plugin/agent.ts, with .opencode still honored [kind:implementation] [paths:packages/opencode/src/config/paths.ts,packages/core/src/config.ts,packages/core/src/plugin/agent.ts,packages/core/test/config/config.test.ts] — verify: `bun test config/config.test.ts (cwd packages/core)`
- [x] **T006** docs/sync/UPSTREAM.md branding allowlist records the user-visible-string surface and the new shimmed files [kind:documentation] [paths:docs/sync/UPSTREAM.md] — verify: `bun run script/check-sync-doc.ts`
