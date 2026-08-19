# Foundation workflow

**Version 3.3.1**

Foundation is an OpenSpec-native harness for safe, economical software changes
in brownfield repositories.

```text
Investigate? → Change → Build → Prove → Land
```

## Why this shape

The previous workflow encoded quality as a long sequence of agent roles and
phases. That preserved quality but made the control plane dominate cost and
latency. The new workflow separates three concerns:

- OpenSpec stores the agreement.
- The native coding agent implements the agreement.
- Deterministic providers prove the agreement.

Rigor scales with risk and evidence needs, not with a task-size phase matrix.

## Commands

### `/investigate <problem>`

Use only when the problem or direction is unclear. Exploration is bounded,
read-only with respect to product code, and may produce an investigation note.
Its output is facts, hypotheses, options, tradeoffs, and a next decision.

### `/change <intent>`

Creates or completes `openspec/changes/<id>/`. The resolver records:

- ambiguity: clear or unclear;
- impact: low, medium, or high;
- coupling: isolated or coupled;
- evidence capabilities;
- size for budget and slicing only;
- semantic security and review triggers.

Standard changes contain proposal, delta specs, design, tasks, evidence, and
execution wiring. Rapid changes contain proposal, tasks, evidence, and execution
wiring and upgrade in place if risk emerges.

`/investigate <decision> --compare` is the optional disposable mode for
genuinely unresolved experience, API, or architecture alternatives. It writes only under
`.foundation/prototypes/`, never edits product code, and adds no lifecycle state;
the selected conclusion is always written to `selection.md`. Continue with
`/change <intent|existing-change> --prototype-selection <selection-path>`; Change
summarizes the decision into proposal/design without treating the ignored
selection or its artifacts as evidence. The runtime rejects local prototype
artifacts and references before they can enter a receipt or proof bundle.

A change that cannot be proven is retired explicitly rather than deleted by
hand. `change abandon <change> --reason <reason> --decision-ref <ref>` releases
its leases, cleans up its sandbox, and moves its change directory, runtime
state, receipts, evidence, and transactions into
`.foundation/recovery/abandoned/<id>/` with an audit line in
`.foundation/logs/abandoned.jsonl`. It requires an explicit recorded user
decision, never touches Git, and refuses an archived change. When the proven
files are already in the working tree it stops and asks whether to keep or
revert them; `--applied keep|revert` records that answer.

### `/build <change>`

The native harness reads the compact change packet and implements it. `tasks.md`
is the only implementation ledger; `handoffs.yaml` separately owns operations
that require AWS, cluster, secret, Terraform, deploy, restart, or other external
authority. Focused checks run during convergence. Native task primitives
or subagents are used only for independently verifiable parallel/resumable work
packages, not lifecycle personas.

For a Git project, create an isolated worktree with:

```bash
claude-foundation sandbox create <change>
```

This is workspace isolation, not an OS security boundary. Inspect the distinction
with `sandbox inspect <change>`. A host that deliberately runs unattended must
use `doctor --stage build --change <change> --unattended` and
`sandbox create <change> --unattended`. Detection is diagnostic, not authorization:
the current runtime accepts no workspace-controlled override and fails unattended
execution closed pending a trusted host-owned attestation mechanism.
`--unattended` is a presence-only security flag: valued or duplicate forms are
rejected before telemetry, workspace inspection, or sandbox mutation. The guard
is cooperative because the runtime cannot infer an external Allow All setting;
the host that enables unattended execution must invoke the guarded form.

For a selected multi-repository topology:

```bash
claude-foundation repos <change>
claude-foundation sandbox create <change> --all
claude-foundation agents plan <change> [--group <n>] [--pretty]
claude-foundation agents dispatch <change> [--pretty]
claude-foundation packet <change> --task <task-id> [--pretty]
```

The plan permits parallel workers only across independent repositories and
resources. It compiles the task, provider, repository, and Land declarations
into one derived graph; OpenSpec and `tasks.md` remain authoritative. Versioned
edge schemas are checked before dispatch. Scoped path, contract, and resource
leases are acquired all-or-none and carry a fencing generation, so a late
worker result cannot advance after takeover. Actual worktree writes, rather
than worker-reported paths alone, must remain inside the granted scope.

