## ADDED Requirements

### Requirement: Foundation loop commands are built into the CLI

The system SHALL inject the eight claude-foundation change-loop commands
(`investigate`, `change`, `build`, `prove`, `land`, `changes`, `feature`,
`dev`) into the command surface at boot from templates bundled in the binary.

#### Scenario: Loop commands present by default

- **WHEN** the CLI boots with a config that does not set `foundation_workflow`
- **THEN** all eight loop commands are listed with their bundled templates,
  each template carrying the harness-missing guard and its Foundation source
  version

#### Scenario: Opt-out disables injection

- **WHEN** the CLI boots with `foundation_workflow: false`
- **THEN** none of the eight loop commands are injected and the existing
  built-in commands (`init`, `review`) and user-defined commands are unchanged

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
