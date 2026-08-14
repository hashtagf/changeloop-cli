---
description: Compatibility composition for change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Execute **$ARGUMENTS**.

With `--resume`, continue the first incomplete operation; never replay work.
With `--plan-only`, run `/change` and stop after validation.

For fresh rapid work, run `change start --template`, write one
completed draft under `.foundation/`, then run `change start <draft>`. Continue
from its Build packet once. Otherwise use `/change`, then `/build`; finish `/prove`.

Use contracts. Do not reread framework files unless a command reports a blocker.

Workflow is mandatory. Never edit product files directly. Code/test success
without Foundation runtime state is a failed `/dev` invocation.

Never Land, commit, push, open a PR, create `.workflow/` state, lifecycle agents,
phase mirrors, or another ledger.
