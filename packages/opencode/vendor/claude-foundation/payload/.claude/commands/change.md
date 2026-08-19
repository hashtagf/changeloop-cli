---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

Read `.claude/skills/change/references/workflow.md` completely and follow it as
the selectively loaded canonical Change workflow. It owns grounding, canonical
spec comparison, delta operations, reviewer settlement, validation, recovery,
and user-language reporting. Do not implement product code during Change.

Treat the text after `/change` as its arguments. Keep lifecycle protocol fields
internal and return only the bounded outcome, decisions, agreement, and next
action in the user's language.
