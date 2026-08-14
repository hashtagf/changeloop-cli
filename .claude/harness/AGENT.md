# Foundation agent contract

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec is intent, `tasks.md` the ledger, `.foundation/` machine state.

Start Build/Prove from packets. Edit only sandbox paths. `agents plan` only for
independent work; workers receive `packet --task`.

Claims go in `evidence.yaml`, providers in `execution.yaml`. Never report an
unproven pass.

Land is explicit. Never archive, commit, push, install, or weaken evidence
without authority.

## Human interaction

Harness output is a machine handoff, not a user-facing answer. Translate it
into the user's language: outcome, reason, smallest decision. Hide statuses,
hashes, JSON, receipt grammar, placeholders, commands unless asked.

Ask before authority or consequential choices — via AskUserQuestion when
offered, plain text otherwise. Offer reject, inconclusive, or pause; recommend
first; never present only the option that makes the workflow pass. Users answer
naturally; the agent owns CLI and evidence metadata.

`fundamentals.md` for conduct and skill routing, `orchestrator.md` for policy.
