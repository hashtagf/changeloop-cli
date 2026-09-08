# Change Loop harness runtime

This directory contains the deterministic runtime installed with Change Loop.
It turns an OpenSpec change into a bounded implementation and
evidence workflow:

```text
Investigate? → Change → Build → Prove → Land
```

The harness is the control plane, not the coding agent and not a replacement
for project tooling. OpenSpec owns the agreement, the native coding agent owns
the implementation, and project-owned providers such as test runners,
Playwright, linters, or security scanners produce evidence.

The product and workflow are called **Change Loop**. The package and CLI remain
`claude-foundation`, so existing commands do not change.

## Using Change Loop

Users describe the goal to their coding agent and use `/change`, `/build`,
`/prove`, and `/land`; `/dev` can drive Change through Prove in one request.
The agent runs the underlying CLI, so users do not need to construct JSON,
receipt, recovery, or bookkeeping commands.

At each gate, the harness checks once and returns all known repairable findings
as one plan. The agent fixes that batch and the harness rechecks only evidence
made missing or stale by the fix. This repeats while useful progress is
possible. The user is asked only for a product decision, explicit side-effect
authority, unavailable external system, or semantic conflict. Harness setup and
host permission recovery stay internal. A change is
finished only after the user explicitly authorizes Land and its state is
`archived`.

Installed users should start with `WORKFLOW.md`. The rest of this page maps the
runtime for maintainers and evidence authors; `EVIDENCE.md` is the canonical
provider and receipt contract.

Every phase view is derived from one versioned execution contract. Semantic
draft v3 compiles meaningful keys into stable cross-ledger IDs and writes only
the OpenSpec artifacts the change needs. After Change, protocol-v5 `advance`
is the normal model-facing entrypoint; primitive commands remain compatible
operator and integration tools. It compiles
risk, required providers, external authority, workspace mutation capability,
budgets, repositories, and Land requirements once; packets, planning,
readiness, and the mutation guard consume that result instead of independently
reinterpreting policy. Lifecycle writes go through the typed reducer. These are
backend changes only: installed user command names and arguments are unchanged.

## Files in this directory

