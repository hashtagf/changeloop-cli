# Change workflow

Before drafting, reconcile all available conversation context relevant to this
intent, including earlier constraints, examples, corrections, investigation
conclusions, and selected prototypes. The latest explicit correction supersedes
the earlier choice; retain earlier requirements that it did not change. Separate
confirmed decisions from proposals, rejected alternatives, and unresolved
choices. Do not turn an assistant suggestion or user silence into agreement.
Use retained project notes for unavailable sessions; never claim to have read
missing conversation history. Ask only for material gaps that cannot be recovered.

Read the smallest canonical sources that settle the requested behavior:
existing OpenSpec requirements, relevant code/tests, architecture decisions,
prototype selection, and versioned integration documentation. Reuse settled answers without asking them again.
Ask every unresolved material behavior, compatibility, security,
migration, rollout, or authority choice in one batch; do not create an interview
ledger.

## Agreement detail and language

Write agent-authored document prose in the user's requested document language;
otherwise use the language of their current request. This applies to proposal
text, requirements, scenario descriptions and outcomes, tasks, evidence
descriptions, and any design rationale, including new prose in amendments.
An English template or existing repository does not override that default.
Preserve schema keys, enums, IDs, paths, commands, code identifiers, and
parser-required headings/markers such as `Requirement:`, `Scenario:`,
`WHEN`, `THEN`, and `SHALL`. Preserve canonical requirement/scenario names
and unchanged text when modifying an existing spec; do not rename identities
or translate unrelated documents. If a mixed-language request leaves the
preference unclear, follow the surrounding conversation.

For each non-English requirement, supply `description` as the complete
requirement statement in the document language, retaining the `SHALL` marker
(for example, `ระบบ SHALL ปฏิเสธคำขอที่ไม่มีสิทธิ์`). Keep `outcome` as the
observable result. Without `description`, the compiler prefixes the outcome
with the English stem `The system SHALL`; translating only `outcome` leaves
a mixed-language statement. `requirement`/`title` names the requirement,
not its statement.

Keep bookkeeping compact, but make the agreement understandable without chat
history. Before compiling, cover the following with facts from the canonical
sources and the user's settled intent:

- In `why`, explain the current behavior, concrete problem, affected actor or
  system, and desired result. Use `changes` for observable before/after behavior
  and affected surfaces, and `nonGoals` for meaningful scope exclusions.
- Give each requirement a bounded outcome. Scenarios identify the triggering
  input or precondition and a result that can be checked; cover the main path
  and relevant failure, boundary, permission, or compatibility cases. Do not
  substitute "works correctly" or an implementation step for observable behavior.
- Tasks name implementation outcomes and affected paths, link requirement
  coverage, and name verification that can detect a violation. Evidence should
  explain what establishes the claim; running a command alone is not acceptance.
- Record material assumptions, constraints, tradeoffs, and compatibility or
  migration consequences in the existing proposal/scenarios or qualifying typed
  extensions. Resolve discoverable facts yourself; ask only for unresolved
  material choices. Do not invent decisions or facts to fill a section.

Scale detail to behavior and risk, not word count or a fixed number of
scenarios. A small change can be brief if its boundaries and acceptance are
clear. Do not create extra artifacts merely to make the packet look thorough.

For changes across components, supply a diagram explaining the affected
boundaries and dependencies. For changed state, async, or workflow behavior,
show the relevant transitions or sequence, including failure/recovery paths.
For added or moved structure, put an affected folder tree and a mapping of
path, responsibility, intended change, requirement/task, and verification in
`currentState` with `design: true`; the compiler carries this Markdown into
`design.md`. Distinguish existing paths from proposed paths. Use `diagrams` for
Mermaid or local image references. Omit unrelated folders and diagrams that add
no implementation constraint; rapid work need not create an empty design.

## Compile and inspect

