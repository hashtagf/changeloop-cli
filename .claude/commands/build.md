---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Validate; `sandbox create <change>` or `sandbox sync`; read the Build packet and
`.claude/commands/references/build-policy.md`.
Call `agents dispatch <change>` and obey its single action until
`build-complete`. Run `run-in-session` locally. Before `spawn-group` or `wait`,
read `.claude/commands/references/build-dispatch.md`. Relay `blocked`; at
completion run `proof readiness`.

Edit only allowed sandbox paths. Host owns leases and task ledger. Declare new
files in `[paths:]`; move unauthorized operations to `handoffs.yaml`. Auto-repair
in-contract findings and use typed recovery. Before fresh Prove, run readiness.
Never replay history, expose raw JSON, archive, commit, or Land. Report
behavior, checks, remaining risk, and next action.