| Domain | File | Role |
|---|---|---|
| Entrypoint | `foundation.mjs` | Public CLI compatibility and lifecycle orchestration |
| Composition | `runtime/composition/bootstrap.mjs` | Project-root discovery, runtime paths, and atomic JSON persistence adapters |
| Contracts | `runtime/contracts/change-artifacts.mjs` | Pure task-ledger and specification-delta parsers shared across domains |
| Contracts | `runtime/contracts/model-policy.mjs` | Risk-sensitive task kinds shared by planning and drift inspection |
| Core | `runtime/core/cli-flags.mjs` | Shared permissive and strict command flag parsing |
| Core | `runtime/core/cli-router.mjs` | Runtime command dispatch over an explicit orchestration API |
| Core | `runtime/core/diagnostics-runtime.mjs` | Doctor, migration, provider listing, and CLI usage diagnostics |
| Core | `runtime/core/execution-contract.mjs` | Compiled risk, evidence, authority, workspace, budget, repository, and Land capabilities |
| Core | `runtime/core/lifecycle-outcome.mjs` | Owner-validated lifecycle outcomes and target-versus-delivery user projection |
| Core | `runtime/core/land-grant.mjs` | Session/change/proof/target-bound explicit Land authority |
| Core | `runtime/core/tool-preparation.mjs` | Project-local tool readiness, preparation identity, and setup boundaries |
| Core | `runtime/core/lifecycle-reducer.mjs` | Typed lifecycle transitions and compatibility-preserving state mutation |
| Core | `runtime/core/process-runtime.mjs` | Provider process execution, readiness checks, and managed services |
| Core | `runtime/core/shell-mutation-policy.mjs` | Shared phase-aware shell mutation and canonical Build containment policy |
| Core | `runtime/core/state-runtime.mjs` | Runtime state, paths, hashing, snapshots, workspace manifests, and Git helpers |
| Core | `runtime/core/trust.mjs` | Canonical JSON and Ed25519 verification shared by trust protocols |
| Core | `runtime/core/update-advisory.mjs` | Phase-bound stable-release discovery, shared cache, and version comparison |
| Core | `runtime/core/workspace-policy.mjs` | Canonical workspace and sandbox-copy exclusion policy |
| Evidence | `runtime/evidence/artifact-store.mjs` | Durable evidence artifacts, containment, digest validation, and prototype rejection |
| Evidence | `runtime/evidence/attestation.mjs` | Host-boundary inspection and signed unattended authority |
| Evidence | `runtime/evidence/evidence-bootstrap.mjs` | Safe project-manifest detection and provider candidates |
| Evidence | `runtime/evidence/evidence-contract.mjs` | Evidence/execution contracts, provider workspaces, policy, and fingerprints |
| Evidence | `runtime/evidence/evidence-results.mjs` | Structured evidence reports, adapter commands, and resource conflicts |
| Evidence | `runtime/evidence/proof-readiness.mjs` | Proof topology, readiness classification, recovery advice, and preflight |
| Evidence | `runtime/evidence/proof-runtime.mjs` | Proof bundle finalization and immutable receipt audit |
| Evidence | `runtime/evidence/receipt-runtime.mjs` | Receipt recording, review/acceptance binding, and reusable evidence |
| Evidence | `runtime/evidence/adapter-runtime.mjs` | Manual providers, services, logs, and executable evidence adapters |
| Evidence | `runtime/evidence/proof-execution-runtime.mjs` | Proof collection, execution, and end-to-end run orchestration |
| Evidence | `runtime/evidence/proof-execution/service-sessions.mjs` | Managed proof-service startup, reverse-order cleanup, and signal reclamation |
| Evidence | `runtime/evidence/provider-catalog.mjs` | Provider capability, adapter, input-mode, and operator-description catalog |
| Evidence | `runtime/evidence/provider-scheduler.mjs` | Provider graph construction, dependency scheduling, and resource-safe batching |
| Evidence | `runtime/evidence/review-attempt-store.mjs` | Durable chained review-attempt history and migration |
| Evidence | `runtime/evidence/review-protocol.mjs` | Pure review provenance, receipt binding, and attempt validation |
| Evidence | `runtime/evidence/signed-ci.mjs` | Signed CI envelope verification |
| Evidence | `runtime/evidence/semantic-acceptance.mjs` | Signed hidden/independent case verification without exposing oracle content |
| Evidence | `runtime/evidence/traceability.mjs` | Pure scenario, claim, task, and provider auditing |
| Quality | `runtime/quality/quality-runtime.mjs` | Consumer discovery, execution, baselines, debt, and repository-lane aggregation |
| Quality | `runtime/quality/adapter-registry.mjs` | Portable CRAP and mutation report adapters |
| Quality | `runtime/quality/quality-policy.mjs` | Changed-code ratchets, fallback assurance, and bounded exceptions |
| Observability | `runtime/observability/telemetry.mjs` | Portable host telemetry normalization |
| Observability | `runtime/observability/metrics-runtime.mjs` | Read-only aggregation of operations, usage, context, and evidence metrics |
| Observability | `runtime/observability/telemetry-runtime.mjs` | Context events, host transcript synchronization, and telemetry ledgers |
| Workflow | `runtime/workflow/agent-planning.mjs` | Task dependency/resource planning and bounded dispatch views |
| Workflow | `runtime/workflow/apply-runtime.mjs` | Apply transaction preparation, recovery, cleanup, and archive orchestration |
| Workflow | `runtime/workflow/authority-runtime.mjs` | Authority request/response bridge and signed CI recording |
| Workflow | `runtime/workflow/authority.mjs` | External authority request persistence and response validation |
| Workflow | `runtime/workflow/budget.mjs` | Run/lifetime usage windows and budget policy transitions |
| Workflow | `runtime/workflow/change-lifecycle.mjs` | Change creation, draft materialization, resolution, and atomic start |
| Workflow | `runtime/workflow/semantic-draft.mjs` | Semantic draft v3 validation, stable links, typed extensions, and provider defaults |
| Workflow | `runtime/workflow/semantic-amendment.mjs` | Transactional Build-time agreement amendments that preserve canonical prose and completed work |
| Workflow | `runtime/workflow/advance-runtime.mjs` | Protocol-v5 deterministic chaining, owner outcomes, and safe user projection |
| Workflow | `runtime/workflow/change-validation.mjs` | Traceability, change validation, and provider requirements |
| Workflow | `runtime/workflow/land-journal.mjs` | Atomic apply identity, journal, rollback, verification, and cleanup |
| Workflow | `runtime/workflow/land-runtime.mjs` | Multi-repository Land readiness, planning, pointers, and resume saga |
| Workflow | `runtime/workflow/repository-delivery-saga.mjs` | Prepare-all, dependency-ordered, uncommitted multi-repository Apply and resume |
| Workflow | `runtime/workflow/lease-runtime.mjs` | Agent resource lease acquisition, renewal, release, and cleanup |
| Workflow | `runtime/workflow/packet-runtime.mjs` | Changed-surface calculation and bounded task/review packet generation |
| Workflow | `runtime/workflow/repository-topology.mjs` | Repository discovery, selection, dependency validation, and workspace views |
| Workflow | `runtime/workflow/sandbox-runtime.mjs` | Isolation inspection, sandbox creation, and contract synchronization |
| Workflow | `runtime/workflow/security-policy.mjs` | Trust-boundary phrases that select security-sensitive assurance |
| Workflow | `runtime/workflow/validation/spec-delta.mjs` | Scenario-drop and new-capability validation for OpenSpec deltas |
| Docs | `runtime/README.md` | Domain boundaries and dependency rules |
| Docs | `AGENT.md` | Small portable contract loaded by Claude, Codex, and other agents |
| Docs | `EVIDENCE.md` | Evidence contract, execution adapter, and proof reference |
| Docs | `CONSUMER-QUALITY.md` | Installed quality protocols, onboarding, adapters, baselines, and fail-closed rules |
| Docs | `README.md` | Runtime overview and operator guide |

Semantic draft version 3 is the default. Agents write intent, requirements,
tasks, and evidence capabilities once; the compiler generates stable IDs,
cross-ledger links, specs, and safe detected provider wiring. Multiple specs,
decisions, diagrams, prototype selections, integration documentation,
repositories, and external operations are typed extensions. Version 1 remains
an exact compatibility path and version 2 retains its unambiguous mechanical
bookkeeping behavior.

Rich local references resolve to regular files inside the project; remote
integration references use HTTPS with a fixed version. Semantic amendments may
extend an existing task's claims but require a new task to change its outcome
or verification command, so a completed task never changes meaning silently.

Use the public CLI instead of invoking `foundation.mjs` directly. The CLI finds
the project from the current directory, or from `--project <path>`, and then
uses the runtime installed in that project.

`foundation.mjs` remains the compatibility entrypoint and lifecycle
orchestration layer. Runtime modules own bounded protocols, policy state
machines, parsing, or pure transformations. Filesystem mutation is restricted
to explicit stores/adapters injected by the entrypoint. This keeps installed
CLI behavior stable while making routing, repository topology, provider
scheduling, review validation, security, evidence, budgeting, and normalization
logic independently testable.

## Requirements

- Node.js 20.19 or newer
- Git for isolated sandbox/worktree operations
- npm access when the pinned OpenSpec CLI needs project-local preparation
- Project-owned test and browser dependencies required by configured evidence

Change Loop prepares its pinned OpenSpec CLI under `.foundation/tools` when it
is absent and runs declared repository setup commands in isolated workspaces.
It does not globally install Playwright, browser binaries, test frameworks, or
application dependencies; each application locks and maintains those versions.

`.foundation/tools/` is machine-owned cache state: it is ignored by Git,
recreated from the pinned runtime contract, and never part of a change packet.

Check a project before starting:

