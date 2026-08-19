#!/usr/bin/env bash
# PreToolUse guard that blocks `git commit` while you're on main/master.
#
# OPT-IN — NOT wired into .claude/settings.json. To enable, add it under
# PreToolUse/Bash there (see CLAUDE.md > hooks). Shipped as-is so adopting
# repos can turn it on with one settings edit.
#
# The branch-first rule is otherwise advisory: a slip lands unreviewed work
# straight on the default branch. This hook turns that slip into an immediate,
# self-explanatory block. It fires only on a Bash event whose command is a
# `git commit` AND whose current branch is `main` or `master`; every other
# command, and every commit on a feature branch, passes untouched.
#
# I/O convention (same as protect-secrets.sh / dev-agent-guard.sh):
#   - read the tool-event JSON from stdin, parse with jq;
#   - to BLOCK: print {"decision":"block","reason":...} to stdout, exit 0;
#   - to ALLOW: print nothing, exit 0.
#
# Safety posture (this runs on EVERY Bash call, so it must be cheap and safe):
#   - Fail OPEN. Missing jq, an unparseable payload, a non-Bash event, a
#     detached HEAD, or any failure to read the current branch all ALLOW the
#     command. A guard that blocks on a broken environment is worse than the
#     slip it prevents (it would brick commits in worktrees, rebases, and CI).
#   - Never execute any part of the inspected command. The only command this
#     hook runs is `git symbolic-ref` to read the CURRENT branch — it never
#     evaluates the user's command string.
#   - Dequote the command before verb-matching (technique borrowed from
#     protect-secrets.sh) so a `git commit` substring inside a commit-message
#     body or an echo is not mistaken for a real commit.
#   - Escape hatch: ALLOW_MAIN_COMMIT=1 in the environment skips the block,
#     so an intentional commit on main (an initial scaffold) is still possible
#     without disabling the hook.

set -uo pipefail

# ---------------------------------------------------------------------------
# is_git_commit CMD  ->  exit 0 if CMD is a real git invocation that writes a
# commit on the current branch (commit, merge, cherry-pick, revert, am, rebase,
# or a non-ff pull).
# Dequotes first (so a commit-message body can't false-trigger), then splits
# into simple-command segments and judges each on its command word: the word
# must be `git` (after skipping VAR=val assignments, wrapper prefixes, and
# git's own global flags) and the first non-flag git subcommand must be
# one of the commit-writing verbs.
# ---------------------------------------------------------------------------
is_git_commit() {
  local cmd="$1"
  [ -n "$cmd" ] || return 1

  # Cheap pre-filter: none of the commit-writing verbs present means no match.
  case "$cmd" in
    *commit*|*merge*|*cherry-pick*|*revert*|*\ am\ *|*rebase*|*pull*) ;;
    *) return 1 ;;
  esac

  # (1) Drop the contents of quoted spans so `git commit` text inside a
  # message body / echo argument is never read as a real invocation. Portable
  # char state machine, same as protect-secrets.sh (handles multi-line input).
  local dequoted
  dequoted="$(printf '%s' "$cmd" | awk '
    BEGIN { RS = "\0" }
    {
      n = length($0); inq = 0; q = ""
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (inq)            { if (c == q) inq = 0; printf " "; continue }
        if (c == "\47" || c == "\"") { inq = 1; q = c; printf " "; continue }
        printf "%s", c
      }
    }')"

  # (2) Split into simple-command segments on shell separators.
  local segments
  segments="$(printf '%s' "$dequoted" | tr '|;&`()\n' '\n\n\n\n\n\n\n')"

  while IFS= read -r seg; do
    [ -n "$seg" ] || continue
    # Word-split on whitespace only. Unlike protect-secrets.sh we match a VERB,
    # not a filename, so we must NOT split on `=` — that would break the
    # `git -c key=val commit` form (the `-c` value must stay one token so the
    # global-flag skip below can consume it).
    # shellcheck disable=SC2086 -- intentional word-splitting
    set -- $seg
    [ "$#" -gt 0 ] || continue

    # Resolve the command word: skip leading VAR=value assignments and
    # harmless wrapper prefixes.
    while [ "$#" -gt 0 ]; do
      case "$1" in
        *=*) shift ;;
        sudo|command|env|nice|nohup|time|xargs|exec|builtin|then|do|\\) shift ;;
        *) break ;;
      esac
    done
    [ "$#" -gt 0 ] || continue

    # The command word must be git.
    [ "$1" = "git" ] || continue
    shift

    # Skip git's global flags to reach the subcommand. Flags that take a
    # value (-C <path>, -c <cfg>, --git-dir <d>, …) consume the next token.
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -C|-c|--git-dir|--work-tree|--namespace|--exec-path) shift 2 2>/dev/null || shift; continue ;;
        --exec-path=*|--git-dir=*|--work-tree=*|--namespace=*|-p|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs) shift; continue ;;
        -*) shift; continue ;;
        *) break ;;
      esac
    done
    [ "$#" -gt 0 ] || continue

    # First non-flag subcommand: does it create a commit on the current branch?
    # `commit` is not the only one — a merge on main is the most common form of
    # the slip this hook exists to catch, and cherry-pick, revert, am, rebase
    # and a non-ff pull all write commits just as directly.
    case "$1" in
      commit|merge|cherry-pick|revert|am|rebase|pull) return 0 ;;
    esac
  done <<EOF
