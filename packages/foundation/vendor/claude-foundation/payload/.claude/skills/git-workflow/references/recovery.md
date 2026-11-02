# Recovery

The deep dive for principle 7 of [[git-workflow]] — git almost never loses your work, but a panicked second destructive command often does. This is the playbook for the most common "oh no" situations and the reversible alternatives to the destructive moves.

## Table of contents

- [The first move: stop](#stop)
- [`git reflog` — the 90-day safety net](#reflog)
- [`git fsck --lost-found` — for uncommitted disasters](#fsck)
- [Recovery recipes](#recipes)
  - [Lost commits after `git reset --hard`](#reset-hard)
  - [Bad rebase, want to undo](#bad-rebase)
  - [Force-pushed over my own work](#force-push-self)
  - [Force-pushed over a teammate's work](#force-push-team)
  - [Deleted a branch I needed](#deleted-branch)
  - [Lost a stash](#lost-stash)
  - [Detached HEAD work that "disappeared"](#detached-head)
  - [Committed to the wrong branch](#wrong-branch)
  - [Committed a secret](#committed-secret)
  - [`git add`-staged work I never committed](#staged-uncommitted)
- [Reversible alternatives — habits to build](#reversible-alternatives)

## Stop

The single most important move when you suspect you've lost work: **stop running destructive commands.**

The work is almost always still there. What loses it for real is the *second* destructive command, fired in a panic. Reach for `git status`, `git reflog`, `git log --all`, `git fsck` — not for `--hard`, `--force`, `clean -fd`, `branch -D`.

If you're not sure what state you're in: `git status` first, `git reflog` second, *then* decide.

## Reflog

`git reflog` is git's local journal of every position `HEAD` has been in for the last ~90 days (configurable via `gc.reflogExpire`). It survives rebases, resets, branch deletions, force-pushes — everything except a manual `git reflog expire` or `gc --prune=now`.

```bash
git reflog
# d4e5f6 HEAD@{0}: reset: moving to HEAD~5
# a1b2c3 HEAD@{1}: commit: fix(audit): default actor to system
# 9b8a7c HEAD@{2}: commit: feat(audit): record user_id
# ...
```

To recover, point a new branch at the SHA you want back:

```bash
git switch -c rescue/audit a1b2c3
```

You can also reflog specific branches (`git reflog feat/audit-log`) — useful when `HEAD`'s reflog is noisy.

## fsck

`git fsck --lost-found` finds dangling objects — commits, trees, blobs — that no ref points at. Useful when even reflog comes up empty (e.g., for objects from `git add` that were never committed; reflog only tracks commits).

```bash
git fsck --lost-found
# dangling commit a1b2c3...
# dangling blob d4e5f6...

# Inspect:
git show a1b2c3
git show d4e5f6     # shows the blob's content

# Recover the blob's content:
git show d4e5f6 > recovered-file.txt
```

This finds work that you `git add`-ed but never committed, then lost via a `reset --hard` or `checkout --`.

## Recipes

### Lost commits after `git reset --hard`

```bash
git reflog                          # find the SHA before the reset
git reset --hard <sha-before>       # or:
git switch -c rescue <sha-before>   # safer: branch first, inspect, then choose
```

### Bad rebase, want to undo

```bash
# Easiest: while the rebase is still running
git rebase --abort

# After the rebase has "completed" but the result is wrong
git reflog                          # find HEAD@{N} where N is just before "rebase finished"
git reset --hard HEAD@{N}           # or git switch -c rescue HEAD@{N} first
```

### Force-pushed over my own work

The local copy still has the old SHAs in reflog. The remote also has them in *its* reflog if you have access (GitHub: contact support; GitLab: admin-only). For most cases:

```bash
git reflog                          # find the SHA that was overwritten
git switch -c rescue <sha>
git push --force-with-lease origin rescue
# Now choose: cherry-pick the lost commits onto current branch, or replace the current branch.
```

### Force-pushed over a teammate's work

The teammate's local clone *still has* the SHAs of their lost commit, in their reflog. The recovery path is: ask the teammate to push their commit back from their local reflog. They run:

```bash
git reflog                          # find their lost commit's SHA
git push origin <sha>:refs/heads/recovered
```

This is also a useful reminder that **`--force-with-lease`** would have prevented this: it would have refused the push because the remote SHA didn't match what your clone last saw.

### Deleted a branch I needed

```bash
git reflog                          # the branch tip's SHA is in HEAD's reflog
                                    # (or in the branch's own reflog if it still exists)
# If you have the SHA:
git switch -c recovered-branch <sha>

# If reflog has been wiped:
git fsck --lost-found
# Look for "dangling commit" lines; git show <sha> to identify the right one.
```

### Lost a stash

`git stash drop` clears the stash, but the underlying commit object isn't garbage-collected immediately.

```bash
git fsck --unreachable | grep commit
# For each candidate:
git show <sha>     # is this the stash you lost? stashes have a recognizable shape (two-parent merge commit)

# When you find it:
git stash apply <sha>
```

### Detached HEAD work that "disappeared"

You checked out a SHA, made some commits, then checked out a branch — and now `git log` doesn't show them.

```bash
git reflog                          # the detached-HEAD commits are there
git switch -c rescue <sha-of-last-detached-commit>
```

### Committed to the wrong branch

You committed to `main` what should have been on `feat/audit-log`.

```bash
# On main, with the unwanted commit at HEAD:
git switch -c feat/audit-log          # move to the right branch, keeping the commit
git switch main
git reset --hard origin/main          # remove the commit from main (it's safe on the new branch)
```

If `main` had already been pushed with the wrong commit and others have pulled, *don't* `--force` to revert; add a `git revert` commit instead.

### Committed a secret

You committed a `.env`, an API key, a private cert.

**First:** treat the secret as *already leaked*, because it is — anyone who ever cloned the repo has it. Rotate the secret *now*. Don't wait to clean the history first.

**Then:** remove from history.

```bash
# For recent commits only, force-push is acceptable (coordinate with the team):
git rebase -i <commit-before-the-leak>   # drop the offending commit, or edit it to remove the file
git push --force-with-lease

# For deep history or many commits, use git-filter-repo (preferred over filter-branch):
git filter-repo --path .env --invert-paths
git push --force-with-lease --all
```

Add the file to `.gitignore` and double-check with `git ls-files | grep -E '(.env|.pem|.key)'` before any future commit.

### Staged uncommitted work I never committed

You `git add`-ed a file, then `git checkout -- <file>` blew it away (or `git reset --hard` did).

```bash
git fsck --lost-found
# Find the dangling blob whose content matches your work
git show <blob-sha> > recovered.txt
```

Blobs aren't garbage-collected for ~2 weeks by default, so this works for a while after the fact.

## Reversible alternatives

Habits that prevent the recovery scenarios above:

| Tempting destructive command | Safer alternative |
|---|---|
| `git reset --hard <ref>` | `git switch -c backup` first; *then* reset on the original branch |
| `git push --force` | `git push --force-with-lease` |
| `git rebase main` (on a long branch) | `git switch -c backup`, *then* rebase. If it goes badly, `git rebase --abort` and worst case `git switch backup`. |
| `git checkout -- <file>` to discard uncommitted changes | `git stash` instead — it keeps them recoverable. `stash drop` later if you really don't want them. |
| `git clean -fd` | `git clean -fdn` first (the `-n` is dry-run); confirm the list; then `-fd`. |
| `git branch -D <name>` | `git switch -c archive/<name> <name>` first if you might want it back. |
| `git commit --amend` (on a pushed commit) | Don't — add a follow-up commit instead. The amend rewrites SHAs. |
| `git rebase -i` (on a pushed branch shared with others) | Don't, or coordinate explicitly. Squash on merge instead. |

The pattern is the same in all of them: **branch first, destroy second**. Branches are free; SHAs in the reflog are free; the 30 seconds you spend making a backup is the 30 seconds that turns a "oh no" into a "huh, OK."

The mental check before any destructive command: *if I'm wrong about what this does, what gets me back?* If the answer is "the reflog" — proceed (and double-check the reflog isn't about to expire). If the answer is "the teammate's local clone" — stop, branch a backup, then proceed. If the answer is "nothing" — stop entirely. There's a reversible alternative; find it.