```bash
claude-foundation doctor --stage change
claude-foundation update check
```

Update discovery runs only at Investigate entry, Change entry, and Build
preflight. A 24-hour user cache is shared by every project; unavailable release
metadata becomes a stale or unknown non-blocking advisory. Prove and Land do
not check. Advisory data is excluded from deterministic evidence identity, and
the harness never applies an update without user authority. Set
`FOUNDATION_UPDATE_CHECK=0` to disable discovery.

### Agent update policy

Load this policy only when an instruction or packet has
`notification.surface: true`. Translate the supplied status and actions
into the user's language. The harness owns the phase timing and session-level
duplicate decision; `FOUNDATION_SESSION_ID` lets host adapters persist that
decision across Investigate and Change processes. A Build directive is a
reminder immediately before that Build entry, including when Build is the first
phase entered. The notice and reminder never block work, and the agent must not
run an update action unless the user requests it. Do not surface an automatic
update notice during Prove or Land, and do not override a false `surface`
decision.

Check both the project and one change's executable evidence:

```bash
claude-foundation doctor --stage prove --change <change>
```

## Primary agent commands

| Command | What it does | When to use it |
|---|---|---|
| `change start --template` | Prints the compact semantic draft v3 contract | Beginning a fresh Change |
| `change start <draft.json>` | Compiles, validates, installs, and prepares one isolated change transactionally | Completing Change |
| `change amend <change> <amendment.json>` | Adds discovered requirements while preserving canonical content and completed tasks | A semantic v3 Build discovers new behavior |
| `advance <change> --through build\|proven\|archived` | Runs deterministic steps and returns one `EDIT`, `RUN_EXTERNAL`, `REPAIR`, `WAIT`, `ASK_USER`, or `DONE` action | Every normal step after Change |

## Advanced operator and compatibility commands

| Command | What it does | When to use it |
|---|---|---|
| `providers` | Lists supported evidence contracts | Choosing evidence for a change |
| `repos [change]` | Shows discovered topology, drift, and change selection | Setting up or diagnosing multi-repo work |
| `models` | Shows portable model-tier mappings | Reviewing cost/quality routing |
| `quality discover\|init\|doctor` | Discovers profiles, drafts config, and diagnoses project-owned tools | Onboarding a consumer repository |
| `quality run\|report` | Runs report-only or enforced per-repository quality lanes | PR/Prove quality checks |
| `quality baseline\|debt` | Explicitly versions reviewed baselines and renders debt inventory | Pilot graduation and nightly inventory |
| `agents plan <change> [--group <n>] [--pretty]` | Persists the full plan and prints a ≤4 KiB summary or one dispatch group | Before spawning independent workers |
| `agents dispatch <change> [--pretty]` | Returns one graph- and lease-bound native-host action | Advanced host integration behind `advance` |
| `advance <change> [--through build\|proven\|archived] [--host-result <result.json>] [--pretty]` | Runs deterministic lifecycle work and returns one minimal action at a real boundary | Normal post-Change agent path |
| `doctor` | Checks runtime and project readiness | After install or when diagnosing setup |
| `changes` | Lists active changes and readiness | Finding work to resume or land |
| `packet <change> --phase <phase>` | Prints a compact diagnostic handoff; review packets are ≤8 KiB | Operator/debug inspection |
| `packet <change> --repo <id> [--task <id>] [--pretty]` | Prints a bounded repository or task packet | Starting a native subagent |
| `metrics <change>` | Reports measured phase/provider cost and emitted context bytes | Finding latency or orchestration overhead |
| `feedback <change> [--pretty] [--diagnostics]` | Reports current readiness, source-aware timing, repair intervals, blocker coverage, evidence reuse, and the next action; diagnostics exports allowlisted metadata | Explaining why Prove took time without labeling repair as wait |
| `budget checkpoint <change>` | Reports measured remaining allowance, unfinished work, and the exact resume route | Before deciding whether an exhausted run should continue, rescope, or pause |
| `exec <change> [--phase <phase>] -- <command…>` | Derives the phase, runs Build commands in the canonical workspace under the shared mutation policy, passes the exit code through, and records duration | Long build-phase commands (container builds, installs, full test runs) |
| `telemetry host-import <change> <result.json>` | Imports a validated host execution result without prompt or tool payloads | Recording actual model attempts, fallback, usage, and instruction provenance |
| `budget continue <change> --reason <reason>` | Opens one policy-gated audited completion window without deleting usage | Required model work after exhaustion |
| `change validate <change>` | Validates change artifacts | After creating or revising an agreement |
| `change audit <change> [--json]` | Audits scenario → claim → task → provider traceability | Before Build or after contract edits |
| `proof readiness <change>` | Returns READY or a typed blocker with exact next commands | At the end of Build and start of Prove |
| `proof advance <change>` | Converges missing/invalidated evidence through aggregate repair batches | Advanced primitive used by `advance --through proven` |
| `proof run <change>` | Executes, finalizes, and audits proof as one operation | Low-level diagnostic/integration path |
| `proof collect <change>` | Runs available project-owned evidence without finalizing proof | Low-level preparation for an explicit integration |
| `evidence detect <change>` | Finds safe project-owned provider candidates without executing them | When derived or custom wiring is incomplete |
| `evidence init <change> [--write]` | Previews or explicitly writes high-confidence provider wiring | Before manually wiring detected test/static/browser tools |
| `evidence doctor <change>` | Explains configured, detectable, and unresolved capabilities | Diagnosing why Prove lacks a provider |
| `evidence verify-ci <change> <provider> <signed.json>` | Verifies a signed, workspace-bound CI envelope | Importing trusted remote CI evidence |
| `evidence record ...` | Records evidence produced by an external system | CI, human review, or remote systems |
| `authority request\|status\|dispatch\|run\|abort\|record ...` | Routes configured AI review and bound human review/acceptance responses | Crossing a human or remote authority boundary |
| `evidence upgrade <change>` | Upgrades evidence v1 to v2 without guessing commands | Migrating an older active change |
| `sandbox create <change>` | Creates an isolated Git worktree | Advanced primitive behind `advance --through build` |
| `sandbox challenge <change>` | Creates a short-lived nonce and permission contract | Before a host signs unattended authority |
| `sandbox create <change> --unattended --attestation <file>` | Verifies and consumes one trusted host attestation | Unattended Build only |
| `sandbox create <change> --all` | Creates selected repository sandboxes or repairs missing bindings while preserving valid worktrees | Advanced multi-repo primitive and recovery behind `advance` |
| `sandbox sync <change> [--resolve <path,path>]` | Synchronizes a revised agreement and reconciles a moved target: a worktree replays onto the new commit, a copy fast-forwards what it left alone; `--resolve` accepts a merged double-edit | When requirements change during Build, or the target moved (another change landed) |
| `land check <change>` | Checks proof freshness and landing readiness | Before accepting the change |
| `land record <change> ...` | Legacy compatibility: binds a commit for an already-active commit-oriented transaction | Diagnosing/resuming a legacy transaction only |
| `land resume <change>` | Rechecks a resumable Land saga | Diagnostic primitive; normal recovery repeats `/land` |
| `land archive <change>` | Applies, verifies, archives, and safely cleans up | Completing an accepted change |
| `handoff status <change>` | Shows external operations and Land disposition | Checking work owned by DevOps/SRE/security |
| `handoff packet <change> [--id H00n]` | Emits one credential-free operator packet | Sending the exact operation to its named owner |
| `handoff record <change> ...` | Records accepted/completed/rejected with actor and evidence references | Resuming Land without turning operator work into a developer task |
| `migrate [legacy-id] [--apply]` | Reads legacy `.workflow/` state and optionally creates migration candidates | Recovering an older installation without promoting unverified prose |
| `host instruction <command> --protocol 1 --format json --arguments <text>` | Resolves the package-owned command instruction | Host integration without reading consumer command files |
| `host agent-contract --protocol 1 --format json` | Resolves the portable package-owned agent contract | Installing or refreshing a host adapter |

