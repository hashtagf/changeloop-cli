---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Run `claude-foundation advance <change> --through build`. Follow its protocol-v5
action and exact `resume` route yourself until `DONE` or a real boundary.
Command and resume fields are agent-only control data; expose them only for
requested diagnosis.

- `EDIT`: implement returned tasks and checks.
- `REPAIR`: apply the ordered batch; amend new behavior.
- `RUN_EXTERNAL`: run the configured operation once.
- `WAIT`/`ASK_USER`: report waits; ask only for the decision; resume yourself.
- `DONE`: stop at Build, before Proof.

Read `references/build-policy.md` for repair and `references/build-dispatch.md`
only for parallel work or leases.

Edit only allowed sandbox paths. Host owns leases and tasks. Start every
mutating shell call with `cd <workspace> &&`. Declare new files
in `[paths:]`; move unauthorized work to `handoffs.yaml`. Never expose JSON,
archive, commit, or Land. Report behavior, checks, remaining risk, and outcome.
