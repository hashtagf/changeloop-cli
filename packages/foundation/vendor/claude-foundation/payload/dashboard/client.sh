#!/usr/bin/env bash
# claude-foundation dashboard — presence client.
#
# Modes (the installer maps subcommands to these):
#   run     foreground heartbeat loop   ← `claude-foundation dashboard`
#   up      start heartbeat in background ← `claude-foundation dashboard-up`
#   down    stop the background heartbeat ← `claude-foundation dashboard-down`
#   status  is the background heartbeat running? ← `claude-foundation dashboard-status`
#
# The background daemon binds NO port — it only sends outbound heartbeats and is
# controlled via a PID file — so it never collides with your other dev servers.
# Only `curl` is required on the client.

set -euo pipefail

CLIENT_VERSION="1.11.0"
DEFAULT_SERVER="https://claude-foundation-dashboard-production.up.railway.app"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# ── Colors (off when not a TTY) ─────────────────────────────────────────────
if [ -t 1 ]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; B=$'\033[0;34m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; D=''; N=''
fi
info() { printf "%s\n" "${B}▸${N} $*"; }
ok()   { printf "%s\n" "${G}✓${N} $*"; }
warn() { printf "%s\n" "${Y}⚠${N} $*" >&2; }
fail() { printf "%s\n" "${R}✗${N} $*" >&2; exit 1; }

usage() {
  cat <<EOF
claude-foundation dashboard — report this machine's presence to the team dashboard

Usage:
  claude-foundation dashboard-up --key <key> [options]   start in the background
  claude-foundation dashboard-down                       stop the background client
  claude-foundation dashboard-status                     show whether it's running
  claude-foundation dashboard --key <key> [options]      run in the foreground

Options:
  --key <key>          Shared dashboard key (or env CLAUDE_FOUNDATION_DASHBOARD_KEY)
  --server <url>       Dashboard server URL (or env CLAUDE_FOUNDATION_DASHBOARD_URL)
  --name <name>        Display name (default: git user.name, else \$USER)
  --interval <secs>    Heartbeat interval (default: 30)
  --scan <dir>         Dir to scan for /dev runs + git repos (repeatable; default: \$HOME)
  --no-activity        Don't report what /dev runs are active (presence only)
  --no-conflicts       Don't report changed files/lines for conflict early-warning
  --no-usage           Don't report Claude Code token/model usage
  --once               Send a single heartbeat and exit (run mode only)
  -h, --help           Show this help

The background daemon uses no port — it sends outbound heartbeats and is tracked
by a PID file at \$CLAUDE_FOUNDATION_STATE/dashboard.pid (default ~/.claude-foundation).
EOF
}

# ── Mode + args ─────────────────────────────────────────────────────────────
MODE="${1:-run}"
case "$MODE" in
  run|up|down|status) shift ;;
  -h|--help) usage; exit 0 ;;
  *) MODE="run" ;;
esac
ARGS=("$@") # forwarded verbatim to the background child in `up`

KEY="${CLAUDE_FOUNDATION_DASHBOARD_KEY:-}"
SERVER="${CLAUDE_FOUNDATION_DASHBOARD_URL:-$DEFAULT_SERVER}"
NAME=""
INTERVAL="${CLAUDE_FOUNDATION_DASHBOARD_INTERVAL:-30}"
ONCE="no"
ACTIVITY="yes"                                             # report active /dev runs (repo+branch); --no-activity to opt out
CONFLICTS="yes"                                            # report changed files+line-ranges per repo for conflict warning; --no-conflicts to opt out
USAGE="yes"                                                # report Claude Code token/model usage from ~/.claude transcripts; --no-usage to opt out
SCAN_ROOTS=()                                              # dirs to scan for Foundation projects + git repos (default: $HOME)
SCAN_DEPTH="${CLAUDE_FOUNDATION_SCAN_DEPTH:-6}"            # project roots may be nested under a shared work root
ACTIVE_WINDOW="${CLAUDE_FOUNDATION_ACTIVE_WINDOW:-900}"    # secs since the last runtime update to still count as "working"
SCAN_INTERVAL="${CLAUDE_FOUNDATION_SCAN_INTERVAL:-60}"     # rescan cadence (decoupled from heartbeat)
USAGE_DAYS="${CLAUDE_FOUNDATION_USAGE_DAYS:-30}"           # how far back to aggregate token usage
USAGE_INTERVAL="${CLAUDE_FOUNDATION_USAGE_INTERVAL:-300}"  # transcripts are big — reaggregate at most this often
PR_INTERVAL="${CLAUDE_FOUNDATION_PR_INTERVAL:-900}"        # gh API calls — refresh PR counts at most this often
MAX_PAYLOAD_BYTES="${CLAUDE_FOUNDATION_MAX_PAYLOAD_BYTES:-500000}"

# Local-time offset in seconds (e.g. +0700 → 25200) — UTC timestamps from
# transcripts/reflogs are shifted by this so days match the user's calendar.
TZ_RAW="$(date +%z)"
TZ_OFF=$(( 10#${TZ_RAW:1:2} * 3600 + 10#${TZ_RAW:3:2} * 60 ))
[ "${TZ_RAW:0:1}" = "-" ] && TZ_OFF=$(( -TZ_OFF ))

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    --key)        [ $# -ge 2 ] || fail "--key needs a value"; KEY="$2"; shift ;;
    --key=*)      KEY="${1#*=}" ;;
    --server)     [ $# -ge 2 ] || fail "--server needs a value"; SERVER="$2"; shift ;;
    --server=*)   SERVER="${1#*=}" ;;
    --name)       [ $# -ge 2 ] || fail "--name needs a value"; NAME="$2"; shift ;;
    --name=*)     NAME="${1#*=}" ;;
    --interval)   [ $# -ge 2 ] || fail "--interval needs a value"; INTERVAL="$2"; shift ;;
    --interval=*) INTERVAL="${1#*=}" ;;
    --scan)       [ $# -ge 2 ] || fail "--scan needs a path"; SCAN_ROOTS+=("$2"); shift ;;
    --scan=*)     SCAN_ROOTS+=("${1#*=}") ;;
    --no-activity) ACTIVITY="no" ;;
    --no-conflicts) CONFLICTS="no" ;;
    --no-usage)   USAGE="no" ;;
    --once)       ONCE="yes" ;;
    --source)     shift ;;          # injected by the brew wrapper — ignore
    --source=*)   ;;                # ignore
    *)            warn "ignoring unknown argument: $1" ;;
  esac
  shift
done

# Default scan roots: env CLAUDE_FOUNDATION_SCAN_ROOTS (colon-separated) else $HOME.
if [ "${#SCAN_ROOTS[@]}" -eq 0 ]; then
  if [ -n "${CLAUDE_FOUNDATION_SCAN_ROOTS:-}" ]; then
    IFS=':' read -r -a SCAN_ROOTS <<< "$CLAUDE_FOUNDATION_SCAN_ROOTS"
  else
    SCAN_ROOTS=("$HOME")
  fi
fi

# ── Daemon bookkeeping (PID file, no port) ──────────────────────────────────
STATE_DIR="${CLAUDE_FOUNDATION_STATE:-$HOME/.claude-foundation}"
PIDFILE="$STATE_DIR/dashboard.pid"
PIDSTART="$STATE_DIR/dashboard.pid.start"
LOGFILE="$STATE_DIR/dashboard.log"

