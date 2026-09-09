# Change Loop workflow

**Version 3.5.15**

Change Loop is an OpenSpec-native control plane for safe, economical software
changes in brownfield repositories:

```text
Investigate? → Change → Build → Prove → Land
```

This document owns the detailed lifecycle contract: what each phase means,
which state transitions are allowed, what blocks progress, and what authority
the harness never infers. Start with `README.md` or `README.th.md` for the user
journey. Runtime structure and operator commands belong to
`.claude/harness/README.md`; provider, receipt, and proof details belong to
`.claude/harness/EVIDENCE.md`.

## Why this shape

OpenSpec stores the agreement, the native coding agent implements it, and
deterministic project-owned providers prove it. The harness owns state,
isolation, budgets, evidence identity, authority boundaries, and recoverable
Land. Rigor scales with risk and evidence needs, not a task-size phase matrix.

## Ownership and user states

The user owns intent, consequential product decisions, explicit Land authority,
final diff review, and any later Git or external side effect. The coding agent
owns implementation and product repair. The harness owns compilation, tool
preparation, isolation, routing, evidence, permissions integration, recovery,
Apply, and archive. An external owner owns credentials, remote systems, and
human verdicts outside the execution boundary. Harness configuration or host
permission is never turned into a question or command for the user.

Normal output projects internal actions into five user states: `WORKING`,
`NEEDS_DECISION`, `WAITING_EXTERNAL`, `TARGET_REACHED`, and `DELIVERED`.
`DONE` at a requested Build or Prove target projects `TARGET_REACHED`, with
`delivered: false` and the next route preserved. Only `reached: archived`
projects `DELIVERED`. Internal worker and proof-lock waits remain harness-owned
`WORKING`; `WAITING_EXTERNAL` requires a real external owner. Internal commands,
request IDs, journals, repair graphs, and resume tokens remain machine-facing.

## Lifecycle commands

### `/investigate <problem>`

Use Investigate only when the problem or direction is unclear. It is bounded
and read-only with respect to product code. Its output is facts, hypotheses,
options, tradeoffs, and a next decision; it creates no lifecycle state.

`/investigate <decision> --compare` may build disposable alternatives only
under `.foundation/prototypes/`. It always records the selected conclusion in
`selection.md`. Prototype artifacts are never evidence.

### `/change <intent>`

Change authors one compact semantic draft v3. The transactional compiler creates
`openspec/changes/<id>/`, assigns stable cross-ledger IDs, validates the complete
agreement, installs it, and prepares isolation. The draft records:

- ambiguity, impact, coupling, and size;
- semantic requirements and task outcomes;
- claim-to-task coverage and required evidence capabilities;
- semantic security and review triggers;
- typed extensions only when the change needs them.

Rapid changes contain `proposal.md`, `tasks.md`, and `evidence.yaml`. Standard
changes add delta specs and add `design.md` only for a load-bearing decision,
migration, compatibility boundary, architecture, diagram, integration, or
prototype selection. `execution.yaml`, `repositories.yaml`, `handoffs.yaml`,
and `grounding.yaml` appear only when execution differs from detected defaults,
multiple repositories participate, external authority is required, or a
non-derived material decision must be recorded. Absence has versioned
virtual-default semantics.

After compilation, the OpenSpec packet is the source of truth. The semantic
draft is temporary and `.foundation/` is derived coordination state. Draft v1
remains compatible; draft v2 retains its unambiguous bookkeeping behavior.

Referenced diagrams, prototype selections, and local integration documentation
must resolve to regular files inside the project. Remote integration sources
must use HTTPS and a fixed version rather than `latest`, a branch, or another
floating alias. An amendment may extend a task's claim coverage, but changing
its outcome or verification command requires a new task so completed work
cannot silently change meaning.

When Build discovers new behavior, amend the same agreement before continuing:

```bash
claude-foundation change amend <change> <amendment.json>
```

A change that cannot be proven is retired explicitly, never deleted by hand:

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

Abandon releases leases, cleans up isolation, and moves the packet, runtime
state, receipts, evidence, and transactions to
`.foundation/recovery/abandoned/<id>/` with an audit record. It requires a real
user decision, never touches Git, refuses archived changes, and asks whether to
keep or revert already-applied files before acting.