The host drives Build by repeatedly calling `agents dispatch`. A
`run-in-session` action preserves the main-session path. For `spawn-group`, the
host acquires the returned leases, regenerates each leased packet, spawns the
native workers without replaying the parent transcript, waits for the complete
group, releases observed results, and calls dispatch again. An unexpired lease
returns `wait`; the harness does not infer that another host's worker died and
does not invoke a model itself.

The full plan is persisted while stdout stays below 4 KiB; workers
receive only an 8 KiB task packet. A one-repository change with at most two
ordinary tasks stays with one agent. It routes mechanical inventory to the configured Haiku/fast tier,
normal implementation to Sonnet/standard, and architecture, security,
migration, or independent review to Opus/deep. Exact model versions remain host
configuration.

Resume planning considers completed tasks as satisfied dependencies and returns
`proof-ready` when no implementation remains. Dispatch is denied when a task
claims behavior outside its repository authority or has no evidence provider.
Failure blocks only the dependent graph closure; independent completed nodes
and valid receipts remain reusable. Aggregate proof still covers every locked
required node and edge, and multi-remote Land revalidates its preparation
snapshot immediately before each mutation wave.
Providers may distinguish their execution cwd (`repository`) from the complete
repository set they consume (`repositories`). Git-backed `mode: read`
dependencies are pinned in detached worktrees, included in provider and
aggregate proof identity, exposed through `FOUNDATION_REPOSITORIES_FILE`, and
must remain unchanged. They never produce Land nodes; target drift requires
sandbox sync and fresh proof.
Load one primary construction skill per task; add only the security and
observability cross-cutting skills whose triggers apply.

An in-contract defect is repaired without asking again. Only new evidence that
would change locked behavior, compatibility, security, data, or rollout opens
one audited batched amendment. Then revise the same OpenSpec change and
synchronize it without losing unchanged completed tasks:

```bash
claude-foundation sandbox sync <change>
```

Sync increments the revision and invalidates previous proof. It is also how a
target that moved during Build — a teammate's pull, another change landing — is
reconciled, and the answer is the same command in either sandbox mode:

- A **git worktree** is pinned to the commit it branched from. Sync replays the
  sandbox's diff onto the current commit and reports
  `rebased: <base> -> <head>`; commits made inside the sandbox flatten into that
  diff. If a hunk no longer applies, the sandbox is left untouched and each
  rejected file is named as a `CONFLICT` — merge the target's version in the
  sandbox worktree and sync again.
  For a multi-repository change, sync prepares every moved writable repository
  before replacing any live sandbox. A conflict is reported as
  `CONFLICT <repository>:<path>` and leaves every repository sandbox and
  recorded base unchanged; a clean replay reports one `rebased <repository>:`
  line per moved repository.
- An **isolated copy** fast-forwards files the target moved while the sandbox
  left them alone, names any double-edited file as a `CONFLICT` immediately, and
  accepts `--resolve <path,path>` once the target's version has been merged into
  the sandbox copy.

A target that moved and could not be reconciled is always reported, never
silent. `sandbox inspect <change>` shows the recorded base against the target's
head, and `land check` refuses a worktree sandbox whose base the target has left.

Packet artifacts flow the other way: edit them in `openspec/changes/<change>/`
in the target — a packet file edited only in the sandbox blocks the sync; only
`tasks.md` ticks merge back.

### `/prove <change>`

Proof validates artifacts, hashes relevant inputs, resolves claims to providers,
reuses valid receipts, executes missing/stale evidence, and writes a proof bound
to the workspace hash.

Composite hashes bind repository content and agreement revision, not Git commit
identity. Recorded base heads remain explicit recovery and Land state: an
unsynchronized target still stops at `control-head-moved`, while rebasing onto a
history-only commit with identical content does not charge another review.

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

Required evidence that is failed, missing, stale, erroneous, or inconclusive
blocks landing.

A gate whose provider executed and failed has three exits, all printed beside
the blocker: fix the cause and re-run, rewire the provider in `execution.yaml`,
or withdraw the gate on record with `claude-foundation change waive <change>
--capability <c> --reason <why> --decision-ref <ref>`. A waiver removes the
capability from the required set while the claim keeps declaring it; it is
carried as a `user-waived` advisory in the proof record and named on the
`LAND READY` line, receipts already earned stay valid, and `--revoke` restores
the requirement. There is no route that lands a failing proof, and `review`
and `acceptance` keep their own waiver and withdrawal routes.

