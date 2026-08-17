## MODIFIED Requirements

### Requirement: Foundation loop commands are built into the CLI

The system SHALL inject the eight claude-foundation change-loop commands
(`investigate`, `change`, `build`, `prove`, `land`, `changes`, `feature`,
`dev`) into the command surface at boot from thin dispatcher templates bundled
in the binary. Each dispatcher SHALL resolve workflow semantics from the
matching project-owned canonical command file rather than embedding a
Foundation release-specific workflow body.

#### Scenario: Loop commands present by default

- **WHEN** the CLI boots with a config that does not set `foundation_workflow`
- **THEN** all eight loop commands are listed with bundled dispatchers that map
  to their matching `.claude/commands` files

#### Scenario: Canonical project instruction is used

- **WHEN** a loop command is invoked in a project with a complete Foundation
  installation
- **THEN** the dispatcher requires the agent to read the matching canonical
  command file completely and follow it with the invocation arguments

#### Scenario: Partial Foundation installation fails closed

- **WHEN** the project harness or matching canonical command file is missing
- **THEN** the dispatcher stops, relays setup or reinstall guidance, and does
  not fall back to a bundled workflow body or improvised process

#### Scenario: Opt-out disables injection

- **WHEN** the CLI boots with `foundation_workflow: false`
- **THEN** none of the eight loop commands are injected and the existing
  built-in commands (`init`, `review`) and user-defined commands are unchanged
