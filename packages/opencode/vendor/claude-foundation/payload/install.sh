#!/usr/bin/env bash
# Install the OpenSpec-native Foundation harness into an existing project.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PATH=""
SOURCE_PATH="$SCRIPT_DIR"
ASSUME_YES=no
DRY_RUN=no

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
info() { printf '▸ %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }

usage() {
  cat <<'EOF'
claude-foundation init [target-path] [options]

Options:
  --source <path>  Foundation source checkout
  --yes, -y        Do not ask for confirmation
  --dry-run        Show files without writing
  --force, -f      Accepted for backward compatibility; managed files refresh
  --help, -h       Show this help

Installs the OpenSpec-native change loop:
  /investigate → /change → /build → /prove → /land

`/dev` remains a compatibility composition of change → build → prove.
Existing `.workflow/` records are preserved as read-only migration sources.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || fail "--source needs a path"; SOURCE_PATH="$2"; shift ;;
    --yes|-y) ASSUME_YES=yes ;;
    --dry-run) DRY_RUN=yes ;;
    --force|-f) : ;;
    --help|-h) usage; exit 0 ;;
    -*) fail "unknown option: $1" ;;
    *) [ -z "$TARGET_PATH" ] || fail "unexpected argument: $1"; TARGET_PATH="$1" ;;
  esac
  shift
done

TARGET_PATH="${TARGET_PATH:-$PWD}"
mkdir -p "$TARGET_PATH"
TARGET_PATH="$(cd "$TARGET_PATH" && pwd)"
SOURCE_PATH="$(cd "$SOURCE_PATH" && pwd)"
[ "$TARGET_PATH" != "$SOURCE_PATH" ] || fail "target cannot be the Foundation source"

for required in \
  .claude/orchestrator.md .claude/commands .claude/harness/foundation.mjs \
  .claude/harness/commands.json \
  .claude/skills .claude/rules .claude/hooks .claude/settings.json \
  openspec/config.yaml openspec/repositories.yaml openspec/schemas \
  foundation.json .foundation/.gitignore .foundation/README.md WORKFLOW.md; do
  [ -e "$SOURCE_PATH/$required" ] || fail "source is missing $required"
done

# Managed product files. Project-owned specs, changes, runtime, and local settings
# are intentionally absent.
MANAGED=(
  ".claude/orchestrator.md"
  ".claude/commands"
  ".claude/harness"
  ".claude/skills"
  ".claude/rules"
  ".claude/hooks"
  "openspec/schemas"
  ".foundation/.gitignore"
  ".foundation/README.md"
  "WORKFLOW.md"
)

# Files written by the phase orchestrator in earlier releases. Exact paths only:
# custom user agents/hooks are never removed.
LEGACY=(
  ".claude/commands/spec.md" ".claude/commands/dev-plan.md"
  ".claude/commands/test-plan.md" ".claude/commands/implement.md"
  ".claude/commands/uxui-plan.md"
  ".claude/agents/pm.md" ".claude/agents/lead.md" ".claude/agents/engineer.md"
  ".claude/agents/qa.md" ".claude/agents/retro.md" ".claude/agents/uxui.md"
  ".claude/agents/team-best-practice-researcher.md"
  ".claude/agents/team-code-reviewer.md"
  ".claude/agents/team-silent-failure-hunter.md"
  ".claude/agents/team-pr-test-analyzer.md"
  ".claude/agents/team-codebase-explorer.md"
  ".claude/agents/team-type-design-analyzer.md"
  ".claude/agents/INDEX.md" ".claude/agents/TEAM.md"
  ".claude/agents/references/pm.md" ".claude/agents/references/lead.md"
  ".claude/agents/references/engineer.md" ".claude/agents/references/qa.md"
  ".claude/hooks/dev-agent-guard.sh" ".claude/hooks/dev-state-mark.sh"
  ".claude/hooks/dev-state-validate.sh" ".claude/hooks/artifact-lint.sh"
  ".claude/orchestrator/references"
  ".claude/skills/fanout-team-agents" ".claude/skills/qa-handoff-note"
  ".claude/skills/brainstorming/references" ".claude/skills/plan-writing/references"
  ".workflow/_templates"
)

