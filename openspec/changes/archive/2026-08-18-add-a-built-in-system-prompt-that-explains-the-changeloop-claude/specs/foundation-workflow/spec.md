## ADDED Requirements

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