### `/build <change>`

The normal entrypoint is:

```bash
claude-foundation advance <change> --through build
```

The coordinator validates the agreement, prepares or synchronizes isolation,
compiles the task graph, and returns one bounded protocol-v5 action:
`EDIT`, `REPAIR`, `RUN_EXTERNAL`, `WAIT`, `ASK_USER`, or `DONE`.
`tasks.md` is the only implementation ledger. `handoffs.yaml` separately owns
AWS, cluster, secret, Terraform, deploy, restart, or other operations that need
external authority.

Build writes only inside the declared isolated workspace. Git projects normally
use detached worktrees; a dirty target or non-Git project uses an isolated copy.
This is workspace integrity, not OS process, network, or secret containment.
Mutating shell commands must start with `cd` to the workspace root or a literal
directory inside it, joined by `&&`; on Claude Code the phase guard pins the
shell's reported directory as that anchor when it is already inside the
workspace, and audits the pin. The phase guard and
`claude-foundation exec` reject direct path escapes and symlink traversal, but
the host still owns process isolation for indirect or dynamically computed
effects. Copying or linking files from outside the workspace is refused as
well: a workspace never borrows the checkout's dependencies. Sandbox creation
prints a NOTE with the exact `sandbox.setupCommand` snippet when the project
has a lockfile but declares no setup command.

Before Build, the harness compiles and persists an execution-preparation plan
from selected repositories, setup commands, provider wiring, and tool identity.
It reuses ready records, prepares only missing project-local dependencies, and
retries only failed repository setup records. The pinned OpenSpec CLI may be
installed under `.foundation/tools`; it is never installed globally. A setup or
host-integration failure remains Harness-owned repair and is not emitted as a
command for the user.

Unattended Build requires a trusted host-owned attestation:

```bash
claude-foundation sandbox challenge <change>
claude-foundation sandbox create <change> --unattended --attestation <file>
```

`--unattended` is presence-only; valued or duplicate forms are rejected before
telemetry or mutation. An attestation is short-lived, project-, agreement-, and
permission-bound, single-use, and does not turn a worktree or container into a
security boundary. The complete operator contract is in the harness guide.

One-task changes without shared external authority stay in the current agent.
Independent tasks with disjoint declared paths may use native workers even in
one repository; overlapping, dependent, unknown-scope, or shared-resource work
stays serialized. The harness plans dependency and resource scopes,
leases them all-or-none with fencing generations, and accepts only observed
writes inside the granted authority. Load one primary construction skill per
task and only the cross-cutting security or observability skills whose triggers
apply.

For multi-repository work, the committed topology selects repositories and
access modes before task, provider, or worker planning. Providers may execute
in one repository while consuming a declared set of other isolated
repositories. Read-selected Git dependencies participate in proof but never
produce a Land mutation node.

The declared selection—not the number of surviving runtime records—decides
whether a lifecycle is composite. Selecting one non-root repository is
multi-repository even when `root` has no product writes. After isolation, every
selected non-root repository must retain a worktree record whose path, target,
access mode, and base head match the catalog. Changed-surface hashing, review
packets, provider manifests, Apply, and Land all use that binding and never
fall back to the live target.

`sandbox inspect <change>` reports missing, unexpected, missing-path, and
invalid-worktree records without executing a PATH-resolved Git command.
`sandbox create <change> --all` repairs missing bindings idempotently while
preserving valid worktrees. Repair or retire an incomplete repository selection
before resume; never prove a subset.

An in-contract defect is repaired without asking again. Only evidence that
changes locked behavior, compatibility, security, data, or rollout opens one
audited batched amendment. Synchronize any amended agreement or moved target:

```bash
claude-foundation sandbox sync <change>
```

Sync increments the agreement revision and invalidates proof that no longer
describes it. A worktree replay is prepared against the current target before
replacement; a multi-repository replay prepares every writable repository
before replacing any; a copy fast-forwards files only the target changed.
Double-edited files stop as named `CONFLICT` entries and leave the existing
sandbox intact. Merge the target version in the sandbox and sync again, using
`--resolve` for a copy.

