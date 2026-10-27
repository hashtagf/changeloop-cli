#!/usr/bin/env bash

# A writable alias also makes backup/rollback ownership ambiguous. Preserve it
# and require a real destination instead of following or silently replacing it.
# The caller explicitly selects the root (which may itself resolve via a link).
install_assert_destination() {
  local root="$1" rel="$2" allow_leaf_link="${3:-no}" part current remainder
  case "$rel" in
    ""|/*|*\\*|*$'\n'*|..|../*|*/../*|*/..) fail "refusing unsafe install path: $rel" ;;
  esac
  current="$root"
  remainder="$rel"
  while [ -n "$remainder" ]; do
    part="${remainder%%/*}"
    if [ "$part" = "$remainder" ]; then remainder=""; else remainder="${remainder#*/}"; fi
    [ -n "$part" ] && [ "$part" != . ] || fail "refusing unsafe install path: $rel"
    current="$current/$part"
    if [ -L "$current" ]; then
      [ "$allow_leaf_link" = yes ] && [ -z "$remainder" ] && return 0
      fail "install destination traverses a symlink: $current -> $(readlink "$current"); preserve this link and choose a real installation directory, or explicitly relocate the shared configuration before retrying"
    fi
  done
}
