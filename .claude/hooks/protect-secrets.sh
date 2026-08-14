#!/usr/bin/env bash
# PreToolUse guard that blocks reads of .env files and credential material.
#
# Secrets leak into the model's context the moment a tool prints their
# contents — and once in context they can be summarised, logged, or echoed
# back. This hook denies the three tool surfaces that can surface file
# contents BEFORE the read happens:
#
#   1. Read  — block when tool_input.file_path is a secret file.
#   2. Grep  — block when the search path is a secret file, or the glob
#              explicitly targets secret files (output_mode:"content" would
#              print matching lines, leaking the secret).
#   3. Bash  — block when the command both (a) references a secret file and
#              (b) uses a content-reading utility (cat, head, grep, base64,
#              cp/scp, …). A reference alone is allowed: `source .env`,
#              `docker compose --env-file .env up`, and `npm run dev` load a
#              .env without ever printing it to the model, so they pass.
#
# Allow-list wins over deny-list: template/sample files (.env.example,
# .env.sample, *.template, *.dist) and public material (*.pub) are safe to
# read and never blocked — they're the very files a developer needs to see.
#
# Scope note: this is a defence against ACCIDENTAL reads in a normal session,
# not an adversarial sandbox. A determined bypass (obfuscated commands, base64
# round-trips, `c""at`) can still slip through a regex; treat this as one layer,
# not the whole wall. Edit the pattern lists in is_secret_path() to tune.
#
# On a match the hook emits {"decision":"block","reason":...} (the same shape
# dev-agent-guard.sh uses) so Claude Code denies the call and feeds the reason
# back to the model. Otherwise it exits 0 and the tool proceeds.

set -uo pipefail

# jq is the only hard dependency. Fail open if it's absent — a missing
# toolchain on some machine must not brick every Read in the session.
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')" || exit 0
case "$tool_name" in
  Read|Grep|Bash) ;;
  *) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# is_secret_path PATH  ->  exit 0 if PATH names a secret, 1 otherwise.
# Matching is on the lowercased basename plus a few path-segment rules
# (~/.ssh private keys, ~/.aws/credentials, ~/.gnupg). Allow-list first so a
# template or public file always wins over a broad deny pattern.
# ---------------------------------------------------------------------------
is_secret_path() {
  local p="$1"
  # Strip one layer of surrounding quotes left over from command tokenizing.
  p="${p%\"}"; p="${p#\"}"; p="${p%\'}"; p="${p#\'}"
  [ -n "$p" ] || return 1

  local base lc lc_path
  base="$(basename -- "$p" 2>/dev/null)" || return 1
  lc="$(printf '%s' "$base"  | tr '[:upper:]' '[:lower:]')"
  lc_path="$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')"

  # --- Allow-list: templates and public key material are safe to read. ---
  case "$lc" in
    *.example|*.sample|*.template|*.dist|*.pub|*.md) return 1 ;;
  esac

  # --- Path-segment deny: private key / credential directories. ---
  # Prepend "/" so relative and absolute paths match the same pattern.
  case "/$lc_path" in
    */.aws/credentials) return 0 ;;
    */.gnupg/*) return 0 ;;
    */.ssh/*)
      # ~/.ssh holds private keys (id_rsa, *.pem) AND harmless files
      # (config, known_hosts, *.pub). .pub is already allow-listed above;
      # treat the well-known non-secret names as safe, block everything else
      # (i.e. the bare private keys with no extension).
      case "$lc" in
        config|known_hosts|known_hosts.old|authorized_keys) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac

  # --- Basename deny-list. Edit here to add/remove protected files. ---
  case "$lc" in
    .env|.env.*|*.env)                                   return 0 ;;  # dotenv in any flavour
    *.pem|*.key|*.pfx|*.p12|*.jks|*.keystore|*.kdbx|*.ppk|*.gpg) return 0 ;;  # key/cert stores
    id_rsa|id_dsa|id_ecdsa|id_ed25519)                  return 0 ;;  # SSH private keys
    .npmrc|.pypirc|.netrc|_netrc|.git-credentials|.htpasswd|.dockercfg) return 0 ;;
    credentials|credentials.json|credentials.yml|credentials.yaml) return 0 ;;
    auth.json|master.key)                               return 0 ;;  # composer, Rails
    *service*account*.json|*-key.json|*_key.json)       return 0 ;;  # GCP/service-account keys
  esac

  # Files whose NAME advertises a secret/credential, but only when the
  # extension is a data/config format — so "secrets.json" or "db-credentials.yaml"
  # are blocked while "protect-secrets.sh" or "credentials.md" are not.
  case "$lc" in
    *secret*|*credential*)
      case "$lc" in
        *.json|*.yaml|*.yml|*.toml|*.env|*.ini|*.conf|*.cfg|*.properties|*.xml|*.txt) return 0 ;;
      esac
      ;;
  esac

  return 1
}

# ---------------------------------------------------------------------------
# glob_targets_secret GLOB  ->  exit 0 if a Grep glob aims at secret files.
# Looser than is_secret_path because globs carry wildcards (**/.env, .env*).
# ---------------------------------------------------------------------------
glob_targets_secret() {
  local lc
  lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in
    *.example|*.sample|*.template|*.dist) return 1 ;;
    *.env|*.env.*|.env*|*.env*)           return 0 ;;
    *secret*|*credential*)                return 0 ;;
    *.pem|*.key|*.pfx|*.p12|*.jks|*.keystore|*.ppk|*.kdbx) return 0 ;;
    *.npmrc|*.pypirc|*.netrc|*id_rsa*|*id_ed25519*|*git-credentials*) return 0 ;;
  esac
  return 1
}

