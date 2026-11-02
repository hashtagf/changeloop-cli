# Executable evidence adapters

Change Loop separates the stable behavioral contract from replaceable execution
wiring. Change Loop does not install test frameworks, browsers, or project
dependencies; the project owns and locks every executable named by an adapter.

This is the canonical provider/receipt reference for maintainers and evidence
authors. Commands and schemas here are for the agent, configured tool, or
integration operator; users provide decisions rather than hand-writing receipts.
For everyday use, start with the [user quickstart](https://claude-foundation.dev/docs/quickstart/).
For file ownership and permitted writers, use
[the ownership reference](README.md#file-ownership-and-writers).

## Behavioral contract

`evidence.yaml` changes only when observable claims or obligations change:

```json
{
  "version": 2,
  "claims": [
    {
      "id": "profile-update",
      "scenario": "The owner can update their profile",
      "impact": "medium",
      "capabilities": ["test", "browser", "accessibility"]
    }
  ]
}
```

Discovery is an implicit suite-level obligation whenever `test` is selected; do
not repeat `discovery` on every claim.

## Readiness and selective execution

During `advance --through proven|archived`, a harness-runnable configured review
starts beside the executable providers for the same workspace hash and is joined
before Prove classifies the result; it runs in the foreground and holds the
authority lock until its verdict is recorded. A verdict recorded while tests
fail stays reusable only while its workspace hash is unchanged, and review
findings plus failed evidence at the same hash return as one REPAIR batch.
Handoff routes, external reviewers, and plain `proof advance` stay serial.

On the rapid lane with `minimum: 1`, a test-discovery run that exits 0 without
a parseable count passes discovery only when its output shows an executed test
(for example `✔`, `ok N`, `PASS file`, `--- PASS:`, `test … ok`, or `N passed`
with N ≥ 1, and no "no tests ran" line). The receipt records
`countMeasurement: "exit-code"` and `discovered: null`; standard lanes, floors
above 1, and non-zero exits still require a counted result.

`evidence` is optional for a rapid draft (low impact, isolated, no security
triggers, review or acceptance not required, no design content); omitted
capabilities default to `["test"]` proven by the tasks' verify commands, or to
`["static-analysis"]` (a `command` provider passed by exit code, no test
discovery) when the declared or path-inferred work types are all `docs` or
`chore`. When a
test run prints no countable result, discovery stays inconclusive and its repair
names the exact fix (for example `--test-reporter=tap` on the `package.json`
script that wraps `node --test`).

Before Build, the harness records an execution-preparation identity covering
the agreement revisions, selected repository bases/setup state, and provider
wiring. It prepares only missing project-local tools and failed repository
setups; ready sibling repositories are reused. Provider execution still occurs
only in Prove and remains bound to the exact isolated repository set.

Review packets and provider receipts carry repository-qualified inputs. A
changed producer invalidates dependent consumers, while an unrelated repository
or provider with the same fingerprint is reused. An active proof lock is waited
on rather than duplicated. Infrastructure exhaustion leaves a non-dispatchable
external or Harness-owned boundary; it cannot remain a review request that gets
invoked repeatedly. No unavailable measurement is converted to zero or pass.

A sandbox path changed outside every task's `[paths:]` is recorded as a
repository-qualified `surfaceAdditions` entry (`{repositoryId, path}`; legacy
bare strings mean root) that widens only its own repository, included in the proven hash and the Land projection,
and does not block readiness. A control-plane, CI, or secret path is recorded
with `protected: true` and a path the sandbox removed with `deleted: true`;
both stay in readiness and the Land projection, and Land lists them (paths
only) before it applies. A misplaced root sandbox or more than 100 such paths
is an agent repair with a concrete command (`move-to-repository-sandbox`, or
`ignore-generated-output` with the `.gitignore` patterns that cover the spill).

## Execution wiring

`execution.yaml` may change as Build discovers the actual commands, ports, and
reports. Wiring changes invalidate only affected provider fingerprints.

A `security-static`, `resilience`, `compatibility`, `data-migration`, or
`cross-repo-contract` provider whose `command` adapter runs exactly a test
provider's argv (same repository, `env`, and `envFrom`, no `criticalCases`)
observes only that test run, so it is never run or credited as its
capability. This covers the providers a semantic draft without `execution`
derives from the tasks' `verify` commands. Review covers it instead: the review
policy gains a `covered-by-review:<capability>` trigger (review becomes required
under either policy; `security-static`, `data-migration`, `compatibility`, and
`cross-repo-contract` select the high tier, `resilience` at least medium), the
provider leaves the required set, and readiness, `proof plan`, and the proof
record it as an advisory with `status: "covered-by-review"` and `aliasOf`
naming the repeated test provider. Prove continues without a user decision and
completes only when that review passes. When review is waived or not required,
nothing covers the capability: the provider stays required as unwired external
evidence. `evidence doctor` reports it as covered by review only while review
covers it, and otherwise as blocked; both `evidence detect` and `doctor` name
the next step to wire a project-owned command for that capability in
`execution.yaml`, which replaces the alias.

A provider command without `timeoutMs` runs for at most 600000 ms (ten
minutes). A timeout is an infrastructure `error`, and the failure names the
provider, the limit, and `providers.<name>.timeoutMs` to raise it. A provider
command never inherits the harness's own session state
(`CLAUDE_FOUNDATION_PROJECT`, `FOUNDATION_WORKSPACE_ROOT`,
`FOUNDATION_CALLER_CWD`, `FOUNDATION_CLAUDE_SESSION_ID`,
`FOUNDATION_CLAUDE_TRANSCRIPT_PATH`, `FOUNDATION_PUBLIC_OPERATION`,
`FOUNDATION_ACTIVE_PHASE`), so a test that runs `claude-foundation` in its
own fixture acts on that fixture; the provider contract variables such as
`FOUNDATION_CHANGE_ID` and `FOUNDATION_REPOSITORIES_FILE` are still set, and a
value the provider declares in `env` or `envFrom` still reaches it.

```json
{
  "version": 1,
  "providers": {
    "test": {
      "adapter": "test-discovery",
      "command": ["npm", "test", "--", "--reporter=json"],
      "report": "test-results/unit.json",
      "minimum": 1,
      "timeoutMs": 120000
    },
    "browser": {
      "adapter": "playwright",
      "command": ["npx", "playwright", "test"],
      "outputs": ["accessibility"],
      "project": "chromium",
      "inputMode": "browser-automation",
      "service": "web",
      "readiness": {
        "url": "http://127.0.0.1:4173",
        "expectHeader": {"x-foundation-app": "profile"}
      },
      "timeoutMs": 120000
    }
  },
  "services": {
    "web": {
      "command": ["npm", "run", "start", "--", "--port", "4173"],
      "resources": ["port:4173"],
      "readiness": {
        "url": "http://127.0.0.1:4173",
        "expectHeader": {"x-foundation-app": "profile"}
      }
    }
  }
}
```

Evidence v1 and evidence v2 with embedded `providers` remain readable. Separate
them explicitly:

```bash
claude-foundation evidence upgrade <change>
```

The upgrade moves known wiring into `execution.yaml`; it never guesses commands.

## Bootstrap project-owned wiring

Use the bootstrap commands when a change declares claims but `execution.yaml`
has no executable providers yet:

```bash
claude-foundation evidence detect <change>
claude-foundation evidence init <change>
claude-foundation evidence init <change> --write
claude-foundation evidence doctor <change>
```

`detect` reads repository-owned manifests and configuration without executing
scripts. `init` is preview-only unless `--write` is present; even then it adds
only high-confidence wiring and preserves existing providers. Ambiguous,
external-authority, missing structured-test-count, and operator-review cases
remain unresolved with an explicit next action. Bootstrap never installs a
dependency, creates a receipt, weakens a claim, or treats detection as proof.

A `package.json` with no `scripts.test` (or `test:unit`/`unit`) is a visible
finding, never silence: `detect` returns a `test` candidate with confidence
`none`, not recommended and without config; `init` lists it as skipped;
`evidence doctor` prints `REVIEW test: ...; no scripts.test; add one so Prove
can run tests`; and `doctor --stage prove --change <id>` warns
`evidence-wiring:test`. Add a runnable test script to resolve it.

## Work-type capabilities

A change's declared or inferred work types add capabilities that its changed
paths cannot reveal. They join the path-derived obligations with a
`work-type:<type>` trigger:

| Work type | Capabilities |
|---|---|
| api, library, deprecation | `compatibility` |
| performance | `performance` |
| async | `concurrency` |
| integration | `integration` |
| ui | `accessibility` |
| data | `data-migration` |
| migration | `parity` |
| dependency | `dependency-supply-chain` |
| infra | `plan-check`, `deployment` |
| observability | `observability` |
| privacy | `security-static` |
| security | `security-static` |
| data-fix | `data-migration` |
| ml | `evaluation` |
| client-release | `release-health` (post-release) |
| experiment | `experiment-guardrail` (post-release) |

A capability only a work type requires is still required evidence, but it does
not raise the review tier or force review on its own: `compatibility` from
`api` alone leaves review at the tier the change's real risk selects. The same
capability required by a changed path still raises it.

Six capabilities exist for these work types:

| Capability | Proves | Default adapter | Phase | Bootstrap scripts |
|---|---|---|---|---|
| `concurrency` | Concurrent and asynchronous paths keep their ordering, isolation, and completion guarantees under contention | `command` | pre-land | `test:concurrency`, `concurrency` |
| `evaluation` | A model or ranking evaluation scores at or above its threshold | `command` | pre-land | `test:eval`, `eval`, `evaluate` |
| `parity` | The new implementation matches the reference on the declared comparison set | `command` | pre-land | `test:parity`, `parity` |
| `plan-check` | An infrastructure or migration plan contains only the declared changes | `command` | pre-land | `plan:check`, `plan` |
| `release-health` | Crash, error, and adoption signals stay healthy during rollout | `external` | post-release | none |
| `experiment-guardrail` | Guardrail metrics stay within bounds after release | `external` | post-release | none |

An `evaluation` command prints a `foundation-evaluation-v1` result on stdout
(or writes it to its configured report):

```json
{ "protocol": "foundation-evaluation-v1", "score": 0.91, "threshold": 0.85 }
```

It passes only when the command exits 0 and `score >= threshold`; a
provider-level `threshold` in `execution.yaml` applies when the result omits
one. A missing or non-numeric score or threshold fails closed. When stdout
holds log lines before the result, the last line that is a JSON object is the
result. A result whose `protocol` names another protocol fails, naming both. The receipt
observation records `{kind: "evaluation", status, score, threshold}`.

Post-release capabilities exist only after the change ships. They are rollout
gates: deferred (neither failed nor pending), excluded from the providers that
gate proof, never blocking proof or Land, and listed as Appendix: Rollout gates
in the archived proposal. A gate the work type or a claim owes is listed even
without a provider. A waived capability's gate is listed with status `waived`
and is no longer owed. A proof finalized before rollout gates existed owes
none. Wiring a missing pre-land provider is agent work in
`execution.yaml`, never a user question.

## Signed CI and external authority

An external provider may declare `ci.issuer` and an Ed25519 `ci.publicKey` in
`execution.yaml`. Import only its signed, workspace-bound envelope:

```bash
claude-foundation evidence verify-ci <change> <provider> signed-result.json
```

The envelope binds the change, provider, workspace hash, optional Git commit,
run URL, status, observation, and artifact SHA-256 digests. The hash it must
carry is the one that provider binds, which
`claude-foundation hash <change> <provider>` prints; without a provider the same
command prints the change's workspace hash. An invalid signature,
stale workspace, wrong issuer, or unsigned passing artifact is rejected before
a receipt is written.

`land.riskBasedCi` is read when a change is created and again on every
`change resolve`. When a project cannot produce signed CI, the user decides:
`change resolve <change> --ci-not-required --decision-ref <ref>` records a
per-change waiver, or `land.riskBasedCi: false` in `foundation.json` followed
by `change resolve` lifts the requirement for that change. Neither is made
from inside Build, where the phase guard keeps project policy out of reach.

### Signed semantic acceptance

`semantic-acceptance` is the first-class proof boundary for hidden or
independent behavioral cases. Configure it as an external provider with a
trusted Ed25519 issuer/key and declare stable case IDs, their claims, input
partitions, and whether each case is required. A case may also bind a critical
case observation from another provider. Defect reproductions can require a
signed before-fail/after-pass transition.

The external runner returns a signed envelope containing only the change,
provider, workspace hash, case IDs, statuses, observation digests, and optional
transition digests. Hidden inputs and oracle implementation never enter the
agent packet. The integration records that envelope through the existing
command surface:

```bash
claude-foundation evidence record <change> semantic-acceptance \
  --envelope signed-semantic-result.json
```

The runtime verifies the signature, issuer, workspace, complete required-case
set, uniqueness, claim/partition binding, transition, and any referenced source
receipt before writing the receipt. A review pass cannot override a failed or
missing semantic case. Workspace edits, envelope tampering, or a stale/missing
source critical-case receipt invalidate it and block Proof and Land.

Use unified `advance` as the normal resumable path:

```bash
claude-foundation advance <change> --through proven
```

It invokes the compatible `proof advance` primitive internally, executes
missing project evidence for the current gate, aggregates findings,
and reuses current receipts while repaired inputs selectively invalidate their
providers and downstream dependencies. Product repairs may repeat until all
required evidence passes. A decision, authority, resource, conflict, or
no-progress boundary preserves the change and returns an exact resume route.
Repeating it against an unchanged open request does not rerun evidence or
dispatch another reviewer. Configured AI review uses
`authority run`; a named human review uses `authority dispatch` before
`authority record`; acceptance uses request/status/record without a review
dispatch. Requests contain bounded packets and expire or become stale with the
workspace. Responses must match the request identity and workspace, then pass
the ordinary review or acceptance receipt validator. `authority record` reports
every response problem in one refusal, including an undispatched review
request; the response template states that dispatch comes first, and a delta
template counts its verified findings. Completed requests cannot be replayed.
Readiness exposes this boundary as a structured user decision with pass, fail,
inconclusive, error, and pause paths. It never emits a pre-filled passing receipt.
The agent translates the packet and owns the response artifact; users answer in
ordinary language. Direct `evidence record` remains a low-level integration path,
not the normal interactive recovery flow.

## Adapters

| Adapter | Purpose |
|---|---|
| `command` | Run one deterministic project command for one provider |
| `test-discovery` | Run a test command once and emit both test and discovery receipts |
| `playwright` | Run project-owned Playwright tests and map structured claim annotations |
| `contract-digest` | Hash one declared artifact in two or more repositories and pass only when the bytes agree |
| `benchmark` | Run one command alternately on base and head and pass only when the head median stays within the regression threshold ([Performance against base](#performance-against-base)) |
| `external` | Require a receipt from a system Change Loop does not execute |

For a repository-scoped provider, `FOUNDATION_REPOSITORIES_FILE` binds every
selected ID to the same path, access mode, and base head used by changed-surface
and review-packet identity. A selected source head may seed this before
isolation. After isolation, every non-root repository requires its recorded
runtime base and a worktree owned by the selected catalog target; a missing,
incomplete, or foreign binding is infrastructure failure before hashing, never
fallback to the live target and never a zero/pass measurement. Its recovery is
the existing `sandbox create <change> --all` route.

### Test and discovery in more than one repository

`test-discovery` writes both receipts from a single run: the test receipt under
the provider's own name, and the discovery receipt under `discoveryProvider`
(default `discovery`). A provider named exactly `test` needs nothing further.

Two repositories need two test providers, so at most one of them can be named
`test`. Each of the others names its own discovery provider, and that provider
must be configured — repository-scoped claims resolve to repository-scoped
providers:

```json
{
  "test-api": {
    "capability": "test", "adapter": "test-discovery", "repository": "api",
    "discoveryProvider": "discovery-api",
    "command": ["npm", "test", "--", "--test-reporter=tap"],
    "minimum": 1, "reportFormat": "tap"
  },
  "discovery-api": {
    "capability": "discovery", "adapter": "test-discovery", "repository": "api",
    "command": ["npm", "test", "--", "--test-reporter=tap"],
    "minimum": 1, "reportFormat": "tap"
  }
}
```

The discovery entry declares the same adapter but never runs on its own — the
test provider that names it produces its receipt in the same execution. Giving
it a different adapter passes validation and then fails at run time, because no
other adapter produces a discovered count.

Configured commands run from the active workspace. The normal path is:

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

`proof readiness` reports a `next` array whenever it is not `READY`, and every
command that stops on a readiness result prints that recovery rather than the
blocker alone. When a required provider has no adapter but the project owns a
safe command for its capability, the recommended route is
`evidence init --write`, not a request to a person. A capability the
changed-surface policy inferred and nobody wired is not a required provider at
all: it appears under `advisories` in readiness, `proof plan`, and the proof
record, and does not block.

When `quality/foundation-quality.json` is committed, evidence bootstrap can
wire `claude-foundation quality run --enforce` as the change's static-analysis
provider. It resolves `FOUNDATION_CHANGE_ID`, runs in selected repository
workspaces, and emits one non-averaged lane per repository. Missing quality
capabilities remain explicit `unsupported` or `unavailable` assurance and are
never converted to passing evidence. Setup, adapter authoring, rollout,
baseline, and scope rules are documented in `CONSUMER-QUALITY.md`.

Prototype files under `.foundation/prototypes/` are non-authoritative. The
runtime rejects them, including local-path references and symlinked origins,
before copying any artifact or writing a receipt.

Preview runs (`claude-foundation preview`) are equally non-authoritative. Their
receipts carry `kind: "preview"`, live under `.foundation/previews/<change>/`,
and are refused as `preview-evidence` wherever they appear, including when
copied into the receipt store; artifacts and references under
`.foundation/previews/` are rejected like prototypes. A preview is a reading
aid for approvers ([WORKFLOW.md](../../WORKFLOW.md#approval-package-preview-and-role-lanes)),
and every claim is still proven by a Prove run. A provider declared with
`"previewOnly": true` is outside the proof contract: it is never a required
provider, never covers a claim, and is not subject to provider wiring rules
beyond having an adapter and a command.

The approval package's after-Build tab for a draft example only reads evidence;
it never creates it. An example's `capability` selects the matching Prove
provider: the tab says `proof` only for a valid passing receipt, `failed` for a
failing one, and otherwise falls back to a matching preview receipt, labeled
`preview` or stale, or to no result. Its links reach only artifacts under the
change's `.foundation/evidence/<change>/` or `.foundation/previews/<change>/`
folders, resolved without following a symlink out of them.

Valid receipts are reused. Commands with identical executable arguments,
environment, working directory, and timeout are deduplicated within one proof
execution. Providers with non-conflicting resources run concurrently.

Tests run once across Build and Prove. A Build task `verify:` that is exactly a
required `command` or `test-discovery` provider's argv in the same repository
runs the provider's way (cwd, environment, timeout, captured output). A clean
pass whose content hash did not move during the run is kept for Prove, which
parses and receipts that output like a fresh run when the execution identity,
environment (minus run ids), and the provider's content hash still match.
Shell syntax, report files, readiness or services, `dependsOn`, multi-repository
scope, any later edit, or an unreadable or altered record means Prove reruns.

For a single selected writable npm repository containing both `package.json`
and `package-lock.json`, Change Loop supplies the built-in
`dependency-supply-chain` lockfile provider automatically. No
`execution.yaml` entry is needed. A manifest/lock mismatch fails Proof; a
repaired lockfile is checked again and can pass. Multi-repository or ambiguous
ownership remains explicit rather than guessing which repository to execute in.

Built-in provider version 2 validates the dependency graph with the installed
`npm ci --dry-run --offline --ignore-scripts` after comparing root metadata.
It preserves manifests and `node_modules` and does not run lifecycle scripts.
Unavailable npm or cache data cannot produce a passing receipt. The provider
binds the workspace, including workspace/local manifests and npm configuration;
its version change invalidates receipts from the metadata-only provider.

What expires a receipt is what it is bound to. A provider that runs a command
binds the workspace minus the change packet, so editing `proposal.md`,
`design.md`, `tasks.md`, or a spec delta after proving re-finalizes the proof
without re-executing anything. `review`, `acceptance`, and
`semantic-acceptance` bind the whole
workspace including the packet — a reviewer read it — and cannot narrow that
with provider `inputs`. Review additionally supports the diff-and-packet rebind
described in the [harness guide](README.md): worktrees use normalized patches
and copy sandboxes use baseline-to-current Apply manifests. Human acceptance
retains worktree-only rebind; signed semantic acceptance is not diff-rebound.
This reuse rule does not infer dependency independence or replace executable
checks against the synchronized workspace.
In a multi-repository snapshot, both hashes compose repository content rather
than recorded Git base commits. Base heads remain explicit sandbox/Land state,
so an unreconciled target is still blocked while a history-only base movement
with byte-identical content does not expire evidence.

Narrow it further with workspace-relative `inputs`, and an edit outside them
rebinds the receipt instead of re-earning it:

An unaffected declared-input receipt may also cross one validated semantic
amendment revision. The transaction writes a create-only before/after audit at
`.foundation/evidence/<change>/receipt-rebinds/`; any failed amendment restores
the prior receipt and removes its audit record. Ambiguity reruns only the
affected provider and never authorizes a broad receipt rewrite.

```json
{"providers": {
  "test": {"adapter": "test-discovery", "command": ["npm", "test"],
           "minimum": 1, "inputs": ["src/**", "tests/**", "package.json"]},
  "static-analysis": {"adapter": "command", "command": ["npm", "run", "lint"],
                      "inputs": ["src/**", ".eslintrc.json"]}
}}
```

A `discovery` provider produced by a `test-discovery` adapter reads the test
provider's config, so declaring `inputs` once covers both. A cross-repository
provider may scope a pattern to a repository: `api:openapi.yaml`. Patterns are
workspace-relative, reject `..`, and a passing receipt whose declared inputs
matched no file is refused rather than bound to an empty set. `inputs` is a
claim about what the command reads: name too little and a real code edit reuses
evidence that never saw it. `proof plan` prints each provider's binding, and
reuse is logged to `.foundation/logs/<change>/reuse.jsonl`.

For an executable provider, every existing workspace-relative input file named
directly by its command must be covered by `inputs` or by the change's declared
surface. The configured `report` is an output and is excluded from this check.
`evidence doctor` refuses incomplete wiring and names the uncovered file. This
prevents a changed helper script from reusing evidence earned by its older
bytes; add the script to `inputs` when it is part of the provider.

A receipt records how it was produced. Receipts the harness executed carry
`execution: "harness"` and their command log; everything recorded by hand is
`execution: "manual"` and must include `--observed`, `--source` or `--reviewer`,
and at least one `--artifact` or `--reference`. That floor does not depend on
`--adapter`, which the caller supplies: naming an executing adapter by hand is
refused, and a provider configured for one cannot be given a passing receipt at
all — run `proof run` so the declared command is what executes. A `--reference`
must be a URI or a path that exists; free text is not a reference.

Review receipts additionally identify reviewer type/identity, the actual model
session for AI reviewers, one or more structured implementation-subject tuples,
finding IDs/details, verified closure IDs, and changed-artifact scope after the
first round. The review packet unions committed base-to-HEAD and dirty paths per
repository with all review contract artifacts. Contract directories are expanded
to individual file identities in the dispatch manifest, including nested spec
files. Workspace-relative contract paths are accepted only when they uniquely
bind to the same scoped file; escaping symlinks remain invalid. Packet paths
are checked before launching a configured reviewer. Immutable older packets
with contract-directory scopes remain resumable; this compatibility does not
widen a new file-scoped delta. Critical policy
requires a different provider/model family or a human, unless the project has
declared `"review": { "diversity": "single-model" }` in `foundation.json`; that
waiver is named in the packet and recorded as `review.policy.diversityWaived`.
Reviewer independence is waived the same way and nowhere else: with
`"review": { "independence": "self" }`, a reviewer may share an implementer's
identity and session at any impact, the receipt still records the observed
`review.policy.independent` as false alongside `independenceWaived`, and each
waiver relaxes only its own axis. The shipped `foundation.json` explicitly
commits both waivers: `independence: "self"` and
`diversity: "single-model"`. Claude Code Opus is the selected reviewer and
Codex is the alternate. `doctor` and `change validate` expose the normalized
posture and consequences; risk-tiered routing does not restore either assurance axis.
AI review packets are diff-scoped: dispatch adds `reviewDiff` (changed code
hunks against each repository's base, bounded per file and in total; contract
artifacts excluded) and `agreement` (claims, acceptance, and delta spec
requirements), all bound by the packet digest alongside the unchanged scope,
workspace hash, and finding binding. A low-tier first round is `diff-only`: the
reviewer sees a projection without reference-only fields and may open a file
only when its hunk is truncated, omitted, or unavailable. It runs on the fast
model tier at medium reasoning effort: the reviewer's `fastModelId` (optional `fastModelFamily`), else the
`models.fast.family` alias for `claude-cli`; `review.lowRiskModel:
"configured"` opts out. Provider family never changes; model family records
the fast model actually run (`fastModelFamily`, else the `models.fast.family`
alias), so diversity and separation checks judge that model. The first round of
a medium-tier review runs the faster `standard` class by default (the reviewer's
`standardModelId`/`standardModelFamily`, else `models.standard.family` for
`claude-cli`, at the configured effort), a deliberate speed/depth trade-off. The
configured model keeps high, every later (delta/closure) round, a medium change
with any trigger other than `medium-impact-or-coupling`, `review-risk`,
`declared-medium-risk`, `input-domain`, or `independence-waived-self-review`
(for example `access-control`, `authorization-or-secrets`, `risk-semantics`,
`risk-capability`, `covered-by-review:*`, `multi-repository-claim`), and a declared
(not keyword-only) review. `review.modelByTier` maps `low` and `medium` to
`fast|standard|configured` (`high` is rejected, never weakened); an unrecognized
class, a missing alias, or a standard model that would share the implementation's
family under a diversity requirement runs the configured model. The receipt
records the reviewer's model ID, family, and class (`review.reviewer.modelTier`),
and a `standard` round escalates exactly like a `fast` one. Review packet
schema 6 adds `reviewDepth`, `reviewDiff`, `agreement`, and, on a full round
with agreement scenarios, `scenarioChecklist` (one digest-bound item per
scenario; ids are claim ids when a claim names the scenario). The reviewer
returns `scenarioCoverage` per item (`covered-by-test`, `covered-by-code-only`,
`missing`, `unsure`); a `missing` item without a bound finding becomes a major
finding on that id, and a fast-tier round with any `missing` item goes
straight to repair. Otherwise a fast-tier round whose coverage is unparseable
or has an `unsure` item is re-run once on the configured model with the same
packet and dispatch: no new AI wave, the configured verdict is final, and the
attempt and dispatch record the model actually run plus `modelEscalation`
(`escalatedFrom: "fast"`). The reviewer may also return advisory `specGaps`:
input partitions or scenarios the change plausibly needs but the agreement does
not name. They are bounded, recorded on the durable report and the completed
attempt, and reported as `reviewAdvisories.specGaps` on a reached `proven` or
`archived` target; they never become findings, change the verdict, or block.
Closing one is a semantic amendment the user decides. An explicit
`--review` (or impact, coupling, or declared security triggers) raises
verification risk to high even at the low review tier. A draft's typed
`riskSignals` are kept on the change: `access-control` and `financial` make
review required under either policy and select the high tier, and `input-domain` at least
the medium tier (configured model); review required only by intent keywords
follows its tier. Medium, high, promoted, and legacy routes
are `diff-first` on the configured model. Intent keywords alone make review
required at the low tier; they raise the tier or require diversity only
alongside declared risk. A low-tier `foundation-rapid` change with no such
signal (and no required or diversity trigger, review capability, or capability
inferred from its diff that raises the tier) requires no review: its receipts
are the project's providers only, and no reviewer is dispatched.
A configured `defaultReviewer` runs first, followed by `fallbackReviewers` in
order only after infrastructure errors. `fail` and `inconclusive` are delivered
verdicts and never trigger fallback. Uninspectable packets and finding/closure
binding errors retain an error attempt and exhaust that request immediately,
without spending a full review on another model for unchanged validation input.
Rejected findings remain diagnostic data, not passing evidence.
A completed configured report is checkpointed before attempt and receipt
recording. Retrying the same request after interrupted recording reuses that
report only when its digest, packet, workspace, implementation subject, and
reviewer provenance still match. It retains the actual reviewer session and
does not launch another model or append another completed attempt. A changed
binding stops recovery and preserves the report for inspection.
On the existing `advance --through proven|archived` route, the backend revalidates
the retained packet and rejected result. It may restore missing control-workspace
location metadata without widening scope. Only a now-valid binding with a ready
reviewer reopens the request; unchanged failures stay stopped, inspection is
read-only, and the immutable error attempt still consumes infrastructure budget.
A configured reviewer whose CLI is not installed is recorded as an
infrastructure failure (`reviewer CLI not installed: <name>`) without being
spawned, so a host with no reviewer CLI reaches the `main-session` fallback; with
no fallback configured the run fails naming the missing CLI and the
`review.fallbackReviewers: ["main-session"]` + `independence: "self"` fix.
The Codex readiness probe `codex login status` is soft when `OPENAI_API_KEY`,
`CODEX_API_KEY`, `OPENROUTER_API_KEY` or a non-OpenAI `model_provider` is
present, or when the reviewer sets `auth: "skip"`; credentials are then
verified at dispatch.
`main-session` is allowed in that list only
with `review.independence: "self"`; the request binds observed implementation
provenance and current-session telemetry rather than guessing identity or model.
A project may require either axis independently, and the runtime defaults
an absent key to `required`. Risk routing bounds the circuit: low gets one full AI review; medium
and high may use one full plus one finding-bound delta after one correction
batch. High-risk decisions are settled in the initial Decision Sheet, so Prove
has no mandatory human-final gate. Reviewer infrastructure failures receive one
full retry and never create a delivered baseline. If the final delta reports an
in-contract blocker, it must bind that finding to affected claims and declared
critical cases; a later current pass of those providers creates a deterministic
repair-closure receipt, not a third AI review. A delta review that no longer
reports an earlier finding closes it. When the repaired final finding has no
declared critical case to bind (for example a rapid change) and current
non-review proof passes, Prove requests one closure review of the repaired
workspace, comparing the review provider's current subject hash with the failed
wave's subject rather than the global workspace hash; only after that closure wave also fails and its repair cannot close
does Prove stop at the review-exhausted user decision (accept the review risk with `change waive
--capability review`, revise the agreement, or pause) instead of returning an
unsatisfiable repair. A review that `advance` runs beside the providers binds
its receipt to that pass's explicit proof run and snapshot, and its failure
leaves an open request without marking the operation blocked. The pass binds to
the forced workspace snapshot (a readiness hash read from a stale cached snapshot
is re-derived first, so the overlap is not silently lost). The base-source test
discrimination child yields the event loop so reviewer preparation and execution
can progress beside it.
This overlap also applies when Prove reuses all executable checks from Build;
it does not rerun those checks just to start review. The
reviewer is always joined before any stop returns: a failed provider or a
non-discriminating test never leaves a reviewer running, and a verdict that
finishes after the tests is recorded against its own request and hash like any
other. Before a verdict is recorded the reviewed hash is re-read from disk: when
a provider or an edit changed the bytes while the reviewer ran, the attempt
closes as an error (like `authority abort`, counted as reviewer infrastructure,
not as a delivered wave), the request ends `aborted`, no receipt is written, and
the next pass requests a review of the current content. A change-level hash chain binds
dispatch, completion, scope, findings, closure evidence, and receipt payload.
Corrupt history, including a lowered chain whose recorded head and count were
moved back together while attempt records above that head remain (one
in-flight head+1 record linking to the head excepted), is quarantined
(`review-attempts.corrupt-<stamp>`, never
deleted) and rebuilt by the harness without a user decision, fail-closed: the
rebuilt count is never below the evidenced attempts, only a chain that
verifies end to end and covers every evidenced attempt keeps its verdicts, and
unverifiable attempts become inconclusive delivered AI waves that consume the
review budget. Legacy review receipts remain readable but cannot
satisfy protocol v3.

External operations use `handoffs.yaml`, not evidence receipts or unchecked
developer tasks. Prove may finish while those operations are pending. Land
requires completion evidence for pre-Land or activation-coupled work; accepted
post-Land work may remain only when its activation-proof claim establishes a
dark merge. Handoff packets and records reject credential material.

Acceptance is external and human-only. A passing receipt requires explicit claim
scope, `--acceptor`, `--decision accept`, unique nonblank `--criterion` values,
`--observed`, provenance, and a durable artifact or reference. Every read
revalidates those fields, the contract reason, and final workspace identity.
New standard changes must explicitly decide whether acceptance is required;
silence remains `undecided` and blocks validation rather than becoming approval.

## Main-session identity

A `main-session` reviewer, and self-review provenance generally, needs the
calling session's identity. The runtime reads, first non-empty wins, the
session id from `FOUNDATION_CLAUDE_SESSION_ID`, `FOUNDATION_SESSION_ID`,
`CODEX_THREAD_ID`, then `FOUNDATION_MAIN_SESSION_ID`. `--main-session-id`
must equal it when set; it never overrides the host's id.

| Field | Flag (wins) | Environment fallback |
|---|---|---|
| identity | `--main-session-identity` | `FOUNDATION_MAIN_IDENTITY` |
| provider family | `--main-session-provider-family` | `FOUNDATION_MAIN_PROVIDER_FAMILY` |
| model family | `--main-session-model-family` | `FOUNDATION_MAIN_MODEL_FAMILY` |
| model id | `--main-session-model` | `FOUNDATION_MODEL_ID` |

Telemetry for the same session fills any field left empty. Provider and
identity are inferred only for Claude Code (`FOUNDATION_CLAUDE_SESSION_ID`,
set by the session-context hook) and Codex (`CODEX_THREAD_ID`). Any other
host must provide the session id (`FOUNDATION_SESSION_ID`) plus all four
fields, or the request reports the missing ones instead of guessing. The
OpenCode plugin exports `FOUNDATION_SESSION_ID`; it cannot see the provider or
model, so set the other variables for that host. Gemini CLI ships no
integration; export every variable above.

Every review outcome that stops short of a verdict (`configured-reviewer-
infrastructure-exhausted`, `main-session-provenance-unavailable`, and bare
`authority run` refusals) carries `next.command`, and `authority run` routes in
`advance` output are built from the stored request and these variables, e.g.
`claude-foundation authority run <id> --request <rid> --subject-actor
claude-main-session --subject-session <sid> --subject-provider-family anthropic
--subject-model-family <family> --subject-model <model>` with every value
filled when known. A value neither the request nor the environment knows stays a
named `<placeholder>` listed in `next.placeholders`; incomplete AI subject
provenance is never sent, so the run falls back to `--subject-actor
implementation-agent` and `next.unresolved` names the missing fields.

## Test and discovery

With automatic report detection, counted shell summaries such as
`suite: ALL PASS (12/12 assertions)` and `suite: 2/12 assertion(s) FAILED`
also provide discovery counts, including when retained by RTK. Suite names
must be unique and counts consistent; bare `PASS` and malformed summaries do
not establish a count. The colored Vitest (`Tests  39 passed | 2 failed (41)`)
and Jest (`Tests: 1 failed, 40 passed, 41 total`) footers are also counted, so
a default `npm test` needs no extra reporter. These summaries do not establish
critical-case IDs. `go test -json` output is counted from its event stream:
each test's and subtest's last `pass`, `fail`, or `skip` counts once, test names
are critical-case IDs, and a package that fails without a failing test (a build
error) counts as a failure.

The configured structured JSON report must expose a non-negative integer such as
`numTotalTests`, `totalTests`, `testCount`, or `expected`. If the command passes
but no deterministic count is available, test evidence may pass while discovery
is `inconclusive`; landing remains blocked. Arrays, numeric strings, arbitrary
nested keys, and mixed stdout are not coerced into a count.

## Playwright

Install and lock Playwright in the application repository. A typical command is:

```json
["npx", "playwright", "test"]
```

For a direct Playwright command, the adapter adds `--reporter=json` and the
configured `--project` unless they are already supplied. Wrapper commands such
as `npm run e2e` must forward those options themselves or write the configured
`report` file. Use Playwright `webServer` configuration or a named Change Loop
service for server startup. Every explicit readiness probe requires an expected
body or header identity. A status-only probe is rejected because a different
process could occupy the port.

Every browser test that proves a claim must carry a claim annotation:

```ts
test("owner updates profile", {
  annotation: { type: "claim", description: "profile-update" }
}, async ({ page }) => {
  // interaction and assertions
});
```

Bind a stable critical case on the same test with a `critical-case` annotation:

```ts
test("owner updates profile", {
  annotation: [
    { type: "claim", description: "profile-update" },
    { type: "critical-case", description: "case-profile-owner-update" }
  ]
}, async ({ page }) => {
  // interaction and assertions
});
```

A successful exit without all required annotations is `inconclusive`, never
`pass`. A skipped annotated test does not satisfy its claim or critical case.
Empty, malformed, or unknown result statuses are inconclusive and cannot credit
claims or cases. Zero executed tests cannot pass, even without required claims.
Any failed, timed-out, or interrupted attempt remains a failure even if a later
retry passed. Repair the project reporter/test selection and rerun that provider.
Adapter protocol 7 invalidates prior adapter fingerprints, so pre-upgrade
receipts must be refreshed instead of retaining ambiguous browser passes.
Playwright attachments present in the JSON report are referenced from
the receipt. One Playwright adapter may declare `outputs`, for example
`["accessibility"]`; it emits separate capability receipts from one command
execution. Configure traces, screenshots, and videos in the project.

Browser automation is not physical operating-system input. Use
`browser-automation` for Playwright and reserve `os-input` or `both` for
evidence that genuinely requires a focused native window.

Projects should also install an automatic Playwright fixture that fails on
unexpected `console.error` and uncaught page errors. Change Loop cannot infer
that policy from a successful browser exit.

## Resources and dependencies

Default resources are repository-qualified, so two repositories' suites do not
serialize against each other:

- command/test: `workspace-read`;
- Playwright: `workspace-read`, `dev-server:<repo>`, `browser:<repo>`;
- mutation: `workspace-write:<repo>`;
- `contract-digest`: `workspace-read`.

A provider without `repository` keeps the unqualified names. Two providers in
different repositories that genuinely share one resource — a single database, a
single browser profile — must declare it explicitly; the defaults cannot infer
it.

Override with `resources` and order providers with `dependsOn`. Read-only
providers may run together. `workspace-write` conflicts with all workspace
readers, and named exclusive resources such as `browser`, `dev-server`, or
`database` cannot overlap.

Required services use the same explicit resource vocabulary and start in
bounded parallel batches. Their declared port is also an implicit `port:<n>`
resource. If one startup fails, the harness stops every successful sibling
before returning the aggregate failure.

Use parameterized names such as `port:4173`, `database:test`, or
`browser:chromium` when independent instances may run concurrently. Provider
dependency cycles and structured-report collisions are rejected by
`proof preflight`.

Literal non-sensitive environment values may use `env`. Secrets, credentials,
tokens, passwords, and API keys must use `envFrom`, which names variables to
inherit without storing their values in OpenSpec.

## Services, ports, and isolation

A service's readiness URL names a literal port, and `execution.yaml` is copied
byte-identical into every sandbox — so two changes of one project declare the
same port. Before starting a service the runtime probes its readiness URL and
refuses to start when something already answers: a server left behind by a
failed run would otherwise satisfy the very first poll and hand this change a
green suite for code that never started. The built-in static server also echoes
`x-foundation-proof-run`, and readiness requires it to match this run.

Services started by a proof run are reclaimed on failure, on `SIGINT`/`SIGTERM`,
and at exit. A provider or service failure no longer leaves a listener holding
the port.

Sandboxes carry the file tree and nothing else:

- **worktree** mode checks out tracked files only — `node_modules`, local env
  files, and generated assets are absent;
- **copy** mode additionally excludes `node_modules`, `coverage`,
  `test-results`, and `playwright-report` — unless git tracks the path, since a
  committed fixture is content whatever its directory is called. Symbolic links
  are copied verbatim and keep pointing inside the sandbox.

Write every provider report and artifact to one of those excluded directories.
The workspace hash is taken before providers run and again at finalization, so
a report written anywhere else changes the surface mid-run and expires the
receipt it was produced to justify. `change validate` warns when a configured
`report` path sits inside the hashed surface.

Everything outside the file tree is shared with the host and with every other
change: environment variables (including `DATABASE_URL` and API keys passed
through `envFrom`), ports, `/tmp`, the Playwright browser cache, and any
external database or queue a service talks to. An end-to-end provider that
needs installed dependencies must either install them as part of its command or
run against the control workspace; the sandbox will not provide them.

## Receipt reuse

Reuse is bound to:

- workspace hash and change revision;
- provider and adapter protocol versions;
- adapter and command configuration;
- claim scope;
- declared environment names and project lockfile digests;
- Node/platform architecture;
- required artifact SHA-256 and byte size.

Reports, logs, and attachments are copied immediately into
`.foundation/evidence/<change>/<proof-run>/`. `proof audit` verifies copied
receipt and artifact digests even after sandbox cleanup or archival.

## A gate that executed and failed

A provider that ran and exited non-zero blocks proof with validity `fail`. It
has exactly three honest exits, and the blocker output prints all three:

- fix the cause and `proof run` again — right when the gate caught a defect;
- rewire the provider in `execution.yaml` — right when the gate is wrong;
- withdraw the gate on record — right when the user decides to land without it:

```sh
claude-foundation change waive <change> --capability <capability> \
  --reason <why> --decision-ref <host-user-decision>
```

The waiver removes the capability from the required set; the claim keeps
declaring it, and the waiver is carried as a `user-waived` advisory in proof
readiness, the proof record, the archive, and on the `LAND READY` line. The
receipts already earned stay valid — a waiver is subtractive and cannot change
what any other provider attested — so the next `proof run` executes nothing.
`--revoke` restores the requirement. New waivers bind the current workspace and
contract revision and expire when either changes; `change amend` lists the ones
its new revision expires. A waiver that would leave no required provider is
refused: its proof would carry no receipts (`missing-receipt-manifest`), which
Land refuses, and Prove never finalizes such a proof. `review` can be waived with
an explicit user decision naming the remaining risks; original failed receipts
and incomplete review remain visible, never converted into passing evidence.
The final proof covers the remaining required set and records the exceptions.
`acceptance` retains its withdrawal route through
`change resolve --acceptance-not-required` or an explicit claim amendment.
The review deadline and continuation contract is in [WORKFLOW.md](../../WORKFLOW.md).

## A gate that failed and then passed unchanged

Resuming without a change is not a fourth exit. When a harness-executed
provider recorded `fail` and its next run passes with the same workspace hash,
input identity, provider, contract, and execution fingerprints, the new receipt
is written with `status: fail`, `observedStatus: pass`, and a `flake` record:
`rule: fail-then-pass-on-unchanged-content`, the first failure (`observed`,
`finishedAt`, `log`), the number of passes seen since, the observed pass, and
the repair. Further passes on the same content keep that first failure as the
evidence and stay `fail`.

This is the least-weakening rule: a failure observed on byte-identical inputs
is never erased by a later pass, and no fixed rerun count is trusted to turn a
nondeterministic gate into proof. The claim needs a repair — make the test or
the code it exercises deterministic — and the first pass on changed content is
proof again. Only a prior `fail` counts; an `error` never produced a product
verdict, and manual receipts are unaffected. An unchanged flake that keeps
recurring reaches the user through the no-progress ladder in
[WORKFLOW.md § Recovery and user decisions](../../WORKFLOW.md#recovery-and-user-decisions).

## Tests that fail without the change

A passing suite proves a behavior change only when some test can tell the
change from the original code. For behavior-changing work — any work type other
than `refactor`, `docs`, `chore`, `config`, or `test`, as stated in the
`## Work type` section of `design.md` or the rapid `proposal.md`, otherwise
inferred from the tasks' `[paths:]` — `advance --through proven|archived`
checks this after executable evidence passes and before the proof is
finalized. Refactor, docs, chore, and config work keeps tests that pass both
before and after the change, so the rule never applies to it.

For each writable repository whose changed surface includes product code
(paths that are not tests, docs, or package manifests), the harness takes the
repository's required `test` provider (`command` or `test-discovery`, no
service or readiness probe) and runs its command once against the base source:

- the base is `git archive <baseHead>` extracted into a private temporary
  directory, never the sandbox or the user's target, and no Git worktree is
  added;
- every sandbox path that differs from base is laid over it **except** the
  change's product code, so the change's new or modified tests, fixtures,
  manifests, and carried-in files are present while the code under test is
  the original; `node_modules`, `.venv`, and `venv` are linked from the sandbox;
- when the runner takes file arguments (`node --test`, `pytest`,
  `python -m pytest`, `go test` by package), only the change's test files run;
  a plain `sh -c` wrapper is recognized with the same conservative command
  parser used for task checks; shell expansion, pipes, assignments, and
  redirects retain the configured command;
- a provider compiled from several task verifies records them as `segments`;
  the base runs the segments from the first through the last one whose command
  names a changed test file, so an earlier setup segment (a build or codegen)
  still runs and only later segments are skipped (a single first segment is
  narrowed further as above); when a changed test is named by no segment in
  that range, or the provider has no `segments`, its whole command runs as before;
  any other command (for example `npm test`) runs once as configured;
- a test that imports a module the change adds fails on base and therefore
  counts as failing on base.

A non-zero exit on base passes the rule. A clean exit 0 means the change's
tests pass on the original code: Prove returns the same convergent evidence
REPAIR as a failed provider (`stage: "tests-not-discriminating"`, route
`AUTO_REPAIR`) naming each repository and test file, and the agent adds or
strengthens a test that fails without the change. A behavior change with no
changed test file needs an existing test that fails on base. Changed tests are
progress; an unchanged rerun reaches the existing no-progress boundary. A spawn
failure, timeout, missing `baseHead`, or unresolvable surface is no verdict and
never blocks. Each verdict is cached under
`.foundation/logs/<change>/test-discrimination/` by the digest of the base
commit, the command, its effective environment digest, and every overlaid file, so an unchanged
rerun runs nothing; cost is at most one extra test command per affected
repository per distinct test content. Low-level `proof run` and `proof
finalize` remain operator primitives and do not run this check.

The same rule applies in Build. When a behavior task's `verify` passes but
nothing changed in its declared `[paths:]` — the check passed on the original
code — the task is not ticked: it returns with the task's verification failure
`task <id> completed with no change`, counted like any repeated verify failure.
Tasks scoped only to docs or manifests, observation task kinds, and refactor,
docs, chore, or config changes keep verify-only completion.

## Performance against base

A `benchmark` provider measures one project command on the original code and on
the change under the same environment. It takes `command`, `runs` (integer, at
least 3, default 5), and `maxRegressionPercent` (default 10); a draft with fewer
runs returns an agent `EDIT`. The base tree is built exactly as for
[tests that fail without the change](#tests-that-fail-without-the-change), and
runs alternate base, head, base, head so machine drift affects both sides.

The receipt keeps every duration sample per side, both medians,
`regressionPercent` (`(head − base) / base × 100`, two decimals), the
threshold, and one environment descriptor for both sides. The provider passes
when every head run exits 0 and `regressionPercent` is at most the threshold;
a value equal to the threshold passes. A regression is confirmed before it
counts: the harness runs one fresh alternating round with twice the runs, and
that confirmation decides the verdict. The receipt keeps the first round's
samples and `firstComparison` beside `confirmation`, so a single noisy round
never hands the agent an unfixable repair. A confirmed regression returns the
convergent evidence REPAIR `stage: "performance-regression"` with finding
`<provider>:performance-regression` carrying both medians, the percentage, and
the threshold, so the ordinary recovery ladder applies. A failing head command
is the ordinary `evidence-failed` repair. A missing `baseHead`, a base tree that
cannot be built, or a base run that cannot spawn or fails records
`comparison: {status: "unavailable", reason}` and decides from the head exits
alone; it never blocks.
