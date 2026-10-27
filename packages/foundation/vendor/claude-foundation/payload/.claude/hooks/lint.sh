#!/usr/bin/env bash
# Lint dispatcher hook for Claude Code PostToolUse.
#
# Reads the tool-event JSON from stdin, looks at tool_input.file_path,
# picks a linter from the extension, and runs it. On a real lint failure
# this exits 2 — Claude Code feeds the captured stderr back to the model
# so it can self-correct on the next turn.
#
# Linters are optional. If none is installed for a language, the hook
# exits 0 silently (it should never block an edit on a machine that
# simply doesn't have the toolchain).
#
# Auto-fix is intentionally OFF. We want Claude to see the diagnostics
# and fix them in-conversation, not have files mutate behind its back.
#
# The edit hook is the hot loop. By default it runs only near-zero-startup
# deterministic checks (currently gofmt); language-server linters, project lint,
# type checks, and static analysis run once in the workflow Ship Gate.
# Set CLAUDE_EDIT_LINT=1 for file lint after every edit, or
# CLAUDE_EDIT_FULL_CHECKS=1 for the complete legacy behavior.

set -uo pipefail

# jq is the only hard dependency. Fail open if it's not installed.
command -v jq >/dev/null 2>&1 || exit 0

EVENT_JSON="$(cat)"
FILE_PATH="$(printf '%s' "$EVENT_JSON" | jq -r '.tool_input.file_path // empty')"

[ -n "$FILE_PATH" ] || exit 0
[ -f "$FILE_PATH" ] || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
FULL_CHECKS="${CLAUDE_EDIT_FULL_CHECKS:-0}"
EDIT_LINT="${CLAUDE_EDIT_LINT:-0}"
[ "$FULL_CHECKS" = "1" ] && EDIT_LINT=1

# Only lint files inside the project tree.
case "$FILE_PATH" in
  "$PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

have() { command -v "$1" >/dev/null 2>&1; }

# Run a linter. On non-zero exit, emit a labeled report to stderr and
# exit 2 so Claude Code surfaces it back to the model.
run_linter() {
  local label="$1"; shift
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '── %s: %s ──\n%s\n' "$label" "$FILE_PATH" "$out" >&2
    exit 2
  fi
}

# Prefer a project-local node binary over the global one — most JS/TS
# repos pin their linter version in node_modules.
node_bin() {
  local name="$1"
  if [ -x "$PROJECT_DIR/node_modules/.bin/$name" ]; then
    printf '%s\n' "$PROJECT_DIR/node_modules/.bin/$name"
  elif have "$name"; then
    printf '%s\n' "$name"
  fi
}

