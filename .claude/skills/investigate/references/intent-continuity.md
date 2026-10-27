# Intent continuity for Change investigations

For a feature, improvement, or bug, set v2 `purpose: "change"`; use
`research` for code-only questions. Summarize the user's intended outcome from
available messages and start independent source reads immediately. Explicit
instructions are requirements. Ask only for missing meaning that materially
changes the outcome; never require blanket confirmation or interpret silence as
agreement. Ask asynchronously when supported and keep unrelated work moving.

After each meaningful user or agent exchange, correction, evidence batch, and
before handoff, retain agreement-relevant requests, examples, constraints,
exceptions, non-goals, criteria, decisions, and questions in the same record.
Cite accessible messages in `conversation`; record unavailable history in
`historyGaps`. Preserve old events. Revise a requirement by appending a
revision and retiring only the conflicting revision with a reason and
`supersededBy`; keep unrelated requirements and answers. Reuse settled answers
on resume. The harness retains the last validated intake after invalid edits.
See the [record contract](../../../harness/README.md#investigation-intake-records).

With approved `--compare`, use a `mode: "compare"` record with three to five
options and create disposable alternatives only at their `prototypePaths` under
`.foundation/prototypes/<id>/`. Record the choice, reason, and every rejected
option in the record's `selection`. Do not edit product code or OpenSpec;
prototype output is never proof.

Separate user intent from source-grounded facts. Questions may be open-ended;
recommendations and alternatives are optional.
record materiality, dependencies, and independent work. Do not perform work
that depends on unanswered meaning. A nonmaterial question may travel as
disclosed context; unresolved material intent cannot silently become agreement.
Source, record, and report repair belongs to the agent or
harness.

Record each experiment's question, requirement revisions, criteria, findings,
and limitations. Recheck only experiments whose cited requirements changed;
preserve completed results and explicitly supersede them when repeating. Do
not force a PoC when available evidence settles feasibility.

Before Change, transfer the latest handoff and map each active material user
requirement through `investigationCoverage` to actual requirements/scenarios,
non-goals, or design decisions. Confirm examples, criteria, answers,
corrections, and experiment limits survived compilation. A missing mapping or
detail is drafting work; repair it without asking the user to repeat a settled
decision.
