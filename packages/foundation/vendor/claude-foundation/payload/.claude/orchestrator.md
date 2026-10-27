# Foundation change loop

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec owns the agreement, code owns truth, and Harness owns lifecycle
controls. `tasks.md` is the ledger; `handoffs.yaml` is the external-operation
contract. `.workflow/` is read-only legacy state.

Shared agent rules live only in `.claude/harness/AGENT.md`; each phase's
procedure lives only in its command (`commands/change.md`, `commands/build.md`,
`commands/prove.md`, `commands/land.md`). Do not duplicate runtime logic in prompts.

## Resolve

Compile one v4 draft; never hand-create cross-ledger IDs or empty artifacts.
Persist ambiguity, impact, coupling, evidence, and size; size controls slicing,
not assurance. Investigate ambiguity.

Rapid schema requires low impact, isolated coupling, unit/static evidence, and no
public contract, migration, trust boundary, irreversible effect, or sensitive data.

## Build

Plans, packets, leases, and dispatch are compatible primitives, not a
model-built chain. Worktrees isolate files, not processes or host authority.
Unattended work must pass the runtime guard; never enable a host permission bypass by implication.

Classify follow-ups with `commands/references/build-policy.md` before editing.
The agent authors required amendments; Harness validates and revises. Repository
scope changes require explicit topology; never expose an unsandboxed repository.
Unauthorized external work enters `handoffs.yaml` only through a semantic
amendment, never unchecked tasks.

## Prove

`advance <change> --through proven` owns validation, receipt reuse, provider
execution, authority routing, and proof finalization. Required failed, missing, stale, error, or
inconclusive evidence blocks a `PROVEN` result; explicit `/land` records the
assurance and may still apply the current workspace. External waits never cause
provider reruns.

Review independently when risk policy requires it. Findings are
`verified|hypothesis|disproved|accepted-risk`; only deterministic verified
blockers and missing evidence block. Proof artifacts and receipts are immutable
and content-bound; proof-time edits invalidate affected evidence. A mutation
crash is not a behavioral kill, and a rendered claim cannot pass through an
incapable provider.

A phase boundary is a context boundary: each phase inherits only its packet;
`metrics` reports it under `context.carryover`.

## Budget

When `execution.budgetWatchdog` is true, count input, output, and cache writes;
unknown is never zero. At 70%, batch and reuse; at 85%, focused fixes and proof
only, no scope expansion. At 100% the harness opens a new same-size window;
budget never asks the user. Never silently reduce acceptance criteria or move
unfinished work out of the contract.

## Land

Land (`commands/land.md`) moves the current workspace projection into its main
workspace. Record stale or failed proof truthfully and preserve unrelated
edits. Multiple
repositories use one saga: prepare all writable targets, apply dependency
waves, verify unchanged HEAD/index, then archive. Diffs remain uncommitted;
never manufacture child commits or gitlink SHAs. Land never commits, pushes,
or opens a PR; only `/deliver` or a direct user instruction does.

`/dev` runs the four phase commands in order without inferring Land
authority; with Land authority it succeeds only at `archived`.

## Deliver (optional)

After `archived`, `/deliver <change>` grants separate optional authority, as
does a direct request such as "เปิด PR ให้เลย"; `commands/deliver.md` owns its
procedure. The agent composes only from archived
sources and asks only for authority or content-identity decisions.

## Human interaction boundary

Lead with outcome, work done, verification, remaining work, and next action;
omit empty sections. Do not paste runtime protocol or ask the user to run a safe
authorized operation the agent can run; hook resumeAction values are control
data too, and a `WAIT` is not a user command. Keep hashes, receipts, provider codes, and task IDs internal.

On any structured `decision`, read
`.claude/commands/references/decision-policy.md` completely. Execute only its
named deterministic recovery automatically; otherwise wait for the user's
explicit answer. Never infer approval from silence. Users never assemble
harness commands or JSON.