Execution adapters run project-owned commands. `test-discovery` produces
two receipts from one process; `playwright` consumes a structured JSON report
and requires claim annotations. The scheduler reuses valid receipts,
deduplicates identical commands, and runs providers concurrently only when
their declared resources do not conflict. Evidence v1 remains manual-compatible
and upgrades explicitly with `claude-foundation evidence upgrade <change>`.

When executable wiring is absent, `evidence detect` inspects repository-owned
manifests without executing scripts, `evidence init` previews high-confidence
additions and writes them only with `--write`, and `evidence doctor` reports
remaining ambiguity or external authority. Detection never installs tools,
creates receipts, overwrites configured providers, or weakens claim coverage.

`change audit` checks scenario → claim → task → provider traceability, including
negative security paths and migration rollback/integrity. Tasks link explicitly
with `[claims:<claim-id>]`.

Remote CI can return a signed envelope through `evidence verify-ci`; issuer,
workspace, optional commit, run URL, and artifact digests are verified before a
receipt is created. `proof advance` is the normal resumable Prove path. It runs
configured evidence once, routes review before acceptance, and stops cleanly
while external authority is pending. Configured AI review uses `authority run`;
named-human review uses `authority dispatch` before `authority record`;
acceptance uses `authority request` and `authority record` without a review
dispatch. All paths expire or become stale with the workspace and pass the same
receipt validator.

### `/land <change>`

Landing checks proof freshness, applies a proven sandbox diff when applicable,
verifies state identity, then delegates semantic spec sync and archive to the
pinned OpenSpec CLI.

```bash
claude-foundation land check <change>
claude-foundation land recover <change> --decision-ref <ref> [--resolution keep-current|restore-backup]
claude-foundation land archive <change>
```

`land check` mutates nothing. An apply is a transaction over the target, and an
interrupted one stays pending until somebody settles it deliberately: the check
reports the transaction, its status, and how many paths it would update, create
and delete, and `land recover` settles it under a recorded decision. A manual
recovery also requires `--resolution`: `restore-backup` restores and verifies
the recorded pre-apply state, while `keep-current` preserves the target, marks
the projection unapplied, and requires `sandbox sync` before Land can continue.

The projection itself is confined to the change's surface — what git tracks plus
what `tasks.md` declares in `[paths:]`. An untracked path no task names is not
change surface: it neither expires collected evidence nor becomes a deletion at
Land. A path is only deleted from the target when the sandbox is observed to
have removed it.

Commit, push, and pull-request effects require explicit authorization.

### `/changes`

Lists active changes and distinguishes in-progress, proven, stale-proof, and
ready-to-land states. Every listed state names the command that moves it.

A session does not have to ask. The `SessionStart` hook reports each active
change, its status, and that same next command, plus runtime state left behind
by a change that no longer exists. The digest is deliberately hash-free, so it
never claims a proof is fresh: readiness is what `/changes` adds, and the
digest names it rather than implying an answer it did not compute. With no
active change it names the entry points instead, which is also the only place
`/investigate` appears — exploration precedes the state machine and holds no
status of its own.

### `/dev`

Compatibility composition:

```text
/change → /build → /prove
```

It never lands by implication. `--plan-only` stops after `/change`;
`--resume <id>` resumes an active OpenSpec change.

## Schemas

### `foundation-rapid`

Allowed only when all are true:

- low impact;
- isolated;
- no public contract change;
- no persistent migration;
- no semantic security trigger;
- no irreversible effect;
- unit/static evidence is sufficient.

### `foundation-standard`

Used for all other changes. Design remains concise and records only decisions
that constrain implementation, compatibility, rollout, rollback, or proof.

## Evidence

`evidence.yaml` is the stable JSON-compatible behavioral contract.

```json
{
  "version": 2,
  "claims": [
    {
      "id": "owner-updates-profile",
      "scenario": "An authenticated owner updates their profile",
      "impact": "medium",
      "capabilities": ["test"]
    }
  ]
}
```

`execution.yaml` separately holds commands, structured reports, named services,
readiness identity, resources, and environment variable names. Legacy embedded
providers remain readable and migrate with `evidence upgrade`.

Supported capabilities:

