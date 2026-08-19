# Change: Bundle the Foundation runtime and bootstrap new repositories

## Why

Changeloop currently exposes Foundation commands but delegates every command and
agent-contract lookup to a separately installed `claude-foundation` executable.
In a repository without a Foundation installation, the commands are visible but
cannot run, and the current PATH release can drift from the protocol expected by
Changeloop. A Changeloop installation therefore does not yet provide a usable
change harness on its own.

## What changes

- Ship one checksum-pinned claude-foundation release payload inside the
  Changeloop binary and select it by default for host instructions and agent
  context.
- Add `changeloop foundation init|status|doctor|upgrade` so a writable project
  can install or refresh the bundled harness without a separate Foundation CLI
  installation.
- Detect an uninitialized project on first use of a Changeloop-owned Foundation
  command, request one explicit bootstrap decision, and continue through the
  bundled runtime after initialization.
- Preserve an explicit PATH-runtime compatibility mode, existing user command
  precedence, and `foundation_workflow: false`.
- Verify atomic installation, project-owned-file preservation, protocol
  compatibility, and a compiled binary with Foundation absent from PATH.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** compiled binary packaging, public CLI, plugin process
  boundary, target-repository filesystem, configuration, documentation
- **Security triggers:** checksum-pinned supply chain, canonical path
  confinement, symlink and overwrite handling, argv-only subprocess execution

## Non-goals

- Changing Foundation lifecycle, evidence, or Land semantics.
- Reimplementing Foundation's managed-file ownership rules in Changeloop.
- Silently modifying a repository merely because Changeloop was opened.
- Network downloads at runtime or automatic selection of an arbitrary PATH
  executable.
- Adding Windows support beyond the platforms supported by the pinned
  Foundation installer; unsupported platforms fail before writing.
