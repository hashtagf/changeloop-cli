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
# Only exact known spellings take a fast path. The guard lowercases the mode,
# so any other casing ("BLock", "oFF") could mean enforcement there; treating
# an unrecognised spelling as block delegates every call, which is the safe
# direction — the guard, not this prefilter, then decides.
case "${FOUNDATION_GUARDRAIL_MODE:-audit}" in
  off|OFF|Off) exit 0 ;;
  audit|AUDIT|Audit) mode=audit ;;
  *) mode=block ;;
esac

HERE="${0%/*}"
[ "$HERE" = "$0" ] && HERE="."

# Block mode fails closed inside the guard even when the phase is unknown, so
# nothing may be decided here. Delegate before any other test.
if [ "$mode" != "block" ] && [ -z "${FOUNDATION_ACTIVE_PHASE:-}" ]; then
  logs="${CLAUDE_PROJECT_DIR:-$PWD}/.foundation/logs"
  if [ ! -d "$logs" ]; then exit 0; fi
  # Presence, not freshness. Whether a recorded phase is still within the
  # guard's window is policy, and duplicating it here would let the two
  # disagree. Presence can only cause more delegation, never less.
  found=0
  for candidate in "$logs"/*/phase-context.jsonl; do
    if [ -e "$candidate" ]; then found=1; break; fi
  done
  [ "$found" -eq 1 ] || exit 0
fi

exec node "$HERE/phase-mutation-guard.mjs"