| Provider ID | Select it when the claim requires |
|---|---|
| `test` | Executable behavioral checks |
| `discovery` | Proof that the expected tests were actually found |
| `browser` | Rendered behavior or real input in a browser |
| `mutation` | Proof that tests detect a deliberate behavioral fault |
| `state-identity` | Actor, revision, or before/after state identity |
| `integration` | Multiple components or external boundaries working together |
| `compatibility` | Public or persisted contract compatibility |
| `performance` | A measured latency, throughput, resource, or size budget |
| `security-static` | Static security analysis of a changed trust boundary or sink |
| `cross-repo-contract` | Agreement between producer and consumer repositories |
| `review` | Independent risk review |
| `acceptance` | Named human acceptance of an explicitly subjective decision |
| `static-analysis` | Compile, type, lint, or static quality gates |
| `data-migration` | Forward migration, mixed-version safety, and rollback |
| `accessibility` | Semantics, keyboard, focus, contrast, or assistive access |
| `resilience` | Timeout, retry, partial failure, recovery, or degraded dependency |
| `observability` | Required logs, metrics, traces, or alerts |
| `deployment` | Package, configuration, rollout health, or rollback behavior |
| `dependency-supply-chain` | Vulnerability, license, lockfile, or provenance policy |

Run `claude-foundation providers` to inspect the canonical
catalog installed in a project. Providers are evidence contracts, not bundled
vendor tools: `/prove` may execute the repository's existing command with
`claude-foundation evidence run`, or record a receipt from an external system. Select only
providers justified by observable claims.

Test evidence automatically requires suite-level discovery evidence.
Risk-triggered changes automatically require review evidence. After Build, a
changed-surface policy adds supply-chain, migration, accessibility,
compatibility, security/review, or deployment obligations when relevant files
changed.

Because that policy reads files already changed, it can only speak after Build —
by which point the contract is signed and its evidence collected, so a late
obligation expires both the receipts and the review signature bound to them.
`change resolve --surface <glob,glob>` declares the paths a change expects to
touch, and `doctor --stage change` and `change validate` then run the same rules
against them and name the glob behind each forecast capability. The forecast
warns and never gates: enforcement stays with the real changed surface, so a
mis-declared surface can never reduce required evidence.

An obligation the policy infers this way is enforced only where the project has
actually wired a provider for that capability, or where a claim already declares
it. An inferred capability nobody wired is carried as an **advisory**: reported
by `proof plan`, `proof readiness`, and the proof record, and not counted as
evidence. The alternative was worse than it sounds — an unwired capability
defaults to adapter `external`, so a late inference became a gate that appeared
after Build, could not be executed, and stopped Prove and Land with no way
forward. Wire the capability with `evidence init --write` to make it binding.
Review is deliberately outside this rule: it stays a gate, and it has its own
declared waivers below.

Each receipt records provider/version, change, claims, workspace hash, result,
observations, capability metadata, command/log, and timestamps. Status is one of
`pass`, `fail`, `inconclusive`, or `error`.

The provider protocol is deny-by-default: a provider may cover only claims that
declare it, executable providers require an explicit `--claims` scope, and a
provider protocol/version/fingerprint change invalidates old receipts. Browser
receipts record `foreground-required` and `foreground-available` independently.
Playwright uses the distinct `browser-automation` input mode. Foundation does
not install Playwright or browser binaries; `doctor --stage prove --change
<id>` checks the project-owned command, dependency, configuration, readiness
identity, execution DAG, and report topology.

If a configured provider is unavailable, readiness returns
`INFRASTRUCTURE_ERROR` with structured recovery choices: diagnose, retry,
record verifiable external evidence, or reconfigure an available project-owned
command for the same declared claims. Recovery never weakens claim coverage or
manufactures a passing receipt.

Every non-ready state provides an explicit recovery path. Pending tasks return
`NEEDS_CODE_CHANGE` with `/build` and task-plan pointers; topology or agreement
issues return `CONFIGURATION_ERROR` with doctor, `/change`, affected files, and
validation pointers. `changes` also exposes non-archived runtime files whose
active OpenSpec directories disappeared as `orphan-runtime`, and doctor reports
how to restore or quarantine them.

