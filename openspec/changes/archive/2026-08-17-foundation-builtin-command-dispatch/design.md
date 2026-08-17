# Design

## Current state

- `FoundationWorkflowPlugin` injects eight templates into `config.command` at
  boot and skips every name already defined by the user. The plugin itself does
  not inspect the filesystem or Foundation version.
- The eight `.txt` templates bundle full workflow bodies copied from Foundation
  3.2.27. Their focused test pins the `3.2.27` header, so an installed harness
  can advance while the binary continues serving older agent instructions.
- The `claude-foundation` executable comes from `PATH`, resolves the project
  root from the working directory, and forwards operations to the project's
  `.claude/harness/foundation.mjs`. Runtime API 21 protects CLI/runtime function
  compatibility, not the semantics of an older prompt body.
- Foundation installation manages `.claude/commands` and `.claude/harness`
  together. The project canonical commands are therefore the instruction
  source that already shares the harness revision.

## Decisions

- **Decision:** Bundle a thin dispatcher per command. It checks that the
  project harness and its matching canonical command file exist, reads that
  command file completely, and follows it with the invocation arguments.
  - **Why:** This keeps the builtin command identity while binding workflow
    semantics to the project-owned Foundation revision without adding config
    hook I/O or duplicating release bodies.
  - **Rejected:** Manual resync on every release, loading command bodies in the
    plugin at boot, and embedding the full harness in this V1 change.
- **Decision:** Treat a missing harness or canonical command as a partial
  installation and stop with setup/reinstall guidance.
  - **Why:** A stale fallback can execute obsolete lifecycle or recovery steps;
    failing closed is observable and recoverable.
  - **Rejected:** Preserve the 3.2.27 body as a fallback or let the agent
    improvise the workflow.
- **Decision:** Preserve command names, default enablement,
  `foundation_workflow: false`, and user-defined command precedence unchanged.
  - **Why:** Version binding is the only requested behavior change and the
    existing public configuration contract remains valid.
  - **Rejected:** A new opt-in, renamed commands, or overwriting project/user
    definitions.
- **Decision:** Document existing version inspection rather than add a new
  Changeloop diagnostic command.
  - **Why:** CLI version, project runtime version, runtime API, and doctors
    already expose the necessary facts; another command would expand scope.
  - **Rejected:** Add `changeloop foundation version` in this change.

## Compatibility and migration

The eight command names and config behavior are compatible. Projects with a
complete Foundation installation begin using that installation's canonical
command instructions after restarting Changeloop. Projects without Foundation
continue seeing the commands but receive setup guidance when invoking one.

A project with a harness but a missing matching `.claude/commands` file changes
from running a stale bundled workflow to a fail-closed partial-install error.
Reinstalling Foundation repairs it. No persisted data, schema migration,
service rollout, or external operation is involved. Rollback restores the
previous templates but also restores the version-drift risk.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Wrong command-to-file mapping | Table-driven test covers all eight exact mappings | test |
| `$ARGUMENTS` lost for an argument-taking command | Focused assertion covers seven argument-taking templates | test |
| Partial installation continues with stale or improvised steps | Test requires both guards, stop language, setup guidance, and absence of the old full bodies | test |
| Opt-out or user precedence regresses | Retain existing focused plugin tests in the structured evidence run | test |
| Documentation conflates CLI version with runtime compatibility | Evidence test checks the documented version model and removes the 3.2.27 bundle claim | test |