$segments
EOF

  return 1
}

# ---------------------------------------------------------------------------
# on_default_branch  ->  exit 0 if the current branch is main/master and the
# escape hatch is unset. Fails OPEN: any inability to read the branch returns
# 1 (= "not on a blocked branch" = allow).
# ---------------------------------------------------------------------------
on_default_branch() {
  [ "${ALLOW_MAIN_COMMIT:-}" = "1" ] && return 1

  # symbolic-ref reports the branch even on an UNBORN branch (a fresh repo with
  # no commits yet) — where `git rev-parse --abbrev-ref HEAD` errors out. It
  # fails (non-zero) on a detached HEAD or outside a repo, so the `|| return 1`
  # is the fail-open path for both.
  local branch
  branch="$(git symbolic-ref --short -q HEAD 2>/dev/null)" || return 1
  case "$branch" in
    main|master) return 0 ;;
    *) return 1 ;;
  esac
}

block() {
  jq -n --arg reason "$1" '{decision: "block", reason: $reason}'
  exit 0
}

main() {
  # jq is the only hard dependency. Fail open if it's absent — a missing
  # toolchain on some machine must not brick every commit in the session.
  command -v jq >/dev/null 2>&1 || exit 0

  local input tool_name cmd
  input="$(cat)"

  tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')" || exit 0
  [ "$tool_name" = "Bash" ] || exit 0

  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
  [ -n "$cmd" ] || exit 0

  if is_git_commit "$cmd" && on_default_branch; then
    local branch
    branch="$(git symbolic-ref --short -q HEAD 2>/dev/null || printf 'main')"
    block "COMMIT BLOCKED: the current branch is \"$branch\", so this would write directly to the default branch. Your files are unchanged. Create a feature branch and retry. Only use ALLOW_MAIN_COMMIT=1 after the user explicitly authorizes a direct default-branch commit."
  fi

  exit 0
}