case "$FILE_PATH" in
  *.go)
    # gofmt has no module dependency — always run it first.
    if have gofmt; then
      diff="$(gofmt -d "$FILE_PATH" 2>&1)" || true
      if [ -n "$diff" ]; then
        printf '── gofmt: %s not formatted ──\n%s\n' "$FILE_PATH" "$diff" >&2
        exit 2
      fi
    fi

    # golangci-lint needs a go.mod somewhere above the file — outside a
    # module it errors with "no go files to analyze" and is unhelpful.
    # Walk up looking for go.mod; skip the linter if there's no module.
    has_go_mod=0
    dir="$(dirname "$FILE_PATH")"
    while [ "$dir" != "/" ] && [ "$dir" != "." ]; do
      if [ -f "$dir/go.mod" ]; then has_go_mod=1; break; fi
      dir="$(dirname "$dir")"
    done

    if [ "$FULL_CHECKS" = "1" ] && [ "$has_go_mod" -eq 1 ] && have golangci-lint; then
      # Go can't type-check a single file in isolation — sibling-file symbols in
      # the same package read as "undefined", producing a false cascade. So lint
      # the file's PACKAGE from the module root ($dir, found above) where imports
      # and same-package symbols resolve, then surface ONLY issues whose path is
      # the edited file, so pre-existing lint debt in sibling files never blocks
      # this edit. ($rel is the file path relative to the module root; golangci-
      # lint prints issues as "relpath:line:col: msg (linter)".)
      rel="${FILE_PATH#"$dir"/}"
      reldir="$(dirname "$rel")"
      rc=0
      full="$(cd "$dir" && golangci-lint run "./$reldir/" 2>&1)" || rc=$?
      out="$(printf '%s\n' "$full" | grep -F "$rel:" || true)"
      if [ -n "$out" ]; then
        printf '── golangci-lint: %s ──\n%s\n' "$FILE_PATH" "$out" >&2
        exit 2
      fi
      # Distinguish "no findings in this file" from "the linter never ran".
      # golangci-lint exits 0 = clean, 1 = issues found (sibling debt we filtered
      # out above). Any other code is a real failure — a broken .golangci.yml
      # (exit 3) or an unresolved package / typecheck error (exit 7). Surfacing
      # nothing for those would let a misconfigured linter pass every edit
      # silently, which is exactly the trap this per-file lint must avoid.
      if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
        printf '── golangci-lint could not run for %s (exit %s) ──\n%s\n' "$FILE_PATH" "$rc" "$full" >&2
        exit 2
      fi
    fi
    ;;

  *.py)
    if [ "$EDIT_LINT" = "1" ]; then
      if have ruff; then
        run_linter "ruff" ruff check "$FILE_PATH"
      elif have flake8; then
        run_linter "flake8" flake8 "$FILE_PATH"
      elif have pylint; then
        run_linter "pylint" pylint --score=n "$FILE_PATH"
      fi
    fi
    # Optional compatibility mode: project-wide type feedback after each edit.
    # The default workflow runs this once at Ship Gate.
    if [ "$FULL_CHECKS" = "1" ] && have pyright; then
      run_linter "pyright" pyright "$FILE_PATH"
    fi
    ;;

  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    if [ "$EDIT_LINT" = "1" ]; then
      bin="$(node_bin eslint)"
      if [ -n "$bin" ]; then
        run_linter "eslint" "$bin" "$FILE_PATH"
      else
        bin="$(node_bin biome)"
        if [ -n "$bin" ]; then
          run_linter "biome" "$bin" lint "$FILE_PATH"
        fi
      fi
    fi

    # Optional compatibility mode for .ts/.tsx. tsc must check the PROJECT
    # (single-file tsc ignores tsconfig and false-positives), so run against
    # the nearest tsconfig and surface ONLY diagnostics for the edited file.
    # Best-effort:
    # 20s cap via timeout/gtimeout when available (timeout -> skip silently);
    # without a timeout binary the hook harness's own cap applies.
    if [ "$FULL_CHECKS" = "1" ]; then case "$FILE_PATH" in
      *.ts|*.tsx)
        tsc_bin="$(node_bin tsc)"
        if [ -n "$tsc_bin" ]; then
          tsdir="$(dirname "$FILE_PATH")"
          while [ "$tsdir" != "/" ] && [ "$tsdir" != "." ]; do
            [ -f "$tsdir/tsconfig.json" ] && break
            tsdir="$(dirname "$tsdir")"
          done
          if [ -f "$tsdir/tsconfig.json" ]; then
            rel="${FILE_PATH#"$tsdir"/}"
            tbin="$(command -v timeout || command -v gtimeout || true)"
            rc=0
            if [ -n "$tbin" ]; then
              full="$(cd "$tsdir" && "$tbin" 20 "$tsc_bin" --noEmit --pretty false -p . 2>&1)" || rc=$?
            else
              full="$(cd "$tsdir" && "$tsc_bin" --noEmit --pretty false -p . 2>&1)" || rc=$?
            fi
            if [ "$rc" -ne 124 ]; then  # 124 = timed out -> skip silently
              out="$(printf '%s\n' "$full" | grep -F "$rel(" || true)"
              if [ -n "$out" ]; then
                printf '── tsc --noEmit: %s ──\n%s\n' "$FILE_PATH" "$out" >&2
                exit 2
              fi
            fi
          fi
        fi
        ;;
    esac; fi
    ;;

  *.html|*.htm)
    if [ "$EDIT_LINT" = "1" ]; then
      bin="$(node_bin htmlhint)"
      if [ -n "$bin" ]; then
        run_linter "htmlhint" "$bin" "$FILE_PATH"
      else
        bin="$(node_bin prettier)"
        if [ -n "$bin" ]; then
          run_linter "prettier" "$bin" --check "$FILE_PATH"
        fi
      fi
    fi
    ;;

  *.css|*.scss|*.sass|*.less)
    if [ "$EDIT_LINT" = "1" ]; then
      bin="$(node_bin stylelint)"
      if [ -n "$bin" ]; then
        run_linter "stylelint" "$bin" "$FILE_PATH"
      else
        bin="$(node_bin prettier)"
        if [ -n "$bin" ]; then
          run_linter "prettier" "$bin" --check "$FILE_PATH"
        fi
      fi
    fi
    ;;
esac

exit 0
