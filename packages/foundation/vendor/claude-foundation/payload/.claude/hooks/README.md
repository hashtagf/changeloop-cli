# Foundation hooks: contract and host wiring

The guard logic in this directory is host-neutral; only the wiring is
host-specific. Every hook reads one JSON event from stdin and answers on one
of two channels. A host (or adapter) that can produce the event and honor the
answers gets the full guard set without changing a hook.

## Event contract (stdin)

```json
{"tool_name": "<Read|Grep|Bash|Edit|Write|MultiEdit|NotebookEdit>",
 "tool_input": {"file_path": "...", "command": "...", "pattern": "...",
                "path": "...", "glob": "...", "output_mode": "..."}}
```

Only the fields relevant to the tool are read. `session-context.sh` and
`dev-terminal-guard.sh` read session events (`session_id`, `transcript_path`),
not tool events. The terminal guard is wired to `Stop` and applies only when
the active transcript's prompt starts with `/dev`.

## Answer contract

- **Deny before the tool runs**: print `{"decision":"block","reason":"..."}`
  to stdout and exit 0. The host must cancel the call and surface `reason` to
  the model. Used by `phase-mutation-guard` and `protect-secrets.sh`.
- **Feed back after the tool ran**: exit 2 with diagnostics on stderr. The
  host must surface stderr to the model. Used by `lint.sh`.
- Exit 0 with no output means allow. Hooks fail open when a toolchain is
  missing (no jq, no node): absence of a guard must not brick a session.
- **Refuse a false terminal success**: the `/dev` Stop hook returns
  `{"decision":"block","reason":"DEV_TERMINAL ..."}` while the coordinator has
  an automatic action available. It allows Stop when exactly one active change
  has a passing, audited proof bound to the current workspace hash, or when the
  coordinator returns a real `WAIT`/`ASK_USER` boundary. A boundary remains
  recorded as incomplete and cannot be mistaken for passing proof. A host
  permission denial is Harness-owned integration recovery: the hook keeps the
  session active and never tells the user to run an internal command.

Environment: `CLAUDE_PROJECT_DIR` names the project root (default: cwd).
`FOUNDATION_GUARDRAIL_MODE` (`off|audit|block|auto`) governs the phase guard;
phase context comes from `FOUNDATION_ACTIVE_PHASE` or `.foundation/logs/`.
The normal slash-command path records that context through the unified
`advance` coordinator; read-only Stop inspection uses `advance --inspect`, does
not record a new phase, and agents do not have to prepare a packet solely to
make a hook recognize the phase. Session identity selects the exact active
change even when another session has a newer change.
The default `auto` mode blocks mutations during every active lifecycle phase
and stays out of adoption-only sessions with no phase context. A recorded Build
phase recovers every selected repository workspace root from runtime state when
the host does not export `FOUNDATION_WORKSPACE_ROOT`.
Mutating Build shell commands must explicitly begin inside a granted workspace;
unanchored package-manager/formatter commands and obvious path escapes are
blocked before the shell starts. When the host reports the shell already inside
the workspace, the guard pins that directory as the anchor instead of refusing.

Hooks constrain unsafe mutations; they do not own lifecycle completion. A
refusal must preserve state and point back to `claude-foundation advance
<change>` (or its exact typed recovery), so an unavailable live hook or stale
phase row cannot become an artificial dead end.

## Host wiring

The machine-readable authority for this table is
`.claude/harness/adapters/host-capabilities.json`. Native dispatch is a host
orchestration contract and is reported separately from live mutation guards.

| Host | Native dispatch | Wiring | Live mutation guards |
|---|---|---|---|
| Claude Code | available | `.claude/settings.json` hook events (installed automatically) | full: phase live; secrets live; lint live; session digest live |
| OpenCode | available | `.opencode/plugins/foundation.js` (placed by the OpenCode adapter install) replays these hooks via `tool.execute.before/after` | partial: phase live; secrets live; lint live; session digest unavailable |
| Cursor | available | none — Cursor has no tool hooks | unavailable: phase unavailable; secrets unavailable; lint unavailable; session digest unavailable |
| Codex CLI | available | none — Codex has no tool hooks | unavailable: phase unavailable; secrets unavailable; lint unavailable; session digest unavailable |

Hosts without live guards still pass through the runtime's Land gates, and
`no-direct-main-commit.sh` remains available as an opt-in git hook. When
adding a host adapter, target this contract; do not fork guard logic into the
adapter.