Consumer-quality configuration is opt-in and remains report-only until the
project explicitly enables enforcement. The complete installed command,
protocol, adapter, baseline, exception, CI, and fail-closed reference is
[`CONSUMER-QUALITY.md`](CONSUMER-QUALITY.md).

If the whole project directory moves, rerunning `sandbox create <change>` can
rebind a recorded sandbox to the canonical `.foundation/sandboxes/<change>` in
the new project location. Recovery requires the old path to be absent, the
change marker and harness layout to match, and any recorded Git metadata to
remain valid. A moved worktree with a broken Git pointer is refused and must be
recreated.

`--unattended` is a presence-only security flag. Valued and duplicate forms are
rejected before telemetry or workspace mutation. The host first calls `sandbox
challenge`, signs the canonical challenge with an Ed25519 key installed in a
system-owned trust root, and supplies the envelope with `--attestation`.
Attestations are short-lived, project/agreement/permission-bound, single-use,
and still fail when a host-control socket, SSH agent, or mounted cluster
credential is exposed. Container detection alone is never treated as trust.

Review and acceptance adapters are external-only. Review packets combine
committed and dirty paths from recorded repository bases with contract
artifacts. Protocol-v3 receipts store reviewer/subject tuples, actual AI
sessions, finding closure, and exact scope in a change-level hash-chained
attempt history. Low gets one full AI review; medium and high get at most one
full AI review plus one post-correction delta. One infrastructure retry is
separate from delivered review waves. A final in-contract blocker is closed by
its named claims and passing critical-case receipts, not a third AI. High-risk decisions are settled
in the initial Decision Sheet, not a mandatory human-final gate. Deleting a receipt, aborting, or
renaming a provider cannot reset the circuit. Acceptance is revalidated against explicit claims, human
identity, criteria, observation, provenance, durable evidence, contract reason,
and workspace hash.

Run `claude-foundation help` for command syntax and installer options.
Low-level `runtime` commands are reserved for installed slash commands and
diagnostics.

## Host integration protocols

Host integrations resolve canonical instructions from the installed release:

```bash
claude-foundation host instruction <command> \
  --protocol 1 --format json --arguments <text>
claude-foundation host agent-contract --protocol 1 --format json
```

Instruction protocol 1 supports `investigate`, `change`, `build`, `prove`,
`land`, `changes`, `feature`, and `dev`. It returns the command, description,
rendered instruction, argument mode, protocol, and Change Loop version.
Arguments are opaque and `changes` accepts none. Agent-contract protocol 1
returns the exact package-owned `AGENT.md` text, protocol, and version; it does
not perform project discovery or expose a filesystem path.

Unknown commands, invalid arguments, incomplete package content, and unsupported
protocols or formats fail closed with stable JSON error codes. These endpoints
ship before a host adopts them. A host that cannot obtain protocol 1 must request
a compatible Change Loop release rather than read consumer command files or
bundle its own copy.

When the packaged CLI is not on `PATH`, use the source checkout's public router:

```bash
bash /path/to/claude-foundation/cli.sh --project "$PWD" \
  proof readiness <change>
```

The router preserves public nested command grammar. Do not invoke
`foundation.mjs` directly; its hyphenated low-level API is an implementation
surface.

## Repository and model execution

For multi-repository work, resolve contracts in this order: project topology →
change read/write selection → task ownership/dependencies → sandbox creation →
provider repository scope → proof readiness → Land order. Do not begin with
provider wiring or worker assignment; both consume the earlier scopes and must
not invent missing repositories. The user confirms write scope and external
commit decisions. The agent owns manifests, runtime commands, recovery, and a
plain-language report of what was read, written, proven, and still waiting.