Several changes may be active at once. Overlapping path or repository scopes
never block Build, Prove, or Land across changes; whichever lands later
synchronizes onto the moved target as above, resolves any double edit, and
re-proves. Only an explicit `[resources:]` token names a resource two changes
cannot use at once, and those still serialize.

Packet artifacts flow from `openspec/changes/<change>/` in the target into the
sandbox. An artifact edited only in the sandbox blocks sync; only `tasks.md`
completion ticks merge back automatically.

### `/prove <change>`

The normal resumable entrypoint is:

```bash
claude-foundation advance <change> --through proven
```

Proof validates the agreement, hashes relevant inputs, resolves claims to
providers, reuses valid receipts, runs missing or stale project-owned evidence,
routes review before acceptance, and writes a proof bound to the workspace.
Required evidence that is failed, missing, stale, erroneous, or inconclusive
blocks Land.

Composite identity binds repository content and agreement revision rather than
Git commit identity. Recorded base heads remain explicit recovery and Land
state: an unsynchronized target still stops, while moving to a history-only
commit with byte-identical content does not charge another review.

A provider that executed and failed has three honest exits:

- fix the cause and rerun;
- rewire the provider in `execution.yaml`;
- withdraw the capability under a recorded decision with `change waive`.

A waiver removes the capability from the required set while the claim continues
to declare it. It remains visible as `user-waived`, preserves receipts already
earned, and can be revoked. There is no route that turns failed evidence into a
pass or lands it silently. Review and acceptance use their own explicit policy
and withdrawal routes.

When executable wiring is absent, `evidence detect` reads project manifests
without executing scripts, `evidence init` previews additions and writes only
with `--write`, and `evidence doctor` reports ambiguity or external authority.
Detection never installs tools, creates receipts, overwrites configured
providers, or weakens claims.

`change audit` checks scenario → claim → task → provider traceability, including
negative security paths and migration rollback/integrity. Tasks link claims
explicitly with `[claims:<claim-id>]`.

Every phase gate follows the same convergence rule: collect independent
findings, repair one dependency-ordered in-contract batch, and selectively
rerun invalidated checks. Product repair has no fixed cycle ceiling while its
semantic progress identity changes. Two unchanged automated transitions produce
the typed no-progress boundary.

Thrown Build, Prove, or Land dependencies are captured in the same action
envelope with their original reason and exact recovery route. Decisions,
authority, resources, conflicts, and repeated no-progress preserve state.
`proof readiness`, `proof advance`, `proof run`, and direct authority commands
remain diagnostic or integration primitives behind `advance`.

### `/land <change>`

The complete delivery command is:

```bash
claude-foundation advance <change> --through archived
```

This explicit invocation supplies Land authority. Land checks proof freshness,
binds a resumable grant to the exact change, proof, repository graph, and target
roots, applies the proven isolated diff when necessary, verifies state identity,
delegates semantic spec synchronization and archival to the pinned OpenSpec
CLI, and finishes only at `archived`. `proven` is not completion.

`land check` is read-only. Apply is a transaction over the target. An
interrupted transaction remains pending until `land recover` settles it under a
recorded decision. `restore-backup` restores and verifies the pre-apply state;
`keep-current` preserves the target, marks the projection unapplied, and
requires sandbox sync before Land resumes.

The projection is confined to Git-tracked files plus paths declared in
`tasks.md`. An untracked path no task names is neither evidence surface nor a
Land deletion. A target path is deleted only when the proven sandbox removed
it. Conflicts never overwrite unrelated target edits.

Every writable selected repository is prepared before the first target write
and then applied in dependency order with durable per-repository checkpoints.
Each target finishes `applied-uncommitted`: its intended diff is visible for
the user to inspect, while Git HEAD and index remain unchanged. Read-only
repositories remain unchanged. Re-entering `/land` resumes the same grant and
skips already verified nodes; it never requires the user to assemble a journal,
grant, commit, or recovery command.

Land never implies permission to commit, push, publish, deploy, or open a pull
request. Those effects require separate explicit authority.

### `/changes` and `/dev`

`/changes` distinguishes in-progress, proven, stale-proof, and ready-to-land
changes and names the next command for each. Session start may report the same
digest, but a hash-free digest never implies proof freshness. Orphaned runtime
state is reported rather than hidden.

