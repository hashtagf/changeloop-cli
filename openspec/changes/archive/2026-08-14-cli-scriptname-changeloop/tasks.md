# Tasks

- [x] **T001** Rename yargs scriptName to changeloop — `packages/opencode/src/index.ts`
  (`.scriptName("opencode")` → `.scriptName("changeloop")`, `show()`'s
  `startsWith("opencode ")` → `startsWith("changeloop ")`) and
  `packages/opencode/src/temporary.ts` (`.scriptName("opencode")` →
  `.scriptName("changeloop")`) — verify: `--help` output for every documented
  command starts with `changeloop <command>`, not `opencode <command>`
  [repo:root] [paths:packages/opencode/src/index.ts,packages/opencode/src/temporary.ts] [claims:scriptname-changeloop]
- [x] **T002** Regenerate the CLI help-text snapshots — update
  `packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap`
  (every scriptName-derived line, e.g. subcommand headers and cross-references
  under `Commands:`, becomes `changeloop ...`; unrelated literals like the
  `--mdns-domain` default `opencode.local` correctly stay unchanged — out of
  scope); add `script/check-cli-help-snapshots.ts` running the suite and
  emitting a JSON summary for the evidence provider — verify: snapshot test
  passes clean (34 snapshots, 0 fail, 5.67s regenerate / 4.92s clean rerun —
  not flaky, unlike the PTY/mDNS suites)
  [repo:root] [paths:packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap,script/check-cli-help-snapshots.ts] [depends:T001] [claims:scriptname-changeloop]
