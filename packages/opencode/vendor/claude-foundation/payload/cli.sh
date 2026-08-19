#!/usr/bin/env bash
# claude-foundation — top-level CLI router.
#
# Keeps each command single-purpose: this file only routes, install.sh only
# installs, dashboard/client.sh only does presence. New subcommands slot in
# here without piling into the installer.
#
# Public workflow commands resolve the current Foundation project and forward to
# its installed runtime. The runtime remains project-owned so its schemas,
# commands, and evidence protocol upgrade together.
#
# Siblings are located relative to this script, so it works the same from a
# source checkout and from the Homebrew libexec.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_RUNTIME_API=24
PROJECT_START="${CLAUDE_FOUNDATION_PROJECT:-$PWD}"

fail() { printf 'claude-foundation: %s\n' "$*" >&2; exit 1; }
warn() { printf 'claude-foundation: warning: %s\n' "$*" >&2; }

find_project_root() {
  local cursor="$PROJECT_START"
  [ -d "$cursor" ] || cursor="$(dirname "$cursor")"
  cursor="$(cd "$cursor" 2>/dev/null && pwd)" ||
    fail "cannot access project path: $PROJECT_START"
  while :; do
    if [ -f "$cursor/openspec/config.yaml" ] &&
       [ -f "$cursor/.claude/harness/foundation.mjs" ]; then
      # A Build sandbox is a full copy of the project, marker files included.
      # Resolving to the copy would split runtime state between the sandbox's
      # .foundation/ and the project's, so resolution walks past a sandbox
      # unless CLAUDE_FOUNDATION_PROJECT deliberately pins one.
      case "${CLAUDE_FOUNDATION_PROJECT:+pinned}:$cursor" in
        pinned:*)
          printf '%s\n' "$cursor"
          return
          ;;
        *:*/.foundation/sandboxes/*|*:*/.foundation/repository-sandboxes/*)
          warn "ignoring sandbox copy at $cursor; resolving the project root"
          ;;
        *)
          printf '%s\n' "$cursor"
          return
          ;;
      esac
    fi
    [ "$cursor" != "/" ] || break
    cursor="$(dirname "$cursor")"
  done
  fail "not inside a Foundation project; run 'claude-foundation init <path>' first"
}

run_runtime() {
  local access="$1"; shift
  local root runtime actual_api telemetry
  root="$(find_project_root)"
  runtime="$root/.claude/harness/foundation.mjs"
  command -v node >/dev/null 2>&1 || fail "Node.js is required to run the project harness"
  cd "$root"
  actual_api="$(node "$runtime" api-version 2>/dev/null || true)"
  if [ "$actual_api" != "$EXPECTED_RUNTIME_API" ]; then
    if [ "$access" = "write" ]; then
      fail "project runtime API '${actual_api:-unknown}' is incompatible with CLI API '$EXPECTED_RUNTIME_API'; run 'claude-foundation init \"$root\"' to update it"
    fi
    printf "claude-foundation: warning: project runtime API '%s' differs from CLI API '%s'\n" \
      "${actual_api:-unknown}" "$EXPECTED_RUNTIME_API" >&2
  fi
  local phase=""
  case "${1:-}" in
    new|start|resolve|validate|audit-change|abandon|waive|evidence-detect|evidence-init|evidence-doctor|evidence-upgrade) phase="change" ;;
    sandbox|agent-plan|agent-dispatch|agent-acquire|agent-release) phase="build" ;;
    proof-plan|proof-readiness|proof-advance|proof-run|proof-collect|proof-preflight|proof-execute|proof-audit|prove|receipt|run-provider|evidence-verify-ci|authority-request|authority-dispatch|authority-run|authority-abort|authority-status|authority-record|authority-reset-infra) phase="prove" ;;
    handoff-status|handoff-packet|handoff-record|land-check|land-recover|land-plan|land-record|land-pointers|land-resume|archive) phase="land" ;;
  esac
  telemetry=1
  [ "$access" != "inspect" ] || telemetry=0
  FOUNDATION_TELEMETRY="$telemetry" FOUNDATION_PUBLIC_OPERATION="$phase" exec node "$runtime" "$@"
}

need_arg() {
  [ -n "${2:-}" ] || fail "$1 requires an argument"
}

deprecated_install() {
  printf "claude-foundation: warning: implicit installation is deprecated; use 'claude-foundation init ...'\n" >&2
  exec bash "$SCRIPT_DIR/install.sh" "$@" --source "$SCRIPT_DIR"
}

# VERSION file is the single machine-readable source of truth (bumped at release
# time — see RELEASING.md). Fall back to `git describe` for a source checkout
# whose file was deleted; "unknown" only if both are unavailable.
print_version() {
  local v="" describe="" git_root="" source_root=""
  if [ -f "$SCRIPT_DIR/VERSION" ]; then
    v="$(tr -d '[:space:]' < "$SCRIPT_DIR/VERSION")"
  fi
  if command -v git >/dev/null 2>&1; then
    git_root="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
    source_root="$(cd "$SCRIPT_DIR" 2>/dev/null && pwd -P || true)"
  fi
  if [ -n "$git_root" ] && [ "$(cd "$git_root" && pwd -P)" = "$source_root" ]; then
    describe="$(git -C "$SCRIPT_DIR" describe --tags --always --dirty 2>/dev/null || true)"
    describe="${describe#v}"
    if [ -z "$v" ]; then
      v="$describe"
    elif [ -n "$describe" ] && [ "$describe" != "$v" ]; then
      v="$v+source.$describe"
    fi
  fi
  printf 'claude-foundation %s\n' "${v:-unknown}"
}

usage() {
  local registry="$SCRIPT_DIR/.claude/harness/commands.json"
  [ -f "$registry" ] || fail "command registry not found: $registry"
  node - "$registry" "${1:-}" <<'NODE'
const fs = require("fs");
const registry = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const showAll = process.argv[3] === "--all";
const groups = showAll
  ? [["Workflow", "agent"], ["Conditional recovery", "conditional"],
     ["Administration", "admin"], ["Host integration", "host"],
     ["Internal compatibility", "internal"]]
  : [["Workflow", "agent"], ["Conditional recovery", "conditional"]];
console.log("claude-foundation — OpenSpec-native software-change harness\n");
for (const [title, audience] of groups) {
  const rows = registry.commands.filter((command) => command.audience === audience);
  if (!rows.length) continue;
  console.log(`${title}:`);
  for (const command of rows) {
    const deprecated = command.deprecated ? " [deprecated]" : "";
    console.log(`  claude-foundation ${command.usage}${deprecated}`);
    console.log(`    ${command.description}`);
  }
  console.log("");
}
console.log("Global options: --project <path>, -C <path>");
console.log("Workflow: /investigate → /change → /build → /prove → /land");
console.log("Normal use: describe the outcome to your coding agent; it runs recovery and CLI details for you.");
if (!showAll) console.log("Run `claude-foundation help --all` for host and compatibility commands.");
NODE
}

case "${1:-}" in
  --project|-C)
    [ "$#" -ge 2 ] || fail "$1 needs a path"
    PROJECT_START="$2"
    shift 2 ;;
esac

# commands.json promises "every command also answers --help". Route it to
# `describe` before the per-command argument checks below, which otherwise
# reject it as an unexpected argument for every zero-argument command.
case "${1:-}" in
  ""|help|--help|-h|version|--version|-v|describe|host) : ;;
  *)
    for arg in "$@"; do
      [ "$arg" = "--help" ] || continue
      help_target="$1"
      case "${2:-}" in ""|--*) ;; *) help_target="$1 $2" ;; esac
      run_runtime inspect describe "$help_target"
    done ;;
esac

case "${1:-}" in
  version|--version|-v)
    print_version; exit 0 ;;
  describe)
    shift
    [ "$#" -le 2 ] || fail "describe accepts [command] [--json]"
    run_runtime inspect describe "$@" ;;
  help|--help|-h)
    [ "$#" -le 2 ] || fail "help accepts only --all"
    [ "${2:-}" != "" ] && [ "${2:-}" != "--all" ] && fail "help accepts only --all"
    usage "${2:-}"; exit 0 ;;
  host)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      agent-contract)
        command -v node >/dev/null 2>&1 || fail "Node.js is required to resolve the host agent contract"
        if [ "${1:-}" = "--help" ] && [ "$#" -eq 1 ]; then
          printf '%s\n' \
            'claude-foundation host agent-contract [--protocol 1] [--format json]' \
            'Return the package-owned Foundation agent contract as protocol-1 JSON.'
          exit 0
        fi
        exec node "$SCRIPT_DIR/.claude/harness/runtime/core/host-agent-contract.mjs" "$@" ;;
      instruction)
        command -v node >/dev/null 2>&1 || fail "Node.js is required to resolve host instructions"
        if [ "${1:-}" = "--help" ] && [ "$#" -eq 1 ]; then
          printf '%s\n' \
            'claude-foundation host instruction <command> [--protocol 1] [--format json] [--arguments <text>]' \
            'Return a package-owned Foundation workflow instruction as protocol-1 JSON.'
          exit 0
        fi
        exec node "$SCRIPT_DIR/.claude/harness/runtime/core/host-instruction.mjs" "$@" ;;
      *) fail "host requires 'agent-contract' or 'instruction'" ;;
    esac ;;
  init)
    # Explicit alias for the installer. `--host` picks the adapter (every
    # adapter layers over install.sh); the rest of the surface
    # (`[target-path] [options]`) is the installer's, unchanged.
    shift
    host=claude
    init_args=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --host)
          [ "$#" -ge 2 ] || fail "--host needs one of: claude, cursor, opencode, codex"
          host="$2"; shift 2 ;;
        --host=*)
          host="${1#--host=}"; shift ;;
        *) init_args+=("$1"); shift ;;
      esac
    done
    case "$host" in
      claude|claude-code) installer="install.sh" ;;
      cursor) installer="install-cursor.sh" ;;
      opencode) installer="install-opencode.sh" ;;
      codex) installer="install-codex.sh" ;;
      *) fail "unknown host '$host'; expected claude, cursor, opencode, or codex" ;;
    esac
    exec bash "$SCRIPT_DIR/$installer" ${init_args[@]+"${init_args[@]}"} --source "$SCRIPT_DIR" ;;
  providers)
    shift; [ "$#" -eq 0 ] || fail "providers takes no arguments"
    run_runtime read providers ;;
  repos)
    shift
    [ "$#" -le 1 ] || fail "repos accepts at most one change"
    run_runtime read repos "$@" ;;
  models)
    shift; [ "$#" -eq 0 ] || fail "models takes no arguments"
    run_runtime read models ;;
  agents)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      plan)
        need_arg "agents plan" "${1:-}"
        run_runtime write agent-plan "$@" ;;
      dispatch)
        need_arg "agents dispatch" "${1:-}"
        run_runtime write agent-dispatch "$@" ;;
      task)
        [ "$#" -ge 2 ] || fail "agents task requires <change> <task>"
        warn "'agents task' is deprecated; use 'packet <change> --task <task>'"
        task_change="$1"; task_id="$2"; shift 2
        run_runtime read packet "$task_change" --task "$task_id" "$@" ;;
      acquire)
        [ "$#" -ge 3 ] || fail "agents acquire requires <change> <task> --owner <agent-id>"
        run_runtime write agent-acquire "$@" ;;
      release)
        [ "$#" -ge 3 ] || fail "agents release requires <change> <task> --owner <agent-id>"
        run_runtime write agent-release "$@" ;;
      *) fail "agents requires 'plan', 'dispatch', 'task', 'acquire', or 'release'" ;;
    esac ;;
  doctor)
    shift
    run_runtime read doctor "$@" ;;
  changes)
    shift; [ "$#" -eq 0 ] || fail "changes takes no arguments"
    run_runtime read changes ;;
  packet)
    shift; need_arg "packet" "${1:-}"
    run_runtime read packet "$@" ;;
  metrics)
    shift; need_arg "metrics" "${1:-}"
    run_runtime read metrics "$@" ;;
  exec)
    shift; need_arg "exec" "${1:-}"
    run_runtime write exec "$@" ;;
  hash)
    shift; need_arg "hash" "${1:-}"
    [ "$#" -le 2 ] || fail "hash accepts <change> [provider]"
    run_runtime read hash "$@" ;;
  budget)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "budget ${sub:-continue}" "${1:-}"
    case "$sub" in
      continue) run_runtime write budget-continue "$@" ;;
      *) fail "budget requires 'continue'" ;;
    esac ;;
  telemetry)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      sync)
        [ "$#" -ge 1 ] || fail "telemetry sync requires <change> [transcript.jsonl]"
        run_runtime write telemetry-sync "$@" ;;
      import)
        [ "$#" -ge 2 ] || fail "telemetry import requires <change> <file>"
        run_runtime write telemetry-import "$@" ;;
      host-import)
        [ "$#" -eq 2 ] || fail "telemetry host-import requires <change> <result.json>"
        run_runtime write host-execution-import "$@" ;;
      *) fail "telemetry requires 'sync', 'import', or 'host-import'" ;;
    esac ;;
  change)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      new)
        [ "$#" -ge 1 ] || fail "change new requires an intent"
        run_runtime write new "$@" ;;
      start)
        [ "$#" -ge 1 ] || fail "change start requires --template or <draft.json>"
        run_runtime write start "$@" ;;
      resolve)
        [ "$#" -ge 1 ] || fail "change resolve requires <change>"
        run_runtime write resolve "$@" ;;
      validate)
        need_arg "change validate" "${1:-}"
        run_runtime write validate "$@" ;;
      audit)
        need_arg "change audit" "${1:-}"
        run_runtime read audit-change "$@" ;;
      abandon)
        need_arg "change abandon" "${1:-}"
        run_runtime write abandon "$@" ;;
      waive)
        need_arg "change waive" "${1:-}"
        run_runtime write waive "$@" ;;
      *) fail "change requires 'new', 'start', 'resolve', 'validate', 'audit', 'abandon', or 'waive'" ;;
    esac ;;
  validate)
    warn "'validate' is deprecated; use 'change validate'"
    shift; need_arg "validate" "${1:-}"
    run_runtime write validate "$@" ;;
  proof)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "proof ${sub:-<plan|readiness|advance|run|finish|collect|preflight|execute|finalize|audit>}" "${1:-}"
    case "$sub" in
      plan)
        warn "'proof plan' is deprecated; use 'proof readiness'"
        run_runtime read proof-readiness "$@" ;;
      readiness) run_runtime read proof-readiness "$@" ;;
      advance) run_runtime write proof-advance "$@" ;;
      run) run_runtime write proof-run "$@" ;;
      finish)
        warn "'proof finish' is deprecated; use 'proof run'"
        run_runtime write proof-run "$@" ;;
      collect) run_runtime write proof-collect "$@" ;;
      # Deliberately `write` despite the read registry kind: preflight is a
      # gate, and the read path only warns on a mixed-revision runtime — a
      # "ready" from an incompatible runtime is worse than an unavailable one.
      preflight) run_runtime write proof-preflight "$@" ;;
      execute) run_runtime write proof-execute "$@" ;;
      finalize) run_runtime write prove "$@" ;;
      audit) run_runtime read proof-audit "$@" ;;
      *) fail "proof requires 'plan', 'readiness', 'advance', 'run', 'finish', 'collect', 'preflight', 'execute', 'finalize', or 'audit'" ;;
    esac ;;
  evidence)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      detect)
        need_arg "evidence detect" "${1:-}"
        run_runtime read evidence-detect "$@" ;;
      init)
        need_arg "evidence init" "${1:-}"
        run_runtime write evidence-init "$@" ;;
      doctor)
        need_arg "evidence doctor" "${1:-}"
        run_runtime read evidence-doctor "$@" ;;
      verify-ci)
        [ "$#" -eq 3 ] || fail "evidence verify-ci requires <change> <provider> <signed.json>"
        run_runtime write evidence-verify-ci "$@" ;;
      run)
        [ "$#" -ge 4 ] || fail "evidence run requires <change> <provider> -- <command>"
        run_runtime write run-provider "$@" ;;
      record)
        [ "$#" -ge 3 ] || fail "evidence record requires <change> <provider> <status>"
        run_runtime write receipt "$@" ;;
      upgrade)
        need_arg "evidence upgrade" "${1:-}"
        run_runtime write evidence-upgrade "$@" ;;
      *) fail "evidence requires 'detect', 'init', 'doctor', 'verify-ci', 'run', 'record', or 'upgrade'" ;;
    esac ;;
  authority)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "authority ${sub:-<request|dispatch|run|abort|status|record>}" "${1:-}"
    case "$sub" in
      request) run_runtime write authority-request "$@" ;;
      dispatch) run_runtime write authority-dispatch "$@" ;;
      run) run_runtime write authority-run "$@" ;;
      abort) run_runtime write authority-abort "$@" ;;
      status) run_runtime read authority-status "$@" ;;
      record) run_runtime write authority-record "$@" ;;
      reset-infra) run_runtime write authority-reset-infra "$@" ;;
      *) fail "authority requires 'request', 'dispatch', 'run', 'abort', 'status', 'record', or 'reset-infra'" ;;
    esac ;;
  handoff)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "handoff ${sub:-<status|packet|record>}" "${1:-}"
    case "$sub" in
      status) run_runtime read handoff-status "$@" ;;
      packet) run_runtime read handoff-packet "$@" ;;
      record) run_runtime write handoff-record "$@" ;;
      *) fail "handoff requires 'status', 'packet', or 'record'" ;;
    esac ;;
  sandbox)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in challenge|create|sync|apply|inspect) : ;; *) fail "sandbox requires challenge, inspect, create, sync, or apply" ;; esac
    need_arg "sandbox $sub" "${1:-}"
    if [ "$sub" = "inspect" ]; then
      run_runtime inspect sandbox "$sub" "$@"
    else
      run_runtime write sandbox "$sub" "$@"
    fi ;;
  land)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "land ${sub:-<check|recover|plan|record|pointers|resume|archive>}" "${1:-}"
    case "$sub" in
      check) run_runtime read land-check "$@" ;;
      recover) run_runtime write land-recover "$@" ;;
      plan) run_runtime write land-plan "$@" ;;
      record) run_runtime write land-record "$@" ;;
      pointers) run_runtime write land-pointers "$@" ;;
      resume) run_runtime write land-resume "$@" ;;
      archive) run_runtime write archive "$@" ;;
      *) fail "land requires 'check', 'recover', 'plan', 'record', 'pointers', 'resume', or 'archive'" ;;
    esac ;;
  migrate)
    shift
    access=read
    for arg in "$@"; do [ "$arg" != "--apply" ] || access=write; done
    run_runtime "$access" migrate "$@" ;;
  runtime)
    shift
    [ "$#" -gt 0 ] || fail "runtime requires an internal harness command"
    warn "'runtime' is an internal compatibility namespace; use canonical public commands"
    case "$1" in version|api-version|hash|doctor|packet|metrics) access=read ;; *) access=write ;; esac
    run_runtime "$access" "$@" ;;
  dashboard|dashboard-up|dashboard-down|dashboard-status)
    sub="$1"; shift
    client="$SCRIPT_DIR/dashboard/client.sh"
    [ -f "$client" ] || { printf 'dashboard client not found at %s\n' "$client" >&2; exit 1; }
    case "$sub" in
      dashboard)
        if [ "${1:-}" = "snapshot" ]; then
          shift
          [ "$#" -eq 1 ] && [ "$1" = "--json" ] || fail "dashboard snapshot requires --json"
          root="$(find_project_root)"
          command -v node >/dev/null 2>&1 || fail "Node.js is required to inspect the dashboard snapshot"
          exec node "$SCRIPT_DIR/dashboard/snapshot.mjs" --project "$root"
        fi
        exec bash "$client" run "$@" ;;
      dashboard-up)     exec bash "$client" up "$@" ;;
      dashboard-down)   exec bash "$client" down "$@" ;;
      dashboard-status) exec bash "$client" status "$@" ;;
    esac ;;
  "")
    deprecated_install ;;
  .|..|/*|./*|../*|~/*|--yes|-y|--dry-run|--force|-f)
    deprecated_install "$@" ;;
  *)
    if [ -d "$1" ]; then deprecated_install "$@"
    else fail "unknown command '$1'; run 'claude-foundation help'"
    fi ;;
esac