`/dev` is compatibility composition:

```text
/change → /build → /prove
```

It never lands by implication. `--plan-only` stops after Change and
`--resume <id>` resumes an active OpenSpec change.

## Agreement lanes

### `foundation-rapid`

Rapid is allowed only when all are true:

- impact is low and coupling is isolated;
- no public contract or persistent migration changes;
- no semantic security or irreversible-effect trigger applies;
- unit or static evidence is sufficient.

### `foundation-standard`

Standard covers every other change. Design records only decisions that
constrain implementation, compatibility, rollout, rollback, or proof. Size
affects budgets and slicing only; it never weakens assurance.

## Evidence contract

`evidence.yaml` is the stable behavioral contract; `execution.yaml` holds
replaceable commands, reports, services, resources, and environment-variable
names. Provider names describe what is proven, not which tool runs. Run
`claude-foundation providers` for the installed catalog and use
`.claude/harness/EVIDENCE.md` for adapters, receipts, resource locks, signed
envelopes, Playwright annotations, and reuse rules.

Execution graph v3 includes setup, service, task, provider, and Land nodes.
The scheduler prioritizes the longest ready dependency path, then fills the
configured capacity with non-conflicting nodes. Valid receipts are reused;
required services and repository setup commands start in bounded independent
batches, and a partial service-start failure stops every session already born.

Test claims automatically require suite-level discovery. Risk-triggered changes
require review. Changed-surface policy may add supply-chain, migration,
accessibility, compatibility, security, review, or deployment obligations after
Build.

Because the real surface exists only after Build, `change resolve --surface`
forecasts those obligations during Change. Forecasts name the triggering glob
but never gate or reduce the requirements derived from actual changed files.
An inferred capability is binding only when a claim declares it or the project
has wired a provider; otherwise it remains a visible advisory. Review stays a
gate and has its own policy.

Consumer quality is opt-in through
`quality/foundation-quality.json`. It is report-only until explicitly enforced,
never expands the Change surface, and never converts unsupported, unavailable,
or unmapped measurements into zero or pass. The installed operational contract
is `.claude/harness/CONSUMER-QUALITY.md`.

Receipts bind provider and protocol versions, claim scope, relevant inputs,
execution configuration, environment identity, artifacts, observations, and
timestamps. Executable receipts record the actual command and log; external
receipts require real provenance and durable references. A provider protocol or
fingerprint change invalidates its prior receipt.

Remote CI and semantic acceptance may return signed, workspace-bound envelopes.
Signatures, issuer, cases, observations, transitions, and artifact digests are
verified before a receipt is written. Hidden oracle content stays external, and
review prose cannot replace a missing or failed required case.

An unavailable configured provider returns `INFRASTRUCTURE_ERROR` with honest
recovery choices: diagnose, retry, record verifiable external evidence, or
configure an available project-owned command proving the same claims. It never
becomes a zero or pass.

Pending implementation returns `NEEDS_CODE_CHANGE`. Agreement or topology
problems return `CONFIGURATION_ERROR`. Subjective acceptance or a contract
contradiction returns `NEEDS_USER_DECISION`. Every non-ready result names an
exact recovery or resume route.

The decision envelope is machine-facing. The agent explains it in the user's
language and owns routine commands and metadata. It
never asks the user to run a safe authorized operation it can perform.
Genuine decisions present honest
choices, including reject, inconclusive, or pause; they never contain a
preselected passing receipt.

## Review, acceptance, and external authority

Under `workflow.reviewPolicy: "risk-tiered"` every change receives review, with
the correction circuit bounded by risk:

- **low** — one full AI review; a material correction promotes the route to
  medium;
- **medium** — one full AI review, one correction batch, and at most one fresh
  delta review closing the first-round finding IDs;
- **high** — material risks are settled in the initial Decision Sheet, followed
  by one full AI review and at most one post-correction delta.

High risk includes authorization or secrets, public or cross-repository
contracts, migration or destructive state, money, concurrency,
replay/idempotency, brokers or real wire behavior, and activating legacy
behavior. Medium includes other non-low impact/coupling and declared review
risk.

