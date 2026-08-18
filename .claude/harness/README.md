# Foundation harness runtime

This directory contains the deterministic runtime installed by Claude
Foundation. It turns an OpenSpec change into a bounded implementation and
evidence workflow:

```text
Investigate? → Change → Build → Prove → Land
```

The harness is the control plane, not the coding agent and not a replacement
for project tooling. OpenSpec owns the agreement, the native coding agent owns
the implementation, and project-owned providers such as test runners,
Playwright, linters, or security scanners produce evidence.

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
| Core | `runtime/core/process-runtime.mjs` | Provider process execution, readiness checks, and managed services |
| Core | `runtime/core/state-runtime.mjs` | Runtime state, paths, hashing, snapshots, workspace manifests, and Git helpers |
| Core | `runtime/core/trust.mjs` | Canonical JSON and Ed25519 verification shared by trust protocols |
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
| Evidence | `runtime/evidence/traceability.mjs` | Pure scenario, claim, task, and provider auditing |
| Observability | `runtime/observability/telemetry.mjs` | Portable host telemetry normalization |
| Observability | `runtime/observability/metrics-runtime.mjs` | Read-only aggregation of operations, usage, context, and evidence metrics |
| Observability | `runtime/observability/telemetry-runtime.mjs` | Context events, host transcript synchronization, and telemetry ledgers |
| Workflow | `runtime/workflow/agent-planning.mjs` | Task dependency/resource planning and bounded dispatch views |
| Workflow | `runtime/workflow/apply-runtime.mjs` | Apply transaction preparation, recovery, cleanup, and archive orchestration |
| Workflow | `runtime/workflow/authority-runtime.mjs` | Authority request/response bridge and signed CI recording |
| Workflow | `runtime/workflow/authority.mjs` | External authority request persistence and response validation |
| Workflow | `runtime/workflow/budget.mjs` | Run/lifetime usage windows and budget policy transitions |
| Workflow | `runtime/workflow/change-lifecycle.mjs` | Change creation, draft materialization, resolution, and atomic start |
| Workflow | `runtime/workflow/change-artifacts.mjs` | Compatibility re-export for commands overlapping an installer upgrade |
| Workflow | `runtime/workflow/change-validation.mjs` | Traceability, change validation, and provider requirements |
| Workflow | `runtime/workflow/land-journal.mjs` | Atomic apply identity, journal, rollback, verification, and cleanup |
| Workflow | `runtime/workflow/land-runtime.mjs` | Multi-repository Land readiness, planning, pointers, and resume saga |
| Workflow | `runtime/workflow/lease-runtime.mjs` | Agent resource lease acquisition, renewal, release, and cleanup |
| Workflow | `runtime/workflow/packet-runtime.mjs` | Changed-surface calculation and bounded task/review packet generation |
| Workflow | `runtime/workflow/repository-topology.mjs` | Repository discovery, selection, dependency validation, and workspace views |
| Workflow | `runtime/workflow/sandbox-runtime.mjs` | Isolation inspection, sandbox creation, and contract synchronization |
| Workflow | `runtime/workflow/security-policy.mjs` | Trust-boundary phrases that select security-sensitive assurance |
| Workflow | `runtime/workflow/validation/spec-delta.mjs` | Scenario-drop and new-capability validation for OpenSpec deltas |
| Docs | `runtime/README.md` | Domain boundaries and dependency rules |
| Docs | `AGENT.md` | Small portable contract loaded by Claude, Codex, and other agents |
| Docs | `EVIDENCE.md` | Evidence contract, execution adapter, and proof reference |
| Docs | `README.md` | Runtime overview and operator guide |

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
- OpenSpec CLI for schema validation and archival
- Project-owned test and browser dependencies required by configured evidence

Foundation deliberately does not install Playwright, browser binaries, test
frameworks, or application dependencies. Each application must lock and
maintain its own versions.

Check a project before starting:

```bash
claude-foundation doctor --stage change
```

Check both the project and one change's executable evidence:

```bash
claude-foundation doctor --stage prove --change <change>
```

## Operator commands

