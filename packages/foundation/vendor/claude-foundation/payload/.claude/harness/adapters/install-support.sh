#!/usr/bin/env bash

# Shared adapter-install support. Callers define adapter_scope_root(), mapping
# the manifest's small scope vocabulary to an absolute root they own.

adapter_manifest_init() {
  ADAPTER_MANIFEST_HOST="$1"
  ADAPTER_MANIFEST_TARGET="$2"
  ADAPTER_MANIFEST_DIR="$ADAPTER_MANIFEST_TARGET/.foundation/adapter-manifests"
  ADAPTER_MANIFEST_PATH="$ADAPTER_MANIFEST_DIR/$ADAPTER_MANIFEST_HOST.txt"
  ADAPTER_MANIFEST_NEXT="$(mktemp)"
  ADAPTER_MANIFEST_PRESERVE="$(mktemp)"
  ADAPTER_MANIFEST_PRIOR="$(mktemp)"
  mkdir -p "$ADAPTER_MANIFEST_DIR"
  if [ -f "$ADAPTER_MANIFEST_PATH" ]; then
    ADAPTER_MANIFEST_MIGRATING=no
    cp "$ADAPTER_MANIFEST_PATH" "$ADAPTER_MANIFEST_PRIOR"
  else
    ADAPTER_MANIFEST_MIGRATING=yes
  fi
  trap adapter_manifest_cleanup EXIT
  # Validate all deletion authority before the adapter writes anything.
  while IFS="$(printf '\t')" read -r scope rel; do
    [ -n "$scope" ] || continue
    adapter_manifest_validate_entry "$scope" "$rel"
  done < "$ADAPTER_MANIFEST_PRIOR"
}