Review begins from a bounded review packet, never Build history. Its changed
surface includes committed and dirty paths from recorded repository bases plus
review contract artifacts. A missing base blocks review instead of appearing
clean. Every receipt records the actual reviewer, session, implementation
subjects, findings, closures, and scope.

Concurrent-change sync reuses identity-valid review evidence through the
[existing proof binding rules](.claude/harness/EVIDENCE.md). No-op sync preserves
proof and lifecycle progress; changed inputs still require a current proof.
This does not reset review waves or grant Land authority.

Critical work requires a different model/provider family or a human unless the
committed project policy explicitly waives diversity. Reviewer independence is
separate and may be waived only through committed policy. Each waiver relaxes
only its own axis and is named in both packet and receipt.

Configured `fallbackReviewers` are tried in order only after an infrastructure
error. `fail` and `inconclusive` are delivered verdicts and never fall through.
Packet inspection and finding/closure binding errors stop the current automatic
retry chain rather than dispatching the unchanged validation failure to another
model. The backend owns this routing through the existing commands.
The existing `advance --through` route reopens a binding failure only after the
retained packet/result validates again and the reviewer is ready, preserving
scope, attempt history, and infrastructure retry accounting.
A `main-session` fallback requires the explicit self-independence policy and
records observed provenance rather than guessing it.

The risk route is a circuit breaker, not a loop-until-pass rule. After the
allowed delivered AI waves, another open review is refused. A final in-contract
blocker must name affected claims and declared critical cases; current passing
provider evidence may then close those IDs deterministically without a third
AI. A hash chain binds attempts, scope, findings, closure, and receipts.
Deleting or renaming state cannot reset the limit; corrupt history fails closed.

Human acceptance is separate from review. Every new standard change explicitly
records whether subjective acceptance is required; `undecided` blocks
validation. Required acceptance binds named claims, nonblank criteria, human
identity, observation, provenance, durable evidence, and the final workspace.
The runtime never invokes a human, impersonates one, or manufactures approval.

`handoffs.yaml` owns external operations. Pending handoffs do not block Build or
evidence collection. Land blocks unresolved pre-Land or activation-coupled
operations. An accepted post-Land operation may remain only when a declared
claim proves the merged artifact is safe before activation. Records contain
owners, tickets, and evidence references—never credentials.

## Terminal stops

Some guards end a run rather than returning another repair action: exhausted AI
review waves, corrupt review history, a spent budget continuation, model budget
that cannot unblock the next step, a moved control repository during
multi-repository Land, reset staged submodule pointers, or an apply rollback
that could not complete.

Each stop preserves the change and returns a decision envelope with a typed
code, at least two honest options, a recommendation, and an exact resume route.
When `automaticRecovery` is marked, `automaticRecovery` is performed and
explained by the agent without opening a user interview. Other options are
translated into the user's language; the agent never treats a stop as a dead
end or infers authority. Retiring with `change abandon` is offered where valid.

An unresolved apply transaction blocks a new one. `doctor --change <id>` reports
it before Land and names the recovery operation.

## Invalidation

One relevant workspace snapshot supplies the identity shared by a proof and its
receipts. Runtime state, receipts, sandboxes, dependencies, other active changes,
and archives are excluded. Any relevant product or agreement edit makes the
affected proof material stale.

Executable providers normally bind product inputs rather than the change
packet, so a packet-only edit may re-finalize proof without rerunning them.
Review, acceptance, and semantic acceptance bind the packet because those
authorities read it. A provider may narrow executable inputs explicitly; the
proof plan shows the binding. Complete rules live in the evidence reference.

## Preflight and telemetry

Run `doctor --stage change|build|prove`. Change and Build permit commands that
are planned but not created yet. Prove requires executable providers and rejects
dependency cycles, report collisions, literal secret-like values, and
status-only readiness probes. Use `--require-archive` when the intended flow
includes Land.

Telemetry records only observed operation and usage metadata. Unknown requests,
tokens, cache, or cost remain unknown rather than zero. A complete token
measurement without price data is truthfully partial and may satisfy a policy
that requires a measured usage dimension; no measured dimension cannot.
Prompts and tool payloads are never copied.
When `advance` executes multiple lifecycle phases, its single operation row
carries disjoint phase intervals. Metrics attribute those intervals without
counting additional command invocations or overlapping parent time. Quality
lane timing includes adapter normalization and ratchet evaluation; structured
quality output is drained even when enforcement returns a failing exit code.

