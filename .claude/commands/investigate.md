---
description: Explore a problem or bounded alternatives without committing.
argument-hint: <problem or decision> [--compare]
---

Investigate **$ARGUMENTS** without edits. Retain user requirements and
corrections; ask only missing meaning and continue independent work.

Read `.claude/skills/investigate/references/workflow.md` completely and follow
its fact/decision ownership, bounded-write, comparison, evidence, and handoff
rules. Start from `claude-foundation investigate --template`, maintain its JSON
record, and run `claude-foundation investigate <record.json>` after every
evidence batch. Follow the typed action and exact resume route. Preserve
findings at a real boundary and never treat prototype output as proof.
Write record content in the user's language. Return a short conclusion and a
link to the current `report.path`; do not hand the user raw JSON as the result.