adapter_manifest_validate_entry() {
  scope="$1"
  rel="$2"
  case "$scope" in project|codex-home) ;; *) fail "refusing unknown adapter manifest scope: $scope" ;; esac
  case "$rel" in
    ""|/*|*..*|*\\*|*$'\n'*) fail "refusing unsafe adapter manifest path: $scope:$rel" ;;
  esac
  case "$ADAPTER_MANIFEST_HOST:$scope:$rel" in
    cursor:project:.cursor/commands/*|cursor:project:.cursor/rules/*|cursor:project:.cursor/orchestrator.md|\
    cursor:project:.cursor/agents/pm.md|cursor:project:.cursor/agents/lead.md|\
    cursor:project:.cursor/agents/engineer.md|cursor:project:.cursor/agents/qa.md|\
    cursor:project:.cursor/agents/retro.md|cursor:project:.cursor/agents/uxui.md|\
    cursor:project:.cursor/agents/team-best-practice-researcher.md|\
    cursor:project:.cursor/agents/team-code-reviewer.md|\
    cursor:project:.cursor/agents/team-silent-failure-hunter.md|\
    cursor:project:.cursor/agents/team-pr-test-analyzer.md|\
    cursor:project:.cursor/agents/team-codebase-explorer.md|\
    cursor:project:.cursor/agents/team-type-design-analyzer.md) ;;
    opencode:project:.opencode/commands/*|opencode:project:.opencode/plugins/foundation.js) ;;
    codex:project:.agents/skills/*|codex:project:.codex/foundation-rules|codex:project:.codex/hooks) ;;
    codex:codex-home:prompts/*) ;;
    *) fail "refusing adapter manifest path outside $ADAPTER_MANIFEST_HOST ownership: $scope:$rel" ;;
  esac
  adapter_scope_root "$scope" >/dev/null ||
    fail "adapter manifest scope is unavailable: $scope"
}

adapter_manifest_owned() {
  scope="$1"
  rel="$2"
  grep -qxF "$(printf '%s\t%s' "$scope" "$rel")" "$ADAPTER_MANIFEST_PRIOR"
}

adapter_manifest_record() {
  adapter_manifest_validate_entry "$1" "$2"
  printf '%s\t%s\n' "$1" "$2" >> "$ADAPTER_MANIFEST_NEXT"
}

adapter_manifest_relinquish() {
  adapter_manifest_validate_entry "$1" "$2"
  printf '%s\t%s\n' "$1" "$2" >> "$ADAPTER_MANIFEST_PRESERVE"
}

adapter_manifest_seed_prior() {
  [ "$ADAPTER_MANIFEST_MIGRATING" = yes ] || return 0
  adapter_manifest_validate_entry "$1" "$2"
  printf '%s\t%s\n' "$1" "$2" >> "$ADAPTER_MANIFEST_PRIOR"
}

adapter_manifest_may_write() {
  scope="$1"
  rel="$2"
  dst="$3"
  [ ! -e "$dst" ] && [ ! -L "$dst" ] ||
    adapter_manifest_owned "$scope" "$rel" ||
    { [ "$ADAPTER_MANIFEST_MIGRATING" = yes ] && adapter_legacy_owned "$scope" "$rel"; }
}

adapter_manifest_prepare_file() {
  dst="$1"
  if [ -d "$dst" ] && [ ! -L "$dst" ]; then
    fail "owned adapter file path became a directory; move it before reinstalling: $dst"
  fi
  [ ! -L "$dst" ] || rm -f "$dst"
}

adapter_manifest_prepare_replacement() {
  adapter_manifest_prepare_file "$1"
  [ ! -e "$1" ] || rm -f "$1"
}

adapter_manifest_cleanup() {
  [ -z "${ADAPTER_MANIFEST_NEXT:-}" ] || rm -f "$ADAPTER_MANIFEST_NEXT"
  [ -z "${ADAPTER_MANIFEST_PRESERVE:-}" ] || rm -f "$ADAPTER_MANIFEST_PRESERVE"
  [ -z "${ADAPTER_MANIFEST_PRIOR:-}" ] || rm -f "$ADAPTER_MANIFEST_PRIOR"
}

adapter_manifest_finish() {
  LC_ALL=C sort -u "$ADAPTER_MANIFEST_NEXT" -o "$ADAPTER_MANIFEST_NEXT"
  if [ -s "$ADAPTER_MANIFEST_PRIOR" ]; then
    while IFS="$(printf '\t')" read -r scope rel; do
      [ -n "$scope" ] || continue
      grep -qxF "$(printf '%s\t%s' "$scope" "$rel")" "$ADAPTER_MANIFEST_NEXT" && continue
      grep -qxF "$(printf '%s\t%s' "$scope" "$rel")" "$ADAPTER_MANIFEST_PRESERVE" && continue
      base="$(adapter_scope_root "$scope")"
      dst="$base/$rel"
      if [ -d "$dst" ] && [ ! -L "$dst" ]; then
        fail "owned adapter file path became a directory; move it before reinstalling: $dst"
      fi
      [ ! -e "$dst" ] && [ ! -L "$dst" ] || rm -f "$dst"
    done < "$ADAPTER_MANIFEST_PRIOR"
  fi
  mv "$ADAPTER_MANIFEST_NEXT" "$ADAPTER_MANIFEST_PATH"
  ADAPTER_MANIFEST_NEXT=""
  adapter_manifest_cleanup
  ADAPTER_MANIFEST_PRESERVE=""
  ADAPTER_MANIFEST_PRIOR=""
  trap - EXIT
}

adapter_capability_summary() {
  contract="$1"
  host="$2"
  node -e '
    const fs = require("fs");
    const [contract, host] = process.argv.slice(1);
    const row = JSON.parse(fs.readFileSync(contract, "utf8")).hosts?.[host];
    if (!row) process.exit(2);
    const guards = row.liveMutationGuards;
    console.log(`  capabilities:  native dispatch ${row.nativeDispatch}; live mutation guards ${guards.coverage}`);
    console.log(`                 phase ${guards.phase}; secrets ${guards.secrets}; lint ${guards.lint}; session digest ${guards.sessionDigest}`);
    console.log(`  enforcement:   ${row.finalEnforcement}`);
  ' "$contract" "$host" || fail "invalid host capability contract for $host"
}
