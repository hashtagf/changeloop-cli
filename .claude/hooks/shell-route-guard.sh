#!/usr/bin/env sh
# Off is decided by the shell so a disabled guide costs no interpreter start.
case "${FOUNDATION_GUARDRAIL_MODE:-auto}" in
  off|OFF|Off) exit 0 ;;
esac
command -v node >/dev/null 2>&1 || exit 0
HERE="${0%/*}"
[ "$HERE" = "$0" ] && HERE="."
exec node "$HERE/shell-route-guard.mjs"
