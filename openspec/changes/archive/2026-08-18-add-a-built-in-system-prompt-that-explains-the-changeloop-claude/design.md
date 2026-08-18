# Design

## Current state

- Foundation built-in commands already use a bounded local subprocess to resolve
  versioned package-owned instructions and fail closed on invalid responses.
- The first implementation duplicated a summary string in Changeloop, which can
  drift from `.claude/harness/AGENT.md` and omitted operational constraints.
- The user selected the Foundation-owned host API as the canonical source.

## Decisions

- **Decision:** Resolve `host agent-contract --protocol 1 --format json` from
  the same `claude-foundation` executable used by command dispatch.
  - **Why:** The installed release owns both its workflow instructions and agent
    contract; Changeloop remains a thin client.
  - **Rejected:** Hardcoding or reading a sibling development checkout path.
- **Decision:** Cache one resolution promise per plugin instance.
  - **Why:** The package-owned contract cannot change during a session and
    spawning a process for every provider turn would add avoidable latency.
  - **Rejected:** Reading the project-installed file directly, which bypasses
    protocol/version validation and can select a different Foundation release.
- **Decision:** Append a stable failure instruction instead of improvising.
  - **Why:** Missing or malformed canonical context must be visible and
    actionable without silently substituting stale guidance.
  - **Rejected:** Falling back to the previously bundled summary.

## Compatibility and migration

Requires agent-contract protocol 1. Older Foundation releases keep command
dispatch behavior but receive a clear upgrade/reinstall instruction in system
context. No persisted data or migration exists; disabling `foundation_workflow`
still disables both built-ins and context.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Malformed or oversized subprocess output enters the system prompt | Reuse timeout/output limits and validate required protocol fields | test |
| Context resolution adds per-turn startup latency | Cache one promise per plugin instance | test |
| User-owned commands receive unexpected Foundation context | Gate resolution on the existing injected-command ownership set | test |