info "Install plan"
for rel in "${MANAGED[@]}"; do printf '  ~ %s\n' "$rel"; done
[ -e "$TARGET_PATH/openspec/config.yaml" ] || printf '  + openspec/config.yaml\n'
printf '  ~ .claude/settings.json (merge hooks, preserve user settings)\n'
printf '  ~ CLAUDE.md (managed pointer only)\n'
printf '  ~ AGENTS.md (portable managed pointer only)\n'
for rel in "${LEGACY[@]}"; do
  [ -e "$TARGET_PATH/$rel" ] && printf '  - %s (legacy phase control plane)\n' "$rel"
done

if [ "$DRY_RUN" = yes ]; then ok "dry run complete"; exit 0; fi
if [ "$ASSUME_YES" != yes ]; then
  printf 'Proceed? [y/N] '
  read -r answer || fail "aborted; no input to confirm with, pass --yes to install"
  case "$answer" in y|Y|yes|YES) : ;; *) fail "aborted" ;; esac
fi

MANIFEST_PATH="$TARGET_PATH/.foundation/install-manifest.txt"
NEW_MANIFEST="$(mktemp)"
BACKUP_DIR="$(mktemp -d)"
INSTALL_COMMITTED=no
PROJECT_MUTABLE=(
  ".claude/settings.json"
  ".claude/settings.foundation.json"
  "CLAUDE.md"
  "AGENTS.md"
  "openspec/config.yaml"
  "openspec/repositories.yaml"
  "foundation.json"
)
for rel in "${MANAGED[@]}"; do
  if [ -e "$TARGET_PATH/$rel" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -R "$TARGET_PATH/$rel" "$BACKUP_DIR/$rel"
  fi
done
for rel in "${PROJECT_MUTABLE[@]}"; do
  if [ -e "$TARGET_PATH/$rel" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -R "$TARGET_PATH/$rel" "$BACKUP_DIR/$rel"
  fi
done
[ ! -f "$MANIFEST_PATH" ] || cp "$MANIFEST_PATH" "$BACKUP_DIR/install-manifest.txt"
rollback_install() {
  [ "$INSTALL_COMMITTED" != yes ] || return 0
  for rel in "${MANAGED[@]}"; do
    [ ! -e "$TARGET_PATH/$rel" ] || rm -rf "$TARGET_PATH/$rel"
    if [ -e "$BACKUP_DIR/$rel" ]; then
      mkdir -p "$TARGET_PATH/$(dirname "$rel")"
      cp -R "$BACKUP_DIR/$rel" "$TARGET_PATH/$rel"
    fi
  done
  for rel in "${PROJECT_MUTABLE[@]}"; do
    [ ! -e "$TARGET_PATH/$rel" ] || rm -rf "$TARGET_PATH/$rel"
    if [ -e "$BACKUP_DIR/$rel" ]; then
      mkdir -p "$TARGET_PATH/$(dirname "$rel")"
      cp -R "$BACKUP_DIR/$rel" "$TARGET_PATH/$rel"
    fi
  done
  # A fresh install has no prior manifest to restore, so the one this run wrote
  # would otherwise survive the rollback and claim ownership of files that were
  # just removed.
  if [ -f "$BACKUP_DIR/install-manifest.txt" ]; then
    cp "$BACKUP_DIR/install-manifest.txt" "$MANIFEST_PATH"
  else
    rm -f "$MANIFEST_PATH"
  fi
}
cleanup_install() {
  status=$?
  [ "$status" -eq 0 ] || rollback_install
  rm -f "$NEW_MANIFEST"
  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap cleanup_install EXIT
for rel in "${MANAGED[@]}"; do
  src="$SOURCE_PATH/$rel"
  if [ -d "$src" ]; then
    find "$src" -type f -print | while IFS= read -r file; do
      printf '%s\n' "${file#"$SOURCE_PATH/"}"
    done
  else
    printf '%s\n' "$rel"
  fi
done | LC_ALL=C sort -u > "$NEW_MANIFEST"

# Remove only files previously recorded as Foundation-owned and no longer
# shipped. Never infer ownership from a directory name.
if [ -f "$MANIFEST_PATH" ]; then
  while IFS= read -r old_rel; do
    [ -n "$old_rel" ] || continue
    # Prefix alone is not containment: `.claude/../../../tmp/x` starts with
    # `.claude/` and resolves outside the project, and this list guards a
    # delete. Reject traversal, absolute paths, and backslashes outright.
    case "$old_rel" in
      /*|*..*|*\\*|*$'\n'*) fail "refusing unsafe managed manifest path: $old_rel" ;;
    esac
    case "$old_rel" in
      .claude/*|openspec/schemas/*|.foundation/.gitignore|.foundation/README.md|WORKFLOW.md) ;;
      *) fail "refusing unsafe managed manifest path: $old_rel" ;;
    esac
    if ! grep -qxF "$old_rel" "$NEW_MANIFEST"; then
      [ ! -e "$TARGET_PATH/$old_rel" ] || rm -f "$TARGET_PATH/$old_rel"
    fi
  done < "$MANIFEST_PATH"
  # Removing the files leaves their directories behind, which reads as "the
  # obsolete tree is still installed". Prune only what is now empty, so a
  # directory holding anything of the user's is untouched.
  for root in ".claude" "openspec/schemas"; do
    [ -d "$TARGET_PATH/$root" ] || continue
    find "$TARGET_PATH/$root" -depth -type d -empty -exec rmdir {} + 2>/dev/null || true
  done
fi

for rel in "${MANAGED[@]}"; do
  src="$SOURCE_PATH/$rel"; dst="$TARGET_PATH/$rel"
  mkdir -p "$(dirname "$dst")"
  if [ -d "$src" ]; then
    mkdir -p "$dst"
    cp -R "$src/." "$dst/"
  else
    cp "$src" "$dst"
  fi
done
mkdir -p "$(dirname "$MANIFEST_PATH")"
cp "$NEW_MANIFEST" "$MANIFEST_PATH"

if [ ! -e "$TARGET_PATH/openspec/config.yaml" ]; then
  mkdir -p "$TARGET_PATH/openspec"
  cp "$SOURCE_PATH/openspec/config.yaml" "$TARGET_PATH/openspec/config.yaml"
fi
if [ ! -e "$TARGET_PATH/openspec/repositories.yaml" ]; then
  mkdir -p "$TARGET_PATH/openspec"
  cp "$SOURCE_PATH/openspec/repositories.yaml" "$TARGET_PATH/openspec/repositories.yaml"
fi
if [ ! -e "$TARGET_PATH/foundation.json" ]; then
  cp "$SOURCE_PATH/foundation.json" "$TARGET_PATH/foundation.json"
elif command -v jq >/dev/null 2>&1; then
  if jq -e '.version == 1 and .execution.packetBytes == 65536' \
      "$TARGET_PATH/foundation.json" >/dev/null 2>&1; then
    tmp="$(mktemp)"
    jq '.execution.packetBytes = {
          task: 8192, review: 8192, repository: 12288, global: 16384
        } |
        .execution.planSummaryBytes //= 4096' \
      "$TARGET_PATH/foundation.json" > "$tmp"
    mv "$tmp" "$TARGET_PATH/foundation.json"
    printf '✓ migrated former default packet budget to scoped task/review/repository/global limits\n'
  elif jq -e '.execution.packetBytes | type == "number"' \
      "$TARGET_PATH/foundation.json" >/dev/null 2>&1; then
    printf '⚠ preserving custom numeric execution.packetBytes; use scoped task/review/repository/global limits when ready\n' >&2
  fi
  tmp="$(mktemp)"
  jq --slurpfile src "$SOURCE_PATH/foundation.json" '
    .workflow //= $src[0].workflow |
    .workflow.grounding //= $src[0].workflow.grounding |
    .workflow.reviewCircuit //= $src[0].workflow.reviewCircuit |
    .workflow.reviewPolicy //= $src[0].workflow.reviewPolicy |
    .review //= {} |
    .review.defaultReviewer //= $src[0].review.defaultReviewer |
    if .review.fallbackReviewer == null and .review.independence == "self"
      then .review.fallbackReviewer = $src[0].review.fallbackReviewer
      else . end |
    .review.reviewers //= {} |
    .review.reviewers = ($src[0].review.reviewers + .review.reviewers)
  ' "$TARGET_PATH/foundation.json" > "$tmp"
  mv "$tmp" "$TARGET_PATH/foundation.json"
  printf '✓ installed risk-tiered workflow and configured reviewer defaults; existing explicit review waivers were preserved\n'
else
  printf '⚠ jq unavailable; inspect legacy numeric execution.packetBytes manually\n' >&2
fi

for rel in "${LEGACY[@]}"; do
  [ ! -e "$TARGET_PATH/$rel" ] || rm -rf "$TARGET_PATH/$rel"
done

SETTINGS_SRC="$SOURCE_PATH/.claude/settings.json"
SETTINGS_DST="$TARGET_PATH/.claude/settings.json"
if [ ! -e "$SETTINGS_DST" ]; then
  mkdir -p "$(dirname "$SETTINGS_DST")"
  cp "$SETTINGS_SRC" "$SETTINGS_DST"
elif command -v jq >/dev/null 2>&1; then
  backup="$SETTINGS_DST.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS_DST" "$backup"
  merged="$(jq --slurpfile src "$SETTINGS_SRC" '
    # `upsert` below matches on the command string, so a hook whose command
    # changed reads to it as a new hook and lands *beside* the old one. The
    # phase guard moved from the .mjs entry point to the .sh prefilter that
    # execs it; without retiring the old spelling here an upgraded project would
    # run both on every mutating call — the exact double-fire this step exists
    # to prevent.
    def remove_legacy:
      .hooks //= {} |
      .hooks |= with_entries(
        .value |= map(
          .hooks |= map(select(
            if (.command? | type) == "string"
            then (.command | test("hooks/(dev-agent-guard|dev-state-mark|dev-state-validate|artifact-lint)\\.sh|hooks/phase-mutation-guard\\.mjs")) | not
            else true end
          ))
        ) | .value |= map(select((.hooks | length) > 0))
      );
    # Foundation once shipped these commands unquoted, so a project path with a
    # space word-split and every hook silently failed open. Rewrite the old
    # spelling in place; upserting the quoted one beside it would leave the
    # broken entry running and double-fire the guard.
    def quote_foundation_hooks:
      .hooks //= {} |
      .hooks |= with_entries(
        .value |= map(
          .hooks |= map(
            if (.command | type) == "string" and
               (.command | startswith("${CLAUDE_PROJECT_DIR}/.claude/hooks/"))
            then .command = "\"${CLAUDE_PROJECT_DIR}\"" +
              (.command | ltrimstr("${CLAUDE_PROJECT_DIR}"))
            else . end)
        )
      );
    def upsert($event; $matcher; $hook):
      .hooks //= {} |
      .hooks[$event] //= [] |
      if (.hooks[$event] | any(.matcher == $matcher)) then
        .hooks[$event] |= map(if .matcher == $matcher then
          .hooks = ((.hooks // []) +
            (if (.hooks | any(.command == $hook.command)) then [] else [$hook] end))
          else . end)
      else .hooks[$event] += [{matcher:$matcher,hooks:[$hook]}] end;
    remove_legacy |
    quote_foundation_hooks |
    reduce ($src[0].hooks | to_entries[]) as $event (.;
      reduce ($event.value[]) as $entry (.;
        reduce ($entry.hooks[]) as $hook (.;
          upsert($event.key; $entry.matcher; $hook))))' "$SETTINGS_DST")"
  printf '%s\n' "$merged" > "$SETTINGS_DST"
else
  cp "$SETTINGS_SRC" "$TARGET_PATH/.claude/settings.foundation.json"
  printf '⚠ jq unavailable; merge .claude/settings.foundation.json manually\n' >&2
fi

CLAUDE_DST="$TARGET_PATH/CLAUDE.md"
START="<!-- claude-foundation:change-loop:start -->"
END="<!-- claude-foundation:change-loop:end -->"
BLOCK="$(cat <<'EOF'
<!-- claude-foundation:change-loop:start -->
## Foundation change loop

Use `/investigate` when the problem is unclear, otherwise use `/change`.
The delivery loop is `/change → /build → /prove → /land`; `/dev` is a
compatibility composition that stops after proof.

@.claude/harness/AGENT.md
<!-- claude-foundation:change-loop:end -->
EOF
)"
if [ ! -e "$CLAUDE_DST" ]; then
  printf '# CLAUDE.md\n\n%s\n' "$BLOCK" > "$CLAUDE_DST"
elif grep -qF "$START" "$CLAUDE_DST"; then
  tmp="$(mktemp)"
  block_tmp="$(mktemp)"
  printf '%s\n' "$BLOCK" > "$block_tmp"
  awk -v start="$START" -v end="$END" '
    FNR==NR { replacement=replacement $0 ORS; next }
    index($0,start) { printf "%s", replacement; skip=1; next }
    index($0,end) { skip=0; next }
    !skip { print }
  ' "$block_tmp" "$CLAUDE_DST" > "$tmp"
  rm -f "$block_tmp"
  mv "$tmp" "$CLAUDE_DST"
else
  printf '\n%s\n' "$BLOCK" >> "$CLAUDE_DST"
fi

AGENTS_DST="$TARGET_PATH/AGENTS.md"
AGENTS_START="<!-- claude-foundation:portable-agent:start -->"
AGENTS_END="<!-- claude-foundation:portable-agent:end -->"
AGENTS_BLOCK="$(cat <<'EOF'
<!-- claude-foundation:portable-agent:start -->
## Foundation change loop

Read `.claude/harness/AGENT.md` before Foundation workflow work. Use
`investigate → change → build → prove → land`; start each phase from
`claude-foundation packet <change>`.
<!-- claude-foundation:portable-agent:end -->
EOF
)"
if [ ! -e "$AGENTS_DST" ]; then
  printf '# AGENTS.md\n\n%s\n' "$AGENTS_BLOCK" > "$AGENTS_DST"
elif grep -qF "$AGENTS_START" "$AGENTS_DST"; then
  tmp="$(mktemp)"
  block_tmp="$(mktemp)"
  printf '%s\n' "$AGENTS_BLOCK" > "$block_tmp"
  awk -v start="$AGENTS_START" -v end="$AGENTS_END" '
    FNR==NR { replacement=replacement $0 ORS; next }
    index($0,start) { printf "%s", replacement; skip=1; next }
    index($0,end) { skip=0; next }
    !skip { print }
  ' "$block_tmp" "$AGENTS_DST" > "$tmp"
  rm -f "$block_tmp"
  mv "$tmp" "$AGENTS_DST"
else
  printf '\n%s\n' "$AGENTS_BLOCK" >> "$AGENTS_DST"
fi

if ! command -v node >/dev/null 2>&1; then
  printf '⚠ Node.js >=20.19 is required by OpenSpec and the Foundation harness\n' >&2
elif ! command -v openspec >/dev/null 2>&1; then
  printf '⚠ Install pinned OpenSpec: npm install -g @fission-ai/openspec@1.7.0\n' >&2
fi

if command -v node >/dev/null 2>&1; then
  (cd "$TARGET_PATH" &&
    node .claude/harness/foundation.mjs doctor --stage change >/dev/null) ||
    fail "post-install doctor failed; managed files were rolled back"
fi

INSTALL_COMMITTED=yes
ok "OpenSpec-native Foundation installed at $TARGET_PATH"
printf '  Your product source was not changed; managed workflow files were installed or updated.\n'

# Until these files are committed they are the working tree's dirt, and the loop
# reads dirt as change surface: the harness's own shipped paths then trip its own
# policy triggers, so the first change is asked for accessibility, compatibility,
# and data-migration evidence it cannot produce, and every `sandbox create` falls
# back to a whole-tree copy. Staging makes the commit one command; making the
# commit itself is not an authority an installer holds over someone's repository.
if command -v git >/dev/null 2>&1 &&
   git -C "$TARGET_PATH" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$TARGET_PATH" add -- "${MANAGED[@]}" CLAUDE.md AGENTS.md \
    openspec/config.yaml openspec/repositories.yaml foundation.json \
    .claude/settings.json >/dev/null 2>&1 || true
  if ! git -C "$TARGET_PATH" diff --cached --quiet 2>/dev/null; then
    printf '▸ Setup is complete, but the managed workflow files are only staged.\n'
    printf '  Commit them before the first Foundation change so they are not mistaken for product work:\n'
    printf '    git commit -m "chore: install claude-foundation harness"\n'
    printf '  The loop treats uncommitted files as the change surface, so an\n'
    printf '  uncommitted harness becomes the first change'"'"'s surface.\n'
  fi
fi
printf 'Next: describe the outcome with /change <intent>; the agent handles the workflow details.\n'
