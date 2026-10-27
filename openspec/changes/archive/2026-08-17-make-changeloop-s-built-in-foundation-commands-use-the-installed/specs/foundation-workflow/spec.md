## MODIFIED Requirements

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
