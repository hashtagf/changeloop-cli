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
# On a match the hook never refuses the call. It rewrites it so the agent
# still gets what it needs without the secret: a Read or Bash reader is pointed
# at a redacted copy (keys and layout kept, values replaced by <redacted>), a
# Grep that could print secret lines is scoped away from secret files or limited
# to file names. Only when no redacted copy can be made (Node is missing) does
# it fall back to refusing. FOUNDATION_SECRETS_GUARD=block restores refusals.

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

# ---------------------------------------------------------------------------
# glob_is_docs_only GLOB  ->  exit 0 if every file the glob can match is a
# documentation/template extension that is_secret_path always allows (see its
# allow-list above). Used to exempt a content-mode Grep whose glob makes it
# structurally impossible to touch a secret file, e.g. "*.md" or "**/*.md" —
# no filename ending in .md can ever be a .env or credential file.
# ---------------------------------------------------------------------------
glob_is_docs_only() {
  local lc
  lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in
    *.md|*.example|*.sample|*.template|*.dist|*.pub) return 0 ;;
  esac
  return 1
}

# glob_is_scoped GLOB  ->  exit 0 if the glob names a file extension, so it
# cannot reach a dotenv or key file (secret-shaped globs are refused earlier).
# "*.ts" and "src/**/*.{ts,tsx}" are scoped; "*", "**/*", and "src/" are not.
glob_is_scoped() {
  case "$1" in
    *'*'|*/|'') return 1 ;;
    *.*) return 0 ;;
  esac
  return 1
}

