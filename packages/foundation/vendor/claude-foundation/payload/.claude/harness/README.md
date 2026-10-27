# Change Loop harness runtime

**Audience:** coding agents, host integrators, evidence authors, and maintainers.
This installed reference is maintained by Change Loop; consumers should not
customize it in place. For everyday use, follow the
[user quickstart](https://claude-foundation.dev/docs/quickstart/).

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
`/prove`, and `/land`; `/dev` drives the same lifecycle, reaching Land only
within the user's explicit authority.
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

Users can follow the quickstart linked above; the installed `WORKFLOW.md` is
the detailed lifecycle contract. The rest of this page maps the runtime for
agents, maintainers, and evidence authors; `EVIDENCE.md` is the canonical
provider and receipt contract.

Runtime API 39 adds bounded repository intelligence, adaptive intake metrics,
and selective amendment proof recovery. Typed intake inspection uses
`change start <draft.json> --inspect` and discovery deltas for v4 amendments.
Spec approval uses `change resolve --approve-spec`,
and content-bound review waivers through `change waive --capability review`.
Each requires a real `--decision-ref`. Review is bounded by its rounds; each
dispatch has its own timeout. See [WORKFLOW.md](../../WORKFLOW.md) for the user contract.

Every phase view is derived from one versioned execution contract. Semantic
draft v5 (and v4) validates typed-risk discovery coverage (optional for ordinary changes) and decision prerequisites,
then compiles meaningful keys into stable cross-ledger IDs and writes only
the OpenSpec artifacts the change needs. After Change, protocol-v6 `advance`
is the normal model-facing entrypoint; primitive commands remain compatible
operator and integration tools. It compiles
risk, required providers, external authority, workspace mutation capability,
budgets, repositories, and Land requirements once; packets, planning,
readiness, and the mutation guard consume that result instead of independently
reinterpreting policy. Lifecycle writes go through the typed reducer. Existing
command names remain compatible; `change start --inspect` is an additive
read-only argument.

## File ownership and writers

Ownership determines what installation and upgrades may replace. It does not
say who must type the content or who may approve a decision. An agent can write
project-owned code; the harness can compile a project-owned agreement.

| Category | Paths in an installed project | Who writes or updates it | Reader and authority |
|---|---|---|---|
| Project agreement | `openspec/specs/`, `openspec/changes/`, `openspec/investigations/` | Agent authors intent and investigation records; harness compiles/amends packets, updates task completion, and archives through OpenSpec | Users review intent, scenarios, and outcomes; consequential decisions remain theirs |
| Project configuration | `foundation.json`, `openspec/config.yaml`, `openspec/repositories.yaml`, `quality/` | Project maintainer or authorized agent; installer seeds missing configuration and may perform documented additive/default migrations | Project chooses policy; upgrades preserve custom settings |
| Project instructions and host settings | `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` | Project authors local instructions; installer updates only its marked pointer blocks and merges supported settings | These are not replaced by the upstream repository's maintainer manuals |
| Installed product | `.claude/orchestrator.md`, `.claude/commands`, `.claude/harness`, `.claude/skills`, `.claude/rules`, `.claude/hooks`, `openspec/schemas`, `WORKFLOW.md`, `.foundation/.gitignore`, `.foundation/README.md` | Change Loop maintainers change source; installer refreshes managed files | Agent/host instructions and system references, not consumer customization points |
| Runtime records | `.foundation/runtime/`, `receipts/`, `evidence/`, `transactions/`, and other state listed below | Harness and configured tools through supported operations | Read for diagnosis; never hand-edit proof, receipts, lifecycle state, or recovery journals |
| Working inputs and implementation | `.foundation/drafts/`, declared code/test paths inside `.foundation/sandboxes/` or `.foundation/repository-sandboxes/` | Agent writes drafts and implements within the declared Build workspace | Drafts are temporary inputs, not the agreement; sandbox content may be unlanded project work |
| Optional local policy | `.foundation/policy.json` | Project maintainer or authorized agent supplies capability rules | Project-controlled input despite its location; not an evidence receipt |

The installer's `MANAGED` list defines product ownership; the per-install
`.foundation/install-manifest.txt` records the managed files. A managed directory
does not make every custom file beneath it disposable: custom agents, hooks,
and other project additions must survive upgrades. `foundation.json` may gain
missing fields or recognized legacy-default migrations; it is not replaced
wholesale with upstream policy.

Generated does not mean disposable, and project-owned does not mean manually
editable during an active lifecycle. Change agreements go through draft/revision
or amendment routes; task checkboxes and IDs are maintained by the harness.
Use supported recovery and cleanup rather than deleting `.foundation/`: it can
hold unlanded code, proof history, transaction backups, and local policy.

The upstream source repository also contains contributor instructions, internal
tests, research reports, and website sources. These are for developing and
documenting Change Loop itself; they are not installed consumer requirements.
Consumer `CLAUDE.md` and `AGENTS.md` stay project-owned even though
the upstream repository uses those names for its own maintainer guidance.

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
| Core | `runtime/core/tool-identity.mjs` | Content-keyed reuse of successful OpenSpec probes and strict lint (persisted in `.foundation/cache/`), and per-process Git index queries |
| Core | `runtime/core/git-head.mjs` | HEAD and "not a repository" answered from repository files, falling back to Git for any layout it does not model |
| Core | `runtime/core/lifecycle-reducer.mjs` | Typed lifecycle transitions and compatibility-preserving state mutation |
| Core | `runtime/core/process-runtime.mjs` | Provider process execution, readiness checks, and managed services |
| Core | `runtime/core/signals.mjs` | Process-scoped signals (drift restored, budget warning, already archived) that keep their stream line and ride on the advance envelope |
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
| Workflow | `runtime/workflow/semantic-draft.mjs` | Semantic draft v3 compatibility plus v4/v5 discovery coverage, stable links, typed extensions, decision status and durable rationale, unknown task field warnings, and provider defaults |
| Workflow | `runtime/workflow/draft-folder.mjs` | Draft v5 folder loader: splits authored `proposal.md`/`design.md` prose by outline heading, checks order, placeholders, and derived headings, and derives grounding NFR/observability from `change.json` |
| Workflow | `runtime/workflow/validation/outline-contract.mjs` | The versioned outline: each packet section's document, order, heading (en/th), owner, feeding fields, and condition |
| Workflow | `runtime/workflow/validation/architecture-fields.mjs` | Typed fields `boundaries`, `tenancy`, `domain` |
| Workflow | `runtime/workflow/validation/contract-fields.mjs` | Typed fields `apiContracts`, `eventContracts`, `dataModel`, `ui`, `configContract` |
| Workflow | `runtime/workflow/validation/quality-fields.mjs` | Typed fields `nfr`, `threatModel`, `observability`, `trackingPlan`, `capacity` |
| Workflow | `runtime/workflow/validation/delivery-fields.mjs` | Typed fields `rollout`, `testStrategy`, `dependencies`, `recovery` |
| Workflow | `runtime/workflow/validation/work-type-fields.mjs` | Work-type fields: `bugfix` variants, `refactor`, `libraryContract`, `migrationPlan`, `integrations`, `performanceAnalysis`, `dependencyChange`, `deprecationPlan`, `infraPlan`, `privacyAssessment`, `experimentDesign`, `releasePlan`, `modelCard` |
| Workflow | `runtime/workflow/validation/process-fields.mjs` | Proposal fields `decisionLog`, `communication`, `releaseNote`, `demo`, `compliance`, and the archive-only review, compliance, and rollout-gate appendices |
| Workflow | `runtime/workflow/validation/design-blueprints.mjs` | `WORK_TYPES`, `LIGHT_WORK`, `BEHAVIOR_NEUTRAL_WORK`, and design field validation/rendering in outline order |
| Workflow | `runtime/workflow/validation/dev-document.mjs` | Work-type inference and the sections each work type requires |
| Workflow | `runtime/workflow/validation/semantic-intake.mjs` | Risk-derived discovery dimensions, decision-DAG validation, and bounded frontier selection |
| Workflow | `runtime/workflow/validation/semantic-source-inventory.mjs` | Deterministic grounded-source inventory and freshness findings |
| Workflow | `runtime/workflow/validation/repository-intelligence.mjs` | Bounded repository discovery, relevance ranking, and dependency/caller/test maps |
| Workflow | `runtime/workflow/validation/semantic-intake-intelligence.mjs` | Adaptive intake depth, question-quality gates, multilingual-neutral signals, and effectiveness snapshots |
| Workflow | `runtime/workflow/semantic-intake-state.mjs` | Draft/source-bound typed intake snapshot and safe resume projection |
| Workflow | `runtime/workflow/validation/amendment-invalidation.mjs` | Selective claim, task, provider, approval, and proof invalidation planning |
| Workflow | `runtime/workflow/validation/selective-proof-plan.mjs` | Fail-closed receipt preservation and exact post-amendment proof recovery |
| Workflow | `runtime/workflow/semantic-amendment.mjs` | Transactional Build-time agreement amendments that preserve canonical prose and completed work |
| Workflow | `runtime/workflow/advance-runtime.mjs` | Protocol-v6 deterministic chaining, durable recovery decisions, owner outcomes, and safe user projection |
| Workflow | `runtime/workflow/change-validation.mjs` | Traceability, change validation, and provider requirements |
| Workflow | `runtime/workflow/land-journal.mjs` | Atomic apply identity, journal, rollback, verification, and cleanup |
| Workflow | `runtime/workflow/land-runtime.mjs` | Multi-repository Land readiness, planning, pointers, and resume saga |
| Workflow | `runtime/workflow/repository-delivery-saga.mjs` | Prepare-all, dependency-ordered, uncommitted multi-repository Apply and resume |
| Workflow | `runtime/workflow/land-verification.mjs` | Target-read verification that every writable repository holds its proven sandbox bytes before archive |
| Workflow | `runtime/workflow/sandbox-preservation.mjs` | Sandbox-versus-target comparison and recoverable backups before any sandbox removal |
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

Semantic draft version 5 is the default; versions 4 and 3 compile unchanged.
A v5 draft is a folder: `change.json` (`version: 5`, every typed field) plus
authored `proposal.md` and `design.md` whose `## ` headings come from the
outline contract. The compiler keeps authored prose byte-for-byte, merges it
with derived sections in outline order, and rejects unknown, derived,
out-of-order, empty, or `TODO`/`TBD` sections in one EDIT. Every field module
exports `validate<Field>(value, path)` (issues prefixed by the exact path, such
as `boundaries[0].timeout is required`) and `render<Field>(value, {language})`
(markdown without the heading, Thai labels for `th`); older field shapes stay
valid. New fields are optional in v4 and v3 as well. The section order, work
types, and required sections are specified in [WORKFLOW.md](../../WORKFLOW.md#draft-v5-folder-and-outline).

Agents write intent, requirements,
tasks, and explicit discovery dispositions once (evidence capabilities default
to `test`); the
harness derives required dimensions, refuses unresolved coverage, and validates
the decision frontier before the compiler generates stable IDs, cross-ledger
links, specs, and safe detected provider wiring. Multiple specs,
decisions, diagrams, prototype selections, integration documentation,
repositories, and external operations are typed extensions. Version 1 remains
an exact compatibility path, version 2 retains its unambiguous mechanical
bookkeeping behavior, and version 3 remains readable.

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
is absent at Prove or Land (Build records it as `deferred` and never stops for
it) and runs declared repository setup commands in isolated workspaces.
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

### Investigation intake records

`investigate --template` now emits record v2; v1 records, states, and handoffs
remain readable. `purpose: research` permits a facts-only investigation;
`purpose: change` retains the intent of a feature, improvement, or bug. Command
names and arguments are unchanged. See [the lifecycle contract](../../WORKFLOW.md#investigate-problem)
for boundaries and authority.

| Field | Record shape |
|---|---|
| `intent` | `{goal, outcome, actors: [], scope: []}`; goal and outcome required when a change is ready |
| `conversation` | `[{key, speaker: user\|agent, statement, source}]`; cite accessible messages/notes, retain events unchanged |
| `requirements` | `[{key, revision, kind, statement, origin: user\|agent, status, material, conversationKeys: []}]`; optional `examples`, `criteria`, retirement `reason`, `supersededBy: {key, revision}` |
| `questions` | `[{key, question, material, status: open\|answered\|deferred, dependsOn: [], workKeys: []}]`; answered rows need `answer` and user `conversationKeys`; deferral needs `reason`; alternatives/recommendation optional |
| `work` | `[{key, outcome, questionKeys: []}]`; work is independent when all named questions are answered |
| `experiments` | `[{key, question, criteria: [], material, status: planned\|complete, requirementRefs: [{key, revision}]}]`; complete rows need `findings` and `limitations`; optional bounded `prototypePaths`; retain results and supersede under a new key with `supersededBy` and `reason` |
| `historyGaps` | Nonempty strings identifying unavailable conversation context; do not claim missing messages were read |
| `hypotheses` | `[{key, statement, status: open\|supported\|falsified, factKeys: []}]`; settled rows need `factKeys`; optional `experimentKeys` name the current (not superseded) experiments that test the hypothesis, and the report shows them as each open hypothesis's next check |

Requirement kinds are `behavior`, `constraint`, `example`, `exception`,
`non-goal`, and `success-criterion`. Statuses are `stated`, `confirmed`,
`proposed`, `unresolved`, `superseded`, and `cancelled`. Explicit user intent
can be `stated` without another confirmation; `confirmed` and user-origin
rows must cite a user event. A material proposal or unresolved question cannot
become an agreement by silence. Revision content and provenance are retained;
invalid edits preserve the last validated intake for agent repair.

V2 handoffs bind intake content as well as sources and workspace. Change
authors `investigationCoverage: [{sourceKey, sourceRevision, targets: []}]`.
Each target is `{kind: requirement, key: <requirement-key>}`, or
`{kind: scenario, key: <requirement-key>, scenario: <scenario-key-or-name>}`,
or `{kind: non-goal, key: <exact-non-goal-text>}`, or
`{kind: constraint, key: <exact-constraint-text>}`, or
`{kind: design, key: <decision-key>}`. Every active material stated/confirmed
requirement needs a real target. Several sources can share a target; a source
can have several targets. Revised/amended agreements retain coverage. Links
prove structural completeness, not semantic equivalence; the agent compares
meaning in the compiled packet. Legacy changes need no retroactive mapping.

When material questions remain, the typed action includes `pendingQuestions`
and `independentWork`. Continue independent investigation while asking for
the answer; do not perform dependent work or add blanket confirmation gates.

### Command reference

| Command | What it does | When to use it |
|---|---|---|
| `investigate --template` | Prints the versioned source/fact/hypothesis record | Starting a bounded investigation |
| `investigate <record.json>` | Persists source-bound investigation state and emits a Change handoff when ready | Resuming Investigate or crossing into Change |
| `change start --template` | Leads with the minimal draft v5 folder (`change.json` with `version: 5` and `workType`, plus `proposal.md`) and its file-tool `save` route, then prints the typed-field contract with machine-checkable discovery coverage, `minimalDraftWriting`, one example block per work type (`workTypeExamples`), and the v5 folder layout (`draftFolderV5`); a v4 JSON draft still starts | Beginning a fresh Change |
| `change start <draft.json \| draft-folder> --inspect` | Returns the next typed intake action and exact resume route without creating a change | Iterating on a semantic draft |
| `change start <draft.json \| draft-folder>` | Compiles, validates, installs, and prepares one isolated change transactionally | Completing Change |
| `change revise <change> <draft.json>` | Recompiles a revised semantic draft over the same change id through the start intake gate in the same call (an incomplete intake prints its action and changes nothing), with rollback and a requirement delta for approval; `--merge` applies the file as a partial draft over the recorded compiled-from draft; `--approve-spec --decision-ref <ref> [--through <target>]` records the user's approval in that call | An agreed semantic change must change before Build starts |
| `change amend <change> <amendment.json>` | Adds, revises, or removes requirements before Land starts, including a `proven` candidate (returns to `building`); requires and retains a discovery delta for v4; a verify-only `updateTasks` amendment fixes an unfinished task's verify command (`--template` prints both); inspects in the same call and amends only at `DONE`, and accepts the same approval flags as `change revise` | A semantic v3/v4 change discovers new or changed behavior |
| `change amend <change> --task <key\|id> --verify <command> [--reopen]` | Corrects one task's verify command directly through the same transaction (`--reopen` unticks a completed task); keeps the spec approval, claims, and capabilities, refuses an always-passing command, and accepts the task only when the new command passes | A task's verify command is wrong |
| `advance <change> --through build\|proven\|archived` | Runs deterministic steps and returns one `WORKING`, `EDIT`, `RUN_EXTERNAL`, `REPAIR`, `WAIT`, `ASK_USER`, or `DONE` action | Every normal step after Change |

While a proof runs, another `advance` for the same change returns `WORKING`
with `wait.progress`: the current `wave`, the providers `running`, each
`finished` provider with its `status` and `durationMs`, `startedAt`, and
`elapsedMs`. It is advisory and never changes recovery. Wait for the running
proof instead of starting another.

Every route `advance` returns stays on this surface: a `command`, `next`,
instruction, or decision option that would name an operator primitive below
(`proof`, `land`, `sandbox`, `evidence init`) is rewritten to the matching
`advance` route, and the recovery ladder (owner repair, `TRY_ALTERNATE_APPROACH`,
then a `REPAIR` back to the original agent or harness owner with repetition
evidence on the third unchanged round; only a user-owned boundary becomes a
question), the
first-observation `user-environment` question for causes only the user can
clear (typed `resource`, `credential`, or `network`), the optional `signals[]`
the envelope carries, and the budget no-progress cap are specified in
[WORKFLOW.md § Recovery and user decisions](../../WORKFLOW.md#recovery-and-user-decisions).

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
| `advance <change> --decision retry\|wait\|pause\|merge\|retain --decision-fingerprint <hash> --decision-ref <ref> --reason <approach>` | Records the user's answer to the offered recovery or advance decision and resumes its retained target; grants no unrelated authority | Agent records an explicit answer |
| `advance <change> --through archived --restore-target <path,path>` / `--recover-apply settle\|keep-current\|restore-backup` / `advance <change> --undo-land`, each with `--decision-ref <ref>` where the user decides | Restores conflicting target paths inside Land, settles an interrupted apply, or undoes an archived Land whose diff is still uncommitted; see [WORKFLOW.md § `/land`](../../WORKFLOW.md#land-change) | Land conflict, interrupted apply, or the user's undo |
| `doctor` | Checks runtime and project readiness | After install or when diagnosing setup |
| `changes` | Lists active changes and readiness | Finding work to resume or land |
| `current` | Prints the one active change with readiness and next command; with none or several it lists candidates and exits non-zero. While exactly one change is active, `advance`, `packet`, `metrics`, `feedback`, `package`, `change audit`, `authority status`, `handoff status`, and `evidence detect\|doctor` may omit `<change>`; `advance` with `--through archived`, `--approve-spec`, `--restore-target`, `--recover-apply`, or `--undo-land` always needs the explicit id | Lost the change id |
| `packet <change> --phase <phase>` | Prints a compact diagnostic handoff; review packets are ≤20 KiB; `--task` for a completed task prints its read-only packet (`executionAuthority.status: "completed"`) | Operator/debug inspection |
| `packet <change> --repo <id> [--task <id>] [--pretty]` | Prints a bounded repository or task packet | Starting a native subagent |
| `metrics <change>` | Reports measured phase/provider cost, emitted context bytes, and blocked operations by code, phase, and operation with the latest local reason | Finding latency, orchestration overhead, or where a change keeps stopping |
| `feedback <change> [--pretty] [--diagnostics]` | Reports current readiness, source-aware timing, repair intervals, blocker coverage, evidence reuse, and the next action; diagnostics exports allowlisted metadata | Explaining why Prove took time without labeling repair as wait |
| `outcomes [--pretty]` | Read-only rollup of archived changes: first-proof pass, proof runs, review attempts and repair rounds, amendments, reopened tasks, recorded user decisions, cost, and declared escaped defects (from later changes' `fixes`), grouped by workType × impact × riskSignals; unknown values stay `null` with a denominator and `unknownCount`; unreadable states are listed under `skipped` | Judging whether workflow changes improve accepted outcomes |
| `lessons [--min-changes <n>] [--pretty]` | Read-only grouping of blocker codes and review finding codes that recur in at least `n` distinct changes (default 3, minimum 2), each with a suggested permanent check and the `/change` route; untyped blockers and uncoded findings are counted separately; never creates checks or exports free-text reasons | Turning recurring problems into checks |
| `package <change> [--pretty]` | Writes the read-only approval package `.foundation/packages/<change>.html`: risk level, technical domains, artifacts by approver role with proof/preview labels, Mermaid diagrams, and optional suggested previews for High/Critical changes; never changes lifecycle state. `change start` and the `advance` approval question also write it and print its path, and a render failure only warns. The draft's optional `scratch` summary and typed `examples` appear first, each example with an after-Build tab read from receipts and previews; page text follows the draft language, and diagrams render with the shipped `.claude/harness/vendor/mermaid.min.js` loaded by relative path ([WORKFLOW.md](../../WORKFLOW.md#approval-package-preview-and-role-lanes)) | Showing approvers the change before they approve |
| `preview <change> --provider <name> [--decision-ref <ref>] [--pretty]` | Optional, before Build only: runs one declared provider in `.foundation/previews/<change>/workspace` and records a `kind: "preview"` receipt bound to the contract revision. A provider marked `external: true` runs only with the user's `--decision-ref`; preview receipts never satisfy Prove or Land ([WORKFLOW.md](../../WORKFLOW.md#approval-package-preview-and-role-lanes)) | Trying a plan, dry run, mock, or screenshot before approval |
| `budget checkpoint <change>` | Reports measured remaining allowance, unfinished work, and the exact resume route | Checking remaining allowance and the resume route |
| `exec <change> [--phase <phase>] [--repo <id>] [--task <id>] -- <command…>` | Derives the phase, runs Build and Prove commands in the change's sandbox under the shared mutation policy, passes the exit code through, and records duration. A multi-repository change picks the sandbox from `--repo`/`--task`, else the caller's directory (a repository sandbox, the shared mirror, or the checkout's copy maps to the same relative path in that repository's sandbox), else the pending tasks when they share one repository, else the shared sandbox; never the main checkout. An unknown repository or task refuses with the known names | Long build-phase commands (container builds, installs, full test runs) and a submodule task's checks |
| `telemetry host-import <change> <result.json>` | Imports a validated host execution result without prompt or tool payloads | Recording actual model attempts, fallback, usage, and instruction provenance |
| `budget continue <change> --reason <reason>` | Opens one policy-gated audited window without deleting usage | Optional explicit widening; exhaustion auto-continues |
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
| `handoff status <change>` | Shows external operations and Land disposition | Checking work owned by DevOps/SRE/security |
| `handoff list [--open] [--owner <team>] [--environment <env>] [--json]` | Lists operational obligations across active and archived changes | Finding post-Land work without knowing a change ID |
| `handoff packet <change> [--id H00n]` | Emits one credential-free operator packet | Sending the exact operation to its named owner |
| `handoff record <change> ...` | Records accepted/completed/rejected/cancelled/superseded outcomes with durable references | Updating operational state without reopening developer tasks |
| `migrate [legacy-id] [--apply]` | Reads legacy `.workflow/` state and optionally creates migration candidates | Recovering an older installation without promoting unverified prose |
| `host instruction <command> --protocol 1 --format json --arguments <text>` | Resolves the package-owned command instruction | Host integration without reading consumer command files |
| `host agent-contract --protocol 1 --format json` | Resolves the portable package-owned agent contract | Installing or refreshing a host adapter |

`/land <change>` is the only user-facing Land operation. The registered
`land check`, `land advance`, `land recover`, `land archive`, `land record`,
`land resume`, `land plan`, and `land pointers` routes are internal compatibility
or diagnostic primitives. The Harness invokes them through the convergent Land
transaction; agents must not ask users to compose or run them. `land check` runs
Land's own pre-mutation preflight read-only, so it stops on the same code Land
would, and refuses unproven work instead of reporting it ready. `land advance`
is only an alias of `advance <change> --through archived`: it issues no grant,
prints that route's JSON envelope, and the phase guard rewrites it to that
route. Land requires current passing proof
([WORKFLOW.md § Blocking policy](../../WORKFLOW.md#blocking-policy)).

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
its named claims and passing critical-case receipts; without that binding, one closure review covers the repaired delta. High-risk decisions are settled
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
and scopes provider commands and receipts with `repository`. That sandbox is
the repository's one location: `advance` EDIT tasks name it as `workspace`, the
phase guard treats it as in-workspace, and review findings named through root
bind to it. A declared repository's directory or gitlink in the root workspace
is never a root change. Read-selected Git
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
shared-resource concurrency and applies the model tiers in `foundation.json` when `models.routing` is true;
otherwise every task uses the standard tier unless it requests one.
The complete plan is persisted under `.foundation/plans/`; stdout is a compact
summary, or one group selected with `--group`. `packet --task` emits only the
chosen task's claims, files, providers, and model. A one-task change recommends
one agent. Ready tasks can fan out across independent repository workspaces.
Tasks sharing a workspace stay serialized even with disjoint paths: result
validation observes the repository diff and cannot attribute concurrent writes.
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
lease. `agents acquire` by the lease's own owner after a graph, contract, or
key change re-grants it under a new generation with the original write
baseline instead of refusing, and `agents release` performs that re-grant
itself when the graph or contract moved after acquisition, so the worker never
runs acquire-then-release; only a task an amendment removed from the plan is
refused. `agents release` of another owner's expired lease
takes it over without `--force`; only a live foreign lease needs `--force
--decision-ref`. `authority record` on a stale request records nothing, issues
the replacement request, and names it with the `advance` resume route.

JSON output is compact by default and `--pretty` is inspection-only. Plan
schema 6 compiles a deterministic setup/service/task/provider/repository/Land
graph, prioritizes the longest ready dependency path within configured resource
and capacity bounds, resumes dependencies satisfied by completed tasks, reports
`proof-ready` after all tasks complete, and declares the deepest model required
by a mixed session while carrying instruction provenance. It retains a bounded
graph-v2 authority snapshot so compatible upgrades can resume, while missing or
stale authority returns affected tasks and their dependants to verification as
defined in [`WORKFLOW.md`](../../WORKFLOW.md). Packet schema 7 adds
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
run. Within one change, each repository workspace has an exclusive lease key;
path and contract scopes still bound task authority. All keys are acquired
atomically. A force release discards any old accepted result; a completed task
with unresolved lease authority is scheduled for verification without changing
its checkbox, and recovery clears only after an accepted release.
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

The [lifecycle contract](../../WORKFLOW.md#lifecycle-commands) owns Change,
Build, Prove, Land, and optional Deliver. Normal agent execution uses
`advance <change> --through build|proven|archived`. Commands listed above as
compatibility primitives are for diagnostics and integrations.

Land requires explicit authority and completes at `archived`. It preserves
Git HEAD and index; commit, push, and PR creation need separate authority.
For interrupted work follow [recovery and user decisions](../../WORKFLOW.md#recovery-and-user-decisions).

### Sandbox setup and synchronization

The following details are operator diagnostics; the coordinator owns routine
preparation, synchronization, and recovery.

A fresh sandbox has no installed dependencies — the copy path excludes them
and a worktree is a bare checkout. Declare a setup command and the harness
runs it once inside every newly created sandbox:

```json
// foundation.json
{ "sandbox": { "setupCommand": "npm ci", "setupTimeoutMs": 600000 } }
```

Without it, the harness runs the install the workspace lockfile pins
(`package-lock.json`/`npm-shrinkwrap.json` → `npm ci`, `pnpm-lock.yaml`,
`yarn.lock`, `bun.lock`/`bun.lockb` → their frozen-lockfile install) and
records it on the workspace like a configured setup (`source: "lockfile"`).
`{ "sandbox": { "installDependencies": false } }` opts out. A failed or missing
install never blocks: preparation retries it, then `advance` hands it to the
agent as a `REPAIR` with the command, directory, and log tail. Setup records a
digest of `package.json` and the lockfiles; when a Build edit changes them, the
next `exec`, task check, or proof run reruns the same setup first. The phase
guard still refuses linking or copying the checkout's `node_modules` into the
sandbox.

In a multi-repository topology, each `openspec/repositories.yaml` row may
declare its own `setupCommand`, which runs inside that repository's sandbox;
`sandbox.setupCommand` still covers the root workspace. The outcome is
recorded on the workspace record (`setup: ok|failed`). A failing command preserves the sandbox and its setup result. Resume
`advance`: preparation retries failed setup while reusing successful repository
setup. Repair the declared command when the failure needs a project change.

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
the target's version into the sandbox copy and resume with `advance`: the next
sync settles the path only when a 3-way check against the copy's stored base
bytes proves the target's edit is in the copy and no conflict markers remain.
`--resolve <path>` (comma-separate several paths) declares a merge explicitly.

A copy keeps its base bytes in `.foundation/copy-base/`, a content-addressed
store keyed by the baseline's sha256 and shared across changes. The declared
surface is stored when the copy is made; any other path is stored the first
time sync or Land sees it diverge while the target, the sandbox copy, or the
base commit still holds the baseline bytes. Files over 8 MiB, binary files,
and bases already gone are never stored, so their merges and restores stay
unprovable and Land keeps the `target-edit-conflict` decision.

A target that moved and could not be reconciled is always reported, never
silent: `sandbox inspect <change>` shows the recorded base against the target's
head, and `land check` refuses a worktree sandbox whose base the target has
left, naming the replay as the way out.

Packet artifacts are the other direction: their source of truth is
`openspec/changes/<change>/` in the target, so a packet file edited only in
the sandbox blocks the sync until the edit is ported there — only `tasks.md`
ticks merge back automatically.
Harness-owned semantic amendments stay in the sandbox until Land. Build
preparation and base-move sync preserve them. Competing target packet edits
stop `advance` with the `amended-agreement-conflict` decision; the user's
answer is recorded with `advance --decision` (the primitive equivalent is
`--resolve openspec/changes/<change>`); see the
[Build-time amendment contract](../../WORKFLOW.md#change-intent).

## Evidence model

Claims belong to `evidence.yaml`. The compiler derives ordinary provider wiring;
`execution.yaml` is conditional on custom commands, reports, services, or
readiness. See [EVIDENCE.md](EVIDENCE.md) for adapters, capability selection,
claim coverage, resource scheduling, and receipt validity.

Use `advance <change> --through proven` for the normal agent path. It aggregates
findings and reuses valid evidence. Diagnostic primitives do not replace the
coordinator's recovery protocol.

## Runtime state

Generated state lives under `.foundation/` and must not be treated as product
source:

This table is the canonical inventory of runtime records and working inputs.
The ownership exceptions are described above. Shorter
listings elsewhere name this file as their source rather than restating it.

| Path | Contents |
|---|---|
| `.foundation/runtime/` | Runtime operation and handoff state, one file per change |
| `.foundation/drafts/` | Agent-written semantic drafts awaiting `change start` (the seeded allowlist permits edits here) |
| `.foundation/intake/` | One draft/source-bound semantic intake snapshot per inspected draft path |
| `.foundation/amendments/` | Transient verify-only amendment staged by `change amend --task/--verify`; removed when the command ends |
| `.foundation/investigations/` | Source-bound Investigate state, metrics, no-progress checkpoint, and Change handoff digest |
| `.foundation/receipts/` | Live content-bound provider receipts and `proof.json` |
| `.foundation/evidence/` | Immutable proof bundles: manifests, receipt copies, durable artifacts, and the hash-chained review-attempt ledger |
| `.foundation/snapshots/` | One content snapshot descriptor per proof |
| `.foundation/cache/` | Digest-keyed reuse of successful OpenSpec version probes and strict-lint passes across commands; safe to delete |
| `.foundation/logs/` | Provider logs, telemetry events, receipt-reuse and budget audits |
| `.foundation/locks/` | Recoverable per-change proof and authority mutation leases |
| `.foundation/reviews/` | Structured reports returned by configured AI reviewers |
| `.foundation/sandboxes/` | The control sandbox, a Git worktree or a copy |
| `.foundation/repository-sandboxes/` | Per-repository sandboxes for multi-repository work |
| `.foundation/plans/` | Agent execution plans |
| `.foundation/leases/` | Task and resource leases |
| `.foundation/transactions/` | Land apply journals and staged backups |
| `.foundation/deliveries/` | Optional post-archive Deliver checkpoints and verified PR receipts |
| `.foundation/authority/` | Review and acceptance requests and their completion records |
| `.foundation/attestations/` | Unattended-execution challenges and consumed nonces |
| `.foundation/instruction-manifests/` | Instruction provenance per command |
| `.foundation/recovery/` | Quarantined abandoned changes, undone Lands (`land-undone/`), and orphaned runtime state |
| `.foundation/backups/` | Commit bundles, patches, and file copies of unlanded sandbox work, written before a sandbox is removed |
| `.foundation/agreement-drift/` | Isolated-packet edits made outside an amendment, saved when the harness restores the approved text |
| `.foundation/prototypes/` | Disposable comparison prototypes, never admissible as evidence |
| `.foundation/packages/` | Read-only approval packages (`<change>.html`), regenerated on demand |
| `.foundation/previews/` | Optional pre-Build preview workspaces and `kind: "preview"` receipts, never admissible as evidence |
| `.foundation/policy.json` | Optional project-authored rules mapping paths to required capabilities; not generated proof |
| `.foundation/install-manifest.txt` | Installer-owned record of managed files |

`intake/`, `repository-sandboxes/`, `prototypes/`, `packages/`, `previews/`, `recovery/`, `agreement-drift/`, and `policy.json` appear
only once something creates them.

Receipts are reusable only while their bound inputs remain unchanged. Every
required artifact is copied into the evidence vault and bound by SHA-256 and
byte size. Proofs bind receipt digests, contract and execution fingerprints,
the workspace snapshot, environment descriptor, and protocol versions.

Review and acceptance receipts additionally carry the change's diff identity
and the packet review hash. When a sandbox sync replays the change onto a
moved base without altering either — the common shape of "another change
landed first" — `proof run` / `proof advance` rebind the verdict to the new
workspace hash instead of expiring it, and no review wave is consumed. This
holds for a human verdict exactly as for an AI one, so no new request opens.
A replay that does alter the diff expires the verdict and opens a new review
request; if that
expiry would exhaust the AI review wave cap, the next review dispatch
releases exactly the expired passing attempt from the count under a
harness-owned reference; `authority reset-base-move <change> --decision-ref
<ref>` remains the manual route.

Copy sandboxes also supply a review contribution identity, computed from
the baseline and current Apply manifests. Forwarded untouched files disappear
from that difference; edits, deletions, executable modes, and symlink targets
remain bound. Same-file reconciliation conservatively expires the review.
Every writable repository participates; missing identities never match.
Rebinding retains the original proof-run and verdict fields; runtime-added
rebind coordinates do not invalidate a legacy full-receipt attempt binding.
Changes to the original verdict, contribution identity, or packet still do.
Human acceptance keeps its existing worktree-only rebind boundary, and signed
semantic acceptance retains its own exact binding. Diff reuse is not a
dependency-impact analysis: executable providers still validate the new inputs.

A sync that leaves evidence-bound content and contract inputs unchanged keeps
the existing proof and lifecycle progress. Conflicts or changed inputs still
invalidate the aggregate proof, while valid provider receipts remain reusable.
`proof plan` explains whether review reuse is unavailable because its identity
is missing, the contribution changed, or the review agreement changed.

Use metrics to inspect the actual cost of a run:

```bash
claude-foundation metrics <change>
```

`hostToolProfile` (`measurement`, `total`, `byTool`, `byCategory`) counts
imported Claude transcript `tool_use` blocks by category (harness CLI, harness
doc reads, state reads, harness artifact writes, product writes, test runs,
other); without transcript data every count is null. Automatic `advance` work
is recorded as the stages `advance.evidence-wiring`, `advance.review-run`,
`advance.sandbox-sync`, and `build.task-check`; Land work inside archive is
recorded as `land.check`, `land.apply`, `land.archive`, and `land.cleanup`.

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
task and review packets 20 KiB, repository packets 24 KiB, and global packets 32 KiB.
These defaults give a measured three-repository, three-task change (20 claims on
one task) about 1.5x headroom; `foundation.json execution.packetBytes` overrides
them within the hard `2048..65536` ceiling, and an over-budget packet blocks with
its largest fields.
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
subagents while allowing focused fixes and required proof work. Budget is
advisory: crossing 100% opens a new same-size harness window every time and
never asks the user; the runtime never silently drops acceptance criteria or
moves unfinished work out of the contract. `budget continue` is an optional,
audited explicit widening up to the configured ceiling; counters and
requirements are never deleted or silently reset.
`budget checkpoint` reports measured capacity and remaining tasks/provider
blockers without pretending to forecast unknown model demand.

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
is labeled. Repair timing is explicitly derived, covers both `advance` and
legacy proof resumes, and merges overlapping intervals. It is elapsed
fail-to-resume time, not a measurement of active editing. The dashboard
separately exposes recorded status and freshness:
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

Configured ephemeral reviewers ingest CLI-reported usage internally under stable
session/turn identities; replayed imports do not add the same event twice.
Missing cost stays null. Hook audit schema 2 separates enforcement `mode` from
`outcome`: an anchor rewrite is `rewritten`, a refused mutation is `blocked`,
and an audit-only violation is `audit-only`; mode alone is not a block count.

Derived semantic-draft and amendment provider commands use a non-login shell
to preserve the prepared PATH. Explicit provider commands retain their declared
shell semantics; repository toolchain requirements still belong to the project.

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
