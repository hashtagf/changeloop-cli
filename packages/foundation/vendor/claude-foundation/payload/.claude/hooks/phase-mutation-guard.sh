#!/usr/bin/env sh
# Prefilter for the phase-mutation guard.
#
# The guard runs on every Edit/Write/MultiEdit/NotebookEdit/Bash call. Measured
# on the Foundation repository: `sh -c ':'` is 3ms, `node -e ''` is 44ms, and the
# guard is 53ms — so 44 of its 53ms is interpreter startup and only ~9ms is the
# guard deciding anything. On a stock install with no active change that decision
# is always "nothing to enforce, exit 0", which is ~50ms spent per call to reach
# a conclusion a shell test reaches for 3ms.
#
# This file decides only whether a decision is *needed*. It never reports a
# violation, never reads the event body, and only skips cases the guard itself
# exits on. Every test below is an over-approximation in the safe direction: when
# in doubt, delegate.

set -u

# The fast path uses shell builtins only — no `tr`, no `dirname`, no subshell.
# That keeps it independent of PATH and of process creation entirely, so the
# saving is real rather than one external command traded for another.
#
# Only off takes a fast path. Audit must delegate because the authoritative
# transcript path lives in the PreToolUse event body, not reliably in the
# SessionStart-exported environment of claude -p hook processes.
case "${FOUNDATION_GUARDRAIL_MODE:-auto}" in
  off|OFF|Off) exit 0 ;;
  auto|AUTO|Auto|audit|AUDIT|Audit) mode=delegate ;;
  *) mode=block ;;
esac

HERE="${0%/*}"
[ "$HERE" = "$0" ] && HERE="."

exec node "$HERE/phase-mutation-guard.mjs"
