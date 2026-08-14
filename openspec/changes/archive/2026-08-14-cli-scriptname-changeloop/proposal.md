# Change: cli-scriptname-changeloop

## Why

The `changeloop` bin entry works (landed in `phase-0-foundation`), but the CLI's
own `--help`/usage output still says `opencode <command>` regardless of which
name invoked it — `changeloop --help` prints `opencode run [message..]`, etc.
This is confusing when the primary identity is now `changeloop`.

## What changes

- `packages/opencode/src/index.ts` and `src/temporary.ts`: yargs
  `.scriptName("opencode")` → `.scriptName("changeloop")`, so `--help`/usage
  text reads `changeloop <command>`.
- `index.ts`'s `show()` helper matches its `startsWith("opencode ")` guard to
  the same new scriptName, so the ASCII-logo-before-help behavior stays
  correct.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Rapid-lane eligibility:** 3 literal-string changes across 2 files, no
  config/data/security surface, verified by a direct `--help` output check —
  no broader design decision involved.

## Non-goals

- The ASCII art logo, `describe:` strings on individual subcommands, and TUI
  screen text (terminal title, theme name, crash screen, splash) still say
  "opencode" — deliberately deferred; they sit in actively-upstream-developed
  source (`packages/opencode/src/cli/**`, `packages/tui/src/**`) where a wide
  edit sweep now would create merge-conflict surface on every future upstream
  sync. Roadmap Phase 3 (full rebrand) covers them together.
- Making the invoked name detected dynamically (so `opencode --help` still
  shows "opencode" while `changeloop --help` shows "changeloop") was
  considered and rejected: bun-compiled binaries do not preserve the invoked
  symlink name in `process.argv` (verified directly — both symlinks report
  the same internal `$bunfs` path), so this would need launcher-to-binary
  env-var plumbing, which is out of scope for this rapid fix.
