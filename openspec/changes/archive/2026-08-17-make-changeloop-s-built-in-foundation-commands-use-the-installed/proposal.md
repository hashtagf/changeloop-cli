# Change: Resolve built-in Foundation commands from the installed CLI

## Why

Changeloop currently exposes eight built-in Foundation slash commands through
templates that redirect the agent to project-owned `.claude/commands/*.md`
files. This avoids bundled-prompt drift, but keeps command availability tied to
a complete per-project host installation and makes the built-in command surface
an indirect file lookup rather than a capability supplied by the
`claude-foundation` executable selected from `PATH`.

## What changes

- Define a versioned, read-only host-instruction contract owned by
  `claude-foundation` for all eight Foundation commands.
- Change the Changeloop plugin to invoke that contract synchronously from
  `PATH` when one of its injected slash commands executes, validate the
  response, and replace the dispatcher marker with the returned instruction.
- Fail closed with actionable diagnostics when the executable, host API,
  protocol version, or response is unavailable; do not read project command
  files and do not fall back to a bundled workflow body.
- Preserve default enablement, `foundation_workflow: false`, argument
  forwarding, and user-defined command precedence.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** published `claude-foundation` CLI contract,
  Changeloop plugin command execution, focused tests, configuration docs
- **Security triggers:** process execution with user-supplied command arguments;
  arguments must be passed as an argv element without shell evaluation

## Non-goals

- Execute an entire `/change`, `/build`, `/prove`, or `/land` workflow inside
  the plugin.
- Embed the Foundation runtime, installer, or workflow bodies in Changeloop.
- Read instruction files from the project or the Homebrew installation path.
- Change command names, lifecycle semantics, model routing, or Land authority.
