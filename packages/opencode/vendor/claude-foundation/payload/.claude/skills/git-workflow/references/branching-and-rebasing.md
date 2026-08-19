# Branching and rebasing

The deep dive for principles 1, 4, and 5 of [[git-workflow]] — where a branch starts, how local history gets cleaned up, and how branches stay in sync with the integration branch.

## Table of contents

- [Branch naming and lifetime](#branch-naming-and-lifetime)
- [Trunk-based vs feature branches](#trunk-based-vs-feature-branches)
- [Interactive rebase: the most useful 30 seconds of your day](#interactive-rebase)
- [Fixup commits and autosquash](#fixup-and-autosquash)
- [Rebase vs merge for integration](#rebase-vs-merge)
- [`--force-with-lease`, not `--force`](#force-with-lease)
- [Stacked branches](#stacked-branches)
- [Resolving conflicts during a rebase](#resolving-conflicts)

## Branch naming and lifetime

Names are cheap; consistency compounds. Pick one of these and use it everywhere:

```
<type>/<short-slug>            feat/audit-log, fix/login-redirect
<type>/<ticket>-<slug>         feat/AUTH-482-audit-actor
<author>/<type>/<slug>         flame/feat/audit-log    (only if you have many authors per area)
```

Lifetime targets:
- **≤3 days** for a focused PR. The 99th-percentile cost of a 3-day branch is small; rebases are cheap.
- **≤1 week** for any branch with active work. Past that, the branch is paying rebase tax every day.
- **>1 week** is a smell — either ship a slice now or close the branch and rebuild. Long branches are where bugs hide and reviews die.

Delete merged branches. The branch list is a workspace, not an archive. `git fetch --prune` cleans up stale remote-tracking refs.

## Trunk-based vs feature branches

Two viable styles:

**Trunk-based** — everyone commits directly to `main` (or a short-lived branch that merges within a day). Pros: integration debt is always near zero; feature flags carry incomplete work safely. Cons: requires strong CI, requires feature-flag discipline, requires that `main` is *always* shippable.

**Feature branches** — work happens on a branch, merges via PR. Pros: review gate, isolated CI per branch, easy to drop a feature mid-flight. Cons: branches rot, conflicts accumulate, big PRs are common.

Most teams here run **short-lived feature branches** — a feature branch that lives 1–5 days, integrates daily, ships via PR. It's the conservative default. The `/dev` workflow in this project produces one branch per run; the branch is short-lived by design (one spec, one plan, one PR).

## Interactive rebase

`git rebase -i <base>` opens an editor with one line per commit since `<base>`. You can:

```
pick a1b2c3 first commit
pick d4e5f6 second commit
pick 7a8b9c third commit
```

Change `pick` to:
- `reword` — change the commit message
- `edit` — pause, let you `git commit --amend` mid-rebase
- `squash` (s) — combine with the previous commit, keeping both messages
- `fixup` (f) — combine with the previous commit, discarding this one's message
- `drop` (d) — remove the commit entirely

You can also reorder the lines to reorder commits. The rebase replays them in the new order.

**Use cases:**
- Clean up a messy WIP branch before pushing it for review.
- Squash "fix typo" commits into the real commit they belong to.
- Reword a commit subject that turned out to be misleading.
- Split a giant commit into smaller ones (`edit` it, then `git reset HEAD^` and re-commit in pieces).

**Use it before pushing.** Rebasing already-pushed history is a separate, more careful operation — see [Rebase vs merge](#rebase-vs-merge) and [Force-with-lease](#force-with-lease).

## Fixup and autosquash

The cleanest workflow when you find a flaw in an earlier commit *on the same branch*:

```bash
git add <files>
git commit --fixup=<sha-of-earlier-commit>   # creates a commit titled "fixup! <orig subject>"
# ... continue working, maybe more fixups ...
git rebase -i --autosquash <base>            # auto-arranges the fixups under the right commits
```

The `--autosquash` flag pre-fills the rebase plan so the fixup commits are positioned right after their targets, marked `fixup`. You just save and close — the rebase squashes them in.

Set `git config --global rebase.autoSquash true` so `git rebase -i` always autosquashes; you don't have to remember the flag.

This is dramatically better than `git commit --amend` for anything but the most recent commit: amend rewrites only `HEAD`, while `--fixup` + `--autosquash` lets you fix *any* previous commit on the branch cleanly.

## Rebase vs merge

The two ways to integrate `main` into your branch:

```bash
# Rebase: replay your commits on top of latest main. Linear history.
git fetch origin
git rebase origin/main

# Merge: create a merge commit. Branching history.
git fetch origin
git merge origin/main
```

**Rebase pros:** clean linear log, `git bisect` works perfectly, no merge-commit noise.
**Rebase cons:** rewrites your SHAs (so requires `--force-with-lease` to push); each commit must be conflict-resolved in turn, which can be more work for a long branch with overlapping changes.

**Merge pros:** preserves the literal history of when things happened, no rewriting, one conflict resolution at the end.
**Merge cons:** noisy log full of "Merge branch 'main' into feat/x" commits, bisect has to navigate the graph.

**Picking one:** the team's choice, applied consistently. The `/dev` flow defaults to **rebase onto main** for integrating during the branch's life, and uses the platform's merge strategy (often **squash merge** on GitHub) at PR merge time, so the integration branch stays linear from the outside even if developers used either style on the branch.

The one thing **never** to do: mix the two on the same branch. Pick rebase or merge per branch and stick with it. Mixing produces a graph nobody can read.

## `--force-with-lease`

`git push --force` is dangerous: it unconditionally overwrites the remote with your local state. If a teammate pushed something while you were rebasing — say, a fix to a review comment on a PR you have open — `--force` deletes their commit. They notice tomorrow when they `git pull` and the commit is gone.

`git push --force-with-lease` is the safe alternative: it pushes only if the remote is still at the SHA you last saw. If someone pushed in the meantime, the push is refused, you `git fetch`, integrate their commit, and retry. The cost is one extra command in the rare case of a collision; the benefit is never overwriting a teammate's work.

```bash
# Default to --force-with-lease everywhere
git config --global alias.fpush 'push --force-with-lease'
```

And the absolute rule: **never** force-push to `main` (or any protected/long-lived integration branch). If a bad commit landed, add a `git revert` commit. The history is the truth; "the truth got worse for ten minutes" is preferable to "the truth got rewritten under everyone's feet."

## Stacked branches

A stack: B is branched off A, A is branched off `main`. Each is its own PR, and B merges only after A merges. Useful for sequencing dependent work into reviewable chunks instead of one mega-PR.

**Rebase order matters:** rebase from the bottom up.

```bash
git switch A
git fetch origin && git rebase origin/main
git switch B
git rebase --onto A <old-base-of-B> B
```

If you rebase B before A, B is now on top of a SHA of A that A itself no longer has, and you'll see phantom conflicts.

Tools that help: `git rebase --update-refs` (rebases an entire stack at once on modern git), or third-party tools like `git-spr`, `ghstack`, `git-branchless`.

## Resolving conflicts

During a rebase, when a commit doesn't apply cleanly, git pauses with conflict markers in the affected files. The flow:

1. Inspect: `git status` shows which files conflict. Open them.
2. Resolve: find the `<<<<<<<` / `=======` / `>>>>>>>` markers. The text between `<<<<<<<` and `=======` is *yours* in the sense of "the commit being replayed"; below `=======` is the existing state. (Note: during rebase, "ours" and "theirs" are reversed from `merge` — `ours` is `main`, `theirs` is your commit.) Pick the right code; remove the markers.
3. Stage: `git add <file>`.
4. Continue: `git rebase --continue`. Git replays the next commit.
5. If you regret it: `git rebase --abort` puts you back where you started.

**Semantic conflicts** — the merge resolves syntactically but the meaning is wrong: e.g., `main` renamed a function and your commit added a new call to the old name. Git won't catch this. Run the test suite after every non-trivial rebase. A clean merge is not a working merge.

If a rebase becomes genuinely impossible (overlapping rewrites of the same lines, refactored away by both sides), `git rebase --abort`, branch a "rescue" copy of your work (`git switch -c rescue/<name>`), and do a merge instead. Rebase is the default, not a religion.
