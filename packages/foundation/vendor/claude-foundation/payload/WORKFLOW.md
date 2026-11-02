# Change Loop workflow

**Version 3.6.8**

Change Loop is an OpenSpec-native control plane for safe, economical software
changes in brownfield repositories:

```text
Investigate? → Change → Build → Prove → Land
```

**Audience:** coding agents, integrators, maintainers, and users checking exact
behavior. This is an installed system reference, not a file consumers customize.
For everyday use, follow the [quickstart](https://claude-foundation.dev/docs/quickstart/).
The [ownership reference](.claude/harness/README.md#file-ownership-and-writers)
separates project agreements, installed instructions, and runtime records.

This document owns the detailed lifecycle contract: what each phase means,
which state transitions are allowed, what blocks progress, and what authority
the harness never infers. In the upstream source repository, `README.md` and
`README.th.md` introduce the product; a consumer project's root README describes
that project, not necessarily Change Loop. Runtime structure and operator commands belong to
`.claude/harness/README.md`; provider, receipt, and proof details belong to
`.claude/harness/EVIDENCE.md`.

## Why this shape

OpenSpec stores the agreement, the native coding agent implements it, and
deterministic project-owned providers prove it. The harness owns state,
isolation, budgets, evidence identity, authority boundaries, and recoverable
Land. Rigor scales with risk and evidence needs, not a task-size phase matrix.

## Ownership and user states

The user owns intent, consequential product decisions, explicit Land authority,
final diff review, and the authority for any later Git or external side effect
(such as an explicit `/deliver`). The coding agent
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

### Authority from the user's words

One rule decides what the user's chat words authorize; `AGENT.md` carries it
for every host, and the phase guard enforces its Git and Deliver parts.

- **Approval.** A reply to the spec-approval or amendment question in the
  user's own words—"ลุยเลย", "ทำเลย", "ทำไปเลย", "go ahead", "approve"—is the
  approval. The agent records it through the existing
  `advance <change> --approve-spec --decision-ref <ref>` path and does not ask
  again. Approval stated in the original request counts the same way.
- **Land.** Any explicit instruction to land grants Land. A user who said up
  front "ทำจนจบ", "ทำให้เสร็จ", or "finish it" also authorized Land for that
  change.
- **Not authority.** Silence, and urgency alone ("ด่วน", "รีบ demo"), never
  approve or grant Land. A negated request ("don't push yet") is never
  authority. Authority for an external side effect is never inferred beyond
  what was said.
- **Commit and push.** Only `/deliver` or the user's direct instruction
  ("commit this", "push it") commits or pushes; a push instruction covers the
  commit it publishes. Land never commits. During Build or Prove, a
  `git commit` or `git push` from the main checkout that the user's latest
  prompt did not ask for does not run: the phase guard replaces it with the
  question for the user, and a yes reply lets the same command run. Inside the
  isolated workspace it is ordinary Build work.
- **Pull requests.** A direct request to open a PR or deliver ("เปิด PR ให้เลย",
  "open a PR") is `/deliver` for that one composite command, as is a yes to the
  delivery question the guard asked.

### Blocking policy

The user decides, the agent codes and documents, and the harness automates.
The harness never blocks the user or the agent before Land: it performs a step
itself or routes it to its owner (`EDIT` or `REPAIR` for the agent, `WORKING`
or a harness `WAIT` for its own work, `WAIT` for a named external owner). Land
is the single hard gate: it requires a still-valid spec approval, a `proven`
(or `applied`) lifecycle, passing assurance, and a proof bound to the current
workspace hash ([`/land`](#land-change)).

Before Land, only a user decision stops the flow, as `ASK_USER`:

- spec approval, or an amendment that removes approved behavior;
- product meaning, a material trade-off, or a scope widening the agreement
  does not settle (including an amended-agreement conflict, and two changes
  whose intents contradict);
- an acceptance verdict, a waiver, or exhausted review (`review-exhausted`);
- Land authority, a commit or push, or another external side effect (including
  rerunning a provider execution whose side effects are indeterminate);
- budget or spend (`budget-no-progress`);
- a cause only the user can clear in their own environment
  (`user-environment`: a credential, the network, or a full disk).

Everything else stays with the agent or the harness: setup and tool
preparation, sandbox repair and sync conflicts, shared-resource waits,
protected-path edits and deletions (recorded by Prove and shown at Land), and
repeated repair, which the [recovery ladder](#recovery-and-user-decisions)
returns to its owner with a changed strategy. The ladder's boundary set
(`USER_AUTHORITY_BOUNDARIES` in the advance recovery runtime) is the runtime
form of this list.

## Lifecycle commands

### `/investigate <problem>`

Use Investigate only when the problem or direction is unclear. It is bounded
and read-only with respect to product code. `investigate --template` defines a
v2 record retaining requirements and conversation context as well as facts.
Use `purpose: change` for feature, improvement, or bug feasibility and
`research` for facts-only exploration; v1 records and bindings remain supported.
The agent summarizes the user's intended outcome, retains every material
requirement, example, constraint, exception, non-goal, answer, and correction
after each meaningful conversation update, and starts independent research
without waiting for a blanket confirmation. Explicit instructions need no
repeat approval. User intent cites retained conversation events; code facts
cite repository sources. Missing history is disclosed, never fabricated.
Requirement content changes use new revisions and explicit retirement;
unrelated requirements, previous events, answers, and completed experimental
results survive resume. Invalid history edits retain the last validated intake.
The row shapes live in the [runtime record contract](.claude/harness/README.md#investigation-intake-records).

Questions may be open-ended and name their dependent work. The typed action
exposes pending questions and independent work, which the agent continues
while asking for material meaning. Only work depending on an unanswered
material choice waits; record/source/report repairs remain with their agent
or harness owner. Nonmaterial open questions can travel as disclosed context,
and a material question that depends only on them is still asked; one blocked
by another unanswered material question returns an agent repair to answer,
defer, or unlink that dependency.
Material proposals are not user agreement, and silence confirms nothing.
Experiments name their question, requirement revisions, criteria, findings,
and limitations; only affected results need review after requirements change.

The same template defines a versioned fact, hypothesis, option, decision,
and conclusion record. Running
`investigate <record.json>` discovers and hashes repository sources, persists a
machine-owned resumable state with compact metrics, and returns one typed
agent, user, or harness action. Discovered sources are acknowledged
automatically and stay hashed for freshness; facts and options must cite an
inventoried source, and discoveries no fact cites are listed in the report.
Open decisions derive `conclusion.status: needs-user-decision`; a settled
record with `changeIntent` concludes as `ready-for-change` in the same run, and
explicit legacy statuses stay accepted. Three unchanged attempts expose a
no-progress boundary without discarding the exact resume route: it reaches the
user only when the repeated action was a user question, a sandbox or discovery
failure goes to the harness, and any other stall returns to the agent.

Each inspection also generates `openspec/investigations/<id>.report.md` from the
validated state: conclusion, recommendation/reasons, facts and source links,
hypotheses, comparisons, unknowns, decisions, and next action. A hypothesis may
name `experimentKeys`; each must resolve to a current experiment (a superseded
one returns an agent repair naming its replacement), and the unknowns list
shows every open hypothesis's next check or that none is planned. The agent writes
record content in the user's language and returns a short summary with the
current report link. `language: "th"` selects Thai headings; English is the
fallback. JSON stdout and handoff remain machine-readable. Generated reports
are excluded from investigation source binding, and authored `<id>.md` notes
are preserved. A report failure preserves research and returns a regeneration
route with no current report or handoff advertised; the persisted state records
that route, never `DONE`. Reporting never starts Change.

Set the optional `activeChange` field to an existing change ID when the question
arises during Build or Prove. The harness then reads the active isolated root
and binds its workspace identity and base into state and handoff. If that
sandbox is missing, stale, or unreadable, the first run returns a harness-owned
repair (`repair-harness`) with the same record command; the record itself is
not blamed. Omitting the field preserves standalone Investigate behavior
against the project root.

A comparison is a record with `mode: "compare"`: three to five options, each
with findings, trade-offs, and sources, and, once concluded, a `selection`
naming the chosen option, its reason, and why each other option was rejected.
Under `/investigate <decision> --compare`, the agent may write disposable
alternatives only at the `prototypePaths` such a record declares under
`.foundation/prototypes/<id>/`. Prototype artifacts are never evidence.

A `ready-for-change` result emits a digest-bound handoff. The agent copies it
into semantic draft v4 as `investigation`; Change verifies the state and source
digests before compiling and retains the conclusion in the agreement. V2 also
binds retained intent and requires `investigationCoverage` linking each active
material user requirement to an actual requirement/scenario, non-goal, or design
decision. Revise and amend preserve that mapping. The compiled packet retains
examples, answers, corrections, experimental limitations, and provenance.
The agent checks meaning after compilation: reference validity alone is not
semantic completeness. Missing coverage is agent-owned repair, not another
approval request; existing spec approval before Build remains unchanged.

### `/change <intent>`

Change authors one semantic draft (draft v5 for new work; v4 and v3 remain
compatible) with compact bookkeeping and enough
behavioral detail to understand scope and acceptance without chat history.
Reconcile the relevant available conversation, latest corrections, and retained
decisions before drafting, then check their coverage in the compiled packet.
Use diagrams and affected folder mapping when boundaries, flow, or structure
need explanation; preserve that context for Build and session restart.
Agent-authored document prose follows the user's requested document language,
or the language of their current request; machine syntax and canonical
identities stay stable. See the [Change authoring workflow](.claude/skills/change/references/workflow.md)
for the detail, language, and compiled-packet inspection rules.
The transactional compiler creates
`openspec/changes/<id>/`, assigns stable cross-ledger IDs, validates the complete
agreement, and installs it. `change start` creates no sandbox: the first
`advance` creates the isolated workspace and moves the change from `change` to
`building`. The draft records:

- optional discovery coverage (required for high impact or typed risk), ambiguity, impact, coupling, and size;
- semantic requirements and task outcomes, rendered for people: one case per
  scenario with a short name, optional GIVEN/AND lines, and a titled overview
  per capability;
- claim-to-task coverage and required evidence capabilities;
- semantic security and review triggers;
- typed extensions only when the change needs them.

#### Draft v5 folder and outline

A draft v5 is a folder, started with `claude-foundation change start <folder>`
(`new --draft` accepts it too). `change.json` declares `version: 5` and holds every typed field;
`proposal.md` and `design.md` hold the author's prose under `## ` headings from
the outline, in English or Thai. One versioned outline contract
(`validation/outline-contract.mjs`) fixes every section's document, order,
owner, feeding fields, and condition, so a section renders once in one place.
The compiler keeps authored prose byte-for-byte and merges it with the derived
sections in outline order. One EDIT names, per file, a missing `change.json`, a
heading the outline does not have (with the accepted headings), a heading the
harness derives (such as Change, Capabilities, Acceptance traceability,
Definition of done, Work type, File map, Test map), a heading out of outline order
(with the right order), an empty section, and a section containing `TODO` or
`TBD`. v5 passes the same semantic intake gate and discovery coverage as v4.
`nfr` and `observability` live only in `change.json`; the harness derives
grounding's NFR and observability rows from them. `revise` and `amend` of a v5
change keep the folder's prose; an amendment may replace one authored outline
section of `proposal.md` or `design.md` in place (`sections: [{document, key,
body | value}]`), and a section key the outline does not have is refused with
the packet unchanged. Volatile data (status, approvers, evidence freshness,
review record) never renders in the packet before Land, because the approval
identity covers every packet file; read it with `claude-foundation changes`.

Proposal order: header, Summary, Why, User stories, Success criteria, Scope,
Capabilities (derived, more than one capability), Impact and risk, Decisions to
ratify and open questions, Decision log, Communication/support/release note, How
to verify, Acceptance traceability and Definition of done (derived), then the
appendices (Investigation, Discovery coverage, Derived by the harness,
Provenance, Amendment history; Review record and Compliance change record only
at archive). Design order: Overview, Current state, Domain language,
Assumptions, Work type (derived), Architecture, Tenancy, User flow, Runtime
behavior, Domain model and modules, the contract sections (API, event and job,
data model and migration, UI, config, integration), the work-type sections
(public interface, migration plan, performance analysis, dependency change,
deprecation plan, infrastructure plan, privacy assessment, experiment design,
client release plan, model card, bugfix analysis, refactor invariants),
Decisions, Quality attributes, Threat model, Failure matrix, Observability and
usage, Compatibility and rollout, Capacity and cost, Backup and recovery, Test
strategy, Dependencies, Risks, then the derived File map and Test map. Only
sections whose fields are present render. Every new typed field is also
optional in draft v4 and v3 drafts. Field shapes and one example block per
work type are in `change start --template` (`workTypeExamples`,
`draftFolderV5`); the harness guide lists the field modules.

#### Work types and required sections

`workType` takes any of: feature, bugfix, refactor, api, library, ui, data,
migration, async, integration, config, performance, dependency, deprecation,
infra, observability, privacy, experiment, client-release, ml, data-fix,
security, cicd, docs, test, chore. Undeclared, it is inferred from task paths. A declared `workType` must
include the type its typed signals require: `integrations` or `riskSignals`
`external-integration` require `integration`, and `performance-slo` requires
`performance`; otherwise intake returns an `EDIT` naming the missing type.
Prose is never read for this. Light work (docs, test,
chore) owes only a summary. Every other type owes a failure matrix, except
behavior-neutral work (refactor, config, dependency, docs, test, chore), which
tells its failure story in its own section. Each type adds:

| Work type | Required sections |
|---|---|
| feature | userFlow |
| bugfix | bugfix (`variant: security` adds `bugfix.disclosure`; `hotfix` adds `bugfix.incident`, `bugfix.backport`) |
| refactor | refactor, componentMap |
| api | apiContracts, boundaries |
| library | libraryContract |
| ui | userFlow, uiStates (or `ui`), componentMap |
| data | dataModel |
| migration | migrationPlan, rollout |
| async | jobContract (or `eventContracts`), diagrams |
| integration | integrations |
| config | configContract |
| performance | nfr, performanceAnalysis |
| dependency | dependencyChange |
| deprecation | deprecationPlan |
| infra | infraPlan, rollout |
| observability | observability |
| privacy | privacyAssessment, threatModel |
| experiment | experimentDesign, rollout |
| client-release | releasePlan |
| ml | modelCard |
| data-fix | dataFix |
| security | threatModel, hardening |
| cicd | pipelinePlan |

User-visible work (feature, api, library, ui, deprecation, client-release) also
owes a `releaseNote`. A missing section is one agent EDIT naming the field's
shape and an example, never a user question.

`data-fix` is a one-off change to production data (`dataFix`: scope, snapshot,
dryRun, rerunSafe, rollback); `security` is hardening with no single bug to
reproduce (`threatModel` plus `hardening`: weakness, control, verification);
`cicd` is a change to a pipeline or build definition (`pipelinePlan`: changes,
permissions, blastRadius, rollback), and is inferred from `.github/workflows/`,
`.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml`, and `.circleci/`. A
pipeline file is `cicd` only, never also `config`. `ml`, `experiment`, and `infra` also
require `modelCard.evaluation`, `experimentDesign.guardrails` and `stopRules`, and
`infraPlan.costDelta`, the fields that used to be advice.

**Every required answer can be given truthfully.** Each field of `dataFix`,
`hardening`, and `pipelinePlan`, and the added `modelCard.evaluation`,
`experimentDesign` `guardrails` and `stopRules`, and `infraPlan.costDelta`, may
be answered `none: <reason>` or `unknown: <reason>` (Thai `ไม่มี:` or `ไม่ทราบ:`)
when the fact does not exist or is not yet known, and that counts as present;
the approval page shows the word and the reason. A bare
`none` or `unknown` with no reason is one agent EDIT asking for the reason.
These rules apply to a draft being started or revised only: a change already
started or approved, `advance`, and `change amend` are never blocked by them, and
none of them asks the user a question or stops Prove or Land. A change at risk
level High or Critical must also say how to undo it: `scratch.undo`, an
existing rollback field (`rollout.rollback`, `dataModel` rollback rows,
`migrationPlan.rollbackWindow`, `dependencyChange` pins, `dataFix.rollback`,
`pipelinePlan.rollback`), or `none: <reason>` when it cannot be undone. At
`change start`, a touched path that points at a risk the draft neither declares
nor covers in discovery (a migration file with no `persisted-data-change`
coverage, for example) prints one advisory `NOTE: path risk` and never blocks. Work types also select Build
skills and evidence capabilities (below and in
[EVIDENCE.md](.claude/harness/EVIDENCE.md)).

#### Decisions

A decision may carry `status` (`proposed`, `accepted`, `superseded`; absent
means accepted), `drivers`, `options` with pros and cons, `confirmation`,
`supersedes`, `durable`, and `requirements`. A proposed decision renders only in
the proposal's Decisions to ratify section, so the user ratifies or changes it
with approval; `design.md` records accepted and superseded decisions. An
accepted `durable: true` decision adds a `Rationale` line under each
requirement it names, so the reason survives archive into the living spec; an
unknown requirement key is an agent EDIT. An unknown task field (for example
`depends`) is an advisory warning naming the likely field (`dependsOn`); it
never blocks.

Rapid changes contain `proposal.md`, `tasks.md`, `evidence.yaml`, and a concise
delta `specs/<capability>/spec.md` (one SHALL statement and its scenarios per
requirement, rendered exactly as in standard), which Land merges into
`openspec/specs` like any other delta; only a legacy rapid packet or declared
docs-only work (`workType: ["docs"]` adding requirements, such as README
wording) declares `skip_specs` and has none, so prose never becomes a living
system requirement; its claims still bind evidence. A delta for a capability with no living spec states a
`## Purpose` (the capability overview, else the intent) that archive carries
into the new spec instead of OpenSpec's TBD placeholder; an existing spec's
Purpose is never replaced. A minimal draft's derived names stay short: the
capability is a top-level `capability` or the intent's noun phrase (such as
`kanban-board`), a requirement key is at most five whole words, and its
heading is the readable SHALL clause. A rapid proposal omits Why when the draft states no
reason, and lists recorded `decisions` (defaults the agent chose without
asking, `decidedBy: agent`) under Decisions. Every packet is a dev document
and each fact has one home. Every proposal, rapid or standard, opens with a
harness-rendered header (change id, lane and why, owner, created date, status
via `claude-foundation changes`; an unknown owner reads `unassigned`) and
states Scope (in scope: the behavior each requirement adds; out of scope:
the task `paths` allow-list, unselected repositories, or the authored
`nonGoals`, and never an empty section), an acceptance traceability table
(requirement, scenario claim and kind, task, evidence, test files; ids and
paths only, scenario text stays in `specs/`), and a definition of done
generated from the policy that is enforced: fresh evidence for every claim,
changed tests that fail on the original code (behavior-changing work only),
the review route, user acceptance when required, Land to `archived` (never a
commit), and the optional one-line `successMeasure` (else the scenarios
passing). `change start` prints one advisory coverage NOTE (no failure scenario,
no edge scenario, no success measure) that never asks the agent for anything.
Tasks and their checks live only in `tasks.md`; the proposal no longer carries
a Plan, What changes, or Folder tree, and `design.md` renders the derived
folder tree inside its File map. A rapid proposal, which has no `design.md`,
also carries the compact form (summary, user flow, failure matrix, and any
authored descriptive section: file map, test map,
component map, config contract, refactor, bugfix) and its Decisions. Changes
agreed before this layout keep their Plan, What changes, and Folder tree
and read, resume, and archive unchanged. Descriptive sections never move a
low-risk draft to standard; impact, coupling, security triggers, review, and
acceptance still do. A standard v4 or v5 change
always has `design.md`, and its draft must author the sections its work type
needs ([work types and required sections](#work-types-and-required-sections)); the harness infers
the work type from task paths (stated in `design.md`; declare `workType` to
override; test-, docs-, or manifest-only paths are light work) and derives the
file map and test map (scenario and check command). Flowchart node
labels holding `(`, `)`, or `"` must be quoted (`A["mean(values)"]`).
Each fact is written once: without an authored `failureMatrix`, scenarios with
`kind: "failure"` become its rows (an optional scenario `recovery` fills the
recovery column; with no explicit kind anywhere, scenarios that state a
rejection or error count), the intent stands in for an absent `why`, and omitted
evidence capabilities default to `test` (`static-analysis` for docs/chore) in
either lane unless the draft declares security triggers. The proposal lists
each value the harness filled under "Derived by harness", and `change start`
prints one NOTE; authored values are never replaced. One EDIT lists every
remaining issue (compiler, dev document, start checks, repository and verify
paths). A missing section is an agent draft repair, never a user question. `execution.yaml`, `repositories.yaml`, `handoffs.yaml`,
and `grounding.yaml` appear only when execution differs from detected defaults,
multiple repositories participate, external authority is required, or a
non-derived material decision must be recorded. Absence has versioned
virtual-default semantics.

The packet is written for a human reviewer first. After the rendered header,
`proposal.md` carries its summary, user stories, scope, acceptance traceability,
and definition of done; a capability index is omitted for a single capability.
Discovery coverage and investigation provenance close it as appendices. `design.md`
records every settled intake answer as a durable decision (context, choice,
rejected options, decided by), adds an optional overview diagram, assumptions,
open questions, the user flow, a component map, and the derived file and test
maps. The folder tree lives inside the File map; task outcomes, verify commands,
and dependencies live only in `tasks.md`. It fills the
file map's task column from task `[paths:]` and omits sections the change
leaves empty. When a task names a `repository`, the folder tree is one titled
tree per repository and the file map gains a Repo column; a path is marked
`+` when it is missing at that repository's own base, and stays `~` when the
repository's root cannot be resolved. A change with no named repository renders
unchanged. While any open question remains, an approval request returns those
questions as one `ASK_USER` decision instead of recording consent; the agent
asks them, records the answers, and asks for approval again.

Before compilation, the harness requires every risk-derived discovery dimension
to be covered, marked not applicable with a rationale, investigated, or resolved
by the user. It validates decision dependencies and exposes only the current
frontier; the agent interprets sources and authors requirements, while the user
owns consequential choices. After compilation, the OpenSpec packet is the
source of truth. The semantic draft is temporary and `.foundation/` is derived
coordination state. Draft v1 remains compatible, draft v2 retains its
unambiguous bookkeeping behavior, draft v3 remains readable, and draft v4
compiles unchanged (new optional fields only add sections). A draft declaring
any other version returns an EDIT naming the accepted versions 3, 4, and 5.

`change start <draft.json>` inspects before compilation (`--inspect` only
inspects). Inspection returns one typed `EDIT`, `ASK_USER`, or `DONE` action
with an exact resume route. Its `EDIT` batch also names, as agent repairs, a
task `verify` that references a test file which neither exists nor falls inside
any task's `paths`, and an `apiContracts` error listed without a status or code.
When `openspec/repositories.yaml` (or `.gitmodules`) declares repositories
besides root, nested or trusted `../` siblings, `change start --template` lists
them with the `repositories` selection and per-task `repository`, and the batch
names a task that edits files in a read repository, a root task whose paths or verify
reach into a declared repository (the harness does not rebind it: moving a task
changes where its paths resolve and where verify runs, so the agent rewrites
them), a repository task whose paths are written from the control root, a task
repository the draft does not select, and a verify that `cd`s (or `-C`,
`--prefix`, `--cwd`) into another repository or outside its own; verify runs
from the task repository root. An advisory, never a block, names a known runner
whose default output Prove cannot count (bare `go test`). An
unresolved user-owned coverage row must link to its decisions through
`decisionKeys`; once every linked decision is resolved, the harness treats the
row as covered by those decisions, so recording an answer needs no further
coverage edit. Repository-owned investigation is returned before user
questions. At `DONE` the same call compiles atomically; `--consume-draft` also
removes the draft.
Typed `riskSignals` provide language-neutral triggers for access control,
persisted data, integrations, performance SLOs, UI accessibility, operational
risk, external side effects, financial effects, and input domains
(`input-domain` requires `input-boundary` coverage of the adjacent input
partitions; `financial` requires `timeout-retry-idempotency` and
`recoverability`). A draft declaring `access-control` tags at least one
scenario `access: allow` and one `access: deny`; a missing side or another
value returns an agent `EDIT`, and a deny scenario derives
`permission-rejection` coverage. Prose is never scanned for either decision.
Optional `constraints` (non-empty strings) render as a proposal Constraints
section and are `{kind: constraint}` investigation coverage targets; optional
`fixes` names archived change ids (an `openspec/changes/archive/<date>-<id>`
directory) that this change corrects, is kept on the change, and feeds the
`outcomes` escaped-defect count.
Inspection persists one machine-owned snapshot bound to the draft and its
grounded-source digests. Before each v4 or v5 inspection the harness performs bounded,
read-only repository discovery and ranks relevant specs, tests, callers,
integrations, persistence, and permission boundaries. Typed size, impact,
coupling, risk, and repository signals choose the intake depth without dropping
mandatory dimensions. Enumeration has fixed hard safety limits; adaptive limits
bound only the selected read-set and question frontier. Questions already answered by source facts, duplicate
alternatives, and unsupported recommendations are rejected. Git-aware discovery
omits ignored output; an oversized undeclared file is reported but cannot poison
the whole scan, and unsupported dependency languages are reported as partial
graph coverage. The harness records the source digest itself;
`discovery.sourceDigest` is optional, and a correct draft completes intake on
its first inspect. Source facts and recommendation evidence must match the
selected inventory. Discovery coverage is optional for an ordinary change;
`impact: high`, `riskSignals`, security triggers, integrations, and external
operations require their mapped dimensions. A required dimension the draft
already states is derived as a `covered` row marked derived in the proposal
appendix: current behavior from `currentState`, affected actor from
`userStories`, desired behavior from requirements, success, failure, and input
boundary from scenario `kind` (`success`, `failure`, `boundary`; failures also
from `failureMatrix`, boundaries also from `apiContracts` with request and
errors), compatibility and non-goals from their fields, verification when every
requirement has a verifying task and evidence, data migration and rollback from
every `dataModel` entry, integration contract from documented `integrations`,
timeout/retry/idempotency from integration concerns or a complete
`jobContract`, and accessibility from `uiStates`. Without backing content the
dimension stays missing; an authored row always wins, so a
`needs-user-decision` row is still asked. Draft v3 is unchanged. Prose is never scanned for risk
keywords, a modified requirement does not imply migration or rollback coverage,
and a risk-derived `not-applicable` row needs only a rationale. Design and
reader-guide warnings are advisory, and small rapid-lane drafts get no
missing-section prompts; sections the agent writes are always checked.
Compact effectiveness counts survive successful compilation in runtime;
conversation context is retained in a bound investigation record when present,
without a separate Change interview ledger. A
changed selected source invalidates readiness and returns agent-owned coverage refresh.

For newly started changes, present the compiled spec, scope, and acceptance
criteria and wait for explicit user approval before Build, including `/dev`.
When the request itself already approves the spec, in any wording (for example
"I approve the spec" in a `/dev` request), that is the approval, as is a reply
such as "ลุยเลย" to the approval question; silence and urgency never are
([authority from the user's words](#authority-from-the-users-words)).
Record it with `advance <change> --approve-spec --decision-ref <ref>` (alias of
`change resolve <change> --approve-spec`); add `--through <target>` to continue
in the same call. The same `--approve-spec --decision-ref <ref> [--through
<target>]` flags on `change start`, `change revise`, or `change amend` record the
approval in the call that applies the approving answer; a call that stops at an
intake action approves nothing. The approval binds the agreement, not provider
wiring: editing a provider's command, timeout, env, or a service in
`execution.yaml` or `evidence.yaml` reruns that provider's evidence but keeps
the approval, while adding or removing a provider or changing any claim needs
approval again. Design open questions print with the approval
packet so the user answers them with the approval. The normal agent path uses only
`change start <draft>`, which inspects and starts a complete draft in one call,
`advance`, and `changes`: `advance` wires detected evidence, synchronizes the
sandbox, runs agent-runnable configured reviewers, and ticks a handed-off task
in `tasks.md` when its verify passes (a failed check returns
`verificationFailures`). Every REPAIR carries a command or instruction, so the
agent never reads harness source to recover. `/dev` runs `/change` → `/build`
→ `/prove` → `/land` (Land only with authority) exactly as the separate
commands: shared agent rules live only in `.claude/harness/AGENT.md`, each phase
command is the single source for its phase, and the full Change, intake, and
Build references load only on their triggers. A minimal draft (`intent`,
`requirements[{description, scenarios[{when, then}]}]`,
`tasks[{outcome, verify, paths}]`, no `version`) is expanded by the compiler.
Every EDIT or REPAIR lists `contextFiles` (absolute paths to open), `newFiles`
(declared paths to create), and `contextScope`. A session Build EDIT may also
carry optional `skills`: at most four skill names chosen only from the change's
work types, risk signals, and security triggers (never prose), limited to skills
installed under `.claude/skills/`, with a matching load instruction as the
first instruction; absent when none applies. Each EDIT task with a verify
also carries `checkCommand`, that verify run through `claude-foundation exec
<change> --task <id>`, which the installed allowlist already permits. Each EDIT task carries its own
`workspace`: a non-root repository's task names
`.foundation/repository-sandboxes/<change>/<repository>`, never the shared
sandbox's path for that submodule, and the top-level `workspace` (plus a
`workspaces` map by repository) is that sandbox whenever every task shares it.
The `tasks.md` in `contextFiles` is the isolated ledger the harness ticks. When
the handed work depends on finished tasks, or other repositories hold finished
tasks, the EDIT lists them in `completed` (`id`, `repository`, `workspace`).
`claude-foundation exec <change> --repo <id>` (or `--task <id>`) runs a check in
that same sandbox; without either, the caller's directory or a single pending
task repository selects it, and nothing runs in the main checkout. Unauthorized external work enters
`handoffs.yaml` only through a semantic amendment, and grounding reads belong in
the draft's `grounding` field.
Runtime approval binds agreement content and revision; task checkboxes and
task `[paths:]` write scope are bookkeeping and do not invalidate it. The user
approves a change once: a later `change revise` or `change amend` that only adds
or revises requirements carries the current approval to the new revision and
packet, with an audit row (`approvalCarries`), and needs no second approval. A
revision or amendment that removes a requirement, or one of a change that was
never approved, still waits for approval. During Build agreement edits go through
`change amend`, and a hand-edited isolated packet is agent-owned drift repair. Legacy
primitive-created/in-flight changes retain their compatibility route.

#### Approval package, preview, and role lanes

The approval question links a read-only approval package,
`.foundation/packages/<change>.html`, which `change start`, the `advance`
approval question, and `package <change>` write. The scratch router derives it
from the agreement's existing `workType`, `riskSignals`, `impact`, `coupling`,
`integrations`, and `securityTriggers`: a risk level (Critical when `impact` is
high with `financial` or `access-control`; High when `impact` is high or a
weight-3 signal is declared; Medium for any other signal or medium impact; Low
otherwise), up to 28 technical domains, and approval artifacts grouped by
approver role, each deduplicated across domains. Every change shows its change
impact and test map; Low shows nothing else, and runnable artifacts appear only
from High upward. A `proof` label requires a valid passing receipt; other
artifacts are `preview` or `no evidence yet`. A render failure is a warning and
the user approves from the packet as before.

The page is decision-first, in this order: the change id with a risk level (a
word, a symbol, and a four-step scale, never colour alone) and each reason for
the level in plain words; the `scratch` lines, with before and after as paired
cards; a scope strip of files touched, open questions, and failure cases (a
count the draft cannot give reads `unknown`, never 0); the decision cards for
the change's kind of work; the required-section checklist; failure cases as
cards of trigger, what happens, and recovery (recovery appears only when the
draft states it); the first two examples open, with a
prototype always first, and the rest collapsed; the open questions in full; and one
collapsed reviewer-details section holding the summary, technical domains, role
tables, suggested previews, and any diagram no card took. The page has no
decision section: it carries no form, button, handler, textarea, or script
beyond the Mermaid loader, and records nothing; the user's reply in the chat is
the decision. Under the risk block one quiet status line says the spec is
approved for the page's revision, or names the `approval.roles` lanes still
missing, and is absent when there is nothing to say. A change with no typed
draft hides the scope strip, the cards, and the checklist. The page uses the
installed Thai-capable sans fonts (Sukhumvit Set, Leelawadee UI, Noto Sans Thai,
Thonburi, Tahoma) at a 17px base and loads nothing from the network.

**Diagrams and prototype on the cards.** Each diagram sits, open and
collapsible and scrolling sideways when wide, in the card it explains, once: the
`userFlow.source` flow chart in card A; a `sequenceDiagram` in card D, else F,
else A; a `stateDiagram` in card F, else E, else A; any other diagram in card A.
A diagram whose preferred cards are not shown goes to the first card shown, and
with no cards at all stays in reviewer details. Card A says there is no
prototype yet when it is shown without one; this is a note, never a gate.

**Decision cards.** Each work type maps to one of seven kinds of decision, and
the page shows the card of every kind the change's declared or inferred work
types match, once each, in the order E, G, F, D, A, B, C (the choices hardest to
undo first). A card shows the question the approver decides and the typed draft
fields that answer it; a field the draft lacks reads `unknown`, and nothing is
guessed.

| Card | Work types | Question | Draft fields shown |
|---|---|---|---|
| A | feature, ui, client-release, experiment | What will users see and do? | `userFlow`, `uiStates`, `experimentDesign`, `releasePlan` |
| B | bugfix | What is the problem, how will we know it is fixed? | `bugfix`, `bugfix.incident`, `bugfix.disclosure` |
| C | refactor, dependency, config, docs, test, chore | Is it safe, what must stay the same? | `refactor`, `dependencyChange`, `configContract` |
| D | api, library, deprecation | Who uses this contract and what happens to them? | `apiContracts`, `boundaries`, `libraryContract`, `deprecationPlan` |
| E | data, migration, data-fix | Can data be damaged, can it be undone? | `dataModel`, `migrationPlan`, `rollout`, `dataFix` |
| F | async, integration, infra, observability, performance, cicd | What happens when it breaks, what does it cost? | `infraPlan`, `nfr`, `performanceAnalysis`, `jobContract`, `integrations`, `observability`, `pipelinePlan` |
| G | privacy, ml, security | Whose data, for how long, and if it goes wrong? | `privacyAssessment`, `threatModel`, `hardening`, `modelCard` |

Below the cards, two lines answer how to undo the change and who it affects:
the author's `scratch.undo` and `scratch.who` when present, otherwise a value
read from fields the draft already has (the rollback fields listed above, `deprecationPlan`
consumers, `userStories` actors) with its source named, otherwise `unknown`. A `none:` or
`unknown:` answer shows the word and its reason.

**Required-section checklist.** The checklist lists each section
`requiredDevSections` names for the change's work types as present or missing,
using the same rule the compiler enforces, so it defines no rule of its own.
Because `change start` already refuses a standard-lane draft that lacks a
required section, a missing section appears mainly for rapid-lane and older
drafts. A section that must answer fixed fields reads missing, naming each field that is
not answered. Sections that are only advised would be shown apart with a
recommended label and never validated; none are defined today. A card or the
checklist that cannot be built becomes a warning on the page and the rest still
renders.

`preview <change> --provider <name>` is optional at every risk level and never
blocks approval or Build. Before Build only, it copies the target into
`.foundation/previews/<change>/workspace` and runs one declared provider there,
recording a `kind: "preview"` receipt bound to the contract revision; the
package marks it stale after a revision. A provider marked `external: true`
reaches outside the machine and runs only with the user's `--decision-ref` for
that run (otherwise `PREVIEW_AUTHORITY_REQUIRED`, and nothing runs). Preview
receipts never satisfy Prove or Land ([evidence](.claude/harness/EVIDENCE.md)).
For a High or Critical change the package suggests the matching provider and
its command, or names the capability to declare. A provider with
`"previewOnly": true` exists only for previews: Prove never selects it, so it
needs only an `adapter` and a `command`. A provider's `previewArtifact` names a
file inside the preview workspace, such as a prototype or screenshot; the
preview keeps a copy under `.foundation/previews/<change>/artifacts/` and the
package links to it. A path outside the workspace is refused before anything
runs. The package also shows the agreement's content under each artifact and
each preview's status and output, and for a change already applied or archived
it labels proof from the receipts Land accepted.

The router also reads the paths the change's tasks touch. A migration, schema,
or `.sql` path, an auth or permission path, a payment or billing path, a UI
component path, an infrastructure path, or a webhook path adds the matching
risk signal when the draft did not declare it, and the package names the path
that raised it. Path signals affect only the risk level, domains, artifacts,
and approval lanes; discovery coverage and review still follow the declared
signals. A `dataModel` whose every row declares `store: "browser"` (for
example `localStorage`) skips the Data Migration domain and does not count
`persisted-data-change` as heavy, unless a task path still looks like a
migration. Reporting needs a `report` or `search` example, or data and UI work
without an API, a feature, or stored-data change. `access-control` also routes
the Security domain and its threat model.

The draft carries two fields for approvers. `scratch` holds four plain
lines (`get`, `asIs`, `toBe`, `ifFail`, each at most 240 characters) that the
package shows first, and two optional lines of the same shape, `undo` (how to
undo the change) and `who` (who it affects), which are never required. It is required when the draft declares `impact` medium or
high: `change start` and `change revise` return an intake `EDIT` naming each
missing `scratch.<key>`. A low draft may omit it, and the package then shows the
intent with a warning that the summary is missing. The rule applies to a draft
being started or revised only; `advance`, `change amend`, and a change already
started or approved are never blocked by it. `examples`, which stays optional, holds typed blocks with real values from the
request, code, or data, one of 29 types (`prototype`, `examples`, `api`,
`timeline`, `dataDiff`, `lineage`, `mermaid`, `failures`, `permission`, `plan`,
`snapshot`, `repro`, `perf`, `golden`, `adr`, `rollout`, `apiDiff`, `strings`,
`alert`, `privacy`, `coverage`, `consumers`, `messages`, `terminal`, `doc`,
`pipeline`, `search`, `report`, `diffSummary`); an unknown type or a missing
required field is an intake `EDIT` naming the path. A `prototype` names a file
the agent wrote under `.foundation/previews/<change>/` and opens in a sandboxed
frame. Each example has an after-Build tab: with an optional `capability` it
reads that provider's receipt (`proof` only when valid and passing, `failed`
when it failed, with artifact links confined to the change's evidence folder)
or preview (`preview` or stale), and otherwise says no result yet and shows the
optional `postBuild` comparison. Page text is Thai when `language` is `th`,
otherwise English. Switching tabs and API cases uses HTML only; the one script
in a package loads the harness's own `.claude/harness/vendor/mermaid.min.js`
by relative path, nothing is fetched over the network, and every draft value is
escaped. Without that file, diagrams stay readable Mermaid text. `change start`
prints `NOTE: scratch (advisory, approval page)` for a medium or high draft
without examples, a performance change without a target number, or a defect,
migration, or deprecation without a count in `scratch.asIs`; that note never
blocks (the missing-`scratch` rule above is the only blocking check).

With `approval.roles` set in `foundation.json`, spec approval has one lane per
configured role the router selects for the change. Each role records
`advance <change> --approve-spec --role <role> --decision-ref <ref>`; until
every required lane approved this revision and packet, the approval does not
exist and `advance` asks for the missing roles. An approval without `--role`
covers every lane required when it is given, a later `--role` approval adds its
lane without revoking it, and without `approval.roles` the single approval is
unchanged. The harness records the role as stated and does not verify identity.
Lane approvals carry across additive revisions and amendments under the same
rule as the whole approval, and the required lanes are routed again: a role the
revision newly selects must approve before Build. Removing a requirement resets
every lane. A malformed `approval` block or non-array `roles` is refused.

To change an agreement that has not started Build, revise it in place instead
of abandoning it and writing a new draft:

```bash
claude-foundation change revise <change> <draft.json>
```

The revised semantic draft keeps the change id (a different `id` is refused)
and passes the same intake gate as `change start`, under its own snapshot: the
call inspects first, revises only at `DONE`, and otherwise prints the intake
action and changes nothing. `--inspect` only inspects; `--consume-draft` also
removes the draft. With `--merge` the file is a partial draft applied to the
draft the change was compiled from; a patch that changes `version` (for example
v4 to v5) is refused and needs a whole-draft revision. Objects merge, `null` deletes a key, and an
entry in a list keyed by `key` (or `dimension`, or `name`) merges into the
entry with the identity it names (any of those fields every listed entry
has), `"$remove": true` drops it (an unmatched `$remove` is an error), and
other entries are appended; any other list is replaced. Removing a requirement drops its evidence
entry and task coverage. A change started before partial revision, or one an
amendment changed after its draft was recorded, needs the whole draft instead. The transaction
recompiles the whole packet, increments the contract revision, and restores the
prior packet and runtime state byte-for-byte on any failure. It is refused once
the change has a Build workspace, a receipt, or a completed task, and in
`proven`, `landing`, or `archived` status; the refusal names the amendment or
successor-change route.

Every revision or amendment reports its requirement delta (`added`, `revised`,
`removed` keys). A carried approval prints it as covered by the current
approval. Otherwise the delta waits for the next approval, and unapproved deltas
fold together: a key added and then removed disappears, and a key added and then
revised stays added. Present only that delta for approval; `change resolve
--approve-spec` prints the approved delta and clears it, while approval still
binds the whole agreement.

Referenced diagrams, prototype selections, and local integration documentation
must resolve to regular files inside the project. Remote integration sources
must use HTTPS and a fixed version rather than `latest`, a branch, or another
floating alias. An amendment may extend a task's claim coverage, but changing
its outcome requires a new task so completed work cannot silently change
meaning. A completed task's verify command (or paths, or `dependsOn`) changes
only with `reopen: true` on its `updateTasks` row (`--reopen` on the direct
form below): the task is unticked, its claims are invalidated, and it counts as
done again only after the new command passes; a changed check never keeps a
completed status.

An amendment withdraws unfinished tasks with `removeTasks: ["<key-or-id>"]`
(needing no requirement, evidence, or intake on its own). A completed or proven
task is refused, as is a task another remaining task depends on unless that
dependent is removed too or its `updateTasks` row sets `dependsOn`, and a
removal that would leave a claim with no task unless `updateTasks` `covers`
moves it or `removeRequirements` retires it. The removed lines leave
`tasks.md`, their claims are invalidated, derived provider commands follow the
remaining verify commands, the amendment record keeps what each removed task
promised, and a removed id is never reused.

An amendment never adds a second provider for a capability the agreement
already proves: added claims join the one provider serving that capability (or
the one in the same repository), and an author-written command stays as
written. When several providers serve the capability and none matches, the
amendment is refused and names them; declare which provider proves the new
claims in the change's execution providers, then amend again. The `AMENDED`
output lists waivers bound to the earlier contract revision, which no longer
apply; record each again only with a new user decision.

An unfinished task (unchecked, with no valid passing command receipt for its
claims) may change its verify command, and optionally `paths`, through an
amendment with only `updateTasks: [{key, verify, paths?}]` rows. It needs no
requirement, evidence, or version-4 intake; `change amend --template` prints
it. The agent may make that correction directly, without amendment JSON or a
new approval: `change amend <change> --task <task-key|task-id> --verify
<command> [--reopen] [--reason <text>]` (`--reopen` for a completed task).
Derived provider commands follow the new verify,
the task's claims are invalidated so Prove reruns their evidence, and the
revision, validation, and rollback match any amendment. Claims, capabilities,
and the spec approval do not change; a command that always passes (`true`,
`echo`, `|| true`, `; true`) is refused by a best-effort text screen; the prior command is kept in the amendment
record; and the harness accepts the task only after the corrected command
passes in the workspace.

When Build discovers new behavior, or the user adds requirements to a `proven`
candidate before Land starts, amend the same agreement before continuing:

```bash
claude-foundation change amend <change> <amendment.json>
```

A successful amendment of a `proven` candidate returns it to `building` and
discards the old proof-advance checkpoint. Completed tasks and unaffected,
identity-valid receipts remain reusable; added work and invalidated checks run
before a new proof is finalized. A rejected amendment leaves the prior state
and evidence intact. Revision-bound Land grants become stale. Amendments are
refused once Land starts, including applied and archive recovery states; recover
the delivery and use a successor change.

An amendment may add (`addRequirements`), revise (`reviseRequirements`, the
full replacement row for an existing key), or remove (`removeRequirements`,
each with a `migration`) requirements; a key may appear in only one of them. A
revised requirement replaces its spec block and claims in place and needs an
open task, so add one with `addTasks` when only completed work covers it. It
keeps its capability and operation; moving a requirement is a removal plus an
addition. A
removal deletes the block, retires its claims from evidence, tasks, and
provider bindings, records the migration in the proposal, and is refused if a
task would be left without coverage unless `updateTasks` moves it. Only the
claims and providers bound to added, revised, or removed claims are
invalidated; removals are planned from the pre-amendment claims.

`addTasks` may also stand alone when each new task covers a requirement the
agreement already has, such as a dedicated check script; it needs no
requirement, evidence, or version-4 intake, and the covered claims are proven
again with the new task. A refused `updateTasks` row names why its task counts
as completed: ticked in the agreement's `tasks.md`, or its claims already have
a passing command receipt.

A version-4 amendment includes discovery coverage for every added or revised
requirement. The call inspects first and amends only at `DONE`; otherwise it
prints the typed intake action and changes nothing. `--inspect` only inspects;
`--consume-amendment` also removes the amendment file. The returned proof command
is the exact post-amendment recovery route. The transaction validates and
appends that delta to the compiled proposal.
During Build, the amended packet stays in the isolated workspace until Land.
Once that revision is approved (or carries the approval), `advance` resumes from this packet without
importing the older target agreement. `sandbox sync` can replay code onto a moved
base while preserving the amended packet, approval, and contract revision. The
packet is copied and verified in staging before replacing the worktree; an
interrupted replacement retains a verified recovery checkpoint. Restoring that
checkpoint records the base already incorporated in staging, including when the
target has moved again. The aggregate proof is invalidated separately; retained
provider receipts and exact spec approval are rechecked, not silently renewed.

If the target packet changed, Build and sync return an agreement conflict
(`amended-agreement-conflict`). The agent compares both packets and asks for
the intended merge or retained agreement, then records the answer with the
`advance <change> --decision merge|retain|pause` command the chosen option
carries, which performs the resolving sync. This explicitly accepts the
current target packet as the baseline that Land may replace; it does not copy
the target over the amendment. Unknown or stale baselines are never
silently refreshed, and later target edits still block Apply. Code conflicts
continue to use their existing replay or copy-path resolution routes.
Version-3 amendments keep their compatibility shape. The amendment transaction
preserves an unaffected passing receipt only across one explicit revision when
its declared provider, claims, and input fingerprints remain exact. Everything
affected, missing, or ambiguous is rerun through the returned Prove route.

A change that cannot be proven is retired explicitly, never deleted by hand:

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

Abandon releases leases, cleans up isolation, and moves the packet, runtime
state, receipts, evidence, transactions, plans, handoffs, logs, review requests,
reviewer reports, instruction manifests, the open attestation challenge, and any
delivery record to `.foundation/recovery/abandoned/<id>/` with an audit record,
so a later change reusing the id starts with a fresh review budget, its own
task attribution, no inherited attestation, and no stale delivery state. A
delivery record is kept there, never deleted; abandon does not close a pull
request it opened. The global attestation nonce ledger, investigation
prototypes, and content-addressed intake state are not per-change and stay. If
an older abandon or a Land undo left such bookkeeping behind, creating a change
with that id moves it into the newest retirement record; other leftover change
state still refuses the id. Abandon requires a real user decision, never
touches Git, refuses archived changes, and asks whether to keep or revert
already-applied files before acting.

Abandon removes only what the change owns: its sandboxes, its own `.foundation`
records and packet (quarantined, never deleted; an earlier quarantine of the same
id is set aside, not replaced), and, only with `--applied revert`, the target
paths its own apply journal recorded writing. It never deletes a target file the
change did not declare and apply. Before a sandbox is removed, any commit the
target repository cannot reach and any sandbox byte the target does not hold are
written to `.foundation/backups/<id>/<timestamp>/<sandbox>/` (`commits.bundle`,
`changes.patch` against the sandbox base, verbatim `files/`, and a
`manifest.json` naming the restore commands); abandon prints each backup path. A
sandbox whose content cannot be inspected, or whose backup cannot be written, is
kept.

### `/build <change>`

The normal entrypoint is:

```bash
claude-foundation advance <change> --through proven
```

The coordinator validates the agreement, prepares or synchronizes isolation,
compiles the task graph, and returns one bounded protocol-v6 action:
`WORKING`, `EDIT`, `REPAIR`, `RUN_EXTERNAL`, `WAIT`, `ASK_USER`, or `DONE`.
`WORKING` means harness work is still running (`PROOF_IN_PROGRESS`,
`LAND_IN_PROGRESS`): wait for it instead of starting another run. `/build`
targets `proven` from its first call, because Prove has no external side
effects: proof runs only once Build is complete, in the same coordinator
call, without a separate Build `DONE` round trip. It stops at `proven` and
never Lands. `advance <change> --through build` remains available to stop at
Build. The coordinator records the furthest `--through` target requested
(`requestedThrough`, monotonic; Land stays behind its own grant). Every route
the harness prints afterwards (`changes`, the session digest, `validate`,
approval, scope and workspace errors) continues toward that target, and never
below `proven` once the spec is approved, so a resume cannot walk back to a
Build-only stop. A session `EDIT` carries the whole recipe in `instructions`
(implement inside the workspace, resume once, `checkCommand` only to diagnose),
so a plain `EDIT` needs no Build document read; `/dev` reads only
`commands/change.md` up front and loads Build, Prove, and Land guidance on a
failure or a non-`EDIT` action.
`tasks.md` is the only implementation ledger. `handoffs.yaml` separately owns
AWS, cluster, secret, Terraform, deploy, restart, or other operations that need
external authority.

Build writes only inside the declared isolated workspace. Git projects normally
use detached worktrees; a dirty target or non-Git project uses an isolated copy.
This is workspace integrity, not OS process, network, or secret containment.
The agent runs `cd <workspace>` once as its own shell call and then plain
commands, so no compound command asks the user for approval.

The live guards never refuse the agent by default; they automate or route
([blocking policy](#blocking-policy)). A
product edit aimed at the main checkout while a workspace exists is redirected
to the same path in the workspace. Internal Land commands run as `advance
<change> --through archived` (a raw `land advance` is rewritten to it in every
session, `/land` included), and a delivery outside `/deliver` becomes the
question for the user. Everything else runs with guidance naming the rule and
the route: shell findings (path escapes, copies from outside the workspace),
edits before a change exists, and edits outside the phase's surface. Land
reports target edits made outside the sandbox, and the host still owns process
isolation for indirect or dynamically computed effects. A secret read shows a
redacted copy, and a detached `authority run` runs attached. Hosts that want
refusals set `FOUNDATION_GUARDRAIL_MODE=block` (or `FOUNDATION_SHELL_GUARD=block`,
`FOUNDATION_SECRETS_GUARD=block`).

The harness also absorbs what used to cost a turn: the agent's scratchpad
(`<tmp>/claude-*`) and `~/.claude` are writable in every phase unless they hold
the project or a repository the change writes; after Prove, edits inside the
isolated workspace only make the proof stale; during Land, read-only test
commands may run but script runners still need the runtime transaction; and an
isolated packet edited outside a semantic amendment is
restored to the approved text by the harness (whitespace in place; any other
edit saved under `.foundation/agreement-drift/<change>/` for an amendment), not
reported as drift for the agent to undo. A
workspace never borrows the checkout's dependencies. When no setup command is
declared, the harness runs the workspace lockfile's pinned install itself
(`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`,
or `bun install --frozen-lockfile`) and records it like a configured setup;
`sandbox.installDependencies: false` opts out. If that install fails or its
tool is missing, Build is not blocked ([blocking policy](#blocking-policy)):
`advance` returns a `REPAIR` handoff with
the command, workspace directory, and log tail for the agent to finish. When a
Build edit changes the workspace manifest or lockfile after a successful setup,
the harness reruns that setup before the next check, task check, or proof run
reads the workspace.

Before Build, the harness compiles and persists an execution-preparation plan
from selected repositories, setup commands, provider wiring, and tool identity.
It reuses ready records, prepares only missing project-local dependencies, and
retries only failed repository setup records. OpenSpec is required only from
Prove onward: Build neither installs nor stops for a missing CLI and records the
tool as `deferred`; the first Prove installs the pinned CLI under
`.foundation/tools` (never globally) and keeps the existing `HANDOFF` when that
fails. Prove and Land re-check the same plan. Before Build, an unavailable
OpenSpec CLI only defers the strict spec lint; from Prove on, the lint is required and an absent
CLI fails closed rather than letting an unlinted agreement reach archive. A setup or
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

A Build is confined when it stays in one repository, no claim spans
repositories, and no task declares a `[resources:]` token beyond its own
workspace. A confined single task, or a confined chain whose every scheduling
wave holds one task, runs in the current session without a lease (below). When
planned dispatch selects only one ready task otherwise, the current session
runs it under a harness-held lease. Two or more ready tasks in separate
repository workspaces use native workers. Tasks sharing a workspace stay
serialized because lease release observes the whole repository diff; disjoint
paths alone cannot identify their writer.
The compiler writes cross-repository order into `tasks.md`. A task follows
every same-change task in a repository nested inside its own, as root contains
a submodule. A task without authored edges also follows the tasks of each
repository its selection `dependsOn`. A task a semantic amendment adds gets
the same edges. An edge that would close a cycle, including a multi-task cycle
across the updated, kept, and added tasks of an amendment, is a compile issue. The harness plans dependency and resource scopes,
leases them all-or-none with fencing generations, and accepts only observed
writes inside the granted authority. Load one primary construction skill per
task and only the cross-cutting security or observability skills whose triggers
apply.

An edit inside the sandbox outside every task's `[paths:]` does not block Build
or Prove ([blocking policy](#blocking-policy)). Prove records it in the change
surface (`surfaceAdditions`), so it is proven and lands with the change. A
control-plane, CI, or secret path (for example `.claude/`, `.github/`,
`foundation.json`, `.env`) is recorded with `protected: true` and a path the
sandbox removed with `deleted: true`; Land lists both (paths only, never
contents) before it applies. Two cases remain agent repairs, each with a
concrete command: more than 100 such paths (`ignore-generated-output`, with
the `.gitignore` patterns that cover them, or an amendment if they are intended
work) and child-repository work in the root sandbox
(`move-to-repository-sandbox`). Build refuses a write inside another active
task's scope and names the contested paths and the task that owns them.

Lease recovery is harness work, not a user decision. An owner reacquiring its
own unreleased lease after the graph, contract, or `[paths:]` changed is
re-granted under a new fencing generation and keeps its original write
baseline, so earlier writes are still judged against the widened scope. A
lease past its TTL is released or taken over without `--force` or a decision
reference; only a live lease held by another worker needs one. `advance` settles
the session lease it holds even after its TTL. A shared `[resources:]` token
another active change holds is queued, not a repair or a question: `advance`
returns a harness-owned `WAIT` (`WAIT_RESOURCE`, code `LEASE_RESOURCE_HELD`)
naming the holder, and resumes once it lands, is abandoned, or its lease
expires. These waits never count toward the recovery ladder.

A force-released lease grants no result authority. If its task was already
checked complete, the planner returns it for leased verification without
rewriting the checkbox; only an accepted release clears that recovery.

An accepted task result binds that task's own authority: its node (text,
repository, paths, dependencies, schemas) and the claims it proves. An
amendment that leaves a task unchanged keeps its result; a rewritten task and
its dependants need verification. Results recorded before this binding keep
the whole-graph comparison they were written under. `advance` re-verifies a
checked task with a stale record itself, under a harness lease: its `verify`
check must pass, and work finished outside a lease is never split per task.
Only a task a live worker holds, a failing check, or one behind an unverified
dependency returns as an EDIT, listed under `reverification` with its cause as
implemented work to repair, not to redo.

When every pending Build task must run one at a time (a dependency chain or
overlapping paths) in one repository with no cross-repository claim or
external resource, `advance` hands all of them in one session EDIT, in
dependency order, with no lease. The next `advance` runs each handed task's
`verify`, ticks every passing task, records its result under a harness lease,
and returns an EDIT only for failed tasks (with `verificationFailures`) and
their dependents. A behavior task whose verify passed while nothing changed in
its declared `paths` is not ticked: its failure names the paths and the routes
forward (implement the change there, correct the paths with an `updateTasks`
amendment, or withdraw the task with `removeTasks`). Plans with a parallel wave, several repositories, or shared
external resources use native workers, but the harness still holds every
lease: `advance` acquires the group's leases, the parent only spawns one worker
per `execution.workers` entry and waits, and the next `advance` verifies, ticks,
releases, and scope-checks each task. No agent acquires, releases, or ticks.

Every completed task carries one kind of authority: a result the harness
recorded after the task's `verify` passed, bound to that task's own authority.
Planning records none. Older `single-agent-observed` and graph-v2 records stay
readable for in-flight changes only.

An upgrade from execution graph v2 preserves a completed multi-task
single-session Build only when the persisted plan still binds the same task
authority, claims, contract revision, and contract fingerprint. The current
proof records that compatibility witness without manufacturing lease results.
If the binding is absent, stale, or superseded by a force-released lease, the
planner returns only the affected completed task and its dependency descendants
to current leased verification without rewriting `tasks.md`; a packet already
complete at isolation keeps its independent proof route. This deterministic
recovery never asks the user for a semantic decision.

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
fall back to the live target. Each repository has one location: Build envelopes,
the phase guard, review finding binding (a finding named
`root/<submodule path>/<file>` binds to that repository), and Land all use its
repository sandbox. A declared repository's directory or gitlink in the root
workspace (missing, empty, or pointing at another commit) is that repository's
pointer, never a root change, so it is excluded from root review, proof
readiness, Apply, and replay.

Root code and tests still consume each declared nested repository through its
path under root, so the harness projects it into the root sandbox during Build
and Prove. A selected repository's path is a link to its repository sandbox,
which stays the single source of truth: root checks see its uncommitted work,
and an edit through either path lands in the repository sandbox. Any other
declared nested repository holds a detached checkout of the commit the root
gitlink records (a nested repository Git does not track: its target HEAD),
cloned from local objects only, even when the target never initialized that
submodule. That checkout is read-only: an edit or commit there would let a root
check pass on bytes no Land delivers, so the next check refuses until it is
reverted or the repository is selected through an amendment. The root index
keeps each gitlink at its recorded commit (`skip-worktree`), so projections never
enter root status, proof or review hashes, the changed surface, or Land. Sandbox
creation and repair, resume, sync, `exec`, task checks, and proof runs bring the
projections current; content found where a projection belongs is moved to
`.foundation/backups/<change>/`, never deleted. A copy-mode root sandbox that
carries Git is projected the same way.

`sandbox inspect <change>` reports missing, unexpected, missing-path, and
invalid-worktree records without executing a PATH-resolved Git command.
`sandbox create <change> --all` repairs missing bindings idempotently while
preserving valid worktrees. Repair or retire an incomplete repository selection
before resume; never prove a subset.

An in-contract defect is repaired without asking again. Only evidence that
changes locked behavior, compatibility, security, data, or rollout opens one
audited batched amendment. `advance` synchronizes any amended agreement or
moved target itself; the operator primitive behind it is:

```bash
claude-foundation sandbox sync <change>
```

Sync increments the agreement revision and invalidates proof that no longer
describes it. A worktree replay is prepared against the current target before
replacement; a multi-repository replay prepares every writable repository
before replacing any; a copy fast-forwards files only the target changed.
Double-edited files stop as named `CONFLICT` entries and leave the existing
sandbox intact and return to the agent as a repair: merge the target version
in the sandbox and resume. For a copy, `advance` settles a merged file itself
once a 3-way check against the copy's stored base bytes proves the target's edit
is in the merged copy and no conflict markers remain; a changed copy alone never
settles. `--resolve` remains the explicit operator form.

### Follow-up requests during an active Change

Treat a new user instruction as a product decision, not as a request for the
user to maintain OpenSpec. Before product mutation, the agent compares it with
the approved agreement and owns the resulting amendment, implementation, tests,
and documentation. The harness owns validation, revision state, invalidation,
evidence, recovery, and lifecycle progression. Ask the user only when material
product meaning or a trade-off remains unresolved; never ask them to author
amendment JSON, edit ledgers, or run routine recovery.

| Follow-up | Route |
|---|---|
| Fix the approved color, button position, filter result, validation, API mapping, permission, or failure behavior | Repair in contract; no amendment |
| Choose a new color or location; add a filter, saved search, field, action, responsive state, accessibility outcome, or user-visible copy meaning | Amend before implementation |
| Add or change an API contract, stored-data rule, migration, role, security boundary, performance target, notification, retry, integration, external effect, compatibility, or rollout behavior | Amend before implementation |
| Add a regression test, documentation correction, or internal refactor without changing approved behavior | Implement in contract; no amendment |
| Change a test expectation or public documentation because intended behavior changed | Amend before implementation |
| Request “make it better” or similar wording with materially different valid outcomes | Ask only for the unresolved product choice |
| Add an independently deliverable objective, or request it after archive | Start a successor Change |

A clear instruction supplies the decision input, so do not ask the same question
again. An additive amendment carries the existing approval; only a removal
waits for approval. Report the product delta, not harness commands or machine
inputs. A new outcome
received during Prove returns through amendment and Build before selective proof
resumes. Any relevant product or agreement edit makes the affected proof stale.
A review or acceptance response for a superseded workspace is never recorded;
the harness re-requests that authority bound to the current workspace, spending
no review attempt until dispatch, and `advance` resumes from it.

Several changes may be active at once. Overlapping path or repository scopes
never block Build, Prove, or Land across changes; whichever lands later
synchronizes onto the moved target as above, resolves any double edit, and
re-proves. Only an explicit `[resources:]` token names a resource two changes
cannot use at once; the later change queues behind the holder as a harness
`WAIT` (above) rather than blocking.

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
A derived `test` provider runs the tasks' own `verify` commands, not the
project's whole suite; a project that wants its full suite as release evidence
runs it as a separate gate before release (this repository: `run-all.sh`), or
declares it as a provider in the change's `execution`.
Failed, missing, stale, erroneous, or inconclusive evidence remains visible as
assurance status. It blocks a `PROVEN` result, and Land refuses it: an explicit
`/land` proves the current workspace first and lands only once that proof
passes.

Composite identity binds repository content and agreement revision rather than
Git commit identity. Recorded base heads remain explicit recovery and Land
state: an unsynchronized target still stops, while moving to a history-only
commit with byte-identical content does not charge another review.

A provider that executed and failed has three honest exits:

- fix the cause and rerun;
- rewire the provider in `execution.yaml`;
- withdraw the capability under a recorded decision with `change waive`.

A waiver withdraws the whole capability. `change waive` refuses a waiver that
would leave no required provider, since a proof without receipts reports
`missing-receipt-manifest` and Land refuses it; Prove likewise never finalizes
such a proof and names that cause instead of reporting `PROVEN`.

Resuming unchanged is not one of them. A harness-executed provider that failed
and then passes on byte-identical inputs is recorded as a flake: the receipt
stays `fail` with `flake` evidence (the first failure and the observed pass), so
the claim needs a repair, and only a pass on changed content is proof again.

A waiver removes the capability from the required set while the claim continues
to declare it. It remains visible as `user-waived`, preserves receipts already
earned, and can be revoked. There is no route that turns failed evidence into a
pass or lands it silently. Review may use the same explicit waiver route;
acceptance retains its explicit withdrawal route. New waivers bind the current
workspace and contract revision. Changed content expires them; original failed
receipts remain available and proof names the accepted exceptions.

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
semantic progress identity changes. A coding gate that returns the same
findings for unchanged inputs returns an `AUTO_REPAIR` whose next step is a
`change-strategy` repair carrying those findings, not a user question. Two
unchanged automated transitions hand the stuck step to the agent as a
no-progress repair carrying what the step returned. Repeated rounds follow the
[recovery ladder](#recovery-and-user-decisions).

Harness automation that cannot finish is handed to the agent rather than
stopping the flow: a failed sandbox setup or OpenSpec preparation returns an
agent `REPAIR` with `recovery.type: HANDOFF` and a `handoff` naming the step,
its exact command, working directory, and output. The agent finishes the step
(or fixes its declared setup) and resumes. Thrown Build, Prove, or Land
dependencies are captured in the same action envelope with their original
reason and exact recovery route. User decisions
([blocking policy](#blocking-policy)), external waits, resource waits,
conflicts, and repeated no-progress preserve state.
`proof readiness`, `proof advance`, `proof run`, and direct authority commands
remain diagnostic or integration primitives behind `advance`.

### `/land <change>`

`/land` runs the same route `/dev` uses:

```bash
claude-foundation advance <change> --through archived
```

This explicit invocation supplies Land authority. Any other explicit user
instruction to land, in any wording (for example "land it when proven" in a
`/dev` request), supplies it too. Silence never does. `land advance` remains
only as an alias of `advance <change> --through archived`; it issues no grant of
its own, and the phase guard rewrites it to that route.

Land is the single hard gate ([blocking policy](#blocking-policy)). It refuses
until the spec approval is still valid (checked again even when a grant
exists), the lifecycle is `proven` (or `applied` during recovery), assurance
passed, and the proof's workspace hash equals the current workspace hash.
There is no unproven or risk-accepted Land: on a refusal, `advance <change>
--through archived` proves the current workspace and returns to Land. A change
still in `change` or `building` never moves to `applied` or `archived`
directly; a legacy `landing` status reads as `proven` with every gate in force.
When Prove recorded protected-path edits or deletions, the Land output lists
`protected paths changed` and `paths deleted` (paths only), and the grant
carries the same `surface`.
Tests and checks run only inside the returned workspace, never in the main
checkout. If Land's apply conflicts with target files that are regenerable
artifacts (for example `__pycache__/*.pyc`) and were clean at isolation,
Land restores them to the sandbox base itself and continues. Any other
conflicting target edit is kept and carried into the change (below); discarding
it instead is the user's decision, recorded with `advance <change> --through
archived --restore-target <paths> --decision-ref <user-decision>`, and a file
changed after the restore was recorded is never overwritten.
Land has one user-visible
goal: place the exact current workspace projection in the declared main
workspace. The Harness binds a resumable grant to the exact change and its
agreement, contract, and execution revisions, the current workspace hash, the
passing proof run and its workspace hash, the repository graph, the target
roots and base heads, and the issuing session, then owns
checking, Apply, verification, semantic spec
synchronization, archival, recovery, and cleanup as internal checkpoints. It
finishes only at `archived`; `proven` is not completion.

After the merged specs verify, archive appends the volatile records to the
archived `proposal.md` only: Appendix: Review record (review rounds and
findings), Appendix: Compliance change record (the draft's `compliance`
requester, approver, implementer, approval before Build or emergency with
retrospective approval, plus the spec-approval decision; only when
`openspec/config.yaml` sets `compliance: change-record`), and Appendix: Rollout
gates (deferred post-release capabilities). A draft's `compliance` block is
validated at Change (approver differs from implementer; `approvedBefore:
"build"` unless `emergency: true` with a `retrospectiveApproval`). A
resumed Land restores the archived proposal to its pre-append bytes and appends
the same text, so the record is written once.

Apply is a journaled transaction over the target. An interruption is recovered
and resumed by the Harness through the same `/land` invocation. Restore,
keep-current, journal, check, resume, and archive mechanics are not separate
user operations. The Harness settles an interrupted apply itself when doing so
cannot lose bytes: it finishes or reverses only content Land wrote, and when the
target holds other content it keeps the current target, synchronizes the sandbox
onto it, and proves again. The agent receives the divergent paths as a notice;
if automatic recovery cannot finish, the agent gets a repair with the transaction
location, not the user. Restoring the recorded backup over divergent content is
never automatic; a user who wants it records it through the same route,
`advance <change> --through archived --recover-apply restore-backup
--decision-ref <user-decision>`, which settles the journal and continues Land.

Uncommitted target edits that Land would overwrite are kept, never committed or
discarded automatically. An edit on other lines than the change is merged by the
harness (`target-edit-sync`, automatic): a 3-way merge into the sandbox copy,
Prove again for what it invalidated, then Apply; the target keeps the user's
bytes until then. Only an edit of the same lines is a `target-edit-conflict`:
the agent merges it into the sandbox copy, and Land applies the merged file once
merging the target edit into it changes nothing. The same holds when sandbox
work proven after an earlier apply re-applies: a path that apply never wrote
must still be at the sandbox base or already hold the sandbox bytes, and its
executable mode must match too (a user `chmod` is an edit), otherwise
its target edit takes this merge or decision route instead of being
overwritten. For an isolated copy the base is the copy's recorded baseline
(content and executable bit) and the base bytes it stored for that path; the
merge, the carried check, and `--restore-target` use those bytes. A path the
baseline does not record counts as edited, and a path whose base bytes were
never stored stays a `target-edit-conflict` that cannot be restored. Edits made outside the sandbox
stop Land only on paths in this change's Land projection; others are reported.
Git-ignored files are no change's content: under each selected repository's own
ignore rules they are never compared, projected, or reported as target edits or
unlanded sandbox work. A tracked file stays content even when it matches an
ignore pattern.

When a single-repository Land changes the root `package.json` or a known
lockfile, the harness then installs dependencies in the target with the same
command the sandbox setup uses (`sandbox.setupCommand`, else the lockfile's
pinned install; `sandbox.installDependencies: false` without a setup command
opts out), so project commands in the checkout find the new dependencies. The
result is recorded in the Land journal. A failed install never rolls Land back:
it is recorded as `failed` and Land prints the command to run in the target.
Selected child repositories of a multi-repository change are not installed.

A multi-repository change whose selection has no writable root has no root
projection, so Land merges the tasks Build checked in the sandbox ledger into
the root `tasks.md` before archive. Only those checkboxes change; every other
line of the root packet stays the agreement as approved and amended.

An archived Land whose diff is still uncommitted is undone, on the user's
decision, with `advance <change> --undo-land --decision-ref <user-decision>`.
The harness returns every path Land wrote (code, synchronized specs, archived
packet) to its pre-Land bytes from the Land journal, retires the change, and
keeps the landed bytes and records under `.foundation/recovery/land-undone/`.
Undo retires rather than reopens the change (its runtime state and packet
leave the live stores), so it quarantines the same per-change bookkeeping
abandon does: review requests and reports, instruction manifests, the open
attestation challenge, and any delivery record, which is moved, never deleted.
`undo.json` lists what moved, an earlier undo's copy is set aside, and a later
change can reuse the id fresh.
It refuses without writing when HEAD moved since Land, a path Land wrote is
staged, or any such path changed after Land.

Land is always allowed for stacked changes. Because Land leaves its diff
uncommitted, a change that branched before another change landed meets that
landed diff in the target; nobody has to commit the first change before the
second one lands. A worktree sandbox, which starts from HEAD, carries every
file another change landed and left uncommitted when it is created and after
each sync, so Build and Prove run with that work; `sandbox create` and
`sandbox sync` name each carried path. Only bytes a Land journal still vouches
for are carried; a target file the user edited is not. While unchanged, carried
files are not the later change's contribution: they stay out of its task
paths, review, diff identity, replay, and Apply. The harness treats the earlier landed bytes as part of the
target: paths the later change left alone land beside it untouched, and for a
path both changed it replays the landed edit into the later change's sandbox
copy (a 3-way merge), proves again only what that invalidated, and applies.
When both rewrote the same lines, the later change's agent merges them in its
sandbox copy, keeping the landed content; that edit is the resolution unless it drops
landed edits, which keeps the conflict with the agent. Earlier
landed bytes are never restored over or offered for discard, and the user is
asked only when the two changes' intents genuinely contradict. Each change
archives in Land order, so OpenSpec merges each change's spec delta onto the
specs the earlier Land already synchronized.

The projection is confined to Git-tracked files plus paths declared in
`tasks.md`. An untracked path no task names is neither evidence surface nor a
Land deletion. A target path is deleted only when the authorized sandbox removed
it. Conflicts never overwrite unrelated target edits.

Every writable selected repository is prepared before the first target write
and then applied in dependency order with durable per-repository checkpoints.
Each target finishes `applied-uncommitted`: its intended diff is visible for
the user to inspect, while Git HEAD and index remain unchanged. Read-only
repositories remain unchanged. Re-entering `/land` resumes the same grant and
skips already verified nodes; it never requires the user to assemble a journal,
grant, commit, recovery command, or archive command. A node counts as verified
only while its sandbox projection is unchanged: work committed or edited in a
repository sandbox or in the root sandbox after an earlier delivery is delivered
again on resume. A path that earlier delivery did not write is applied only
while the target still holds its base content (or already the sandbox's bytes),
so a target edit made since is never overwritten.

A declared nested repository's pointer (its gitlink) is never root content.
When the root sandbox moves one (committed or staged), Land stops before any
target write; the move is never dropped silently. For a repository the change
selects, this is an agent repair (`ROOT_POINTER_MOVED`): the agent brings the
commit into that repository's sandbox, restores the root pointer to its base,
and resumes; `/deliver` then sets the root pointer to the delivered commit. For
a repository the change does not select, selecting it widens scope, so the user
gets the `repository-pointer-change` decision: land the pointer through that
repository, restore the pointer and land the rest, or pause.

Before a multi-repository change is archived, Land reads each writable selected
repository's target checkout, not its own records: every path the repository
sandbox changed since its base (committed, uncommitted, or untracked) must hold
the sandbox's bytes in the target, the target must be a Git repository of its own
(an uninitialized submodule is not), and nothing may sit in the shared sandbox's
placeholder for a nested repository. Otherwise Land stops with
`LAND_PROJECTION_MISSING`, naming each repository and path; nothing is archived
and no sandbox is removed. A wrong target binding or placeholder work already
stops Land before Apply. Archive cleanup likewise keeps any sandbox whose bytes
the target does not hold, and backs up commits the target cannot reach, as for
abandon, before it removes a sandbox.

Before its first write, Land runs one preflight: readiness, then every refusal
Apply and repository delivery can already decide (moved target, target edits
to sync or reconcile, undeclared deletions, a broken repository binding), and
the spec-sync violations the current specs and the change delta already decide
(`SPEC_SYNC_VIOLATION`). The internal `land check` diagnostic runs that same
preflight without writing or recording anything, so it reports the code and
route Land would stop on instead of a readiness that Land then refuses.

Land never commits, and never implies permission to commit, push, publish,
deploy, or open a pull request. Commit and push happen only through `/deliver`
or the user's direct instruction
([authority from the user's words](#authority-from-the-users-words)).

### `/deliver <change>` (optional)

Deliver is an optional post-Land transaction. The normal change lifecycle is
still complete at `archived`; no delivery state, provider work, presentation
evidence, prompt, or gate exists unless the user explicitly invokes
`/deliver <change>` or directly asks to open a PR or deliver ("เปิด PR ให้เลย"),
which is the same invocation.

The agent runs one composition command, `claude-foundation deliver advance
<change>`, and executes its automatic recovery internally. The user never
assembles readiness, preparation, commit, push, provider, or resume commands.
Invoking `/deliver` on a proven change that is not yet archived is also the
user's Land authority: Deliver runs the normal `advance <change> --through
archived` route, which issues the Land grant under this invocation, and continues
delivery in the same call once the change is archived. A Land boundary on the
way (a real decision or an agent repair) is returned with the Deliver resume
route. Deliver lands only from `proven` or `applied`; when the proof has gone
stale since, that route proves the current workspace again before Land. A
change that is not proven yet is not landed; Deliver recommends finishing Build
and Prove first. The invocation grants only the authority to
Land, create an isolated feature branch, commit the proven Land projection,
push that branch, and open or reuse a pull request. It does not authorize
force-push, default-branch push, merge, deploy, publish, evidence disclosure to
a new store, or product edits. Deliver questions use the blocked-decision shape
(options with outcomes, a recommendation, and `pause`); only typed provider
failures (remote, credentials, push, or pull-request service) wait on the
repository operator.

The delivery commit subject and branch follow the project-owned `deliver`
settings in `foundation.json`. `commitSubject` (default `{commitType}: {title}`,
which yields `feat: <title>` or `fix: <title>`) and `branchPattern` (default
`change/{changeId}`) accept the placeholders `{changeId}`, `{title}`,
`{commitType}` (`feat` or `fix`), `{prType}` (the pull-request type, such as
`bug-fix`), and `{ticket}`. `{ticket}` is the first match of the optional
`ticketPattern` regular expression (its first capture group when it has one) in
the change id, then the archived title, why, and summary. For example,
`"commitSubject": "{commitType}({ticket}): {title}"`, `"branchPattern":
"feature/{ticket}-{title}"`, and `"ticketPattern": "[A-Z]+-\\d+"`. A pattern that
uses only `{changeId}` keeps its historical lowercase normalization; with any
other placeholder the literal text is kept as written, placeholder values are
slugged (except `{ticket}`, kept as matched), and the branch must pass `git
check-ref-format`. The subject must be one non-empty line of at most 180
characters. An unknown placeholder, an invalid pattern, a missing ticket, or an
invalid result is refused before any workspace, commit, or push exists, as a
`delivery-policy` wait that names the setting to correct. A review follow-up's
commit uses the same subject template; it still pushes to the branch of the
pull request it updates, and a delivery already under way keeps its checkpointed
branch. Pull-request titles are unchanged.

Deliver reconstructs the projection in a separate Git worktree, leaving the
user's checkout, HEAD, index, and unrelated edits unchanged. It binds durable
checkpoints to the archived change, proof run, target head, and Land projection.
Commits added on top of the Land base after Land do not stop delivery: the
branch is built from that base and the proven content is verified separately.
Only a history that no longer contains the base (reset or rebase) asks the user.
After interruption it reconciles the local commit, remote branch, and provider
state before taking the next missing action. A repeated invocation verifies and
returns the existing pull request rather than creating another.

A review follow-up updates the pull request it answers instead of opening a
second one. The follow-up change records the original delivery by citing that
pull request's URL in its proposal or design (for example "Address the
requested changes on <PR URL>"). Deliver binds only a URL that a verified
delivery receipt of another change in this project produced; an ordinary
related link never redirects publication. When exactly one such pull request is
cited and the provider reports it still open on its delivered branch and base,
Deliver builds the follow-up commit on that branch's current head, pushes it as
a fast-forward (never forced) to the same branch, and returns
`reached: pr-updated` with the updated URL. A closed or merged pull request, a
moved branch or base, or more than one cited delivery opens a new pull request
instead, and the result's `followUp.notice` says why. The binding is
checkpointed, so a resumed delivery never re-decides it. Re-running Deliver for
the original change afterwards still returns its pull request as reused: a head
at a commit that a recorded follow-up delivery built on the original commit
counts, and the result's `followedUpBy` names those changes. Any other head,
even one descending from the delivered commit, still fails verification.
Multi-repository deliveries do not bind follow-ups yet.

Before committing, Deliver verifies staged Git blobs against the retained Land
projection. Before publishing, it verifies the actual commit tree again, including
resumed commits and changes made by Git hooks. Changed bytes, file modes, missing
files, or additional paths block publication rather than inheriting old proof.
Drift inside the unpublished delivery workspace (an interrupted attempt or a
stray edit) is Harness-owned: Deliver rebuilds that workspace once from the Land
projection and resumes. Only drift that survives the rebuild, such as a commit
hook rewriting staged files, asks the user to fix the hook and retry or leave the
work archived. It fetches the proposed remote PR base on each unfinished attempt
and requires that base to contain the proven Land base. Target content, HEAD, or
PR-base drift asks the user to restore the proven content and retry Deliver, or
leave the work archived; it never asks for a new change. Independent sibling repositories
receive their own PRs; only declared submodules produce root gitlink updates.

Delivery protocol 2 binds file modes to Land and archive evidence. Legacy changes
without mode evidence stay archived and cannot use automatic Deliver. The agent
can review the current diff for separately authorized Git publication, or leave
the work archived; a no-op follow-up Change is not a migration route. Current
modes are never substituted for missing proof. Valid dangling symlinks retain
their link text. Built-in Git text/binary
conversion (including CRLF/LF) is bound to the proven bytes and verified as Git
objects; a changed conversion configuration stops with a retry route. Custom
clean filters (including LFS) and working-tree encodings currently return an
explicit unsupported-conversion boundary before staging, without executing the
filter. Keep those project settings intact and choose separately reviewed Git
publication or leave the work archived. For an interrupted supported conversion,
restore the bound configuration to resume.
Effective push URLs, including rewrites and multiple destinations, must all
identify the approved repository. They are checkpoint-bound and rechecked before
push. Multi-repository Deliver validates all selected projections and destinations
before the first publication. The live remote default branch and the selected
PR base are both protected.

The PR body has one core contract—Summary, Why, Related Work, Type, included and
excluded Scope, Test and Evidence, Risk, Rollback, and Monitoring—plus the
applicable Frontend, Backend, Bug, Refactor/Technical Debt, Database/Migration,
Infrastructure/DevOps, Performance, or Security/Hotfix sections. Deliver reuses
content-bound proof receipts and archived OpenSpec sources. It may collect only
read-only presentation evidence; it never invents evidence or changes code. A
missing optional presentation artifact produces a draft according to project
policy, while missing or stale required evidence blocks Deliver without
changing the already-archived lifecycle result.

Success requires provider read-back proving that the open PR's base, head, and
commit match the delivery receipt. The final user-facing result is the verified
PR URL. Decisions remain with the user, semantic implementation and bounded
narrative work with the agent, and deterministic Git/provider orchestration,
retry, and recovery with the Harness.

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
- the harness derives impact and coupling from the draft and never lowers
  them: tasks spanning two `services/`, `packages/`, `apps/`, `libs/`, or
  `modules/` roots, several repositories, integrations, or external operations
  are coupled; persistence paths (`*.sql`, `migrations/`, `db/`, `schema/`),
  API/async work types, and (without a declared `workType`) requirement text
  naming migrations, rollbacks, databases, APIs, endpoints, payloads, or
  event/message contracts are at least medium. An omitted or lower declaration
  is raised, and the proposal Impact section names the reason;
- no semantic security or irreversible-effect trigger applies;
- unit or static evidence is sufficient;
- a semantic draft authors no design content (file map, UI states, failure
  matrix, user decisions or answered intake choices, assumptions, risks); such a
  draft compiles as standard so that content is kept. Agent defaults
  (`decidedBy: agent`, the minimal-draft default) stay rapid.

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

The change's work types add capabilities that paths cannot reveal (for example
`ml` → `evaluation`, `migration` → `parity`, `infra` → `plan-check` and
`deployment`). Wiring a missing provider for one is agent work (a project-owned
command in `execution.yaml`; `evidence init <change> --write` detects one), never
a user question. Post-release capabilities (`release-health`,
`experiment-guardrail`) are deferred rollout gates listed in the archived
proposal; they never block proof or Land. The mapping and adapters are in
[EVIDENCE.md](.claude/harness/EVIDENCE.md#work-type-capabilities).

Consumer quality is opt-in (`quality.changeGate` defaults to `off`) through
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
For human review and acceptance, the user decides the concrete verdict; the
agent records that confirmed decision and resumes. Human decision ownership
does not require human CLI execution. Command permission alone is not a review
verdict. The host approval and denial handling procedure is in
`.claude/commands/references/decision-policy.md`.
Genuine decisions present honest
choices, including reject, inconclusive, or pause; they never contain a
preselected passing receipt.

## Review, acceptance, and external authority

Review is bounded by its rounds (one full review, then one changed delta), not
by elapsed time: the agent's repair between rounds and reviewer retries never
spend a user-facing budget. Each dispatch has its own 30-minute timeout, and an
expired dispatch is a reviewer infrastructure failure, not a user question.
`change resolve --continue-review` is still accepted and changes nothing.
Timeout is not a pass. Try repair first; if it cannot progress, explain the
attempted remedies and offer further work before Land. Conflicts, incomplete Apply, and missing side-effect authority
still require their actual resolution, never a claim of successful delivery.

Under `workflow.reviewPolicy: "risk-tiered"` every change receives review, with
the correction circuit bounded by risk; `RESOLVED` prints the route, such as
`review: risk-tiered AI review (low tier, fast model)`. The one exception is a
`foundation-rapid` change at the low tier that nothing asks to review (no
declared or keyword security trigger, `--review`, `riskSignals`, review
capability, or required/diversity trigger): it is proven by the project's
deterministic evidence alone, no reviewer runs, and `RESOLVED` prints
`review: not required (rapid lane, low tier: deterministic evidence only)`. The
tier is recomputed from the built diff at every Prove, so an inferred security
or contract capability restores review.
Under legacy policy it prints `required` or
`not required (legacy review policy: no AI review runs)`. The review reads the change's diff and
the agreement's requirements, not whole files. Low risk runs one diff-only
review on the fast model tier at medium effort (`review.lowRiskModel:
"configured"` or a reviewer `fastModelId` overrides it). The first medium round
deliberately runs on a faster standard model (a speed/depth trade-off:
the reviewer's `standardModelId`, else the `models.standard.family` alias) at the
configured effort, unless the change carries a security or required-review
trigger or a declared review, which keep the configured model. High and every
later round keep the configured model at high effort. A team pins the strong model
for medium or picks another class with `review.modelByTier` (`low` and `medium`
to `fast|standard|configured`; `high` is not configurable; unknown values fall
back to the configured model). Every full round receives the agreement's scenario checklist and must
report each scenario as covered, missing, or unsure; a missing scenario becomes
a blocking finding that goes straight to repair. If a fast or standard first round is
only unsure of a scenario or its coverage is unreadable, the harness re-runs
that review once on the configured model without consuming a review round. Security triggers are declared (draft `securityTriggers` or
`resolve --security`) or inferred from intent keywords: declared triggers
select the standard lane and security evidence, while an intent keyword alone
only makes review required at the low tier and the change keeps its lane. A
draft's `riskSignals` raise the tier too: `access-control` and `financial` to
high (and they make review required under either policy), `input-domain` to at
least medium. A review finding may carry a kebab-case `code` (at most 64
characters); a malformed code is dropped and the attempt is still recorded.

- **low** — one full AI review; a material correction promotes the route to
  medium;
- **medium** — one full AI review, one correction batch, and at most one fresh
  delta review closing the first-round finding IDs;
- **high** — material risks are settled in the initial Decision Sheet, followed
  by one full AI review and at most one post-correction delta.

A delta review that no longer reports an earlier finding closes it. When a
repaired final finding has no declared critical case to bind and current checks
pass, Prove stops at the review-exhausted user decision (a human verdict, one
more AI wave, a revised agreement, or pause); it never returns an unsatisfiable
repair.

When every routed AI wave is delivered and a review request still needs a
verdict, `advance` returns `ASK_USER` with kind `review-exhausted` instead of a
wait. Its options are `human-verdict` (dispatch the request to a named person
with `authority dispatch --reviewer-type human`, then `authority record` the
verdict that person gave), `one-more-ai-attempt`
(`authority extend-review <change> --decision-ref <user-decision>` allows
exactly one wave beyond those delivered; each decision reference grants one,
and `advance` then runs it), and `pause`. Exhausted review is never waived.
A request that no configured reviewer can start keeps the `WAIT` for an
external verdict.

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
Deleting or renaming state cannot reset the limit. Neither can moving the
recorded head and count back together to an earlier valid record: an attempt
record above the recorded head marks the chain lowered, except the one
in-flight record at head+1 that links to the head (attempts are written before
the head moves, so a crash can leave it). A corrupt or lowered attempt chain is
harness bookkeeping, not a user decision: the harness moves it aside as
`review-attempts.corrupt-<stamp>` (never deleted, with a recovery manifest),
rebuilds it, and reports a `review-history-recovered` signal. The rebuild is
fail-closed: the attempt count never falls below what the runtime history, any
record or file name, or a legacy receipt evidences; a verdict is reused only
when its whole chain verifies and covers every evidenced attempt; otherwise
the unverifiable attempts count as delivered inconclusive AI waves, which
consumes the budget through the ordinary review-exhausted route.

Human acceptance is separate from review. Every new standard change explicitly
records whether subjective acceptance is required; `undecided` blocks
validation. Required acceptance binds named claims, nonblank criteria, human
identity, observation, provenance, durable evidence, and the final workspace.
The runtime never invokes a human, impersonates one, or manufactures approval.

`handoffs.yaml` owns external operations. Pending handoffs do not block Build or
evidence collection ([blocking policy](#blocking-policy)). Land blocks unresolved pre-Land or activation-coupled
operations. A declared post-Land operation does not require acknowledgement when
a claim proves the merged artifact is safe before activation; the archived
change preserves that operational obligation independently of `tasks.md`.
Acknowledgements, terminal outcomes, tickets, and evidence references are
optional operational records—never credentials. Archive means the code change
was delivered, not that deployment, activation, or production verification ran.

<a id="terminal-stops"></a>

## Recovery and user decisions

Some guards end a run rather than returning another repair action: exhausted AI
review waves, a moved control repository during
multi-repository Land, reset staged submodule pointers, or an apply rollback
that could not complete.

Each stop preserves the change and returns a decision envelope with a typed
code, at least two honest options, a recommendation, and an exact resume route.
When `automaticRecovery` is marked, the known typed recovery is performed by
the harness and explained by the agent without opening a user interview. The
coordinator executes sandbox sync and resumes the original target; a conflicting
sync preserves the work and returns the conflicting paths to the agent as a
repair, and the user is asked only when the intended result is unclear. Other
options are translated into the user's language; the agent never treats a stop as a dead
end or infers authority. A moved target base is replayed, never answered with a
recreated sandbox or a retired change. Retiring with `change abandon` is offered
only where the work itself cannot continue.

Advance protocol 6 retains the existing actions and command routes. Recovery
observations and answers live in `advanceRecovery` on the existing runtime
record. The ladder has three rungs: the first unchanged repair handoff is the
owner's repair, the second returns one agent-owned `REPAIR`
(`TRY_ALTERNATE_APPROACH`) asking for a materially different approach inside the
approved agreement, and the third returns a `REPAIR` (`NO_PROGRESS_BOUNDARY`)
to the original owner, agent or harness, never the user. It carries
`repetition` (rounds, first and last observation, and the output that kept
repeating), `attemptedStrategies`, and an instruction naming the different
approaches to choose from; `repetition.rounds` keeps counting until the
delivery state changes. Only a boundary the user owns
([blocking policy](#blocking-policy): user or Land authority, spec approval,
an external side effect, product meaning, budget or spend) becomes an
`ASK_USER` at the third rung, with that evidence in `decision.repetition`.
Two unchanged internal
automated transitions, a sandbox sync conflict, and a Build task verify that
keeps failing with identical output (durations and timestamps ignored) follow
the same ladder. New process sessions, proof run IDs, diagnostic wording, retry
counters and bookkeeping revisions do not reset progress. Relevant content,
agreement, execution policy, a different verify output, or actual delivery
changes do. Read-only inspection never counts as a repair attempt or records an
answer.

Causes only the user can clear skip the ladder and return `ASK_USER`
(`USER_ENVIRONMENT_REQUIRED`, boundary `user-environment`) on the first
observation: a missing or expired credential or token, VPN, proxy or network
denial, a reviewer CLI that is not logged in, a full disk (`ENOSPC`), private
registry authentication, or a Git remote that rejects the credential (for
example a push `403`). `decision.category` types the boundary as `resource`,
`credential`, or `network`, and `decision.cause` names it. Causes are
classified where the failure is raised, so inspection and every route agree:
typed error codes first, then known signatures in child-process output, on
harness, setup, delivery, and reviewer routes. A full disk is recognized on
every route, while credential or network words inside failing product output
remain a product repair, and a bare local process timeout (`ETIMEDOUT` from a
spawn) is not a network cause. The question names the fix (for example "run
`claude /login`" or "free disk space") and the resume command, and carries no
agent repair instruction; nothing is counted, and an uncleared cause is
reported again the same way. `deliver advance` uses the same classifier and
decision shape; a remaining provider failure is the repository operator's
`WAIT` with an explicit `wait.condition` and `wait.checkCommand`.

Signals the agent must act on that do not change the action ride on the same
envelope as optional `signals[]` entries (`{code, message}`), in addition to
their unchanged stderr or stdout line: `agreement-restored` (an isolated
agreement edit was restored and saved aside for an amendment),
`budget-warning` (spend reached 70% with `execution.budgetWatchdog` on),
`already-archived` (archive recovery found the change already archived),
`apply-recovered` (an interrupted apply was settled), and
`review-history-recovered` (a corrupt review attempt chain was rebuilt). The
field is absent when nothing was signalled.

No agent-facing route names a lifecycle primitive. Any `command`, `next`,
instruction, reason, or decision option that would point at `proof run|advance`,
`land check|advance`, `sandbox sync|create`, or `evidence init` is rewritten to
`advance <change>` with the route's target: proof primitives resume `--through
proven`, Land primitives `--through archived`, and sandbox primitives keep the
current target, so a rewrite never widens a route to Land. Two primitives that
needed a user answer are now advance decisions: an indeterminate provider run
(`DECIDE_INDETERMINATE_EXECUTION`, options `retry|pause`) whose `retry` answer
reaches the next proof run once, and an amended-agreement conflict
(`RESOLVE_AGREEMENT_CONFLICT`, options `merge|retain|pause`) whose answer
performs the resolving synchronization.

Every question offers concrete alternatives, a recommendation and pause, with
the cause and retained repair observations. External waiting is the default,
not a question: `WAIT` names the owner, condition and checking route, and the
agent reports it and resumes when the condition changes.
Live proof workers remain working;
a dead worker returns to harness-owned diagnosis. Resumable internal Land
checkpoints advance automatically while their state progresses.

A stopped configured reviewer returns the existing `authority run` handoff,
not a read-only status command. The agent executes that bounded recovery with the
original implementation provenance and resumes Prove. A valid checkpoint is
reused without another model call; absent results follow the existing attempt
and infrastructure limits. Live reviewer controllers are never dispatched twice.

The agent records an explicit recovery answer using the fingerprint returned
with the decision:

```bash
claude-foundation advance <change> --decision <offered-option> \
  --decision-fingerprint <hash> --decision-ref <user-answer> --reason <approach>
```

The offered options are `retry|wait|pause` for recovery decisions, and the
options listed by an advance decision such as `merge|retain|pause`. A Prove
gate's no-progress decision, raised only for a choice the user owns, is
answered the same way with any option it
offers; any answer but pause resumes that gate as a first observation, so it
returns the repair batch instead of the same question. A gate option that carries its own command
(such as one more AI wave with `authority extend-review`) keeps that command. The answer
retains the prior `--through` target. Retry records the chosen
approach; wait is available only for an external dependency; pause preserves
the work without running setup or providers again. A recorded pause projects
`WAIT` with user state `PAUSED`, not another question or a claim of active work.
Answers are content-bound,
stale fingerprints are refused, and repeated identical references do not grant
another retry allowance. Changed scope requires a new decision. These answers
do not grant Land, waive evidence, extend a model/review budget, or authorize
external side effects. Those decisions keep their existing explicit routes.
Users supply decisions, never flags or runtime JSON.

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

Across changes, `outcomes` and `lessons` are read-only, advisory projections:
they write nothing, never gate a change, and keep unknown values `null`.
`outcomes` reports first-proof pass, rework, recorded user decisions, cost, and
escaped defects declared through later changes' `fixes`, grouped by work type,
impact, and risk signals. `lessons` lists blocker and review finding codes that
recur across distinct changes with a suggested permanent check; adopting one is
an ordinary Change.

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

If OpenSpec moves the packet and the archive command is interrupted, an explicit
`advance --through archived` continuation verifies retained proof, the applied
projection at the relocated packet, the approved agreement, captured file modes,
and spec synchronization before completing cleanup. It does not require a new
Change or reconstruct the missing active packet. A recorded `archived` checkpoint
still undergoes the pending archive audit and cleanup before that continuation
reports success. Recovery consumes its Land grant; it does not grant Git or
publication authority. Legacy recovery without captured modes remains explicit
about unavailable mode evidence for optional Deliver.

Copy mode preserves symbolic links verbatim and rejects target paths changed
since its baseline. Generated, tool-owned directories are excluded only when
untracked; a committed fixture remains content regardless of its directory
name.

Multi-repository changes use one OpenSpec agreement and one declared topology.
A path outside the root needs `allowOutsideRoot: true`; its `type` may be `git`
(default) or `external`, which behave the same.
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
- 100%: every exhaustion opens one more window of the same size
  automatically, recorded as a harness decision
  (`harness://auto-extend/budget/1`) that does not use an operator-approved
  continuation. Budget is advisory and never asks the user while delivery
  progresses; three windows reopened without delivery progress (unchanged
  content and lifecycle state) return the `budget-no-progress` decision with
  the window evidence, and an answer starts a new count.

`budget continue` remains an optional, audited explicit widening; it never
deletes usage or lowers assurance.

`budget checkpoint` reports the measured remaining window, unfinished work, and
exact resume route. It never guesses future model demand.

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

Version pins: protocol `semanticDraftSchema` is 5 and the compiler accepts
draft v3, v4, and v5. The runtime API is unchanged, so an installed CLI keeps working with this runtime.

The harness guide also owns requirements and the canonical table of
`.foundation/` runtime records and working inputs. Generated records are
machine-maintained and ignored by Git; drafts, declared sandbox code, and the
optional local policy have explicit writer rules in that guide. This workflow
names them only where their lifecycle meaning matters.

## Quality invariants

- Zero discovered tests cannot silently pass.
- Missing expected evidence cannot silently pass.
- Browser capability mismatch is inconclusive.
- Mutation crash is not a behavioral kill.
- Missing, failed, inconclusive, invalid, or stale proof is preserved as Land
  assurance and cannot be misreported as passing.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive; the change is recorded
  `archived` only after the harness verifies the merged specs.
- Required assurance is never dropped because of size or budget.
- A delivery flow is complete only at `archived`.
