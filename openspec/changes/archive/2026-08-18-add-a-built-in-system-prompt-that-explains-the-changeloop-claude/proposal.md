# Change: Resolve the Foundation agent contract into Changeloop's system prompt

## Why

Changeloop exposes the claude-foundation lifecycle as built-in commands, but the
model's baseline system context does not explain what the harness is or how the
commands relate. Agents can therefore discover commands without understanding
the OpenSpec, evidence, isolation, and Land-authority boundaries they enforce.

## What Changes

- When at least one built-in Foundation command is active, resolve the canonical
  agent contract through `claude-foundation host agent-contract` protocol 1 and
  append it to the assembled system prompt.
- Cache the package-owned contract per plugin instance and fail closed with
  upgrade guidance when the endpoint is unavailable or malformed.
- Do not add the guidance when `foundation_workflow` is disabled or every
  Foundation command name is supplied by user configuration.
- Cover prompt injection and opt-out behavior with focused plugin tests and
  document the built-in context alongside command configuration.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Public contract:** consumes host agent-contract protocol 1
- **Persistent migration:** no
- **Security trigger:** bounded local subprocess and untrusted JSON response
- **Irreversible effect:** no