| Command | What it does | When to use it |
|---|---|---|
| `providers` | Lists supported evidence contracts | Choosing evidence for a change |
| `repos [change]` | Shows discovered topology, drift, and change selection | Setting up or diagnosing multi-repo work |
| `models` | Shows portable model-tier mappings | Reviewing cost/quality routing |
| `agents plan <change> [--group <n>] [--pretty]` | Persists the full plan and prints a ≤4 KiB summary or one dispatch group | Before spawning independent workers |
| `doctor` | Checks runtime and project readiness | After install or when diagnosing setup |
| `changes` | Lists active changes and readiness | Finding work to resume or land |
| `packet <change> --phase <phase>` | Prints a compact handoff; review packets are ≤8 KiB and exclude Build history | Starting Build, Prove, or independent Review |
| `packet <change> --repo <id> [--task <id>] [--pretty]` | Prints a bounded repository or task packet | Starting a native subagent |
| `metrics <change>` | Reports measured phase/provider cost and emitted context bytes | Finding latency or orchestration overhead |
| `exec <change> [--phase <phase>] -- <command…>` | Runs an external command, passes its exit code through, and records its duration | Long build-phase commands (container builds, installs, full test runs) |
| `telemetry host-import <change> <result.json>` | Imports a validated host execution result without prompt or tool payloads | Recording actual model attempts, fallback, usage, and instruction provenance |
| `budget continue <change> --reason <reason>` | Opens one policy-gated audited completion window without deleting usage | Required model work after exhaustion |
| `change validate <change>` | Validates change artifacts | After creating or revising an agreement |
| `change audit <change> [--json]` | Audits scenario → claim → task → provider traceability | Before Build or after contract edits |
| `proof readiness <change>` | Returns READY or a typed blocker with exact next commands | At the end of Build and start of Prove |
| `proof advance <change>` | Executes missing evidence once, routes external gates, and resumes unchanged waits without polling | Normal Prove path |
| `proof run <change>` | Executes, finalizes, and audits proof as one operation | Low-level diagnostic/integration path |
| `proof collect <change>` | Runs available project-owned evidence without finalizing proof | Low-level preparation for an explicit integration |
| `evidence detect <change>` | Finds safe project-owned provider candidates without executing them | When `execution.yaml` is empty or incomplete |
| `evidence init <change> [--write]` | Previews or explicitly writes high-confidence provider wiring | Before manually wiring detected test/static/browser tools |
| `evidence doctor <change>` | Explains configured, detectable, and unresolved capabilities | Diagnosing why Prove lacks a provider |
| `evidence verify-ci <change> <provider> <signed.json>` | Verifies a signed, workspace-bound CI envelope | Importing trusted remote CI evidence |
| `evidence record ...` | Records evidence produced by an external system | CI, human review, or remote systems |
| `authority request\|status\|dispatch\|run\|abort\|record ...` | Routes configured AI review and bound human review/acceptance responses | Crossing a human or remote authority boundary |
| `evidence upgrade <change>` | Upgrades evidence v1 to v2 without guessing commands | Migrating an older active change |
| `sandbox create <change>` | Creates an isolated Git worktree | Before Build |
| `sandbox challenge <change>` | Creates a short-lived nonce and permission contract | Before a host signs unattended authority |
| `sandbox create <change> --unattended --attestation <file>` | Verifies and consumes one trusted host attestation | Unattended Build only |
| `sandbox create <change> --all` | Creates one sandbox per selected writable repository | Before a multi-repo Build |
| `sandbox sync <change> [--resolve <path,path>]` | Synchronizes a revised agreement and reconciles a moved target: a worktree replays onto the new commit, a copy fast-forwards what it left alone; `--resolve` accepts a merged double-edit | When requirements change during Build, or the target moved (another change landed) |
| `land check <change>` | Checks proof freshness and landing readiness | Before accepting the change |
| `land record <change> ...` | Binds an explicitly created child commit | After authorized commit/CI work |
| `land resume <change>` | Rechecks the resumable Land saga | After a child PR or branch lands |
| `land archive <change>` | Applies, verifies, archives, and safely cleans up | Completing an accepted change |
| `handoff status <change>` | Shows external operations and Land disposition | Checking work owned by DevOps/SRE/security |
| `handoff packet <change> [--id H00n]` | Emits one credential-free operator packet | Sending the exact operation to its named owner |
| `handoff record <change> ...` | Records accepted/completed/rejected with actor and evidence references | Resuming Land without turning operator work into a developer task |

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

