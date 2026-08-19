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

Only the fields relevant to the tool are read. `session-context.sh` is the
exception: it reads a session event (`session_id`, `transcript_path`), not a
tool event.

## Answer contract

- **Deny before the tool runs**: print `{"decision":"block","reason":"..."}`
  to stdout and exit 0. The host must cancel the call and surface `reason` to
  the model. Used by `phase-mutation-guard` and `protect-secrets.sh`.
- **Feed back after the tool ran**: exit 2 with diagnostics on stderr. The
  host must surface stderr to the model. Used by `lint.sh`.
- Exit 0 with no output means allow. Hooks fail open when a toolchain is
  missing (no jq, no node): absence of a guard must not brick a session.

Environment: `CLAUDE_PROJECT_DIR` names the project root (default: cwd).
`FOUNDATION_GUARDRAIL_MODE` (`off|audit|block`) governs the phase guard;
phase context comes from `FOUNDATION_ACTIVE_PHASE` or `.foundation/logs/`.

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