Subjective acceptance or a genuine contract contradiction returns
`NEEDS_USER_DECISION`. Its `decision` envelope is a
machine handoff for the agent, not text to paste to the user. The agent explains
the outcome in the user's language and owns routine commands and metadata. It
never asks the user to run a safe authorized operation it can perform. Genuine
decisions present honest choices (including reject, inconclusive, or pause) and
wait for the answer. Decision recovery never embeds a preselected passing receipt.

Run `claude-foundation proof advance <change>` once as the normal path. It
collects executable evidence, creates or reuses the authority request, and
returns a stable waiting handoff instead of polling or rerunning providers. The
agent uses `authority run` when handing a full or delta packet to the configured
Codex or Claude Code reviewer. An explicitly chosen human review reserves the exact packet with
`authority dispatch`, then records only the real response with `authority record`. Low-level
`proof collect` and `proof run` remain diagnostic/integration commands.

The user never constructs receipt commands or provenance metadata. A crashed,
aborted, or tool-failed dispatch is recorded as infrastructure, does not unlock
a delta, and permits only one full infrastructure retry. It does not overwrite
a previously delivered review receipt.

## Review

Under `workflow.reviewPolicy: "risk-tiered"`, every change receives independent
review, but the correction route is bounded by risk:

- **low** — one full AI review; a material correction promotes the change to
  medium rather than silently spending another low-risk round;
- **medium** — one full AI review, at most one correction batch, then one fresh
  AI delta review that closes the first-round finding IDs;
- **high** — material risks are answered in the initial Decision Sheet; one
  full AI review and at most one post-correction delta, with no human approval
  gate and no third AI.

High risk includes authorization/secrets, public or cross-repository contracts,
migration/destructive state, money, concurrency, replay/idempotency, brokers and
real wire behavior, or activating legacy behavior. Medium includes non-low
impact/coupling and declared review risk; everything else is low.

Security triggers are inferred from the intent as whole words and phrases, so
the words have to name a trust boundary rather than merely appear near one.
`auth token`, `session cookie`, `sensitive data`, and `identity provider` are
triggers; a bare `token`, `session`, `identity`, or `escalation` is not, because
"reduce the token budget" and "escalate to a human" are ordinary sentences.
`--security <trigger>` remains the explicit declaration for a boundary no phrase
caught.

Required review starts from the ≤8 KiB `packet --phase review`, never Build
history. Its changed surface unions committed base-to-HEAD paths with staged,
unstaged, untracked, renamed, and deleted paths for each repository; a missing
recorded base blocks review instead of appearing clean. Every review receipt
identifies the reviewer, the actual reviewer session, and structured
implementation subjects. A medium delta contains only changed review artifacts
and must explicitly close the blocker/major finding IDs from the full review;
out-of-scope delta findings are rejected. Critical work requires a different
model/provider family or a human; other reviews require a fresh context and
prefer diversity. A project with one model available can set
`"review": { "diversity": "single-model" }` in `foundation.json` to accept a
same-family reviewer on critical work; the waiver is named in the review packet
and recorded in the receipt as `diversityWaived`. A project driven from one
session can likewise set `"review": { "independence": "self" }` to let a
reviewer share an implementer's identity and session at any impact; that waiver
is named the same way, recorded as `independenceWaived` beside the observed
`independent: false`, and relaxes only its own axis — a same-family self-review
of critical work still needs the diversity waiver declared alongside it. Both
live only in the committed policy file; neither is a command flag. The shipped
`foundation.json` requires both independence and diversity, configures
`codex-sol` as the default, and also ships `claude-opus`. Codex-only teams select
`codex-sol`; Claude-Code-only teams select `claude-opus`; either team commits
only the `single-model` diversity waiver while keeping independence required.
Set `review.fallbackReviewer` to `main-session` to hand the exact bounded packet
back to the calling agent after the primary records an infrastructure `error`.
The failed attempt remains in the review hash chain. Foundation binds the
ambient host session to matching implementation provenance, current-session
telemetry, or explicit `--main-session-*` values, reserves the fallback attempt, and pre-fills the
response provenance; it refuses the handback rather than guessing missing
identity/model metadata.
This explicit self-review fallback requires `review.independence: "self"`.
`fail` and `inconclusive` are delivered verdicts and never trigger fallback.
Both adapters create a separate read-only, non-persistent session; the Claude
adapter also removes the parent Claude Code nesting marker before launch.
Whichever way the file reads, the receipt records what was observed, not what
was permitted.