The committed `openspec/repositories.yaml` describes root, submodule, Git, and
external nodes. A monorepo remains one Git repository and uses task path scopes
rather than pretending packages are independently landable remotes.
Per-change `repositories.yaml` selects access
and dependency scope. The runtime creates child worktrees under
`.foundation/repository-sandboxes/`, hashes them into one composite snapshot,
and scopes provider commands and receipts with `repository`. Read-selected Git
repositories also receive detached worktrees: they participate in proof but
cannot contribute a Land commit. A provider that executes from one repository
but needs several declares `repository` as its cwd and `repositories` as its
complete dependency set. Its command receives
`FOUNDATION_REPOSITORIES_FILE`, a JSON manifest containing those isolated paths.

`tasks.md` stays the only implementation ledger. Permission-bound operations
live in `handoffs.yaml` and durable state under `.foundation/handoffs/`.
`[repo:<id>]`, `[depends:<task-ids>]`,
`[kind:<kind>]`, `[paths:<paths>]`, and `[resources:<locks>]` are compact
execution annotations. `agents plan` uses them to prevent same-workspace or
shared-resource concurrency and applies the model tiers in `foundation.json`.
The complete plan is persisted under `.foundation/plans/`; stdout is a compact
summary, or one group selected with `--group`. `packet --task` emits only the
chosen task's claims, files, providers, and model. A one-task change recommends
one agent. Multiple ready tasks with disjoint declared paths can fan out in the
same repository; overlapping, dependent, or unknown scopes stay serialized.
The plan is advice and bounded authority for the native
host; the harness does not invoke a model itself.

`agents dispatch` derives the next host action from that plan plus current task
leases. It returns `run-in-session`, `run-leased-in-session`, `spawn-group`,
`wait`, `blocked`, or `build-complete`. A planned frontier with only one
runnable task stays in the parent session under the same lease, fencing, and
observed-result authority used by a worker, avoiding a spawn with no possible
parallel speedup. A live lease always returns `wait`, so a restarted host does
not duplicate an executor it cannot prove abandoned. For a spawn group, the
host acquires each lease, regenerates the now-leased task packet, and gives the
native worker only that packet and repository state. Change Loop still never
starts a model process itself.

The host copies `executionAuthority.leaseId` from the acquired task packet into
`agents release --lease-id`. After any takeover, a generation-less release is
refused so a late executor with the same stable owner cannot clear the current
lease.

JSON output is compact by default and `--pretty` is inspection-only. Plan
schema 5 compiles a deterministic setup/service/task/provider/repository/Land
graph, prioritizes the longest ready dependency path within configured resource
and capacity bounds, resumes dependencies satisfied by completed tasks, reports
`proof-ready` after all tasks complete, and declares the deepest model required
by a mixed session while carrying instruction provenance. Packet schema 7 adds
the active graph, lease fencing generation, execution attempt, and versioned
result authority; it rejects unknown, cross-repository, providerless, stale, or
out-of-scope task results. Large collections are previews plus counts and
digests; use `packet <change> --task <task>` as the authoritative expansion.

Several changes may be active at once. Path and repository scopes never
serialize across changes: each change builds and proves in its own workspace,
and the change that lands later synchronizes onto the moved target
(`sandbox sync`), resolves any double edit, re-proves, and lands. The plan
reports such overlaps as `overlaps`, for information. Only an explicit
`[resources:]` token names something two changes cannot use at once (a shared
database, a deploy target); those still block the plan and a concurrent proof
run. Within one change, conflict scopes are hierarchical: disjoint paths let
tasks run in parallel, and missing or ambiguous scope takes the exclusive
repository key for that change's workers. All keys are acquired atomically.
Proof records node diagnostics plus one aggregate graph proof, while Land
persists a prepare-all snapshot and compare-and-swap revalidates it before each
multi-remote mutation wave.

Multiple writable repositories use ordered local saga states rather than an
atomicity claim. Change Loop prepares every target first, applies dependency
waves as uncommitted diffs, verifies HEAD/index invariants, and requires fresh
composite proof. It never stages, commits, or pushes. Legacy active
commit-oriented records retain their old resume route. Composite routing comes from the declared
selection, not `state.repositories` cardinality: one selected non-root child
still uses the saga. After isolation, a child record must bind its worktree,
catalog target, access mode, and base head; a missing or invalid record fails
closed instead of falling back to the live checkout. `sandbox inspect` exposes
the incomplete record using filesystem and Git-metadata reads only, without a
PATH-resolved Git process. Repeating `sandbox create <change> --all` repairs a
partial binding in place and preserves every valid existing child worktree.

## Normal flow

### 1. Define the agreement

Use `/change` to create or revise `openspec/changes/<change>/`. A complete
change declares its intent, tasks, claims, and required evidence capabilities.
Use `/investigate` first only when the problem or direction is materially
unclear.

Validate the result:

```bash
claude-foundation change validate <change>
claude-foundation change audit <change>
claude-foundation doctor --stage build --change <change>
```

Task annotations such as `[claims:profile-owner-update]` provide the explicit
claim link. The audit also checks exact scenario mapping, provider coverage,
security negative paths, and migration rollback/integrity expectations.

### 2. Build in isolation

Use `/build <change>`. For a Git project, the harness creates an isolated
workspace under `.foundation/sandboxes/<change>`.

A fresh sandbox has no installed dependencies — the copy path excludes them
and a worktree is a bare checkout. Declare a setup command and the harness
runs it once inside every newly created sandbox:

```json
// foundation.json
{ "sandbox": { "setupCommand": "npm ci", "setupTimeoutMs": 600000 } }
```

Without it, `sandbox create` prints a NOTE naming this snippet whenever the
project has a lockfile, and the phase guard refuses linking or copying the
checkout's `node_modules` from inside the sandbox.

In a multi-repository topology, each `openspec/repositories.yaml` row may
declare its own `setupCommand`, which runs inside that repository's sandbox;
`sandbox.setupCommand` still covers the root workspace. The outcome is
recorded on the workspace record (`setup: ok|failed`). A failing command keeps
the sandbox and prints a warning naming the command and workspace path — rerun
it there manually before Prove.

Keep the setup command to dependency installation. Anything it writes outside
ignored directories counts toward the change's surface, exactly as if the
change had written it.