# ---------------------------------------------------------------------------
# --self-test: prove BOTH paths against a throwaway git repo.
#   case A — a `git commit` on `main` is BLOCKED (stdout carries decision:block)
#   case B — a `git commit` on a feature branch is ALLOWED (stdout empty)
# Exits 0 only if both expectations hold; 1 (with a FAIL line) otherwise.
# ---------------------------------------------------------------------------
run_self_test() {
  command -v jq >/dev/null 2>&1 || { echo "FAIL: jq not installed — cannot self-test"; return 1; }
  local self tmp rc=0 out
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp="$(mktemp -d)" || { echo "FAIL: mktemp failed"; return 1; }
  trap 'rm -rf "$tmp"' RETURN

  git init -q "$tmp" >/dev/null 2>&1
  git -C "$tmp" config user.email t@t
  git -C "$tmp" config user.name t
  # Normalise the default branch to "main" across git versions, then seed an
  # initial commit so branches are BORN — an unborn branch makes `checkout main`
  # after `checkout -b feat/test` silently fail and skews later cases.
  git -C "$tmp" symbolic-ref HEAD refs/heads/main 2>/dev/null || true
  git -C "$tmp" commit -q --allow-empty -m seed 2>/dev/null

  local event='{"tool_name":"Bash","tool_input":{"command":"git commit -m \"x\""}}'

  # case A: on main → expect block
  out="$(cd "$tmp" && printf '%s' "$event" | bash "$self")"
  if printf '%s' "$out" | jq -e '.decision == "block"' >/dev/null 2>&1; then
    echo "PASS: git commit on main is blocked"
  else
    echo "FAIL: git commit on main was NOT blocked (got: ${out:-<empty>})"; rc=1
  fi

  # case B: on a feature branch → expect allow (empty stdout)
  git -C "$tmp" checkout -q -b feat/test 2>/dev/null
  out="$(cd "$tmp" && printf '%s' "$event" | bash "$self")"
  if [ -z "$out" ]; then
    echo "PASS: git commit on feat/test is allowed"
  else
    echo "FAIL: git commit on feat/test was blocked (got: $out)"; rc=1
  fi

  git -C "$tmp" checkout -q main 2>/dev/null

  # Every verb that writes a commit, not just `commit`: a merge on main is the
  # most common form of this slip.
  local verb verbevent
  for verb in merge cherry-pick revert am rebase pull; do
    verbevent="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git $verb other\"}}"
    out="$(cd "$tmp" && printf '%s' "$verbevent" | bash "$self")"
    if printf '%s' "$out" | jq -e '.decision == "block"' >/dev/null 2>&1; then
      echo "PASS: git $verb on main is blocked"
    else
      echo "FAIL: git $verb on main was NOT blocked (got: ${out:-<empty>})"; rc=1
    fi
  done

  # boundary: a non-commit command on main is allowed (AC2 boundary)
  local statusevent='{"tool_name":"Bash","tool_input":{"command":"git status"}}'
  out="$(cd "$tmp" && printf '%s' "$statusevent" | bash "$self")"
  if [ -z "$out" ]; then
    echo "PASS: git status on main is allowed"
  else
    echo "FAIL: git status on main was blocked (got: $out)"; rc=1
  fi

  # boundary: the global-flag form `git -c k=v commit` must still be caught
  # on main (a real bypass if missed) — AC1.
  local cfgevent='{"tool_name":"Bash","tool_input":{"command":"git -c user.name=z commit -m x"}}'
  out="$(cd "$tmp" && printf '%s' "$cfgevent" | bash "$self")"
  if printf '%s' "$out" | jq -e '.decision == "block"' >/dev/null 2>&1; then
    echo "PASS: git -c k=v commit on main is blocked"
  else
    echo "FAIL: git -c k=v commit on main slipped through (got: ${out:-<empty>})"; rc=1
  fi

  # boundary: a `git commit` substring inside a quoted argument is NOT a real
  # commit and must be allowed — the dequote pass (AC1 boundary).
  local quotedevent='{"tool_name":"Bash","tool_input":{"command":"echo \"remember to git commit\""}}'
  out="$(cd "$tmp" && printf '%s' "$quotedevent" | bash "$self")"
  if [ -z "$out" ]; then
    echo "PASS: 'git commit' inside a quoted string is allowed"
  else
    echo "FAIL: quoted 'git commit' false-triggered (got: $out)"; rc=1
  fi

  return $rc
}

# --- dispatch -------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  run_self_test
  exit $?
fi

main
