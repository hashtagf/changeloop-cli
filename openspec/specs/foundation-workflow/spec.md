# foundation-workflow Specification

## Purpose
TBD - created by archiving change foundation-workflow-commands-builtin. Update Purpose after archive.
## Requirements
### Requirement: Foundation loop commands are built into the CLI

The system SHALL inject the eight claude-foundation change-loop commands
(`investigate`, `change`, `build`, `prove`, `land`, `changes`, `feature`,
`dev`) into the command surface at boot. When an injected command executes, the
system SHALL synchronously resolve its canonical instruction through the
versioned host-instruction API of the `claude-foundation` executable selected
from `PATH`, without reading project-owned command files or embedding a
Foundation release-specific workflow body.

#### Scenario: Loop commands present by default

- **WHEN** the CLI boots with a config that does not set `foundation_workflow`
- **THEN** all eight loop commands are listed with built-in dispatcher markers

#### Scenario: Canonical project instruction is used

- **WHEN** an injected loop command is invoked and the installed
  `claude-foundation` supports the negotiated host-instruction protocol
- **THEN** Changeloop replaces its dispatcher marker with the matching
  instruction returned by that executable
- **AND** forwards the invocation arguments as one opaque argv value

#### Scenario: Partial Foundation installation fails closed

- **WHEN** the executable is missing, times out, lacks the host API, rejects the
  protocol, or returns an invalid response
- **THEN** Changeloop reports a stable actionable diagnosis and stops
- **AND** does not read a project command file, use a bundled workflow body, or
  improvise the workflow

#### Scenario: Additive protocol response remains compatible

- **WHEN** a protocol-1 response contains valid required fields plus unknown
  additive fields
- **THEN** Changeloop accepts the response and ignores the unknown fields

#### Scenario: Opt-out disables injection

- **WHEN** the CLI boots with `foundation_workflow: false`
- **THEN** none of the eight loop commands are injected or intercepted and the
  existing built-in commands (`init`, `review`) and user-defined commands are
  unchanged

### Requirement: User-defined commands take precedence over injected ones

The system SHALL NOT overwrite a user-defined command whose name collides with
a foundation loop command.

#### Scenario: Collision keeps the user's template

- **WHEN** the user config defines `command.change` and the CLI boots with
  injection enabled
- **THEN** the user's `change` command template is served unchanged and the
  remaining loop commands are still injected

### Requirement: The opt-out config field is compatible across config versions

The system SHALL accept `foundation_workflow` as an optional boolean in the v1
config schema without breaking existing config documents.

#### Scenario: v1 decode and migration survive the new field

- **WHEN** a config document containing `foundation_workflow` is decoded by
  the v1 schema and passed through the v1→v2 migration path
- **THEN** decoding succeeds with the field intact and migration completes
  without error

### Requirement: Foundation built-ins provide canonical agent context

The system SHALL resolve the package-owned Foundation agent contract through
`claude-foundation host agent-contract` protocol 1 and append it to the model
system prompt when Changeloop owns at least one Foundation built-in command.

#### Scenario: Canonical context is injected

- **WHEN** Foundation built-ins are active and the installed endpoint returns a
  valid protocol-1 response
- **THEN** the exact returned contract is appended to the system prompt
- **AND** one resolution is reused for later turns in the same plugin instance

#### Scenario: Context endpoint fails closed

- **WHEN** the endpoint is missing, times out, exceeds the output bound, or
  returns a malformed or mismatched response
- **THEN** the system prompt contains stable upgrade or reinstall guidance
- **AND** Changeloop does not use a bundled contract or project file fallback

#### Scenario: Inactive built-ins add no context

- **WHEN** `foundation_workflow` is false or every Foundation command name is
  user-owned
- **THEN** Changeloop does not invoke the endpoint or append Foundation context

