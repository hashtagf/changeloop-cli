# Foundation change loop

```text
Investigate? → Change → Build → Prove → Land
```

Compiled OpenSpec owns the agreement, code/tests own implementation truth, and the harness owns
state, evidence, budgets, isolation, and Land guards. `tasks.md` is the implementation ledger;
`handoffs.yaml` is the external-operation contract. `.workflow/` is read-only
legacy state.

Use the public `claude-foundation` CLI. Do not reproduce its runtime logic in
prompts or Markdown.

## Resolve

Write one semantic draft v3 and let `change start` derive stable spec, claim,
task, dependency, and provider links. Do not create cross-ledger IDs or empty
artifacts by hand. Persist ambiguity, impact, coupling, evidence, and size;
size controls slicing, never assurance. Use `/investigate` for ambiguity.

Rapid schema requires low impact, isolated coupling, unit/static evidence, and
no public contract, migration, trust boundary, irreversible effect, or
sensitive data. Upgrade when risk appears.

## Build

Start from a compact packet, not conversation history. Read only referenced
files needed by the task, edit only its sandbox and allowed paths, and check
`tasks.md` after focused verification.

Use `advance <change> --through build`; execute only its `EDIT`, `REPAIR`,
`RUN_EXTERNAL`, `WAIT`, `ASK_USER`, or `DONE` action and call the exact resume
route. `agents plan`, packets, leases, and dispatch are compatible primitives,
not a chain the model reconstructs.

Worktrees/copies isolate files, not processes or host authority. Unattended work
must pass the runtime guard; never enable a host permission bypass by implication.

If intent changes, pause and submit one `change amend` semantic amendment to the
same change. Its transaction preserves completed tasks and manual sections,
validates, and rolls back. Repository-scope changes require an explicit topology
revision; never expose an unsandboxed repository.

Unauthorized cloud, secret, infrastructure, deployment, or restart work belongs
to `handoffs.yaml`, never unchecked tasks. Unresolved operations return the
named owner and resume route.

## Prove

Use `advance <change> --through proven`; its deterministic chain owns validation,
readiness, receipt reuse, provider execution, collection, authority routing, and
proof finalization. Low-level proof commands are diagnostics/integration paths.

Validate the active change, snapshot relevant workspaces once, resolve claims to
providers, reuse only fingerprint/hash-valid receipts, and execute missing
evidence by a safe DAG. Required failed, missing, stale, error, or inconclusive
evidence blocks Land; external waits never cause provider reruns.

Review independently when risk policy requires it. Findings are
`verified|hypothesis|disproved|accepted-risk`; only deterministic verified
blockers and missing evidence block.

Proof artifacts and receipts are immutable and content-bound. Proof-time edits
invalidate affected evidence. A mutation crash is not a behavioral kill, and a
rendered claim cannot pass through an incapable provider.

## Phase boundaries

A phase boundary is a context boundary: each phase inherits only its packet.
`metrics` reports inheritance under `context.carryover`.

## Budget

Count input, output, and cache writes; unknown is never zero. At 70%, batch and
reuse. At 85%, allow focused fixes and proof only: no scope expansion.
At 100%, stop new model work and surface `NEEDS_USER_DECISION` with continue,
contract-revision, and pause choices. Never silently reduce acceptance criteria
or move unfinished work out of the contract. Deterministic packet, readiness,
provider, proof-resume, metrics, Land-recovery, and archive operations remain
available. Only the user may authorize `budget continue`, with a decision
reference; each exhausted continuation asks again.

## Land

Land is explicit and uses `advance <change> --through archived`. Reject stale proof, apply only the proven touched-path
projection, preserve unrelated edits, journal backups/mutations, roll back
partial failure, run OpenSpec spec sync/archive, audit digests, and clean up
resumably. Never commit, push, or open a PR without separate authority.

Multiple repositories use one local saga: prepare all writable targets, apply
dependency waves, verify unchanged HEAD/index, then archive. Diffs remain
uncommitted; never manufacture child commits or gitlink SHAs.

`/dev` runs Change → Build → Prove without inferring Land authority. With
explicit Land authority, it may continue and succeeds only at `archived`.

## Human interaction boundary

Match the user's language. Lead with outcome, work done, verification, remaining
work, and next action; omit empty sections. Do not paste runtime protocol or ask
the user to run a safe authorized operation the agent can run. Command, resume,
next, and hook resumeAction values are agent-only control data: execute them and
expose them only for requested diagnosis. `ASK_USER` asks only for a decision or
authority; the agent records it and resumes. `WAIT` reports owner and condition,
not a user command. Keep hashes, receipts, provider codes, and task IDs internal.

On any structured `decision`, read
`.claude/commands/references/decision-policy.md` completely. Execute only its
named deterministic recovery automatically; otherwise wait for the user's
explicit answer. Never infer approval from silence. The agent owns requests, responses,
flags, and provenance; users never assemble harness commands or JSON.