daemon_pid() { [ -f "$PIDFILE" ] && cat "$PIDFILE" 2>/dev/null || true; }
process_started() { ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
is_running() {
  local p expected current command_line
  p="$(daemon_pid)"
  case "$p" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$p" 2>/dev/null || return 1
  if [ ! -s "$PIDSTART" ]; then
    # One-time safe migration for pre-1.11 PID files: accept only a process
    # whose command line is recognizably this dashboard client.
    command_line="$(ps -p "$p" -o command= 2>/dev/null || true)"
    case "$command_line" in
      *dashboard/client.sh*run*) process_started "$p" > "$PIDSTART" ;;
      *) return 1 ;;
    esac
  fi
  expected="$(cat "$PIDSTART" 2>/dev/null || true)"
  current="$(process_started "$p")"
  [ -n "$expected" ] && [ "$current" = "$expected" ]
}

positive_int() { case "$1" in ''|*[!0-9]*|0) return 1 ;; *) return 0 ;; esac; }

validate() {
  command -v curl >/dev/null 2>&1 || fail "curl is required but not found"
  [ -n "$KEY" ] || fail "missing --key (or set CLAUDE_FOUNDATION_DASHBOARD_KEY)"
  case "$SERVER" in
    *YOUR-APP.up.railway.app*) fail "set --server <url> (or CLAUDE_FOUNDATION_DASHBOARD_URL) to your deployed dashboard" ;;
  esac
  positive_int "$INTERVAL" || fail "--interval must be a positive integer"
  positive_int "$SCAN_INTERVAL" || fail "CLAUDE_FOUNDATION_SCAN_INTERVAL must be a positive integer"
  positive_int "$USAGE_INTERVAL" || fail "CLAUDE_FOUNDATION_USAGE_INTERVAL must be a positive integer"
  positive_int "$USAGE_DAYS" || fail "CLAUDE_FOUNDATION_USAGE_DAYS must be a positive integer"
  positive_int "$MAX_PAYLOAD_BYTES" || fail "CLAUDE_FOUNDATION_MAX_PAYLOAD_BYTES must be a positive integer"
  positive_int "$DISCOVERY_INTERVAL" || fail "CLAUDE_FOUNDATION_DISCOVERY_INTERVAL must be a positive integer"
  SERVER="${SERVER%/}"
}

# ── Identity ────────────────────────────────────────────────────────────────
gen_id() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v openssl >/dev/null 2>&1; then openssl rand -hex 16
  else printf '%s-%s%s' "$(hostname 2>/dev/null || echo host)" "${RANDOM}" "${RANDOM}"; fi
}

derive_identity() {
  local id_file="$STATE_DIR/agent-id"
  if [ -f "$id_file" ]; then
    AGENT_ID="$(cat "$id_file")"
  else
    mkdir -p "$STATE_DIR"
    AGENT_ID="$(gen_id)"
    printf '%s\n' "$AGENT_ID" > "$id_file"
  fi
  GIT_USER="$NAME"
  [ -n "$GIT_USER" ] || GIT_USER="$(git config --get user.name 2>/dev/null || true)"
  [ -n "$GIT_USER" ] || GIT_USER="$(git config --get user.email 2>/dev/null || true)"
  [ -n "$GIT_USER" ] || GIT_USER="${USER:-unknown}"
  GIT_EMAIL="$(git config --get user.email 2>/dev/null || true)"
  HOST="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"
}

json_escape() {
  local LC_ALL=C s=$1 out="" c code
  while [ -n "$s" ]; do
    c=${s%"${s#?}"}; s=${s#?}
    case "$c" in
      '"') out="$out\\\"" ;;
      '\') out="$out\\\\" ;;
      $'\b') out="$out\\b" ;;
      $'\f') out="$out\\f" ;;
      $'\n') out="$out\\n" ;;
      $'\r') out="$out\\r" ;;
      $'\t') out="$out\\t" ;;
      *)
        printf -v code '%d' "'$c"
        if [ "$code" -lt 32 ]; then printf -v c '\\u%04x' "$code"; fi
        out="$out$c"
        ;;
    esac
  done
  printf '%s' "$out"
}

# ── Run + change scans: /dev run history and per-repo edits on this machine ──
RUNS_JSON="[]"
RUNS_SOURCE_SCHEMA="none"
RUNS_FOUNDATION_VERSION="unknown"
CHANGES_JSON="[]"
USAGE_JSON="[]"
SESSIONS_JSON="[]"
TOOLS_JSON="[]"
LAST_SCAN=0
RUNS_CACHE="$STATE_DIR/runs.json"      # background scan publishes results here
RUNS_META_CACHE="$STATE_DIR/runs-meta.txt"  # sourceSchema + foundationVersion from that same scan
CHG_CACHE="$STATE_DIR/changes.json"
USAGE_CACHE="$STATE_DIR/usage.json"
USAGE_STATE="$STATE_DIR/usage-state.json"
PRS_CACHE="$STATE_DIR/prs.json"
PRS_JSON="[]"
SCAN_LOCK="$STATE_DIR/scan.lock"
RUN_PATH_CACHE="$STATE_DIR/run-paths.txt"
GIT_PATH_CACHE="$STATE_DIR/git-paths.txt"
DISCOVERY_INTERVAL="${CLAUDE_FOUNDATION_DISCOVERY_INTERVAL:-300}"
DASHBOARD_CLI="${CLAUDE_FOUNDATION_CLI:-$(dirname "$SCRIPT_PATH")/../cli.sh}"

refresh_discovery_cache() {
  local now age
  now="$(date +%s)"
  if [ -f "$RUN_PATH_CACHE" ] && [ -f "$GIT_PATH_CACHE" ]; then
    age=$(( now - $(file_mtime "$GIT_PATH_CACHE") ))
    [ "$age" -lt "$DISCOVERY_INTERVAL" ] && return
  fi
  find "${SCAN_ROOTS[@]}" -maxdepth "$SCAN_DEPTH" \
    \( -name node_modules -o -name .git -o -name Library -o -name .Trash -o -name .cache \) -prune \
    -o \( -path '*/.foundation/runtime' -type d -print -prune \) \
    -o \( -path '*/.workflow/*/state.json' ! -path '*/_templates/*' -print \) 2>/dev/null \
    > "$RUN_PATH_CACHE.tmp" || true
  find "${SCAN_ROOTS[@]}" -maxdepth "$SCAN_DEPTH" \
    \( -name node_modules -o -name Library -o -name .Trash -o -name .cache \) -prune \
    -o -name .git -type d -prune -print \
    -o -name .git -type f -print 2>/dev/null > "$GIT_PATH_CACHE.tmp" || true
  mv "$RUN_PATH_CACHE.tmp" "$RUN_PATH_CACHE"
  mv "$GIT_PATH_CACHE.tmp" "$GIT_PATH_CACHE"
}

# Join args with commas (bash-3.2 safe — never touches an empty array's [*]).
join_csv() {
  local out= first=1 x
  for x in "$@"; do
    if [ -n "$first" ]; then out="$x"; first=; else out="$out,$x"; fi
  done
  printf '%s' "$out"
}

