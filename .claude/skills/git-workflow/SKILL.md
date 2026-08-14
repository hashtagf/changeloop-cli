---
name: git-workflow
description: "Safely perform Git or pull-request mutations: branch, stage, commit, amend, rebase, merge, force update, destructive cleanup, or PR creation/update. Covers fresh bases, atomic commits, intent-carrying messages, shared-history safety, reviewable PRs, and reflog-first recovery. Skip read-only status/log/diff/show. Never treat this skill as authority to commit, push, open a PR, or Land without the user's explicit authorization."
---

# Git workflow

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
- Branching/staging/local commits require the user's request or workflow phase.
- Push, force update, PR creation, merge, and Foundation Land each require the
  applicable explicit authority; one does not imply another.
- Never bypass hooks or checks unless the user explicitly approves the specific
  bypass and its risk.

References: read `commit-messages.md`, `branching-and-rebasing.md`,
`pull-requests.md`, or `recovery.md` only for the active operation.