# token_is_file TOKEN  ->  exit 0 if a Bash argument can name a file: it has a
# path separator or a leading dot, or it exists. `process.env` and
# `import.meta.env` are search patterns in `rg process.env src`, not files.
token_is_file() {
  local t="$1"
  t="${t%\"}"; t="${t#\"}"; t="${t%\'}"; t="${t#\'}"
  case "$t" in
    */*|.*|~*) return 0 ;;
  esac
  [ -e "${event_cwd:-.}/$t" ]
}

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
event_cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
strict="$(printf '%s' "${FOUNDATION_SECRETS_GUARD:-}" | tr '[:upper:]' '[:lower:]')"

# redacted_copy PATH  ->  prints the path of a redacted copy, or nothing.
redacted_copy() {
  command -v node >/dev/null 2>&1 || return 0
  node "$HOOK_DIR/secret-redaction.mjs" "$1" "${event_cwd:-$PWD}" 2>/dev/null || true
}

# secret_absent PATH  ->  exit 0 if the named file does not exist. Nothing can
# leak from it, so the call runs and the tool reports its own error.
secret_absent() {
  case "$1" in /*) [ ! -e "$1" ] ;; *) [ ! -e "${event_cwd:-$PWD}/$1" ] ;; esac
}

# rewrite FIELD VALUE CONTEXT  ->  run the call with one tool_input field replaced.
rewrite() {
  printf '%s' "$input" | jq -c --arg f "$1" --arg v "$2" --arg ctx "$3" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse",
      updatedInput: (.tool_input + {($f): $v}), additionalContext: $ctx}}'
  exit 0
}

block() {
  jq -n --arg reason "$1 No secret contents were read; use a template, public key, or metadata-only search instead." \
    '{decision: "block", reason: $reason}'
  exit 0
}

SHOWN="secrets guard: showing a redacted copy, so keys and layout are visible and every value reads <redacted>. To change the real file, ask the user; never ask for secret values."
REF="See .claude/hooks/protect-secrets.sh. Keep the blocked command internal. If secret-bearing work is genuinely required, ask for an external result or scope decision without requesting secret contents or suggesting that this guard be disabled."

case "$tool_name" in
  # ---- Read --------------------------------------------------------------
  Read)
    file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
    if [ -n "$file_path" ] && is_secret_path "$file_path"; then
      copy=""; [ "$strict" = block ] || copy="$(redacted_copy "$file_path")"
      [ -z "$copy" ] || rewrite file_path "$copy" "$SHOWN"
      [ "$strict" = block ] || ! secret_absent "$file_path" || exit 0
      block "BLOCKED by secrets guard: \"$file_path\" looks like a secret/credential file (.env, private key, credentials, …). Reading it would pull its contents into context. $REF"
    fi
    ;;

  # ---- Grep --------------------------------------------------------------
  Grep)
    g_path="$(printf '%s' "$input" | jq -r '.tool_input.path // ""')"
    g_glob="$(printf '%s' "$input" | jq -r '.tool_input.glob // ""')"
    g_mode="$(printf '%s' "$input" | jq -r '.tool_input.output_mode // ""')"
    g_pattern="$(printf '%s' "$input" | jq -r '.tool_input.pattern // ""')"
    g_type="$(printf '%s' "$input" | jq -r '.tool_input.type // ""')"
    if [ -n "$g_path" ] && is_secret_path "$g_path"; then
      copy=""; [ "$strict" = block ] || copy="$(redacted_copy "$g_path")"
      [ -z "$copy" ] || rewrite path "$copy" "$SHOWN"
      [ "$strict" = block ] || ! secret_absent "$g_path" || exit 0
      block "BLOCKED by secrets guard: Grep path \"$g_path\" is a secret/credential file; matching lines would leak its contents. $REF"
    fi
    if [ -n "$g_glob" ] && glob_targets_secret "$g_glob"; then
      [ "$strict" = block ] || [ "$g_mode" != "content" ] ||
        rewrite output_mode files_with_matches "secrets guard: this glob targets secret files, so the search lists matching file names without printing their lines."
      [ "$strict" = block ] || exit 0
      block "BLOCKED by secrets guard: Grep glob \"$g_glob\" targets secret/credential files; with output_mode \"content\" this would leak their contents. Narrow the glob to exclude .env/credential files. $REF"
    fi
    # is_secret_path is a *filename* matcher, so a directory path with no glob
    # cleared both checks above and still printed matching lines out of every
    # .env underneath it. The pattern is what makes that a leak: a repo-wide
    # content search for credential-shaped text is the accidental disclosure
    # this hook exists to stop. Narrower modes (files_with_matches, count)
    # print no line content and stay allowed. Skipped when the glob itself
    # proves no secret file could ever match (glob_is_docs_only), so a search
    # scoped to "*.md" for documentation mentioning "password" or "API_KEY"
    # is not treated the same as an unscoped repo-wide leak.
    # A file type, a regular file, or a glob that names an extension keeps
    # the search out of dotenv and key files, so `password` in `*.ts` during
    # auth work is ordinary code search.
    if [ "$g_mode" = "content" ] && [ -n "$g_pattern" ] && [ -z "$g_type" ] &&
       ! { [ -n "$g_path" ] && [ -f "$g_path" ]; } &&
       { [ -z "$g_glob" ] || { ! glob_is_docs_only "$g_glob" && ! glob_is_scoped "$g_glob"; }; } &&
       printf '%s' "$g_pattern" | grep -Eqi \
         '(api[_-]?key|secret|passwd|password|private[_-]?key|access[_-]?token|auth[_-]?token|bearer|credential|client[_-]?secret|aws_[a-z_]*key)'; then
      if [ "$strict" != block ]; then
        # Keep this exclusion in step with is_secret_path's deny-lists.
        [ -n "$g_glob" ] || rewrite glob '!{**/.env,**/.env.*,**/*.env,**/*.pem,**/*.key,**/*.pfx,**/*.p12,**/*.jks,**/*.keystore,**/*.kdbx,**/*.ppk,**/*.gpg,**/id_rsa,**/id_dsa,**/id_ecdsa,**/id_ed25519,**/.ssh/**,**/.gnupg/**,**/.npmrc,**/.pypirc,**/.netrc,**/_netrc,**/.htpasswd,**/.dockercfg,**/auth.json,**/*service*account*.json,**/*-key.json,**/*_key.json,**/*secret*,**/*credential*}' \
          "secrets guard: this credential-shaped search skips secret files (.env, keys, credentials) so their values are never printed."
        rewrite output_mode files_with_matches "secrets guard: this credential-shaped search lists matching file names without printing lines, because its glob could reach secret files."
      fi
      block "BLOCKED by secrets guard: Grep pattern \"$g_pattern\" with output_mode \"content\" would print credential-shaped lines from every matching file, including .env files under \"${g_path:-the working directory}\". Use output_mode \"files_with_matches\" to locate them without printing their contents. $REF"
    fi
    ;;

  # ---- Bash --------------------------------------------------------------
  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
    event_cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
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
        if is_secret_path "$tok" && token_is_file "$tok"; then found="$tok"; break; fi
      done
      [ -n "$found" ] && break
    done <<EOF
$segments
EOF

    if [ -n "$found" ] && [ "$strict" != block ]; then
      copy="$(redacted_copy "$found")"
      if [ -n "$copy" ]; then
        # Every spelling of the secret operand in the command reads the copy.
        rewritten="$(FOUND="$found" COPY="$copy" CMD="$cmd" node -e '
          const { FOUND: found, COPY: copy, CMD: cmd } = process.env;
          process.stdout.write(cmd.split(found).join(copy));')"
        rewrite command "$rewritten" "$SHOWN The command ran against the redacted copy."
      fi
      ! secret_absent "$found" || exit 0
    fi
    if [ -n "$found" ]; then
      block "BLOCKED by secrets guard: this Bash command reads \"$found\", a secret/credential file, into context. $REF"
    fi
    ;;
esac

exit 0