The risk route is a hard circuit breaker, not a loop-until-pass rule. After the
allowed delivered AI waves, another open review is refused. A blocker found in
the final delta must name its affected claims and predeclared verification
cases; after an in-contract fix, current passing provider receipts close those
exact IDs deterministically without a third AI. Only a real contract
contradiction opens one batched amendment, and missing operational authority is
`WAITING_EXTERNAL`. A change-level hash chain binds dispatch, completion, finding closure,
scope, and receipt payload, so aborting, deleting a receipt, or renaming a
provider cannot reset the limit. Missing or modified history fails closed.
Workspace edits stale prior review.

`handoffs.yaml` does not block Build or evidence collection. Land blocks an
unresolved `pre-land` or `activation-coupled` operation, but permits an accepted
tracked `post-land` operation only when a declared claim proves the merged
artifact remains safe before activation. Operator records carry names, tickets,
and evidence references—never credentials. An operation without `owner` inherits
`foundation.json > workflow.handoffDefaultOwner` (`devops-team` by default), so
the workflow asks for a specific owner only when that team route cannot proceed.

Human acceptance is separate from review. New standard changes keep this choice
`undecided` until `/change` explicitly records whether subjective product or
experience acceptance is required, and a change stays unvalidatable while it is
undecided. `change resolve` records it:

- `--acceptance-not-required` — no subjective human judgement is involved.
- `--acceptance-required --acceptance-reason <why>` — a named human must accept
  the outcome; the reason states what they are being asked to judge.
- `--acceptance-claims <id,id>` — optional, scopes acceptance to named claims.

Its receipt is
bound to explicit claim IDs, the final workspace, named nonblank criteria, human
identity, observation, provenance, and a durable artifact or reference. Review and
acceptance remain external-only; the deterministic runtime never invokes a model
or impersonates a human.

Findings are `verified`, `hypothesis`, `disproved`, or `accepted-risk`.
Hypotheses require deterministic reproduction before becoming confirmed major
findings.

## Terminal stops

Some guards end a run rather than returning a blocker: exhausted AI review
rounds, a corrupt review chain, a spent budget continuation, a continuation that
more model budget would not unblock, a control repository that moved under a
multi-repository Land, submodule pointers reset after staging, and an apply that
could not finish rolling back.

Each emits the same decision envelope readiness recovery uses — a stop code, at
least two honest options, a recommendation, and a preserved `pause`. A marked
`automaticRecovery` is performed and explained by the agent without opening a
user interview. Agents translate every other option into the user's language;
they never present a stop as a dead end or infer the answer. Retiring with
`change abandon` is one of the offered options wherever it applies.

Foundation also stops on an unresolved apply transaction instead of opening a
new one over it. `doctor --change <id>` reports unresolved transactions before
Land reaches them.

## Security resolver

Triggers are semantic: identity/access, secrets, permissions, cross-user data,
network trust, irreversible mutation, sensitive storage, unsafe sinks, public
security contracts, and security-relevant migrations. Syntax alone is not risk.

## Invalidation

Foundation creates one relevant workspace snapshot per proof and shares its
identity across receipts.
It excludes runtime receipts, sandboxes, dependencies, legacy workflow records,
other active changes, and archived changes. Any relevant edit makes prior
receipts and proof stale.

What is relevant depends on the provider. A provider that runs a command is
bound to the workspace minus the change packet, so editing the proposal,
design, tasks, or a spec delta after proving re-finalizes proof without
re-executing evidence; `review` and `acceptance` are bound to the packet as
well and expire with it. A provider may narrow its binding further by declaring
`inputs` in its execution config, and `proof plan` prints what each one binds.

## Preflight and telemetry

Run `doctor --stage change|build|prove`. Change and Build allow commands that
are explicitly planned but not created yet. Prove requires executable providers
and rejects dependency cycles, report collisions, secret-like literal
environment values, and status-only readiness probes. Add `--require-archive`
when the intended flow includes landing.

