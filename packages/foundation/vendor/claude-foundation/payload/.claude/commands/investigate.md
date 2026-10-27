---
description: Explore a problem or bounded alternatives without committing.
argument-hint: <problem or decision> [--compare]
---

Investigate **$ARGUMENTS** without product edits.

Inspect code/specs, referenced integration documentation, and any active
sandbox. Separate facts, hypotheses, options, tradeoffs, and unknowns. With
approved `--compare`, produce 3–5 alternatives in
`.foundation/prototypes/<id>/`; write only there. Record the choice, reasons,
rejected options, and paths in `selection.md`. Prototype output is never proof. Return
`/change <intent> --prototype-selection <selection>` so the semantic compiler
imports only the decision and reference.

Without comparison, the investigation note is the only allowed write; create
`openspec/investigations/<name>.md` only when findings must persist. In compare
mode, do not edit product code or OpenSpec. Answer in the user's language with
conclusion, evidence, recommendation, unknowns, decisions, and next action.
