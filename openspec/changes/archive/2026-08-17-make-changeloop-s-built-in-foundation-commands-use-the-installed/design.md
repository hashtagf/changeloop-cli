# Design

## Current state

- `FoundationWorkflowPlugin` injects eight `config.command` templates and
  preserves a user-defined command with the same name.
- Each template currently tells the agent to inspect the matching
  `.claude/commands/{name}.md`; the plugin performs no runtime lookup.
- `command.execute.before` can replace the resolved prompt parts before the
  message reaches the model. `PluginInput` supplies the project directory and
  a process boundary, so the plugin can resolve `claude-foundation` from
  `PATH` without changing the command engine.
- The installed CLI exposes lifecycle operations but does not yet expose the
  canonical host instruction as a machine-readable command. That producer
  capability must ship before the Changeloop consumer can activate.

## Decisions

- **Decision:** Foundation owns a synchronous, read-only host-instruction
  endpoint:
  `claude-foundation host instruction COMMAND --protocol 1 --format json --arguments ARGUMENTS`.
  - **Why:** the caller needs the instruction before it can construct the next
    model request, and the installed Foundation release must be the single
    owner of workflow semantics.
  - **Rejected:** project command files, Homebrew-path file discovery, bundled
    prompt bodies, and executing mutating workflows inside the plugin.
- **Decision:** Protocol 1 returns one JSON object with `protocol`, `command`,
  `description`, `instruction`, `argumentMode`, and `foundationVersion`.
  Unknown fields are allowed; required fields are validated. `command` must
  exactly match the request and `instruction` must be non-empty UTF-8 text.
  - **Why:** an explicit tolerant-reader contract permits additive Foundation
    releases without coupling Changeloop to package layout or prose errors.
  - **Rejected:** unversioned stdout text and semantic-version equality checks.
- **Decision:** CLI errors are non-zero exits with a JSON error object carrying
  a stable code. Initial codes are `unsupported_protocol`,
  `unknown_host_command`, and `instruction_unavailable`. Changeloop adds local
  boundary codes for `foundation_cli_missing`, `foundation_cli_timeout`,
  `foundation_host_api_unsupported`, and `foundation_response_invalid`.
  - **Why:** callers must branch on stable codes rather than stderr wording.
  - **Rejected:** parsing human help output or silently choosing another source.
- **Decision:** Injected templates contain only a private dispatcher marker.
  `command.execute.before` intercepts only a matching marker, invokes the CLI
  with an argv array from the project directory, validates at most 256 KiB of
  output, and replaces the prompt part with the returned instruction.
  - **Why:** marker ownership prevents the hook from intercepting a
    user-defined command with the same name, while argv execution preserves
    opaque arguments without shell injection.
  - **Rejected:** intercepting by command name alone or constructing a shell
    command string.
- **Decision:** Use a five-second local deadline and no automatic retry.
  - **Why:** this is a local read operation expected to complete quickly; a
    retry cannot repair a missing or incompatible binary and would delay the
    interactive request.
- **Decision:** Fail closed on every boundary error. Show the stable diagnosis
  and an upgrade/reinstall action, then stop; never fall back to project files
  or bundled instructions.
  - **Why:** fallback would make workflow semantics depend on incidental local
    state and reintroduce the version ambiguity this change removes.

## Producer dependency

This repository owns only the Changeloop consumer. The producer is planned as
change `publish-a-versioned-host-instruction-cli-endpoint-for-changeloop` in
`/Users/hashtagf/Desktop/Work/changeloop-control-plane/claude-foundation` and
must first:

1. publish the protocol-1 command and JSON schema;
2. source all eight instructions from the installed Foundation release;
3. keep project runtime discovery out of this read-only endpoint;
4. add contract fixtures for success, unknown command, unsupported protocol,
   and unavailable instruction; and
5. release a CLI version containing the endpoint.

The producer fixture set becomes the compatibility input for Changeloop's
consumer tests. No Changeloop Build starts until this dependency is available
from an explicit test executable or released CLI.

## Compatibility and rollout

The producer change is additive and ships first. Old Changeloop versions ignore
the new endpoint and continue using project command files. The new Changeloop
consumer then ships and works with any CLI implementing protocol 1, regardless
of semantic version. With an older CLI it fails closed and tells the user to
upgrade Foundation.

Command names, arguments, opt-out behavior, and user precedence remain
compatible. The intentional break is that a complete project-owned
`.claude/commands` installation no longer compensates for a missing or old CLI.

Rollback restores the previous Changeloop binary or sets
`foundation_workflow: false`; it does not mutate Foundation state. The producer
endpoint remains safe for old consumers and need not be rolled back.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Producer and consumer disagree on JSON shape | Protocol fixture consumed by both repositories; tolerant reader for additive fields | contract |
| User arguments execute shell syntax | Spawn with an argv array and prove metacharacter arguments remain one opaque value | test |
| Hook intercepts a user-defined command | Require the private injected marker, not only the command name | test |
| Old or missing CLI causes agent improvisation | Typed fail-closed prompt with no fallback instruction | test |
| Local process hangs or emits excessive output | Five-second deadline and 256 KiB response limit | test |
| Release order breaks existing installations | Additive producer-first rollout and explicit minimum capability diagnostic | docs |