## Repository and model execution

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
chosen task's claims, files, providers, and model. A small one-repository change
recommends one agent. The plan is advice and bounded authority for the native
host; the harness does not invoke a model itself.

JSON output is compact by default and `--pretty` is inspection-only. Plan
schema 4 compiles a deterministic task/provider/repository/Land graph, resumes dependencies satisfied by completed tasks, reports
`proof-ready` after all tasks complete, and declares the deepest model required
by a mixed session while carrying instruction provenance. Packet schema 7 adds
the active graph, lease fencing generation, execution attempt, and versioned
result authority; it rejects unknown, cross-repository, providerless, stale, or
out-of-scope task results. Large collections are previews plus counts and
digests; use `packet <change> --task <task>` as the authoritative expansion.

Conflict scopes are hierarchical. Disjoint paths, contracts, and explicit
resources may proceed concurrently across active changes; missing or ambiguous
scope takes the exclusive repository key. All keys are acquired atomically.
Proof records node diagnostics plus one aggregate graph proof, while Land
persists a prepare-all snapshot and compare-and-swap revalidates it before each
multi-remote mutation wave.

Multiple remotes use ordered saga states rather than an atomicity claim.
Foundation verifies explicit child commits, optional CI state, dependency
order, root gitlinks, and fresh composite proof. It never commits or pushes
without separate authority.

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

It executes missing providers once, routes review before acceptance, and
returns a stable external wait without polling. Readiness, collection, direct
authority calls, execution, finalization, and audit remain diagnostic or
integration surfaces used by the resumable command, doctor, Land, and runtime
tests; they are not the normal agent loop.

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

Foundation does not commit, push, or open a pull request implicitly.

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
| `external` | A receipt produced outside Foundation |

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

Use metrics to inspect the actual cost of a run:

```bash
claude-foundation metrics <change>
```

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
derived on every read: a change resolved to high impact widens its request
target by 1.5x, including the window it is already spending from, because
requests bind long before tokens on high-impact work. A declared `--size`
widens the same lane (`xs` 0.5x, `s` 1x, `m` 1.5x, `l` 2x); size and impact
combine by the larger of the two, never by multiplying them together. Only a window opened by
`budget continue` keeps its granted numbers. At 85% the packet enters `completion-only`: it
forbids speculative investigation, scope expansion, optional refactors, and new
subagents while allowing focused fixes and required proof work. Crossing 100%
adds the `STOP_AND_RESCOPE` recommendation but never turns accounting into a
process failure. Packet, readiness, provider execution, receipt reuse,
proof-resume, metrics, Land recovery, and archive remain available. An operator
may open one fresh audited window with `budget continue` only when readiness
identifies required model-completable code or configuration work. Active leases,
external evidence, infrastructure failures, and ready deterministic work do not
qualify. The reason is audit context, not the policy gate; counters are never
deleted or silently reset.

Claude request telemetry is request-owned, not tool-owned. The `SessionStart`
hook exposes only `session_id` and `transcript_path` to later Foundation
commands. It does not parse the transcript and there is no per-tool telemetry
hook. `packet --phase`, Prove, Land, and `metrics` then read only complete JSONL
records added since the previous cursor. Main-agent and nested subagent
transcripts are deduplicated by request/message identity.

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
token usage, cache usage, or monetary cost remain `null`; Foundation does not
manufacture estimates when telemetry is unavailable. Claude transcript parsing
is schema-validated and isolated behind the host adapter so a future host
format change cannot silently become fabricated usage.

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
report, annotate tests with the claims they prove, and configure traces,
screenshots, videos, console-error handling, and page-error handling in the
project.

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
Foundation-owned files, preserves project files and managed blocks in
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