If Build reveals a new requirement, revise the same change and synchronize it:

```bash
claude-foundation sandbox sync <change>
```

Synchronization increments the change revision and invalidates receipts or
proofs that no longer describe the current agreement.

Sync is also how a moving target is reconciled, and the command is the same in
either sandbox mode.

For a **git worktree**, sync replays the sandbox's diff onto the target's
current commit and reports `rebased: <base> -> <head>`; commits made inside the
sandbox flatten into that diff, which nothing downstream reads. The replay is
verified in a throwaway worktree first, so a hunk that no longer applies leaves
the sandbox untouched and names each rejected file as a `CONFLICT` — merge the
target's version in the sandbox worktree and sync again.

For a **multi-repository worktree**, sync stages every moved writable
repository before replacing any live sandbox. A conflict is reported as
`CONFLICT <repository>:<path>` and leaves every repository sandbox and recorded
base unchanged. A clean sync reports one `rebased <repository>:` line per moved
repository and advances the complete set together.

For an **isolated copy**, files another change landed that this sandbox never
touched fast-forward into the sandbox (baseline included), and a file both sides
edited is named as a `CONFLICT` at sync rather than discovered at Land. Merge
the target's version into the sandbox copy, then declare it with
`--resolve <path>` (comma-separate several paths).

A target that moved and could not be reconciled is always reported, never
silent: `sandbox inspect <change>` shows the recorded base against the target's
head, and `land check` refuses a worktree sandbox whose base the target has
left, naming the replay as the way out.

Packet artifacts are the other direction: their source of truth is
`openspec/changes/<change>/` in the target, so a packet file edited only in
the sandbox blocks the sync until the edit is ported there — only `tasks.md`
ticks merge back automatically.

### 3. Prove the claims

Use the resumable proof path:

```bash
claude-foundation proof advance <change>
```

It evaluates the current gate, reuses valid receipts, returns one aggregated
repair batch when product work is needed, routes review before acceptance, and
returns a stable external wait without polling. After repair, a fresh call
selectively reruns invalidated evidence. Readiness, collection, direct authority
calls, execution, finalization, and audit remain diagnostic or integration
surfaces used by the resumable command, doctor, Land, and runtime tests; they
are not the normal agent loop.

The scheduler:

- reuses receipts bound to unchanged inputs;
- deduplicates identical commands within an execution;
- runs independent read-only providers concurrently;
- serializes providers that share exclusive resources;
- marks incomplete or ambiguous evidence `inconclusive` instead of guessing.

A successful command is not automatically sufficient evidence. Every declared
claim must be covered by a valid receipt from each required capability. See
[EVIDENCE.md](EVIDENCE.md) for adapter configuration, Playwright claim
annotations, resource locks, and receipt reuse rules.

### 4. Land transactionally

Check readiness:

```bash
claude-foundation land check <change>
```

Then complete the change:

```bash
claude-foundation land archive <change>
```

`land archive` verifies the content-bound proof, applies the isolated diff when
needed, checks state identity, synchronizes the specs, archives the OpenSpec
change, and cleans up a safely owned sandbox. Before mutation it builds an
immutable touched-path projection, backs up those paths, and writes an apply
journal. Each write is verified; failure rolls the projection back while
leaving unrelated target edits alone. The sandbox remains the proof subject
until archive completes, so an interrupted OpenSpec archive can resume without
invalidating proof. Transaction backups are removed only after archive audit.

Change Loop does not commit, push, or open a pull request implicitly.

## Evidence model

`evidence.yaml` stores stable behavioral claims. `execution.yaml` stores
commands, reports, services, readiness identity, and resource wiring. Legacy
changes that keep `providers` in `evidence.yaml` remain readable; `evidence
upgrade` separates them. Five adapters are available:

| Adapter | Use |
|---|---|
| `command` | One deterministic command for one provider |
| `test-discovery` | One test process that emits test and discovery receipts |
| `playwright` | Structured browser evidence mapped to claim annotations |
| `contract-digest` | One declared file hashed across two or more repositories, passing only when the bytes agree |
| `external` | A receipt produced outside Change Loop |

Only `external` skips execution entirely. `contract-digest` runs no command but
still executes: it reads and hashes the declared file itself.

Provider names describe what is proven, not which tool runs. The built-in
contracts include behavioral tests, discovery, browser behavior, mutation,
state identity, integration, compatibility, performance, security, review,
static analysis, migration, accessibility, resilience, observability, acceptance,
deployment, and supply-chain checks.

The project selects only the capabilities required by the risk and claims of
the change. Task size affects budgeting and slicing; it does not weaken proof.

Changed-surface policy can only speak once files exist. `change resolve
--surface <glob,glob>` records the paths a change expects to touch so the same
rules run at change time: `doctor --stage change` reports the forecast
capabilities, names the declared glob behind each, and says whether an
independent reviewer and reviewer diversity will be required — before a
signature is spent on a contract that is still moving. `change validate` warns
on the same gap. The forecast never gates: a declared surface is advisory, and
required evidence still comes from the real changed surface.

## Runtime state

Generated state lives under `.foundation/` and must not be treated as product
source:

This table is the canonical listing of what the runtime writes. Shorter
listings elsewhere name this file as their source rather than restating it.

