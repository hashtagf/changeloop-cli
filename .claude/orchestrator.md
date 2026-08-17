# Foundation change loop

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec owns intent, code/tests implementation truth, and the harness owns
state, evidence, budgets, isolation, and Land guards. `tasks.md` is the implementation ledger;
`handoffs.yaml` is the external-operation contract. `.workflow/` is read-only
legacy state.

Use the public `claude-foundation` CLI. Do not reproduce its runtime logic in
prompts or Markdown.

## Resolve

Persist ambiguity, impact, coupling, evidence capabilities, and size. Size
controls budget/slicing, never assurance. Use `/investigate` when ambiguity is
unclear.

Rapid schema requires low impact, isolated coupling, unit/static evidence, and
no public contract, migration, trust boundary, irreversible effect, or
sensitive data. Upgrade when risk appears.

Select providers from observable claims. Security follows actual trust
boundaries, not syntax.

## Build

Start from a compact packet, not conversation history. Read only referenced
files needed by the task, edit only its sandbox and allowed paths, and check
`tasks.md` after focused verification.

Use subagents only for independent, verifiable, resumable work. Multi-repository
work uses committed topology, per-change scope, `agents plan`, scoped packets,
and task leases. A small isolated change stays with one agent.

Worktrees/copies isolate files, not processes or host authority. Unattended work
must pass the runtime guard; never enable a host permission bypass by implication.

Model tiers follow risk and ambiguity, not file count. Deterministic providers
use no model. Never weaken evidence for budget.

If intent changes, pause, revise the same change, and `sandbox sync`. Stable task
IDs preserve unaffected progress. Repository-scope changes require an explicit
topology revision rather than silently exposing an unsandboxed repository.

Cloud IAM, secret writes, infrastructure apply, deploy/restart, and environment
verification belong to `handoffs.yaml` when the developer lacks authority.
They never remain unchecked implementation tasks. Prove can continue after the
packet is delivered once. Land permits an accepted incomplete handoff only for
`post-land + safe-before-activation`; other unresolved operations report
`WAITING_EXTERNAL` with the named owner and do not open a user decision loop.

## Prove

Validate the active change, snapshot relevant workspaces once, resolve claims to
providers, reuse only fingerprint/hash-valid receipts, and execute missing
evidence by a resource-safe DAG. Test evidence requires discovery. Required
failed, missing, stale, error, or inconclusive evidence blocks Land.
An external-operation wait is not failed evidence and never causes provider
reruns. Reviewer infrastructure error has one bounded retry separate from
delivered review waves.

Review independently when risk policy requires it. Findings are
`verified|hypothesis|disproved|accepted-risk`; only deterministic verified
blockers and missing evidence block.

Review starts from its bounded packet in fresh context. Critical policy requires
model-family diversity or its committed waiver. Acceptance stays separate.

Proof artifacts and receipts are immutable and content-bound. Proof-time edits
invalidate affected evidence. A mutation crash is not a behavioral kill, and a
rendered claim cannot pass through an incapable provider.

## Phase boundaries

A phase boundary is a context boundary: each phase inherits only its packet.
`metrics` reports inheritance under `context.carryover`.

## Budget

Count input, output, and cache writes; unknown is never zero. At 70%, batch and
reuse. At 85%, allow only focused fixes and required proof: no scope expansion.
At 100%, recommend
re-scope without blocking deterministic recovery. Only an operator may use
`budget continue`.

## Land

Land is explicit. Reject stale proof, apply only the proven touched-path
projection, preserve unrelated edits, journal backups/mutations, roll back
partial failure, run OpenSpec spec sync/archive, audit digests, and clean up
resumably. Never commit, push, or open a PR without separate authority.

Multiple remotes are not atomic. Use the ordered saga: bind authorized child
commits/CI, verify dependencies, stage checked gitlinks, re-Prove the composite
identity, resume, then archive the control change last.

`/dev` composes Change → Build → Prove only. It never Lands.

## Human interaction boundary

Match the user's language. Lead with outcome, work done, verification, remaining
work, and next action; omit empty sections. Do not paste runtime protocol or ask
the user to run a safe authorized operation the agent can run. Expose hashes,
receipts, provider codes, task IDs, and commands only for requested diagnosis.

Only deterministic recovery may be followed automatically. When a structured
`decision` names `automaticRecovery`, execute that offered route within current
authority, explain the repair in plain language, and continue. Every other
`decision` requires an explicit user answer, including one a blocked operation
emits. Present its honest alternatives,
recommend one with a reason, and always preserve reject, inconclusive, or pause
when those outcomes are valid. Never infer approval from silence or from the
ability to invoke an authority command. The agent creates requests, responses,
flags, and provenance after the human decision; users never assemble harness
commands or JSON.