# Normalize a git remote URL to a stable cross-machine id: host/org/repo.
normalize_remote() {
  local u=$1
  u=${u%.git}
  u=${u#ssh://}; u=${u#git+ssh://}; u=${u#https://}; u=${u#http://}; u=${u#git://}
  u=${u#*@}          # strip user@ (git@github.com:… or user@host)
  u=${u/:/\/}        # git@github.com:org/repo → github.com/org/repo
  printf '%s' "$u"
}

# Resolve the shared branch point so committed feature-branch work remains
# visible until it is merged. HEAD is the safe fallback for repositories whose
# remote does not advertise a default branch.
diff_base() {
  local root=$1 default_ref="" base=""
  default_ref="$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [ -z "$default_ref" ]; then
    for default_ref in origin/main origin/master; do
      git -C "$root" rev-parse --verify -q "$default_ref" >/dev/null 2>&1 && break
      default_ref=""
    done
  fi
  if [ -n "$default_ref" ]; then
    base="$(git -C "$root" merge-base HEAD "$default_ref" 2>/dev/null || true)"
  fi
  printf '%s' "${base:-HEAD}"
}

# GNU stat's -f is "display filesystem status", not BSD's format flag, so
# `stat -f %m "$1"` on Linux stats a nonexistent file named %m (non-zero exit)
# while still printing a filesystem block for "$1". A `-f … || -c …` chain
# therefore emits that block *concatenated with* the real value. Probe once and
# commit to one flavor instead of chaining.
if stat -c%Y . >/dev/null 2>&1; then
  STAT_MTIME_FMT='-c%Y'; STAT_BTIME_FMT='-c%W'
else
  STAT_MTIME_FMT='-f%m'; STAT_BTIME_FMT='-f%B'
fi
file_mtime() { stat "$STAT_MTIME_FMT" "$1" 2>/dev/null || echo 0; }
# Pull a string field out of a state.json (null/number fields → empty).
json_get() { sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" 2>/dev/null | head -1; }
# Best-effort "started" epoch for a run dir (state.json has no created_at): the
# dir's birth time, falling back to the state.json mtime.
dir_started() {
  local d=$1 b
  # GNU reports an unknown birth time as 0 or "-"; both mean "fall back".
  b="$(stat "$STAT_BTIME_FMT" "$d" 2>/dev/null || true)"
  case $b in ""|0|-|*[!0-9]*) b="$(file_mtime "$d/state.json")";; esac
  printf '%s' "$b"
}

# Find ALL /dev runs under SCAN_ROOTS (active AND completed) and report one
# compact record each, so the server can derive live activity AND aggregate
# completion stats (counts, durations, throughput). Fields come straight from
# state.json; newest-first, capped at RUNS_CAP.
scan_runs() {
  [ "$ACTIVITY" = "yes" ] || { RUNS_JSON="[]"; return; }
  RUNS_SOURCE_SCHEMA="none"
  RUNS_FOUNDATION_VERSION="unknown"
  refresh_discovery_cache
  local tab; tab="$(printf '\t')"
  local ranked=() sj rundir id rtype repo branch phase step repo_root started finished doneflag
  local owner oemail rsize rr rid last_rr= last_rid=
  local snapshot current_roots="" snapshot_rows source_meta source_version legacy_count=0
  # Current projects are projected through the public, read-only snapshot API.
  # One malformed project is isolated and does not abort discovery of others.
  while IFS= read -r sj; do
    case "$sj" in */.foundation/runtime) ;; *) continue ;; esac
    rr="${sj%/.foundation/runtime}"
    case "$current_roots" in *$'\n'"$rr"$'\n'*) continue ;; esac
    current_roots="${current_roots}"$'\n'"$rr"$'\n'
    [ -x "$DASHBOARD_CLI" ] || continue
    snapshot="$("$DASHBOARD_CLI" --project "$rr" dashboard snapshot --json 2>/dev/null)" || continue
    source_meta="$(printf '%s' "$snapshot" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try { const v=JSON.parse(s); process.stdout.write(`${v.sourceSchema || "unknown"}\t${v.foundationVersion || "unknown"}`) }
        catch { process.exitCode=1 }
      })' 2>/dev/null)" || continue
    RUNS_SOURCE_SCHEMA="${source_meta%%$'\t'*}"
    source_version="${source_meta#*$'\t'}"
    if [ "$RUNS_FOUNDATION_VERSION" = "unknown" ]; then RUNS_FOUNDATION_VERSION="$source_version"
    elif [ "$RUNS_FOUNDATION_VERSION" != "$source_version" ]; then RUNS_FOUNDATION_VERSION="mixed"
    fi
    snapshot_rows="$(printf '%s' "$snapshot" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try {
          const v=JSON.parse(s);
          for (const run of Array.isArray(v.runs) ? v.runs : []) {
            const finished=Number.isFinite(run.finished)?run.finished:0;
            process.stdout.write(`${finished}\t${JSON.stringify(run)}\n`);
          }
        } catch { process.exitCode=1 }
      })' 2>/dev/null)" || continue
    while IFS= read -r source_row; do
      [ -n "$source_row" ] && ranked+=("$source_row")
    done <<< "$snapshot_rows"
  done < "$RUN_PATH_CACHE"

  # Legacy .workflow records remain readable during the migration window.
  while IFS= read -r sj; do
    [ -n "$sj" ] || continue
    case "$sj" in */.workflow/*/state.json) ;; *) continue ;; esac
    case "$sj" in */_templates/*) continue ;; esac      # skip the blueprint state.json
    rundir="$(dirname "$sj")"
    id="$(json_get "$sj" id)"
    [ -n "$id" ] && [ "$id" != "NNNN-type-slug" ] || continue
    rtype="$(json_get "$sj" type)"
    branch="$(json_get "$sj" branch)"
    phase="$(json_get "$sj" phase)"
    step="$(json_get "$sj" step)"
    repo_root="$(json_get "$sj" repo_root)"
    if [ -n "$repo_root" ]; then repo="$(basename "$repo_root")"
    else repo="$(basename "$(dirname "$(dirname "$rundir")")")"; fi
    # Owner = who actually ran this /dev run. Prefer state.json `owner`/`owner_email`
    # (the orchestrator writes them at run creation); for older runs fall back to
    # the author of the first commit that touched the run dir. Empty owner means
    # the server falls back to attributing the run to whoever reported it.
    owner="$(json_get "$sj" owner)"
    oemail="$(json_get "$sj" owner_email)"
    rsize="$(json_get "$sj" size)"
    rr="$repo_root"; [ -n "$rr" ] || rr="$(dirname "$(dirname "$rundir")")"
    case "$current_roots" in *$'\n'"$rr"$'\n'*) continue ;; esac
    if [ -z "$owner" ] && command -v git >/dev/null 2>&1; then
      IFS="$tab" read -r owner oemail \
        < <(git -C "$rr" log --reverse --format="%an${tab}%ae" -- ".workflow/$(basename "$rundir")" 2>/dev/null | head -1) || true
    fi
    # Stable cross-machine repo id (normalized remote URL, same as changes[]) so
    # the server can dedupe the same run reported from different clones. One git
    # call per repo — find emits a repo's runs consecutively, so cache the last.
    if [ -n "$rr" ] && [ "$rr" = "$last_rr" ]; then rid="$last_rid"
    else
      rid="$(git -C "$rr" config --get remote.origin.url 2>/dev/null || true)"
      [ -n "$rid" ] && rid="$(normalize_remote "$rid")"
      last_rr="$rr"; last_rid="$rid"
    fi
    started="$(dir_started "$rundir")"                  # run-dir birth ≈ created
    finished="$(file_mtime "$sj")"                      # state.json mtime ≈ last_updated
    doneflag=false; { [ "$phase" = "done" ] || [ "$step" = "done" ]; } && doneflag=true
    # Artifact mtimes = phase completion timestamps (spec → plan → … → retro).
    # The dashboard derives the phase funnel from these — no orchestrator change needed.
    local art="" a af
    for a in spec plan test-plan tests review security retro; do
      af="$rundir/$a.md"
      [ -f "$af" ] && art="$art,\"$a\":$(file_mtime "$af")"
    done
    art="{${art#,}}"
    ranked+=("${finished}${tab}{\"id\":\"$(json_escape "$id")\",\"type\":\"$(json_escape "$rtype")\",\"repo\":\"$(json_escape "$repo")\",\"repoId\":\"$(json_escape "$rid")\",\"branch\":\"$(json_escape "$branch")\",\"owner\":\"$(json_escape "$owner")\",\"ownerEmail\":\"$(json_escape "$oemail")\",\"size\":\"$(json_escape "$rsize")\",\"phase\":\"$(json_escape "$phase")\",\"started\":${started:-0},\"finished\":${finished:-0},\"done\":${doneflag},\"art\":${art}}")
    legacy_count=$((legacy_count + 1))
  done < "$RUN_PATH_CACHE"
  if [ "$legacy_count" -gt 0 ]; then
    if [ "$RUNS_SOURCE_SCHEMA" = "none" ]; then RUNS_SOURCE_SCHEMA="legacy-workflow"
    else RUNS_SOURCE_SCHEMA="${RUNS_SOURCE_SCHEMA}+legacy-workflow"
    fi
  fi
  if [ "${#ranked[@]}" -gt 0 ]; then
    RUNS_JSON="[$(printf '%s\n' "${ranked[@]}" | sort -t"$tab" -k1,1 -rn | awk -v n="${RUNS_CAP:-200}" 'NR<=n' | cut -f2- | paste -sd, -)]"
  else
    RUNS_JSON="[]"
  fi
}

# Report which git repos under SCAN_ROOTS differ from their shared default-
# branch merge base, including committed feature work and working-tree edits,
# plus changed line ranges so nested sub-repos show too.
# Two passes keep it affordable on a machine with dozens of dirty repos:
#   1. cheap — one merge-base `git diff --name-only` per repo to find active ones + when
#      they were last edited;
#   2. expensive — only the most-recently-edited CHANGES_REPO_CAP repos get the
#      full `--unified=0` line-range diff + JSON.
# Sets CHANGES_JSON to [{repoId, branch, path, label, files:[{path,ranges}]}].
# Heavy enough to run in the background (see maybe_scan).
scan_changes() {
  [ "$CONFLICTS" = "yes" ] || { CHANGES_JSON="[]"; return; }
  command -v git >/dev/null 2>&1 || { CHANGES_JSON="[]"; return; }
  refresh_discovery_cache
  local tab; tab="$(printf '\t')"

  # ── Pass 1: discover repos + recency (one git call each) ──
  # Dirty repos (uncommitted edits) are the priority. Clean repos with a commit
  # in the last 14d (any local branch) still qualify — otherwise finishing and
  # committing your work makes it vanish from the stats. `.git` matches as a
  # dir (normal clone) OR a file (linked worktree).
  local cand=() clean_cand=() gitdir root first mt count=0 base
  while IFS= read -r gitdir; do
    [ -n "$gitdir" ] || continue
    root=${gitdir%/.git}
    [ -e "$root/.git" ] || continue
    count=$((count + 1)); [ "$count" -le "${CONFLICT_REPO_SCAN_CAP:-600}" ] || break
    base="$(diff_base "$root")"
    first="$(git -C "$root" diff --name-only "$base" 2>/dev/null | head -1 || true)"
    if [ -n "$first" ]; then
      mt="$(file_mtime "$root/$first")"
      cand+=("${mt}${tab}${root}")
    else
      mt="$(git -C "$root" log -1 --since=14.days --branches --format=%ct 2>/dev/null | head -1 || true)"
      [ -n "$mt" ] || continue                      # clean AND idle 14d → skip
      clean_cand+=("${mt}${tab}${root}")
    fi
  done < "$GIT_PATH_CACHE"
  [ $(( ${#cand[@]} + ${#clean_cand[@]} )) -gt 0 ] || { CHANGES_JSON="[]"; return; }

  # ── Pass 2: full line-range diff for the top-N most-recently-edited repos ──
  # Dirty repos get the main cap; clean-but-recent repos ride a smaller side cap
  # so they can never crowd out live work. seen_ids dedupes repo-level stats
  # when one repoId appears as several roots (main checkout + worktrees, or a
  # second clone): only the first (most recent) root reports commits/work/
  # pushes/follow-ups — they all share the same refs, so letting every root
  # report them would double-count. Extra roots still report changed files,
  # which is exactly what cross-branch conflict detection needs.
  local repo_items=() rmt root2 url branch rel label primary seen_ids="|"
  # Feed = dirty repos (newest first, main cap) then clean repos (side cap).
  # Built as a variable + herestring — bash 3.2 mis-parses a multi-command
  # { …; …; } group inside < <(…) here.
  local feed="" cfeed=""
  if [ "${#cand[@]}" -gt 0 ]; then
    feed="$(printf '%s\n' "${cand[@]}" | sort -t"$tab" -k1,1 -rn | awk -v n="${CHANGES_REPO_CAP:-20}" 'NR<=n')"
  fi
  if [ "${#clean_cand[@]}" -gt 0 ]; then
    cfeed="$(printf '%s\n' "${clean_cand[@]}" | sort -t"$tab" -k1,1 -rn | awk -v n="${CLEAN_REPO_CAP:-10}" 'NR<=n')"
    if [ -n "$feed" ]; then feed="${feed}
${cfeed}"; else feed="$cfeed"; fi
  fi
  while IFS="$tab" read -r rmt root2; do
    [ -n "$root2" ] || continue
    url="$(git -C "$root2" config --get remote.origin.url 2>/dev/null || true)"
    [ -n "$url" ] || continue                       # need a remote to match across machines
    url="$(normalize_remote "$url")"
    case "$seen_ids" in
      *"|${url}|"*) primary=no ;;
      *) primary=yes; seen_ids="${seen_ids}${url}|" ;;
    esac
    branch="$(git -C "$root2" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [ -n "$branch" ] || branch="HEAD"
    # Disambiguators: home-relative folder path + optional `git config dashboard.label`.
    rel="$root2"; case "$root2" in "$HOME"/*) rel="~${root2#$HOME}" ;; esac
    label="$(git -C "$root2" config --get dashboard.label 2>/dev/null || true)"
    local file_items=() path ranges r_items r s e
    base="$(diff_base "$root2")"
    while IFS="$tab" read -r path ranges; do
      [ -n "$path" ] && [ "$path" != "/dev/null" ] || continue
      r_items=()
      for r in ${ranges//,/ }; do s=${r%-*}; e=${r#*-}; [ -n "$s" ] && r_items+=("[$s,$e]"); done
      [ "${#r_items[@]}" -gt 0 ] || continue
      file_items+=("{\"path\":\"$(json_escape "$path")\",\"ranges\":[$(join_csv "${r_items[@]}")]}")
    done < <(git -C "$root2" diff --unified=0 "$base" -- 2>/dev/null | awk -v max_ranges="${CONFLICT_RANGE_CAP:-200}" '
        /^\+\+\+ /{ f=$0; sub(/^\+\+\+ [ab]\//,"",f); sub(/^\+\+\+ /,"",f); next }
        /^@@ /{ p=$3; sub(/^\+/,"",p); n=split(p,a,","); s=a[1]+0; L=(n>1?a[2]+0:1); if(L<1)L=1;
                if(f!="" && f!="/dev/null" && count[f] < max_ranges){ rng[f]=rng[f] (rng[f]?",":"") s"-" (s+L-1); seen[f]=1; count[f]++ } }
        END{ for(f in seen) print f"\t"rng[f] }' | awk -v n="${CONFLICT_FILE_CAP:-80}" 'NR<=n')
    # A secondary root (same repoId already reported) with no changed files has
    # nothing left to contribute; a primary root stays even file-less (clean
    # repo — its commits/work still count).
    if [ "${#file_items[@]}" -eq 0 ] && [ "$primary" = "no" ]; then continue; fi
    # Repo-level stats — primary root only (see seen_ids above). All git log
    # calls use --branches: commits land on whatever branch you were on, not
    # just the one checked out right now (same commit on N branches still
    # counts once — git log dedupes by hash).
    local commits="" fu fu_open=0 fu_closed=0
    local me work="" pushes="" gitdir
    if [ "$primary" = "yes" ]; then
    # Commit activity (all authors, all local branches, last 14d, per day) +
    # /dev follow-up backlog.
    commits="$(git -C "$root2" log --branches --since=14.days --date=short --pretty='%ad' 2>/dev/null \
      | sort | uniq -c | awk '{printf "%s{\"date\":\"%s\",\"n\":%d}", (NR>1?",":""), $2, $1}')"
    # MY work in this repo: commits + lines added/deleted per day (author = this
    # repo's git identity), and pushes per day from the remote-ref reflogs —
    # "update by push" entries only exist on the machine that pushed.
    me="$(git -C "$root2" config user.name 2>/dev/null || true)"
    work="$({ git -C "$root2" log --branches --since=14.days --author="$me" --date=short --pretty='C|%ad' --numstat 2>/dev/null || true; } \
      | awk -F'\t' '
        /^C\|/ { split($0, x, "|"); cur = x[2]; C[cur]++; next }
        NF >= 3 && cur != "" { if ($1 != "-") A[cur] += $1; if ($2 != "-") D[cur] += $2 }
        END {
          first = 1
          for (d in C) {
            if (!first) printf ","
            first = 0
            printf "{\"date\":\"%s\",\"commits\":%d,\"added\":%d,\"deleted\":%d}", d, C[d], A[d]+0, D[d]+0
          }
        }')"
    gitdir="$(git -C "$root2" rev-parse --git-common-dir 2>/dev/null)"
    case "$gitdir" in /*) ;; *) gitdir="$root2/$gitdir" ;; esac
    pushes="$({ cat "$gitdir/logs/refs/remotes"/*/* 2>/dev/null || true; } \
      | awk -v tzoff="$TZ_OFF" -v cutsec="$(( $(date +%s) - 14 * 86400 ))" '
        function cfd(z,   era, doe, yoe, doy, mp, d, m, y) {
          z += 719468
          era = int((z >= 0 ? z : z - 146096) / 146097)
          doe = z - era * 146097
          yoe = int((doe - int(doe/1460) + int(doe/36524) - int(doe/146096)) / 365)
          y = yoe + era * 400
          doy = doe - (365 * yoe + int(yoe/4) - int(yoe/100))
          mp = int((5 * doy + 2) / 153)
          d = doy - int((153 * mp + 2) / 5) + 1
          m = mp + (mp < 10 ? 3 : -9)
          y += (m <= 2 ? 1 : 0)
          return sprintf("%04d-%02d-%02d", y, m, d)
        }
        /update by push/ {
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$/ && $(i+1) ~ /^[+-][0-9][0-9][0-9][0-9]/) {
              if ($i + 0 >= cutsec) P[cfd(int(($i + tzoff) / 86400))]++
              break
            }
          }
        }
        END {
          first = 1
          for (d in P) {
            if (!first) printf ","
            first = 0
            printf "{\"date\":\"%s\",\"n\":%d}", d, P[d]
          }
        }')"
    if [ -f "$root2/.workflow/FOLLOWUPS.md" ]; then
      fu="$(awk '/^## Open/{s=1} /^## Closed/{s=2} /^\| *F/{ if(s==1)o++; else if(s==2)c++ } END{printf "%d %d", o+0, c+0}' "$root2/.workflow/FOLLOWUPS.md" 2>/dev/null)"
      fu_open="${fu%% *}"; fu_closed="${fu##* }"
    fi
    fi  # primary
    repo_items+=("{\"repoId\":\"$(json_escape "$url")\",\"branch\":\"$(json_escape "$branch")\",\"path\":\"$(json_escape "$rel")\",\"label\":\"$(json_escape "$label")\",\"commits\":[${commits}],\"work\":[${work}],\"pushes\":[${pushes}],\"fuOpen\":${fu_open:-0},\"fuClosed\":${fu_closed:-0},\"files\":[$(join_csv ${file_items[@]+"${file_items[@]}"})]}")
  done <<< "$feed"

  CHANGES_JSON="[$(join_csv ${repo_items[@]+"${repo_items[@]}"})]"
}

