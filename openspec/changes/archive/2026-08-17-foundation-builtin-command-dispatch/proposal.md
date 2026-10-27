# Change: foundation-builtin-command-dispatch

## Why

Builtin Foundation commands currently duplicate instructions from release 3.2.27 while the project harness is 3.2.29, so agents can follow stale lifecycle and recovery semantics even when CLI/runtime API checks pass.

## What changes

- Replace each bundled full-body Foundation template with a thin dispatcher to
  the matching project-owned `.claude/commands/{command}.md` file.
- Fail closed with the existing setup guidance when either the project harness or matching canonical command file is missing; never fall back to a stale bundled workflow body.
- Replace the hard-coded 3.2.27 test assertion with deterministic dispatcher mapping, missing-install guard, argument forwarding, precedence, and opt-out coverage.
- Document the distinction between Changeloop's builtin dispatcher, the CLI selected from PATH, the project runtime version, and runtime API compatibility.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** default-on command contract, focused tests, configuration documentation
- **Security triggers:** none

## Non-goals

- Embed the Foundation runtime or installer in the Changeloop binary.
- Add a new Changeloop diagnostic command.
- Change Foundation CLI/runtime API compatibility rules.
- Change command names, default enablement, user precedence, or foundation_workflow config semantics.