| Path | Contents |
|---|---|
| `.foundation/runtime/` | Runtime operation and handoff state, one file per change |
| `.foundation/receipts/` | Live content-bound provider receipts and `proof.json` |
| `.foundation/evidence/` | Immutable proof bundles: manifests, receipt copies, durable artifacts, and the hash-chained review-attempt ledger |
| `.foundation/snapshots/` | One content snapshot descriptor per proof |
| `.foundation/logs/` | Provider logs, telemetry events, receipt-reuse and budget audits |
| `.foundation/locks/` | Recoverable per-change proof and authority mutation leases |
| `.foundation/reviews/` | Structured reports returned by configured AI reviewers |
| `.foundation/sandboxes/` | The control sandbox, a Git worktree or a copy |
| `.foundation/repository-sandboxes/` | Per-repository sandboxes for multi-repository work |
| `.foundation/plans/` | Agent execution plans |
| `.foundation/leases/` | Task and resource leases |
| `.foundation/transactions/` | Land apply journals and staged backups |
| `.foundation/authority/` | Review and acceptance requests and their completion records |
| `.foundation/attestations/` | Unattended-execution challenges and consumed nonces |
| `.foundation/instruction-manifests/` | Instruction provenance per command |
| `.foundation/recovery/` | Quarantined abandoned changes and orphaned runtime state |
| `.foundation/prototypes/` | Disposable comparison prototypes, never admissible as evidence |
| `.foundation/policy.json` | Optional project rules mapping paths to required capabilities |
| `.foundation/install-manifest.txt` | Installer-owned record of managed files |

`repository-sandboxes/`, `prototypes/`, `recovery/`, and `policy.json` appear
only once something creates them.

Receipts are reusable only while their bound inputs remain unchanged. Every
required artifact is copied into the evidence vault and bound by SHA-256 and
byte size. Proofs bind receipt digests, contract and execution fingerprints,
the workspace snapshot, environment descriptor, and protocol versions.

Review and acceptance receipts additionally carry the change's diff identity
and the packet review hash. When a sandbox sync replays the change onto a
moved base without altering either — the common shape of "another change
landed first" — `proof run` / `proof advance` rebind the verdict to the new
workspace hash instead of expiring it, and no review wave is consumed. A
replay that does alter the diff expires the verdict as before; if that
expiry would exhaust the AI review wave cap, `authority reset-base-move
<change> --decision-ref <ref>` releases exactly the expired passing attempt
from the count under a recorded user decision.

Use metrics to inspect the actual cost of a run:

```bash
claude-foundation metrics <change>
```

`commandProfile` separates lifecycle mutations from read-only inspections,
reports elapsed union time and the most expensive commands, and identifies
repeated checks observed with the same command arguments, runtime revision,
change content, and policy fingerprints. These rows are candidates for removal,
not proof of waste: executable providers are never classified as redundant only
because their inputs matched. Decision reasons and references are redacted
before fingerprinting. Read-only calls live in `inspections.jsonl`, so measuring
agent probing does not inflate lifecycle rework or mutate completed evidence.
Command telemetry also records setup, service, provider, and Build-plan scheduler
waves with ready/executed/reused node counts, measured queueing where execution is
harness-owned, and peak concurrency. Unknown queueing remains `null`, never zero.

Context is budgeted at the control surface: plan summaries are at most 4 KiB,
task and review packets 8 KiB, repository packets 12 KiB, and global packets 16 KiB.
Oversized artifacts are referenced by path and digest. The budget covers the
exact compact bytes written to stdout. Every emitted plan and packet records
its byte count as an atomic event below
`.foundation/logs/<change>/context-events/`; old events roll into a bounded
summary. Telemetry is best-effort and cannot block packet delivery. `metrics`
tolerates legacy/malformed rows and reports totals, estimated tokens, retained
and archived event counts, median, p95, and maximum by kind.

Request and token limits apply to an active run window; lifetime usage remains
available for cost reporting. Targets come from `foundation.json`
(`execution.requestBudgets`, `execution.tokenBudgets`, keyed by lane) and are
derived on every read: impact, size, coupling, review tier, and security can
widen both targets, including the window it is already spending from.
A validated change stores a compiled execution-surface summary (task, claim,
provider, repository, critical-case, and external-authority counts); its widest
factor widens both request and token targets. The shared factors also include
declared `--size` (`xs` 0.5x, `s` 1x, `m` 1.5x, `l` 2x), impact, coupling,
review tier, and security. Metrics schema 6 reports the non-secret inputs,
factor values, selected scale, and limiting factors. Factors use the maximum,
never multiplication. Only a
window opened by
`budget continue` keeps its granted numbers. At 85% the packet enters `completion-only`: it
forbids speculative investigation, scope expansion, optional refactors, and new
subagents while allowing focused fixes and required proof work. Crossing 100%
raises `NEEDS_USER_DECISION` on the first exhausted window. New model work waits
for continue, explicit contract revision, or pause; the runtime never silently
drops acceptance criteria or moves unfinished work out of the contract. Packet,
readiness, provider execution, receipt reuse, proof-resume, metrics, Land
recovery, and archive remain available. A user may open a fresh audited window
with `budget continue` only when readiness identifies required model-completable
code or configuration work. Every exhausted continuation asks again, up to the
configured ceiling. Active leases, external evidence, infrastructure failures,
and ready deterministic work do not qualify. The reason is audit context, not
the policy gate; counters and requirements are never deleted or silently reset.
`budget checkpoint` makes that pause resumable: it reports measured capacity,
remaining tasks/provider blockers, the user prompt, and the command the agent
will run after an approved continuation without pretending to forecast unknown
model demand.

A control-target HEAD move remains `control-head-moved` unless target bytes
match the change projection or an explicit external delivery reference exists.
Only that observed containment/reference is `out-of-band-delivery-drift`;
`doctor --change <id>` reports it during pre-apply lifecycle states. Change Loop
never converts the signal into proof, authority, or completion. Sync the
sandbox, re-prove if the workspace identity changed, and continue Land until
the change is `archived`.

Claude request telemetry is request-owned, not tool-owned. The `SessionStart`
hook exposes only `session_id` and `transcript_path` to later Change Loop
commands. It does not parse the transcript and there is no per-tool telemetry
hook. `packet --phase`, Prove, Land, and `metrics` then read only complete JSONL
records added since the previous cursor. Main-agent and nested subagent
transcripts are deduplicated by request/message identity.

Archive drains the bound transcript cursors itself. A host may provide complete
input/output token counts without price data; that remains
`partial-measurement` in reports, but it satisfies a `requireUsage` Land policy
because a real usage dimension was measured. Missing/correlated-only telemetry
still fails that policy, and unknown cost remains `null`.

