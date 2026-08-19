# Change: Execute bundled Foundation lifecycle commands without a PATH dependency

## Why

Changeloop injects Foundation commands and resolves their canonical instructions
from its checksum-pinned bundled release, but those instructions still execute
`claude-foundation` through the shell PATH. A machine with only Changeloop can
therefore discover commands and initialize a project yet cannot run the actual
lifecycle. An unrelated or older PATH executable can also split instruction,
agent-context, and lifecycle execution across different Foundation releases.

## What changes

- Make the bundled Foundation CLI available as `claude-foundation` in
  Changeloop-owned shell and PTY environments through a per-instance,
  content-addressed execution shim.
- Include the upstream OpenCode host installer in the verified payload and make
  `changeloop foundation init|upgrade` invoke the bundled release with
  `--host opencode`, installing canonical `.opencode/commands` plus the
  Foundation guard plugin and adapter ownership manifest.
- Activate the shim only in bundled mode while Changeloop owns at least one
  Foundation built-in or the project contains a verified Foundation-managed
  OpenCode adapter; explicit PATH mode and fully user-owned/disabled command
  surfaces retain their existing environment.
- Fail closed when the verified bundle or shim cannot be materialized, without
  falling back to an arbitrary PATH executable.
- Extend focused and compiled-binary evidence through real lifecycle execution
  with external `claude-foundation` removed from PATH.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** Foundation bundle sync and manifest, initializer,
  plugin/runtime, OpenCode host adapter, shell and PTY environment, compiled
  binary evidence, configuration documentation
- **Security triggers:** checksum-pinned executable resolution and per-instance
  shell PATH boundary

## Non-goals

- Changing Foundation lifecycle or installer semantics.
- Treating slash-command invocation as authority to write managed project files;
  first use continues to require explicit initialization approval.
- Making Foundation workflows operate without a configured model/provider.
- Adding a new stale-runtime status taxonomy; the selected CLI/runtime API guard
  remains responsible for incompatible project harnesses.
- Removing explicit `foundation_runtime: "path"` compatibility mode.
- Overwriting `.opencode` command or plugin files that the adapter manifest does
  not identify as Foundation-managed.
