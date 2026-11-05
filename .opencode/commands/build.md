---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**. Shared rules: `.claude/harness/AGENT.md`.

Run `claude-foundation advance <change> --through proven`. Execute each
protocol-v6 action, then follow its exact `resume` route until `DONE` or a
real boundary.

- `EDIT`: implement the returned tasks inside `workspace` and allowed `paths`,
  then resume: `advance` runs every check and ticks passing tasks.
  One `EDIT` may carry several tasks: implement all, resume once. Run a
  `checkCommand` only to diagnose.
- `REPAIR`: apply the whole ordered batch; amend new behavior.
- `RUN_EXTERNAL`: run the named operation; long ones via `claude-foundation exec`.
- `WAIT`/`ASK_USER`: report the wait; ask only for the decision; resume.
- `DONE`: `proven` reached.

Edit only allowed sandbox paths. New observable behavior, or unauthorized infrastructure
or external work, goes through one semantic amendment (Change workflow,
amendment section); never ask for credentials.

Read `references/build-policy.md` for a new user request during an active
change, an amendment, or a standard change;
the policy owns follow-up intent routing. Read `references/build-dispatch.md` when `execution.mode` is parallel
or an action names a lease.

Never archive, commit, or Land. Report behavior, checks, remaining risk, and
outcome.
