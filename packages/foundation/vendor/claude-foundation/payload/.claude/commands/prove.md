---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS** with
`claude-foundation advance <change> --through proven`. The coordinator reuses
fresh receipts, runs eligible deterministic providers, routes configured review
or acceptance, and finalizes proof without asking the model to reconstruct a
primitive command chain.

Follow only the returned protocol-v5 action and invoke its exact `resume`
command yourself. Command and resume fields are agent-only control data.
`REPAIR` and `EDIT` return a bounded invalidation/repair set; `RUN_EXTERNAL`
names one configured external boundary; `WAIT` reports its owner and condition
without a user command; `ASK_USER` asks only for the decision, after which the
agent records it and resumes. Read
`.claude/skills/prove/references/workflow.md` only for the named non-automatic
boundary. Do not rerun unchanged deterministic checks or search for alternate
commands.

Never fabricate evidence or Land. `DONE` at `proven` is success for this command.
Report what passed, what remains unproven, and the next action in the user's
language.