Create one semantic draft v3 from `change start --template`. Its core is:
`intent`, semantic `requirements`, implementation `tasks` with `covers`, and
evidence capabilities keyed by requirement. Put only real complexity in typed
extensions:

- `decisions` only for choices hard to reverse, surprising without context,
  and selected among meaningful alternatives;
- `diagrams` for Mermaid or referenced SVG/PNG contracts;
- `prototypeSelection` for an existing selection note (never prototype code or
  prototype output as proof);
- `integrations` with documentation source/version, linked requirements, and
  security/resilience/compatibility concerns;
- repositories only for multi-repository work;
- external operations only for permission-bound work;
- Grounding v3 only for non-derived material decisions.

Local diagram, prototype-selection, and integration references must resolve to
regular files inside the project; reject directories and escaping symlinks.
Remote integration sources must use HTTPS and name a fixed version rather than
`latest` or a branch.

Create no decision-tree or interview ledger. Never create `CONTEXT.md`, a glossary artifact, or an ADR store;
durable terms and choices belong in the
compiled packet. Always hash reads in `grounding.yaml` when a material decision
needs a grounding read; do not create an empty file.

Compare canonical requirements before choosing `ADDED`, `MODIFIED`, or
`REMOVED`. Do not default to `ADDED`. For `MODIFIED`, copy the complete
requirement and every existing scenario; for `REMOVED`, include a
`**Migration:**` or `**Compatibility:**` consequence. Do not guess
upstream API behavior when documentation or version is missing—return a research
or user-decision boundary.

For defect behavior, include adjacent input partitions and source-language representation/coercion boundaries,
not only the reported reproduction.

Write the draft to `.foundation/drafts/<id>.json` and run
`claude-foundation change start .foundation/drafts/<id>.json --consume-draft`.
Never inspect managed `.claude/harness/**` merely to reconstruct this schema.
The compiler owns classification, stable requirement/claim/task IDs,
cross-links, conditional artifacts, versioned defaults, structural validation,
and rollback. The first Build `advance` owns idempotent sandbox creation and
setup. Repair only the draft fields it reports, as one
batch, then retry. Never patch a partially generated packet or create parallel
IDs by hand.

If Build discovers new observable behavior, create a semantic amendment v1 and
run `change amend <change> <amendment.json> --consume-amendment`. It preserves
completed tasks and custom prose/assets, increments the revision, invalidates
the affected contract, validates, and rolls back on failure. Existing legacy
changes keep their legacy authoring path; do not rewrite them merely to migrate.
`updateTasks` may extend claim coverage but must not replace an existing outcome
or verification command; add a new task when that contract changes.

After a successful start, read the compiled proposal, tasks, evidence, and any
specs/design. Check that the intended detail and document language survived
compilation, and that the packet alone explains scope and acceptance.
Reconcile each confirmed conversation requirement and constraint against its
compiled requirement/scenario, proposal exclusion, or design decision. Report
any uncovered material point before approval; keep this reconciliation in the
existing packet and approval summary, not a separate conversation ledger.
Structural validation does not establish semantic completeness. If material
content is missing, repair through the supported draft/amendment workflow;
never patch generated ledgers independently or silently proceed to Build.

The compiled `openspec/changes/<id>/` documents—not the temporary draft or
`.foundation` state—are the source of truth. Never create product code during
Change. After successful validation, present the compiled packet links, scope,
behavior, and acceptance criteria to the user. Wait for explicit approval of
this spec before Build, including `/dev`; validation is not user approval.
Record the answer with `claude-foundation change resolve <id> --approve-spec
--decision-ref <user-decision>`, then continue with
`claude-foundation advance <id> --through build`. A changed agreement requires
fresh approval; task checkboxes alone do not. At a real decision,
authority, resource, contradiction, or repeated no-progress boundary, preserve
the draft, present supported alternatives and the exact resume route. The agent
must never retire one unasked or infer acceptance from silence.
Optional audit warnings are advisory and do not invent missing grounding.
