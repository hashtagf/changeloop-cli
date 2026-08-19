---
description: Explore a problem or bounded alternatives without committing.
argument-hint: <problem or decision> [--compare]
---

Investigate **$ARGUMENTS** without product edits.

Inspect code/specs and any active sandbox. Separate facts, hypotheses, options,
tradeoffs, and unknowns. With approved `--compare`, produce 3–5 alternatives
under `.foundation/prototypes/<id>/`. Do not edit
product code or OpenSpec. When evidence cannot decide, ask the user; always
write `selection.md` with the choice, reasons, rejected alternatives, and
artifact paths. Return `/change <intent> --prototype-selection <selection>`.

Without comparison, the investigation note is the only allowed write; create
`openspec/investigations/<name>.md` only when findings must persist. In compare
mode, write only inside the prototype directory, including `selection.md`.
Answer in the user's language with conclusion, evidence, recommendation,
unknowns, only material decisions, and the next useful action.