Only usage metadata is persisted: model, request/session identity, timestamp,
phase, agent, input/output tokens, separate cache-creation/cache-read tokens,
and cost when the host supplies it. Prompt text, tool input, and tool output are
never copied to `.foundation/logs/`. `PostToolUse` remains reserved for
behavioral hooks such as linting edited files.

Every emitted packet also records a content-addressed instruction manifest under
`.foundation/instruction-manifests/`. Packets and proofs carry its digest, not
the instruction text. A changed digest records lineage; by itself it does not
invalidate deterministic evidence for an unchanged contract and workspace.
Hosts may report actual model attempts and fallback with `telemetry host-import`;
unknown usage remains `null` rather than being fabricated as zero.

Use an explicit sync when the lifecycle hook was not active:

```bash
claude-foundation telemetry sync <change> ~/.claude/projects/.../session.jsonl
```

Use `telemetry import --format generic|codex|cursor|otel|claude` for other hosts
or historical files. OpenTelemetry GenAI/LLM attributes map to the same token,
model, trace/request, and run fields. Unknown requests,
token usage, cache usage, or monetary cost remain `null`; Change Loop does not
manufacture estimates when telemetry is unavailable. Claude transcript parsing
is schema-validated and isolated behind the host adapter so a future host
format change cannot silently become fabricated usage.

`packet <change> --resume` returns current agreement references, task frontier,
active lease identities, evidence validity, findings and the next action in the
existing global packet ceiling. It does not cache authority or execute work.
Oversized sections identify their source and truncation; read those references
before editing. Resume cannot be combined with phase, task or repository views.
After archive and sandbox cleanup, resume and feedback use retained agreement
references. The pre-archive hash is historical; workspace validity is not
claimed. Use the referenced proof audit for archive evidence.

`advance <change> --inspect` projects the next action without validation writes,
instruction-manifest recording, provider execution or lease acquisition. It
cannot be combined with `--through` or `--host-result`.

`feedback <change>` is the read-only explanation surface. Its readiness uses
current runtime receipt validity; `observedAt` identifies when it was read.
Missing reviewer/repair measurements remain null, and partial reviewer timing
is labeled. The dashboard separately exposes recorded status and freshness:
receipt identity alone cannot establish current workspace validity, so a
recorded passing proof is unverified until checked by the runtime.
`feedback <change> --diagnostics` emits allowlisted metadata and provider aliases,
excluding paths, commands, free-form reasons, payloads and user identifiers.
It neither uploads data nor grants authority. It normalizes both
`host-execution` and `host-execution-contract` source names, keeps historical
events whose blocker type was not recorded explicitly unavailable, and reports
the interval after a failed review as repair only when a later changed workspace
provides evidence of repair. Source-cohort hashing is lazy and failure-contained,
so ordinary commands do not pay the provenance cost. Metrics and feedback group
provider receipts by command-execution identity; a group with multiple providers
is explicitly non-independent even when it yields multiple capability receipts.

## Playwright ownership

Install Playwright in the application repository, for example:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

The Playwright adapter requires a local, project-owned executable. It will not
use `npx` to download an unpinned package during proof. Server startup may live
in project Playwright configuration or a named `execution.yaml` service. Named
services require an identity-bearing readiness body/header so an unrelated
process on the same port cannot produce a false green. Emit a structured JSON
report, annotate tests with the claims they prove, annotate stable cases with
`critical-case`, and configure traces,
screenshots, videos, console-error handling, and page-error handling in the
project. Skipped annotated tests do not satisfy claims or critical cases.

## Updating an installed copy

The source installer manages this entire directory, including this README:

```bash
claude-foundation init /path/to/project
```

For a packaged installation:

```bash
claude-foundation init /path/to/project --yes
```

The installer records `.foundation/install-manifest.txt`, removes only stale
Change Loop-owned files, preserves project files and managed blocks in
`CLAUDE.md`/`AGENTS.md`, then refreshes the runtime as one bundle. Re-run
`doctor` after updating. Runtime and CLI API versions must be compatible.

## Troubleshooting

- **`permission denied` running the installer** — run `claude-foundation init <target>` or
  add executable permission intentionally.
- **Playwright is unavailable** — install and lock `@playwright/test` plus the
  required browser in the application repository.
- **Evidence is `inconclusive`** — inspect the receipt and provider log; common
  causes are missing discovered-test counts, missing Playwright claim
  annotations, or absent required artifacts.
- **A configured provider is unavailable** — run `proof readiness <change>`.
  `INFRASTRUCTURE_ERROR` returns structured `next` choices to diagnose the
  environment, retry, record verifiable external evidence, or reconfigure an
  available project-owned command that proves the same claims. It never
  converts an unavailable provider into passing evidence.
- **Readiness says code or configuration is incomplete** —
  `NEEDS_CODE_CHANGE` returns the `/build` resume command and pending task IDs;
  `CONFIGURATION_ERROR` returns doctor, `/change`, affected config files, and a
  validation command. Operators should not need to infer the next lifecycle
  action from a status label.
- **`changes` reports `orphan-runtime`** — the runtime state exists but its
  active OpenSpec directory does not. Restore that directory, or move the JSON
  state into `.foundation/recovery/orphaned-runtime/` for recoverable
  quarantine. `doctor --change <id>` fails explicitly until reconciled.
- **A receipt became stale** — run `proof readiness`; a bound input, agreement
  revision, environment, or artifact changed.
- **Readiness is rejected** — add `expectBody` or `expectHeader` that identifies
  the intended application, not merely an HTTP status.
- **An archived proof fails audit** — restore the immutable evidence bundle or
  rerun proof; Land never treats a missing/tampered report as passing.
- **Build is in a worktree** — inspect
  `.foundation/sandboxes/<change>` or use `/build <change>`; Land applies the
  proven diff to the main worktree.
- **Requirements changed during Build** — revise the same OpenSpec change and
  run `sandbox sync`; do not preserve a proof for the old agreement.
