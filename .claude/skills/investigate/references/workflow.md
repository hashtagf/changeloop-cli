# Investigate workflow

The harness owns boundaries, persistence, and resume routing.
Separate facts, hypotheses, options, tradeoffs, and unknowns. Resolve source-owned
facts; ask users only for consequential choices evidence cannot settle.
For features, bugs, improvements, or PoCs, read [intent continuity](intent-continuity.md);
see the [record contract](../../../harness/README.md#investigation-intake-records).

Start with `claude-foundation investigate --template`; keep the record at
`openspec/investigations/<id>.json`. After each evidence batch run
`claude-foundation investigate <record.json>`. Sources are hashed; facts cite
them. Set status only for `not-worth-changing`; the harness derives the rest.
Follow `EDIT`, `ASK_USER`, or `DONE` and its resume route. For Change, copy
`handoff` into draft `investigation`, reject stale bindings, and map material
requirements through `investigationCoverage`. Reporting never starts Change.

For Build/Prove, set `activeChange`; follow the
[workspace-binding contract](../../../../WORKFLOW.md#investigate-problem).

Write in the user's language (`language: "th"` selects Thai headings). The harness
generates `openspec/investigations/<id>.report.md` after each batch. Link it with
a conclusion; retain JSON for handoff and resume report failures without
repeating research.
Do not use generated reports as sources.

Without comparison, agent writes are the record and an optional authored note;
the harness owns the generated report. Preserve `<id>.md` notes. With
approved `--compare`, alternatives are only under
`.foundation/prototypes/<id>/`; follow the comparison rules in intent continuity.
Do not edit product code or OpenSpec. Prototype output is never proof.

Continue while evidence changes the result. At real boundaries or repeated
no-progress, preserve findings and exact resume routes.