Native CLI operations append duration and exit state on a best-effort basis to
`.foundation/logs/<change>/operations.jsonl`. Request, token, cache, and cost
come from uniquely identified host request records; unknown usage is never
reported as zero. Claude Code binds its session transcript at `SessionStart`
and incrementally reads only `assistant.message.usage` at phase checkpoints.
There is no per-tool telemetry hook, and prompt/tool payloads are never copied.
Other hosts use `telemetry import --format generic|codex|cursor|otel|claude`;
OpenTelemetry GenAI/LLM attributes normalize into the same append-only event
contract.

Use `claude-foundation metrics <change>` to aggregate phase timing, unique
provider execution time, request/token/cache/cost totals, orchestrator token
share, and emitted context bytes without double-counting receipts emitted by
one combined execution.

`claude-foundation packet <change> --phase change|build|prove|review|land` emits the bounded
handoff for a fresh execution context. Global, repository, task, and review
packets are capped at 16, 12, 8, and 8 KiB respectively and reference larger artifacts by
path and digest. Compact JSON is the default and is the exact measured budget;
`--pretty` is available for people. Collection previews include counts and
digests, with task packets providing authoritative expansion. Atomic context
events are best-effort, concurrency-safe, tolerant of legacy rows, and rolled
up when their retained set grows. The phase marker first closes usage
from the prior phase using the incremental transcript cursor. Large changed-file
sets collapse into prefix counts plus a digest. Build and Prove consume this
packet instead of replaying the full orchestrator transcript.

## Sandbox safety

Foundation sandboxes protect workspace/apply integrity. They do not by themselves
contain processes, network access, host secrets, or system commands. Never infer
that a Git worktree or copied directory is safe for Allow All/unattended execution.

- Git projects use detached temporary worktrees. A target with uncommitted work
  falls back to an isolated copy, except for output the harness produced
  itself: `.foundation/` and an uncommitted `openspec/changes/archive/` move
  left by landing an earlier change never cost the next change its worktree.
- The target HEAD must remain at the recorded base before apply.
- `git apply --check` runs before target mutation.
- Apply identity covers only paths changed by the proven sandbox. Unrelated
  target edits are preserved and excluded from the projection comparison.
- Touched paths and change artifacts are backed up and journaled before writes;
  failures roll back and interrupted transactions recover on retry. A rollback
  that could not complete stops the next apply with its recorded options rather
  than opening a fresh transaction over the divergence.
- The sandbox remains the proof subject until archive and proof audit finish.
- Conflicts stop without overwriting unrelated user edits.
- Mutation testing happens only in isolation.

Non-Git projects use an isolated temporary copy with a before/after content
manifest. The copy preserves symbolic links verbatim, so a relative link never
becomes an absolute path back into the target. Apply rejects any touched target
path changed since the baseline, then verifies the expected touched-path
projection.

Change surface excludes tool-owned output directories, and the copy excludes
the same set. `.foundation/` and `.workflow/` are matched at the project root
only; every other name is matched at any depth but never applies to a path git
tracks. A committed fixture is content whatever its directory is called, and a
generated directory is untracked wherever it sits. Multi-repository changes use one
OpenSpec change plus a repository manifest and require cross-repository contract
evidence before each repository is landed in its declared order. That evidence
is checked, not asserted: the `contract-digest` adapter hashes one declared
artifact in every participating repository and passes only when the bytes agree.

`openspec/repositories.yaml` is the project's topology catalog and is
hand-maintained. Each entry declares `id`, `type` (`root|submodule|git|
external`), `path`, `mode` (`read|write`), and `dependsOn`; `allowOutsideRoot`
permits a path outside the project root. Submodules are discovered from
`.gitmodules`, and an unregistered one is reported by `doctor`. Each change then
selects the subset it may touch in its own `repositories.yaml`, with the
dependency closure enforced.

Only a submodule child gets a durable binding: its landed commit is recorded as
a root gitlink. For a `type: "git"` sibling the commit lives only in gitignored
runtime state, and `land record` says so. `--ci pass` is the operator's word
unless `--ci-attestation <signed.json>` supplies an Ed25519-signed CI envelope
bound to that commit; `--ci-required` refuses the unsigned assertion.
Their workspace identity is composite, while providers configured with
`repository` bind receipts to one repository snapshot. Unrelated repository
edits therefore preserve scoped evidence; contract and producer/consumer edits
still invalidate integration evidence. Multiple remotes Land through an
ordered, resumable saga with explicit commit/CI records and root pointer
verification, never by claiming atomic remote mutation. Staging root pointers
that already hold the landed commit is a no-op and leaves the proof valid, so
Land and Prove cannot trade a change back and forth.

