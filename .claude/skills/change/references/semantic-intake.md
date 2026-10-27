# Semantic intake

The harness owns required coverage, validation, state, and the next action. The
agent owns source interpretation and semantic authoring. The user owns
consequential choices and compiled-spec approval.

Resolve facts from the smallest relevant code, specifications, tests, and
versioned documentation. Never ask the user for a source-owned fact. When more
than one material interpretation remains, use `brainstorming`'s private
dependency tree. Ask only the current frontier in bounded rounds, carrying one
recommended answer per decision; recompute the frontier after every answer.
Keep the tree private: no interview ledger, one agreement approval after the
frontier closes.
For intake intelligence see
[semantic-intelligence.md](semantic-intelligence.md).

`change start <draft.json>` inspects before compiling and returns one typed
action: agent-owned `EDIT` for source investigation or draft
repair, user-owned `ASK_USER` for at most three dependency-ready consequential
decisions, or harness-owned `DONE` when compilation may start. Follow its
`resume` route after updating the same draft. Every `needs-user-decision` row
must name its related decisions in `decisionKeys`; missing or unknown links are
draft errors. A recorded `choice` settles its linked rows.
Inspection keeps one machine-owned snapshot binding the draft and
grounded-source digests. Changed sources invalidate `DONE` and return
`refresh-source-coverage`; editing the draft acknowledges them. No answer
history is retained.

Draft v4 and v5 `discovery.coverage` is optional for an ordinary change. Only typed
declarations require dimensions: `impact: high` (nine core plus operability and
recoverability), `riskSignals`, security triggers, `integrations`, and
`externalOperations`. The harness derives a marked `covered` row from content
that states it: `currentState`, `userStories`, requirements, scenario `kind`
(`success`, `failure`, `boundary`), `compatibility`, `nonGoals`, tasks with
`verify` and evidence, `dataModel`, `uiStates`, `jobContract`, `integrations`.
Author a row only for the rest; an authored row wins. A row is `covered`,
`not-applicable` (with rationale), `needs-investigation`, or
`needs-user-decision`; never turn an unresolved status into an assumption.
Missing dimensions, unknown links, and decision cycles are rejected. Without
`status`, only a `choice` settles a decision. Declare known concerns as `riskSignals`:
`access-control`, `persisted-data-change`, `external-integration`,
`performance-slo`, `user-interface`, `high-operational-risk`,
`external-side-effect`, `financial`, or `input-domain` (caller-supplied values).
Prose is never scanned for risk keywords.

Every settled answer must land in a requirement, scenario, non-goal, constraint,
or qualifying typed decision before compilation. The compiled proposal retains
the coverage table so no answer lives only in chat. Draft v3 stays readable;
do not retrofit legacy changes merely to migrate.
A v4/v5 Build-time amendment supplies a discovery delta for its added
requirements; the harness revalidates it and appends it to the proposal.
