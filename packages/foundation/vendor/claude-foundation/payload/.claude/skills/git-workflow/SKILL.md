---
name: git-workflow
description: "Perform authorized branch, stage, commit, rebase, merge, push, cleanup, or PR operations safely. Use for Git mutations and reviewability; skip read-only inspection. Change Loop Land preserves HEAD/index and grants no commit, push, or PR authority."
---

# Git workflow

For authorized history cleanup, compare original/resulting tree identity.
Reviewer guidance can improve reviewability without rewriting history.

Use this for Git mechanics after authorization. Foundation Land guards and user
authority take precedence over convenience or customary workflow.

## Rules

1. Inspect status, branch, remotes, and upstream before writing. Start branches
   from a fresh intended base and keep one purpose per branch.
2. Make each commit one complete logical change that builds/tests independently.
   Stage deliberately; do not mix generated noise or unrelated cleanup.
3. Write an imperative subject that names the outcome; use the body for the
   constraint, tradeoff, migration, or reason the diff cannot show. Follow the
   repository's existing convention.
4. Rewrite only private/local history. On shared history prefer additive fixes;
   if an authorized force update is unavoidable, use `--force-with-lease` and
   never force a protected/default branch.
5. Integrate deliberately and rerun relevant evidence after rebase/merge because
   a text-clean integration can still be semantically broken.
6. Keep PRs scoped and reviewable. Explain outcome/why/test evidence and include
   UI/API examples when they materially aid review.
7. Before destructive commands, resolve exact targets and name the recovery
   path. Inspect reflog first; prefer backup branch, stash, revert, or other
   recoverable operations.

## Authority and handoff

- Read-only Git inspection needs no workflow mutation authority.
- Commit/push only via `/deliver` or a direct user instruction; Land never
  commits (WORKFLOW.md "Authority from the user's words").
- Branching, staging, force update, merge, and Land each need explicit authority.
- Bypass hooks or checks only with explicit approval of that bypass and risk.

References: read `commit-messages.md`, `branching-and-rebasing.md`,
`pull-requests.md`, or `recovery.md` only for the active operation.
