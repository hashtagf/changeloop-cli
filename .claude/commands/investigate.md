---
description: Explore a problem or bounded alternatives without committing.
argument-hint: <problem or decision> [--compare]
---

Investigate **$ARGUMENTS** without product edits.

Inspect code/specs and the active sandbox when one exists. Separate
facts, hypotheses, options, tradeoffs, and unknowns.
With `--compare`, or an approved comparison, produce
3–5 lightweight alternatives under `.foundation/prototypes/<id>/`. Do not edit
product code or OpenSpec. When evidence cannot decide, ask the user; always
write `selection.md` with the choice, reasons, rejected alternatives, and
artifact paths. Return `/change <intent> --prototype-selection <selection>`.

Without comparison, the investigation note is the only allowed write; create
`openspec/investigations/<name>.md` only when findings must persist. In compare
mode, write only inside the prototype directory, including `selection.md`.
End with `ready for /change`, `needs user decision`, or `not worth changing`.