## Watchdog

The external event ledger requires unique request identity and records operation,
agent/model, parent request, tokens, cache, cost, tool, hash, and change. The
watchdog evaluates the larger of request usage and configured token usage, so a
small number of unusually large requests cannot bypass the thresholds.

Budget actions:

- 70%: batch remaining work and reuse evidence;
- 85%: stop speculative exploration;
- 100%: stop and split or re-scope.

A run gets one operator continuation. Spending it, or asking for one when more
model budget would not move the change, stops with the options that would: the
external evidence, provider, or deterministic operation the proof is actually
waiting on, re-scoping, retiring the change, or pausing.

The stop applies to further model exploration. Deterministic packet, readiness,
evidence, proof-resume, metrics, and archive commands remain available, and
fresh receipts are reused. Required evidence is never removed to meet budget.

## Legacy migration

`.workflow/` is no longer runtime state. Existing records remain read-only.

```bash
claude-foundation migrate
claude-foundation migrate <legacy-id> --apply
```

Apply creates migration candidates, not authoritative specs. Only statements
corroborated by code, tests, or accepted contracts may be promoted.

## Native CLI

Host integrations can resolve the canonical workflow instruction owned by the
installed release without locating or reading a Foundation project:

```bash
claude-foundation host instruction <command> --protocol 1 --format json --arguments <text>
```

Protocol 1 supports `investigate`, `change`, `build`, `prove`, `land`,
`changes`, `feature`, and `dev`. It returns the command, description, rendered
instruction, argument mode, protocol, and Foundation version as JSON. Argument
text is opaque; `changes` accepts none. Unsupported protocols, unknown commands,
unexpected arguments, and unavailable package instructions fail closed with a
stable JSON error code. The endpoint is additive and ships before a host adopts
it; a host that cannot obtain protocol 1 must request a compatible Foundation
release instead of reading project command files or using a bundled copy.

Hosts can resolve the portable agent contract from the same installed release:

```bash
claude-foundation host agent-contract --protocol 1 --format json
```

Agent-contract protocol 1 returns the exact package-owned
`.claude/harness/AGENT.md` text, protocol, and Foundation version as JSON. It
does not perform project discovery or return a filesystem path. Unsupported
protocols or formats, invalid flags, and unavailable or incomplete package
content fail closed with a stable JSON error code. This resource is separate
from `host instruction`; adding it does not change command instruction
responses or argument handling.

`claude-foundation` is the stable public control surface. It searches upward
from the working directory, or from `--project <path>`, and forwards to the
runtime installed in that project so schemas and runtime behavior stay aligned.
Use canonical `change`, `packet`, `evidence detect|init|doctor`,
`proof readiness|collect|run`, `sandbox create|sync`, and
`land check|record|resume|archive` commands rather than calling runtime
internals directly.

When the packaged CLI is not on `PATH`, use the source checkout's public router:

```bash
bash /path/to/claude-foundation/cli.sh --project "$PWD" proof readiness <change>
```

Do not bypass it with `foundation.mjs`; that file intentionally exposes the
hyphenated low-level runtime API rather than the public nested command grammar.

## Runtime layout

```text
foundation.json
openspec/
  config.yaml
  repositories.yaml
  schemas/
  specs/
  changes/
  investigations/

.foundation/
  runtime/
  receipts/
  evidence/
  snapshots/
  logs/
  sandboxes/
  repository-sandboxes/
  plans/
  leases/
  transactions/
  authority/
  attestations/
  instruction-manifests/
  recovery/
```

The contents under `.foundation/` are machine-owned and ignored by Git.
`.claude/harness/README.md` carries the canonical table of what each directory
holds; the listing above names them without restating it.

## Requirements

- Node.js 20.19 or later
- OpenSpec pinned to `@fission-ai/openspec@1.7.0`
- Git for worktree isolation
- `jq` for automatic settings merge during installation

## Quality invariants

- Zero discovered tests cannot silently pass.
- Missing expected evidence cannot silently pass.
- Browser capability mismatch is inconclusive.
- Mutation crash is not a behavioral kill.
- Stale proof cannot land or archive.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive.
- Required assurance is never dropped because of size or budget.