# Aggregate Claude Code token usage per (day, model) from the local transcript
# JSONL files (~/.claude/projects/**/*.jsonl). Each assistant line carries
# `message.model` + `message.usage`; lines are deduped by message id (resumes /
# compaction copy history into new session files). Heavy (transcripts run to
# GBs), so it reuses its own cache and reaggregates at most every USAGE_INTERVAL.
scan_usage() {
  [ "$USAGE" = "yes" ] || { USAGE_JSON="[]"; SESSIONS_JSON="[]"; TOOLS_JSON="[]"; return; }
  local now age
  now="$(date +%s)"
  if [ -s "$USAGE_CACHE" ]; then
    age=$(( now - $(file_mtime "$USAGE_CACHE") ))
    if [ "$age" -lt "$USAGE_INTERVAL" ]; then
      USAGE_JSON="$(sed -n 1p "$USAGE_CACHE" 2>/dev/null)"
      SESSIONS_JSON="$(sed -n 2p "$USAGE_CACHE" 2>/dev/null)"
      TOOLS_JSON="$(sed -n 3p "$USAGE_CACHE" 2>/dev/null)"
      [ -n "$USAGE_JSON" ] || USAGE_JSON="[]"
      [ -n "$SESSIONS_JSON" ] || SESSIONS_JSON="[]"
      [ -n "$TOOLS_JSON" ] || TOOLS_JSON="[]"
      return
    fi
  fi
  local proj="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
  [ -d "$proj" ] || { USAGE_JSON="[]"; SESSIONS_JSON="[]"; TOOLS_JSON="[]"; return; }
  local helper="$(dirname "$SCRIPT_PATH")/usage-scan.mjs"
  if command -v node >/dev/null 2>&1 && [ -f "$helper" ]; then
    local incremental
    if incremental="$(node "$helper" "$proj" "$USAGE_STATE" "$USAGE_DAYS" "${USAGE_FILE_CAP:-4000}" 2>/dev/null)"; then
      USAGE_JSON="$(printf '%s\n' "$incremental" | sed -n 1p)"
      SESSIONS_JSON="$(printf '%s\n' "$incremental" | sed -n 2p)"
      TOOLS_JSON="$(printf '%s\n' "$incremental" | sed -n 3p)"
      printf '%s\n%s\n%s' "$USAGE_JSON" "$SESSIONS_JSON" "$TOOLS_JSON" > "$USAGE_CACHE.tmp" 2>/dev/null \
        && mv "$USAGE_CACHE.tmp" "$USAGE_CACHE" 2>/dev/null
      return
    fi
    warn "incremental usage scan failed; falling back to a full streaming scan"
  fi
  local cut_epoch cutoff
  cut_epoch=$(( now - USAGE_DAYS * 86400 ))
  cutoff="$(date -r "$cut_epoch" +%Y-%m-%d 2>/dev/null || date -d "@$cut_epoch" +%Y-%m-%d 2>/dev/null || echo 1970-01-01)"
  local tzoff="$TZ_OFF"
  local files=() f out
  while IFS= read -r f; do [ -n "$f" ] && files+=("$f"); done \
    < <(find "$proj" -name '*.jsonl' -type f -mtime "-$USAGE_DAYS" 2>/dev/null | awk -v n="${USAGE_FILE_CAP:-4000}" 'NR<=n')
  if [ "${#files[@]}" -eq 0 ]; then
    USAGE_JSON="[]"; SESSIONS_JSON="[]"; TOOLS_JSON="[]"
  else
    # One streaming pass over the transcripts. Emits THREE lines:
    #   1: usage rows per (date, model, project)   2: sessions per date   3: tool-call counts
    out="$(awk -v cutoff="$cutoff" -v tzoff="$tzoff" '
      # Civil-date <-> day-serial math (Hinnant) for shifting UTC dates to local.
      function dfc(y, m, d,   era, yoe, doy, doe) {
        y = y - (m <= 2 ? 1 : 0)
        era = int((y >= 0 ? y : y - 399) / 400)
        yoe = y - era * 400
        doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
        doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
        return era * 146097 + doe - 719468
      }
      function cfd(z,   era, doe, yoe, doy, mp, d, m, y) {
        z += 719468
        era = int((z >= 0 ? z : z - 146096) / 146097)
        doe = z - era * 146097
        yoe = int((doe - int(doe/1460) + int(doe/36524) - int(doe/146096)) / 365)
        y = yoe + era * 400
        doy = doe - (365 * yoe + int(yoe/4) - int(yoe/100))
        mp = int((5 * doy + 2) / 153)
        d = doy - int((153 * mp + 2) / 5) + 1
        m = mp + (mp < 10 ? 3 : -9)
        y += (m <= 2 ? 1 : 0)
        return sprintf("%04d-%02d-%02d", y, m, d)
      }
      index($0, "\"usage\"") == 0 { next }
      index($0, "\"type\":\"assistant\"") == 0 { next }
      {
        if (match($0, /"model":"[^"]*"/) == 0) next
        model = substr($0, RSTART+9, RLENGTH-10)
        if (model == "" || model == "<synthetic>") next
        if (match($0, /"timestamp":"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) == 0) next
        date = substr($0, RSTART+13, 10)
        tsec = substr($0, RSTART+24, 2)*3600 + substr($0, RSTART+27, 2)*60 + substr($0, RSTART+30, 2)
        tsec += tzoff
        if (tsec < 0)          { tsec += 86400; date = cfd(dfc(substr(date,1,4)+0, substr(date,6,2)+0, substr(date,9,2)+0) - 1) }
        else if (tsec >= 86400) { tsec -= 86400; date = cfd(dfc(substr(date,1,4)+0, substr(date,6,2)+0, substr(date,9,2)+0) + 1) }
        if (date < cutoff) next
        mid = ""
        if (match($0, /"id":"[^"]*"/)) mid = substr($0, RSTART+6, RLENGTH-7)
        if (mid != "") { if (mid in seen) next; seen[mid] = 1 }
        proj = ""
        if (match($0, /"cwd":"[^"]*"/)) {
          np = split(substr($0, RSTART+7, RLENGTH-8), pp, "/")
          proj = pp[np]
        }
        it = 0; ot = 0; cc = 0; cr = 0
        if (match($0, /"input_tokens":[0-9]+/))                it = substr($0, RSTART+15, RLENGTH-15) + 0
        if (match($0, /"output_tokens":[0-9]+/))                ot = substr($0, RSTART+16, RLENGTH-16) + 0
        if (match($0, /"cache_creation_input_tokens":[0-9]+/))  cc = substr($0, RSTART+30, RLENGTH-30) + 0
        if (match($0, /"cache_read_input_tokens":[0-9]+/))      cr = substr($0, RSTART+26, RLENGTH-26) + 0
        if (it + ot + cc + cr == 0) next
        k = date "|" model "|" proj
        I[k] += it; O[k] += ot; CC[k] += cc; CR[k] += cr; N[k]++
        sk = FILENAME "|" date
        if (!(sk in MN)) { MN[sk] = tsec; MX[sk] = tsec } else { if (tsec < MN[sk]) MN[sk] = tsec; if (tsec > MX[sk]) MX[sk] = tsec }
        rest = $0
        while (match(rest, /"type":"tool_use","id":"[^"]*","name":"[^"]*"/)) {
          seg = substr(rest, RSTART, RLENGTH)
          rest = substr(rest, RSTART + RLENGTH)
          if (match(seg, /"name":"[^"]*"$/)) T[date "|" substr(seg, RSTART+8, RLENGTH-9)]++
        }
      }
      END {
        printf "["
        first = 1
        for (k in I) {
          split(k, p, "|")
          if (!first) printf ","
          first = 0
          gsub(/\\/, "\\\\", p[2]); gsub(/\"/, "\\\"", p[2])
          gsub(/\\/, "\\\\", p[3]); gsub(/\"/, "\\\"", p[3])
          printf "{\"date\":\"%s\",\"model\":\"%s\",\"project\":\"%s\",\"input\":%.0f,\"output\":%.0f,\"cacheCreate\":%.0f,\"cacheRead\":%.0f,\"count\":%.0f}", p[1], p[2], p[3], I[k], O[k], CC[k], CR[k], N[k]
        }
        printf "]\n["
        for (sk in MN) { split(sk, q, "|"); d = q[2]; SC[d]++; SS[d] += MX[sk] - MN[sk] }
        first = 1
        for (d in SC) {
          if (!first) printf ","
          first = 0
          printf "{\"date\":\"%s\",\"count\":%d,\"seconds\":%.0f}", d, SC[d], SS[d]
        }
        printf "]\n["
        first = 1
        for (t in T) {
          split(t, tp, "|"); tool = tp[2]
          gsub(/\\/, "\\\\", tool); gsub(/\"/, "\\\"", tool)
          if (!first) printf ","
          first = 0
          printf "{\"date\":\"%s\",\"tool\":\"%s\",\"count\":%.0f}", tp[1], tool, T[t]
        }
        printf "]"
      }' "${files[@]}" 2>/dev/null)"
    USAGE_JSON="$(printf '%s\n' "$out" | sed -n 1p)"
    SESSIONS_JSON="$(printf '%s\n' "$out" | sed -n 2p)"
    TOOLS_JSON="$(printf '%s\n' "$out" | sed -n 3p)"
    [ -n "$USAGE_JSON" ] || USAGE_JSON="[]"
    [ -n "$SESSIONS_JSON" ] || SESSIONS_JSON="[]"
    [ -n "$TOOLS_JSON" ] || TOOLS_JSON="[]"
  fi
  printf '%s\n%s\n%s' "$USAGE_JSON" "$SESSIONS_JSON" "$TOOLS_JSON" > "$USAGE_CACHE.tmp" 2>/dev/null \
    && mv "$USAGE_CACHE.tmp" "$USAGE_CACHE" 2>/dev/null
}

# PRs I created in the last 14 days, counted per day via the gh CLI (one
# `gh search prs` call covers every repo). Skips silently when gh is missing
# or unauthenticated; throttled by PR_INTERVAL because it hits the GitHub API.
scan_prs() {
  PRS_JSON="[]"
  command -v gh >/dev/null 2>&1 || return 0
  local now age since
  now="$(date +%s)"
  if [ -s "$PRS_CACHE" ]; then
    age=$(( now - $(file_mtime "$PRS_CACHE") ))
    if [ "$age" -lt "$PR_INTERVAL" ]; then
      PRS_JSON="$(cat "$PRS_CACHE" 2>/dev/null)"
      PRS_JSON="${PRS_JSON:-[]}"
      return 0
    fi
  fi
  since="$(date -r "$(( now - 14 * 86400 ))" +%Y-%m-%d 2>/dev/null || date -d "@$(( now - 14 * 86400 ))" +%Y-%m-%d 2>/dev/null)"
  PRS_JSON="$({ gh search prs --author "@me" --created ">=$since" --json createdAt --limit 100 2>/dev/null || true; } \
    | { grep -o '"createdAt":"[^"]*"' || true; } | cut -d'"' -f4 | cut -c1-10 | sort | uniq -c \
    | awk '{printf "%s{\"date\":\"%s\",\"n\":%d}", (NR>1?",":""), $2, $1}')"
  PRS_JSON="[${PRS_JSON}]"
  printf '%s' "$PRS_JSON" > "$PRS_CACHE.tmp" 2>/dev/null && mv "$PRS_CACHE.tmp" "$PRS_CACHE" 2>/dev/null
}

# Run the scans and atomically publish their results to the cache files.
# (scan_usage publishes its own cache — it throttles itself off that file's age.)
run_scans_to_cache() {
  scan_runs
  scan_changes
  scan_usage
  scan_prs
  printf '%s' "$RUNS_JSON" > "$RUNS_CACHE.tmp" 2>/dev/null && mv "$RUNS_CACHE.tmp" "$RUNS_CACHE" 2>/dev/null
  # scan_runs derives these alongside RUNS_JSON, but this whole function runs in
  # a detached subshell — anything not published to a cache file dies with it.
  printf '%s\n%s' "$RUNS_SOURCE_SCHEMA" "$RUNS_FOUNDATION_VERSION" > "$RUNS_META_CACHE.tmp" 2>/dev/null \
    && mv "$RUNS_META_CACHE.tmp" "$RUNS_META_CACHE" 2>/dev/null
  printf '%s' "$CHANGES_JSON" > "$CHG_CACHE.tmp" 2>/dev/null && mv "$CHG_CACHE.tmp" "$CHG_CACHE" 2>/dev/null
  rm -f "$SCAN_LOCK"
}

# Kick a *background* scan at most once per SCAN_INTERVAL (skipping if one is
# still running) so the heavy repo walk never delays a heartbeat.
maybe_scan() {
  local now; now="$(date +%s)"
  [ "$(( now - LAST_SCAN ))" -ge "$SCAN_INTERVAL" ] || return 0
  if [ -f "$SCAN_LOCK" ]; then
    local lt; lt="$(file_mtime "$SCAN_LOCK")"
    [ "$(( now - lt ))" -lt 300 ] && return 0       # a scan is still in flight
    rm -f "$SCAN_LOCK"                              # stale lock — reclaim
  fi
  LAST_SCAN="$now"
  : > "$SCAN_LOCK"
  ( run_scans_to_cache ) &
  disown 2>/dev/null || true
}

# Load the latest published scan results into the payload vars.
load_cache() {
  [ -s "$RUNS_CACHE" ] && RUNS_JSON="$(cat "$RUNS_CACHE" 2>/dev/null)"
  if [ -s "$RUNS_META_CACHE" ]; then
    RUNS_SOURCE_SCHEMA="$(sed -n 1p "$RUNS_META_CACHE" 2>/dev/null)"
    RUNS_FOUNDATION_VERSION="$(sed -n 2p "$RUNS_META_CACHE" 2>/dev/null)"
  fi
  [ -s "$CHG_CACHE" ] && CHANGES_JSON="$(cat "$CHG_CACHE" 2>/dev/null)"
  if [ "$USAGE" = "yes" ] && [ -s "$USAGE_CACHE" ]; then
    USAGE_JSON="$(sed -n 1p "$USAGE_CACHE" 2>/dev/null)"
    SESSIONS_JSON="$(sed -n 2p "$USAGE_CACHE" 2>/dev/null)"
    TOOLS_JSON="$(sed -n 3p "$USAGE_CACHE" 2>/dev/null)"
  fi
  [ -s "$PRS_CACHE" ] && PRS_JSON="$(cat "$PRS_CACHE" 2>/dev/null)"
  [ -n "$RUNS_JSON" ] || RUNS_JSON="[]"
  [ -n "$RUNS_SOURCE_SCHEMA" ] || RUNS_SOURCE_SCHEMA="none"
  [ -n "$RUNS_FOUNDATION_VERSION" ] || RUNS_FOUNDATION_VERSION="unknown"
  [ -n "$CHANGES_JSON" ] || CHANGES_JSON="[]"
  [ -n "$USAGE_JSON" ] || USAGE_JSON="[]"
  [ -n "$SESSIONS_JSON" ] || SESSIONS_JSON="[]"
  [ -n "$TOOLS_JSON" ] || TOOLS_JSON="[]"
  [ -n "$PRS_JSON" ] || PRS_JSON="[]"
}

build_payload() {
  local changes="${2:-$CHANGES_JSON}" usage_rows="${3:-$USAGE_JSON}"
  local session_rows="${4:-$SESSIONS_JSON}" tool_rows="${5:-$TOOLS_JSON}"
  local run_rows="${6:-$RUNS_JSON}" pr_rows="${7:-$PRS_JSON}"
  printf '{"agentId":"%s","gitUser":"%s","gitEmail":"%s","host":"%s","version":"%s","sourceSchema":"%s","foundationVersion":"%s","status":"%s","runs":%s,"changes":%s,"usage":%s,"sessions":%s,"tools":%s,"prs":%s}' \
    "$(json_escape "$AGENT_ID")" "$(json_escape "$GIT_USER")" "$(json_escape "${GIT_EMAIL:-}")" \
    "$(json_escape "$HOST")" "$(json_escape "$CLIENT_VERSION")" "$(json_escape "$RUNS_SOURCE_SCHEMA")" \
    "$(json_escape "$RUNS_FOUNDATION_VERSION")" "$1" "$run_rows" "$changes" "$usage_rows" "$session_rows" "$tool_rows" "$pr_rows"
}

payload_bytes() { LC_ALL=C printf '%s' "$1" | wc -c | tr -d ' '; }

compact_changes() {
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$CHANGES_JSON" | node -e '
      let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
        try { process.stdout.write(JSON.stringify(JSON.parse(raw).map(r=>({...r,files:[]})))) }
        catch { process.stdout.write("[]") }
      })'
  else
    printf '[]'
  fi
}

bounded_payload() {
  local status=$1 payload bytes summarized_changes
  payload="$(build_payload "$status")"
  bytes="$(payload_bytes "$payload")"
  if [ "$bytes" -gt "$MAX_PAYLOAD_BYTES" ]; then
    warn "heartbeat payload ${bytes}B exceeds ${MAX_PAYLOAD_BYTES}B; omitting detailed change ranges"
    summarized_changes="$(compact_changes)"
    payload="$(build_payload "$status" "$summarized_changes")"
    bytes="$(payload_bytes "$payload")"
  fi
  if [ "$bytes" -gt "$MAX_PAYLOAD_BYTES" ]; then
    warn "heartbeat payload remains ${bytes}B; sending presence without usage aggregates"
    payload="$(build_payload "$status" "${summarized_changes:-[]}" "[]" "[]" "[]")"
    bytes="$(payload_bytes "$payload")"
  fi
  if [ "$bytes" -gt "$MAX_PAYLOAD_BYTES" ]; then
    warn "aggregate payload remains ${bytes}B; sending minimal presence"
    payload="$(build_payload "$status" "[]" "[]" "[]" "[]" "[]" "[]")"
    bytes="$(payload_bytes "$payload")"
  fi
  [ "$bytes" -le "$MAX_PAYLOAD_BYTES" ] || fail "minimal heartbeat exceeds payload limit"
  printf '%s' "$payload"
}

beat() {
  local status="$1" resp code body payload
  payload="$(bounded_payload "$status")"
  resp="$(printf '%s' "$payload" | curl -sS -m 10 -w $'\n%{http_code}' \
    -X POST "$SERVER/api/heartbeat" \
    -H 'content-type: application/json' \
    -H "x-cf-key: $KEY" \
    --data-binary @- 2>/dev/null)" || { warn "network error — will retry"; return 1; }
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  case "$code" in
    200) local n; n="$(printf '%s' "$body" | sed -n 's/.*"onlineCount":\([0-9]*\).*/\1/p')"
         ok "online as ${G}${GIT_USER}${N}  ${D}· ${n:-?} online · $(date +%H:%M:%S)${N}"; return 0 ;;
    401) fail "key rejected by server (401) — check --key" ;;
    *)   warn "server returned HTTP ${code:-?} — will retry"; return 1 ;;
  esac
}

on_term() { printf '\n'; info "signing off…"; beat offline >/dev/null 2>&1 || true; exit 0; }

run_loop() {
  validate
  derive_identity
  trap on_term INT TERM
  info "dashboard: ${SERVER}"
  info "agent:     ${GIT_USER} ${D}(${AGENT_ID:0:8} @ ${HOST})${N}"
  if [ "$ACTIVITY" = "yes" ]; then
    info "runs:      scanning ${#SCAN_ROOTS[@]} root(s) for /dev runs (activity + stats) every ${SCAN_INTERVAL}s ${D}(--no-activity to disable)${N}"
  fi
  if [ "$CONFLICTS" = "yes" ]; then
    info "conflicts: scanning git repos in the background for changed files/lines ${D}(top ${CHANGES_REPO_CAP:-20} by recency · --no-conflicts to disable)${N}"
  fi
  if [ "$USAGE" = "yes" ]; then
    info "usage:     aggregating Claude token/model usage over ${USAGE_DAYS}d, refreshed every ${USAGE_INTERVAL}s ${D}(--no-usage to disable)${N}"
  fi
  # --once: run the scans synchronously so the single beat carries fresh data.
  if [ "$ONCE" = "yes" ]; then scan_runs; scan_changes; scan_usage; scan_prs; beat online; exit 0; fi
  info "heartbeat every ${INTERVAL}s — press Ctrl-C to stop"
  # Presence is never blocked by scanning: the first beat fires immediately, the
  # heavy repo scan runs detached (writes a cache), and beats load whatever the
  # cache has. `sleep & wait` keeps the sleep interruptible so a TERM/INT runs
  # on_term immediately (offline beat fires).
  rm -f "$SCAN_LOCK"          # clear any stale lock left by a previous run
  beat online || true        # instant presence
  maybe_scan                 # kick the first background scan
  while true; do
    sleep "$INTERVAL" &
    wait $! 2>/dev/null || true
    load_cache               # pick up the latest finished scan
    beat online || true
    maybe_scan               # kick the next one if due
  done
}

# ── Dispatch ────────────────────────────────────────────────────────────────
if [ "${CF_DASHBOARD_TEST_MODE:-0}" != "1" ]; then
case "$MODE" in
  status)
    if is_running; then
      ok "dashboard client running ${D}(pid $(daemon_pid))${N}"
      info "log: $LOGFILE"
    else
      warn "dashboard client is not running"
      [ -f "$PIDFILE" ] && rm -f "$PIDFILE"
      rm -f "$PIDSTART"
      exit 1
    fi
    ;;

  down)
    if is_running; then
      pid="$(daemon_pid)"
      info "stopping dashboard client ${D}(pid $pid)${N}…"
      kill "$pid" 2>/dev/null || true
      # Give the client time to send its offline beat before forcing the issue.
      n=0; while is_running && [ "$n" -lt 12 ]; do sleep 0.5; n=$((n + 1)); done
      if is_running; then kill -9 "$pid" 2>/dev/null || true; fi
      rm -f "$PIDFILE" "$PIDSTART"
      ok "stopped"
    else
      warn "dashboard client is not running"
      [ -f "$PIDFILE" ] && rm -f "$PIDFILE"
      rm -f "$PIDSTART"
    fi
    ;;

  up)
    validate
    if is_running; then
      warn "already running ${D}(pid $(daemon_pid))${N} — use 'dashboard-down' first"
      exit 0
    fi
    mkdir -p "$STATE_DIR"
    : > "$LOGFILE"
    nohup bash "$SCRIPT_PATH" run ${ARGS[@]+"${ARGS[@]}"} >>"$LOGFILE" 2>&1 &
    child=$!
    printf '%s\n' "$child" > "$PIDFILE"
    process_started "$child" > "$PIDSTART"
    disown "$child" 2>/dev/null || true
    sleep 1
    if is_running; then
      ok "dashboard client started in background ${D}(pid $child)${N}"
      info "server: ${SERVER}"
      info "stop with: ${B}claude-foundation dashboard-down${N}   ·   log: $LOGFILE"
    else
      warn "client exited immediately — last log lines:"
      tail -n 3 "$LOGFILE" >&2 || true
      rm -f "$PIDFILE" "$PIDSTART"
      exit 1
    fi
    ;;

  run|*)
    run_loop
    ;;
esac
fi