`metrics` and `feedback` expose cost, context, execution, reuse, repair, and wait
signals without counting several receipts from one process as independent
executions. Packet sizes, host imports, transcript cursors, and telemetry schema
belong to the harness operator guide.

## Sandbox and repository safety

Change Loop sandboxes protect workspace and apply integrity. They do not contain
processes, networks, host secrets, or system commands by themselves. Never
infer that a worktree or copy makes unrestricted execution safe.

- The target head and selected repository bindings are checked before Apply.
- `git apply --check` or the copy-mode equivalent runs before mutation.
- Apply identity covers only the proven touched-path projection.
- Touched paths and change artifacts are backed up and journaled.
- Failures roll back; an incomplete rollback stops future Apply attempts.
- The sandbox remains the proof subject until archive and proof audit finish.
- Conflicts stop without overwriting unrelated user edits.
- Mutation testing runs only in isolation.

Copy mode preserves symbolic links verbatim and rejects target paths changed
since its baseline. Generated, tool-owned directories are excluded only when
untracked; a committed fixture remains content regardless of its directory
name.

Multi-repository changes use one OpenSpec agreement and one declared topology.
Cross-repository contract evidence must be checked before repositories Land in
dependency order. Writable sibling repositories and submodules receive their
proven bytes in their existing target working trees without staging, committing,
or manufacturing a gitlink SHA. Read-only repositories have no mutation node.
All writable targets are prepared before mutation and use an ordered, resumable
local saga; an unavailable external delivery remains an external-owner wait
rather than a claim of atomic remote mutation. Legacy in-flight commit-oriented
transactions remain readable through their recorded compatibility route.

Git or deployment activity outside Change Loop is observation, not authority.
A moved control target remains `control-head-moved` unless observed bytes match
the change projection or an explicit external delivery reference exists. Even
then, out-of-band delivery does not create proof, grant authority, or complete
the lifecycle. Sync, re-prove when invalidated, and continue to `archived`.

## Budgets and progress

The watchdog evaluates observed requests and token usage against the widest
applicable execution-surface factor. Factors are selected by maximum, never
multiplied. External authority does not inflate model allowance, and unknown
usage is never fabricated.

Budget actions are:

- 70%: batch remaining work and reuse evidence;
- 85%: stop speculative exploration and optional expansion;
- 100%: stop model work and request split, re-scope, continuation, or pause.

Budget stops apply to model exploration, not deterministic recovery. Packet,
readiness, evidence execution, receipt reuse, metrics, Land recovery, and
archive remain available. A continuation is audited and allowed only when more
model work can move a required code or configuration blocker; it never deletes
usage or lowers assurance.

`budget checkpoint` reports the measured remaining window, unfinished work, and
exact resume route. It never guesses future model demand. A continuation that
cannot unblock the change returns the external evidence, provider, deterministic
operation, re-scope, retire, or pause choice that actually can.

## Compatibility and operator references

`.workflow/` is legacy read-only state. Migration creates candidates rather
than authoritative specs:

```bash
claude-foundation migrate
claude-foundation migrate <legacy-id> --apply
```

Only statements corroborated by code, tests, or accepted contracts may be
promoted.

`claude-foundation` is the stable public control surface. It finds the project
from the current directory or `--project <path>` and routes to the installed
runtime so schemas and behavior stay aligned. Use `change start|amend` and
`advance --through build|proven|archived` for normal work. Operator,
integration, host-instruction, and recovery protocols are documented in
`.claude/harness/README.md`. Do not call `foundation.mjs` directly.

The harness guide also owns requirements and the canonical table of
`.foundation/` runtime state. Those files are machine-owned and ignored by Git;
this workflow names them only where their lifecycle meaning matters.

## Quality invariants

- Zero discovered tests cannot silently pass.
- Missing expected evidence cannot silently pass.
- Browser capability mismatch is inconclusive.
- Mutation crash is not a behavioral kill.
- Stale proof cannot Land or archive.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive.
- Required assurance is never dropped because of size or budget.
- A delivery flow is complete only at `archived`.
