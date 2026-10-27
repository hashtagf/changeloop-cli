# Build operating policy

Before editing, including after a restart, read the full requirements and
scenarios for the returned tasks and their dependencies, plus relevant design
decisions, diagrams, folder mapping, and evidence obligations; a scenario
preview or hash is navigation, not the agreement. Follow truncated references
to their source; resolve missing or contradictory material through the
amendment/decision route. Preserve scope settled before this session.

Never ask the user to copy agreement
files between checkouts. Shell mutations run audited, not blocked: on
`TARGET_EDITED_OUTSIDE_SANDBOX` move your target edits into the sandbox.

## Follow-up intent gate

Classify every new user request received during an active Change against the
approved agreement before product mutation:

- If the agreement already requires the requested outcome, repair the
  implementation in contract without an amendment or another product decision.
- If the request adds or changes an observable outcome, author one batched
  semantic amendment and follow its harness-owned resume route before editing
  product code (an additive amendment keeps the approval; a removal asks). This
  includes UI, interaction, filter/search, validation, accessibility, API, data,
  permission, performance, integration, external-effect, compatibility, and
  rollout semantics, and revising or removing an existing requirement.
- If materially different interpretations remain, ask only for that unresolved
  product decision. Do not ask the user to write specs, tasks, amendment JSON,
  commands, tests, or recovery steps.
- If the active Change is archived or the request is an independently deliverable
  outcome, start a successor Change instead of rewriting history or widening the
  current agreement silently.

The user decides product intent and material trade-offs. The agent translates
that decision into the amendment, code, tests, and durable documentation. The
harness automates validation, revision state, invalidation, evidence execution,
recovery, and lifecycle progression. A clear user instruction is decision input;
do not ask the same semantic question again. Report only the product delta, not
its CLI or JSON.

| Request during an active Change | Classification |
|---|---|
| Apply the approved color, restore the specified button position, or fix the approved filter result | In-contract repair |
| New color, newly requested action location, filter, saved search, validation rule, responsive layout, or accessibility outcome | Semantic amendment |
| New or changed API field, permission, persistence/migration rule, performance target, notification, retry, external integration, or rollout behavior | Semantic amendment |
| Regression test or internal refactor preserving approved observable behavior | In-contract implementation work |
| Test expectation, public documentation, or UI copy changed because intended behavior changed | Semantic amendment |
| “Make it better”, “clean up the filters”, or another request with materially different valid outcomes | Ask only for the unresolved product choice |
| Separate feature after archive or an independently deliverable objective | Successor Change |

During Prove, an in-contract defect follows repair and selective re-proof. A new
user outcome returns through amendment and Build before Prove resumes. After any
product or agreement edit, never treat the prior proof as fresh.

## Workspace commands

Run `cd <workspace>` once as its own shell call; the shell keeps that
directory, and the live phase guard proves each mutating command from it
(hosts that report no shell directory need a `cd <workspace> &&` prefix). A
compound `cd … && …` costs a host approval prompt per call. It rejects absolute outside operands, later directory escapes,
symlink traversal, and copying or linking from outside the workspace. The
harness installs dependencies (setup command or lockfile install); finish a
handed-off failed install inside the workspace, never linking or copying the
checkout's `node_modules`. Fix an unfinished task's wrong verify with `change
amend <change> --task <task> --verify <command>`. Run returned long commands
and each task's `checkCommand` through `claude-foundation exec`, which starts Build children in the canonical
workspace (`--repo <id>` for a repository task's sandbox); time one only when its action requests observed execution. Use
Read/Edit/Write, not shell heredocs or scripts, to view or change files.

## Test and evidence

For defect guards, test adjacent input partitions and source-language coercion
boundaries before completing their tasks; do not stop at the reported repro.
For UI outcomes, check that the required value is rendered and reachable, not
only calculated. For evolving persisted or wire data, exercise the supported
older representation. Map required critical cases to claims and executable
observations through the agreement; discovered test tags alone do not add or
prove acceptance criteria.

Reuse an existing deterministic test command for every claim it actually
observes, including compatibility and validation claims; do not create a
bespoke evidence executable merely to give a capability its own command. If
no existing check can observe a claim, declare the new checker as product work
in `tasks.md`, test its success and failure paths, and keep those tests in the
normal quality run; an untested checker cannot be completion evidence.

## Convergent gates

For every Build gate, run all independent eligible checks before repair. Group
findings by root cause, build one dependency-ordered repair batch, apply every
safe in-contract fix, and rerun only failed, unavailable, downstream,
input-invalidated, or mandatory global checks. Continue without a repair-count
limit while the progress fingerprint changes.

At a user-decision boundary (WORKFLOW.md § Blocking policy), preserve the
sandbox, present the typed choices, and resume Build yourself; other boundaries
stay with their owner. Never turn repeated
execution or a stale receipt into a pass.