block() {
  jq -n --arg reason "$1" '{decision: "block", reason: $reason}'
  exit 0
}

REF="See .claude/hooks/protect-secrets.sh. If this read is genuinely required, the user can run the command themselves with a leading \"! \" in the prompt, or temporarily disable the hook."

case "$tool_name" in
  # ---- Read --------------------------------------------------------------
  Read)
    file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
    if [ -n "$file_path" ] && is_secret_path "$file_path"; then
      block "BLOCKED by secrets guard: \"$file_path\" looks like a secret/credential file (.env, private key, credentials, …). Reading it would pull its contents into context. $REF"
    fi
    ;;

  # ---- Grep --------------------------------------------------------------
  Grep)
    g_path="$(printf '%s' "$input" | jq -r '.tool_input.path // ""')"
    g_glob="$(printf '%s' "$input" | jq -r '.tool_input.glob // ""')"
    g_mode="$(printf '%s' "$input" | jq -r '.tool_input.output_mode // ""')"
    g_pattern="$(printf '%s' "$input" | jq -r '.tool_input.pattern // ""')"
    if [ -n "$g_path" ] && is_secret_path "$g_path"; then
      block "BLOCKED by secrets guard: Grep path \"$g_path\" is a secret/credential file; matching lines would leak its contents. $REF"
    fi
    if [ -n "$g_glob" ] && glob_targets_secret "$g_glob"; then
      block "BLOCKED by secrets guard: Grep glob \"$g_glob\" targets secret/credential files; with output_mode \"content\" this would leak their contents. Narrow the glob to exclude .env/credential files. $REF"
    fi
    # is_secret_path is a *filename* matcher, so a directory path with no glob
    # cleared both checks above and still printed matching lines out of every
    # .env underneath it. The pattern is what makes that a leak: a repo-wide
    # content search for credential-shaped text is the accidental disclosure
    # this hook exists to stop. Narrower modes (files_with_matches, count)
    # print no line content and stay allowed.
    if [ "$g_mode" = "content" ] && [ -n "$g_pattern" ] &&
       printf '%s' "$g_pattern" | grep -Eqi \
         '(api[_-]?key|secret|passwd|password|private[_-]?key|access[_-]?token|auth[_-]?token|bearer|credential|client[_-]?secret|aws_[a-z_]*key)'; then
      block "BLOCKED by secrets guard: Grep pattern \"$g_pattern\" with output_mode \"content\" would print credential-shaped lines from every matching file, including .env files under \"${g_path:-the working directory}\". Use output_mode \"files_with_matches\" to locate them without printing their contents. $REF"
    fi
    ;;

  # ---- Bash --------------------------------------------------------------
  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
    [ -n "$cmd" ] || exit 0

    # (1) Neutralise quoted spans first, so a secret filename that only appears
    # INSIDE a string argument — a commit message, an echo, a generated doc —
    # is never mistaken for a file being read. A span that is a single plain
    # word (no whitespace or shell metacharacters) is kept literally, because
    # quoting a path is a common accidental shape: `cat ".env"` must be caught
    # exactly like `cat .env`. A span with whitespace/metacharacters is prose
    # or a nested command, and is blanked — which is what lets
    # `git commit -m "... cat .env ..."` through. Portable char state machine
    # (handles multi-line input).
    # Known gap: `bash -c "cat .env"` loses its inner command with the quotes —
    # acceptable, since this guards against accidental reads, not deliberate
    # obfuscation.
    dequoted="$(printf '%s' "$cmd" | awk '
      BEGIN { RS = "\0" }
      {
        n = length($0); inq = 0; q = ""; buf = ""
        for (i = 1; i <= n; i++) {
          c = substr($0, i, 1)
          if (inq) {
            if (c == q) {
              inq = 0
              if (buf !~ /[[:space:];|&`()<>]/) printf "%s", buf
              else printf " "
              buf = ""
            } else buf = buf c
            continue
          }
          if (c == "\47" || c == "\"") { inq = 1; q = c; printf " "; continue }
          printf "%s", c
        }
      }')"

    # (2) Split into simple-command segments on shell separators (| ; & newline
    # and command-substitution ( ) `), then judge each segment on its COMMAND
    # WORD. A file is only read when the segment's command is a content-reading
    # utility AND one of its arguments is a secret file. This is why `source
    # .env`, `docker compose --env-file .env up`, and `npm run dev` pass — their
    # command word (source / docker / npm) does not read a file's contents.
    segments="$(printf '%s' "$dequoted" | tr '|;&`()\n' '\n\n\n\n\n\n\n')"

    found=""
    while IFS= read -r seg; do
      [ -n "$seg" ] || continue
      # Normalise metacharacters so `<.env` and `{a,b}` tokenise cleanly, but
      # KEEP '=' for now: the assignment-skipping below needs it. Erasing it
      # first turned `FOO=1 cat .env` into command word "FOO", which is not a
      # reader, so any `VAR=value` prefix walked straight past this guard.
      seg="$(printf '%s' "$seg" | tr '<>{},' '     ')"
      # shellcheck disable=SC2086 -- intentional word-splitting
      set -- $seg
      [ "$#" -gt 0 ] || continue

      # Resolve the command word: skip leading VAR=value assignments and
      # harmless wrapper prefixes (sudo, env, time, …).
      while [ "$#" -gt 0 ]; do
        case "$1" in
          *=*) shift ;;
          sudo|command|env|nice|nohup|time|xargs|exec|builtin|then|do|\\) shift ;;
          *) break ;;
        esac
      done
      [ "$#" -gt 0 ] || continue

      case "$1" in
        cat|tac|nl|head|tail|less|more|bat|view|vi|vim|nano|emacs|od|xxd|hexdump|strings|base64|grep|egrep|fgrep|rg|ag|ack|awk|sed|cut|paste|cp|scp|rsync|dd|gpg|openssl|jq|yq|cmp|diff) ;;
        *) continue ;;   # not a reader → this segment can't leak a file
      esac
      shift

      # Only now split on '=', so `--file=.env` still yields `.env` as a token.
      args="$(printf '%s ' "$@" | tr '=' ' ')"
      # shellcheck disable=SC2086 -- intentional word-splitting
      set -- $args
      for tok in "$@"; do
        if is_secret_path "$tok"; then found="$tok"; break; fi
      done
      [ -n "$found" ] && break
    done <<EOF
$segments
EOF

    if [ -n "$found" ]; then
      block "BLOCKED by secrets guard: this Bash command reads \"$found\", a secret/credential file, into context. $REF"
    fi
    ;;
esac

exit 0
