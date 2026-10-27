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

- **Rewrite or guide before the tool runs** (the default): print
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{...},"additionalContext":"..."}}`
  and exit 0. The host runs the call with `updatedInput` (when present) and
  surfaces `additionalContext` to the model. These guards never refuse by
  default: `phase-mutation-guard` redirects main-checkout edits into the
  isolated workspace, routes internal Land commands to `advance`, and turns an
  unauthorized delivery into the question for the user; `protect-secrets.sh`
  points secret reads at a redacted copy; `no-detached-authority` runs a
  detached reviewer attached.
- **Deny before the tool runs** (explicit strict modes only): print
  `{"decision":"block","reason":"..."}` to stdout and exit 0. Used only when a
  host sets `FOUNDATION_GUARDRAIL_MODE=block`, `FOUNDATION_SHELL_GUARD=block`,
  or `FOUNDATION_SECRETS_GUARD=block`.
- **Route a host-refused shell shape** (default): `shell-route-guard.sh` denies
  only a Bash call the host would stop on an approval prompt anyway. Its
  reason is the command to run instead: `cd <dir> && git …` → `git -C <dir> …`;
  a direct test run while a change is in Build → `claude-foundation exec
  <change> [--repo <id>] -- <command>`. A matching Bash allow rule,
  `bypassPermissions`, or a command it cannot parse lets the call through.
  `FOUNDATION_GUARDRAIL_MODE=audit` turns the denial into advice, and `off`
  disables it.
- **Feed back after the tool ran**: exit 2 with diagnostics on stderr. The
  host must surface stderr to the model. Used by `lint.sh`.
- Exit 0 with no output means allow. Hooks fail open when a toolchain is
  missing (no jq, no node): absence of a guard must not brick a session.
- **Warn on an incomplete terminal**: the `/dev` Stop hook never blocks. When
  no active change has a passing, audited proof bound to the current workspace
  hash (and no real `WAIT`/`ASK_USER` boundary applies), it records the turn as
  incomplete and returns a `systemMessage` naming the blocker and resume route.
  A recorded incomplete verdict cannot be mistaken for passing proof.

Environment: `CLAUDE_PROJECT_DIR` names the project root (default: cwd).
`FOUNDATION_GUARDRAIL_MODE` (`off|audit|block|auto`) governs the phase guard;
shell refusals outside Land/Deliver are audited unless `FOUNDATION_SHELL_GUARD=block`;
phase context comes from `FOUNDATION_ACTIVE_PHASE` or `.foundation/logs/`.
The normal slash-command path records that context through the unified
`advance` coordinator; read-only Stop inspection uses `advance --inspect`, does
not record a new phase, and agents do not have to prepare a packet solely to
make a hook recognize the phase. Session identity selects the exact active
change even when another session has a newer change.
The default `auto` mode guides during every active lifecycle phase and stays
out of adoption-only sessions with no phase context: a call that leaves the
phase's rules still runs, redirected into the workspace when it can be, and the
agent is told the route. A recorded Build phase recovers every selected
repository workspace root from runtime state when the host does not export
`FOUNDATION_WORKSPACE_ROOT`; each writable repository sandbox is in-workspace
with the shared sandbox's strictness, while the shared sandbox's copy of that
repository and read-selected sandboxes are not. Shell analysis reads command text, so its findings
are recorded and explained, never refused, unless a host opts into strict mode.

Hooks guide mutations; they do not own lifecycle completion. Guidance (and a
strict-mode refusal) must preserve state and point back to `claude-foundation
advance <change>` (or its exact typed recovery), so an unavailable live hook or
stale phase row cannot become an artificial dead end.

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
| Gemini CLI | unavailable | none — no Foundation guard wiring is shipped; capabilities are declared unavailable until verified | unavailable: phase unavailable; secrets unavailable; lint unavailable; session digest unavailable |

Hosts without live guards still pass through the runtime's Land gates, and
`no-direct-main-commit.sh` remains available as an opt-in git hook. When
adding a host adapter, target this contract; do not fork guard logic into the
adapter.
