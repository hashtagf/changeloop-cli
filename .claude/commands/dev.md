---
description: Compatibility composition for change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Execute **$ARGUMENTS**.

With `--resume`, continue the first incomplete operation; never replay work.
With `--plan-only`, run `/change` and stop after validation.

For all fresh work use `/change`; only it may run `change start --template` after the
complete read and Decision Sheet. Then run `/build` and `/prove`.

Do not reread framework files unless blocked. Report phase progress; finish in
the user's language with behavior, evidence, risk, and next action.

Workflow is mandatory. Code/test success without Foundation runtime state is a failed `/dev` invocation.

Never Land, commit, push, open a PR, create `.workflow/` state, lifecycle agents,
phase mirrors, or another ledger.
