# Foundation change loop

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec owns intent, code/tests own implementation truth, and
`.claude/harness/foundation.mjs` owns deterministic state, evidence, budgets,
isolation, and Land guards. `tasks.md` is the only ledger. `.workflow/` is
read-only legacy state.

Use the public `claude-foundation` CLI. Do not reproduce its runtime logic in
prompts or Markdown.

## Resolve

Persist ambiguity, impact, coupling, evidence capabilities, and size. Size
controls budget/slicing, never assurance. Use `/investigate` when ambiguity is
unclear.

Rapid schema requires low impact, isolated coupling, unit/static evidence, and
no public contract, migration, trust boundary, irreversible effect, or
sensitive data. Upgrade when risk appears.

Select providers from observable claims. Security is semantic: identity/access,
secrets, permissions, cross-user data, network trust, unsafe sinks, sensitive
storage, irreversible mutation, and security-relevant migrations trigger it;
syntax alone does not.

## Build

Start from a compact packet, not conversation history. Read only referenced
files needed by the task, edit only its sandbox and allowed paths, and check
`tasks.md` after focused verification.

Use subagents only for independent, verifiable, resumable work. Multi-repository
work uses committed topology, per-change scope, `agents plan`, scoped packets,
and task leases. A small isolated change stays with one agent.

Worktrees and copies isolate workspace changes, not processes or host authority.
Explicitly unattended work must pass the runtime's detected security-boundary
guard; never enable a host permission bypass by implication.

Model tiers are policy:

- fast/Haiku: bounded inventory, logs, mechanical docs;
- standard/Sonnet: implementation, tests, focused investigation;
- deep/Opus: architecture, security, migration, contract decisions, independent
  review.

Risk and ambiguity—not file count—escalate. Deterministic providers use no
model. Never weaken evidence to meet a budget.

If intent changes, pause, revise the same change, and `sandbox sync`. Stable task
IDs preserve unaffected progress. Repository-scope changes require an explicit
topology revision rather than silently exposing an unsandboxed repository.

## Prove

Validate the active change, snapshot relevant workspaces once, resolve claims to
providers, reuse only fingerprint/hash-valid receipts, and execute missing
evidence by a resource-safe DAG. Test evidence requires discovery. Required
failed, missing, stale, error, or inconclusive evidence blocks Land.

Review independently for high-impact, non-low-coupled, auth/access, public
compatibility, migration, irreversible mutation, concurrency, money, multi-repo
contracts, evidence anomalies, or policy. Findings are
`verified|hypothesis|disproved|accepted-risk`; only deterministic verified
blockers and missing evidence block.

Review starts from the bounded review packet in a fresh context. Critical policy
requires a different model/provider family or a human. Human acceptance remains
separate and is required only when the Change explicitly declares subjective taste.

Proof artifacts and receipts are immutable and content-bound. Proof-time edits
invalidate affected evidence. A mutation crash is not a behavioral kill, and a
rendered claim cannot pass through an incapable provider.

## Phase boundaries

A phase boundary is a context boundary: each phase inherits only its packet.
`metrics` reports inheritance under `context.carryover`.

## Budget

Spend is input, output, and cache writes from host request records; cache
reads never count. Unknown is never zero. Lifetime usage is
accounting; enforcement uses the active run window. At 70%, batch and reuse. At
85%, obey the packet's completion-only policy: no speculative investigation,
scope expansion, optional refactor, or new subagent. Focused fixes and required
proof remain allowed. At 100%, recommend split or re-scope without blocking
deterministic lifecycle recovery. Only an operator may open another audited
window with `budget continue`. Required proof remains.

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

Runtime JSON, lifecycle constants, hashes, receipts, provider names, provenance
flags, and canonical commands are agent/host protocol. Never paste them into a
user-facing answer by default. Translate machine state into the user's language:
what completed, what remains, why the system stopped, and which decision is
needed.

Only deterministic recovery may be followed automatically. A structured
`decision` requires an explicit user answer, including one a blocked operation
emits. Present its honest alternatives,
recommend one with a reason, and always preserve reject, inconclusive, or pause
when those outcomes are valid. Never infer approval from silence or from the
ability to invoke an authority command. The agent creates requests, responses,
flags, and provenance after the human decision; users never assemble harness
commands or JSON.
