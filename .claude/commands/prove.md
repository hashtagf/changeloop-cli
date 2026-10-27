---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**. Shared rules: `.claude/harness/AGENT.md`.

Run `claude-foundation advance <change> --through proven`: no-op `DONE`
when proof is current (Build runs it). Else the coordinator reuses fresh receipts
and refreshes stale proof.

Execute each protocol-v6 action, then its exact `resume`; apply a `REPAIR` or
`EDIT` set whole. Stay in-session while a review runs: ending the reply kills
it. Never fabricate evidence or invent a checker.

## Gate: no progress

After repeated no-progress, report completed findings, what was tried, and
unreviewed scope; the user chooses further work, Land with explicit risk
acceptance, or pause. Record the answer through
`.claude/skills/prove/references/workflow.md`, read otherwise only for a named
non-automatic boundary.

Never Land. `DONE` at `proven` is success for this command, not delivery.
Report what passed, what remains unproven, any `reviewAdvisories.specGaps`,
and the next action in the user's language.
