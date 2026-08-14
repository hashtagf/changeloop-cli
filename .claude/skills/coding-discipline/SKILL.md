---
name: coding-discipline
description: "Resolve unclear scope, consequential assumptions, speculative complexity, or diff-shape risk before coding. Use when the always-on conduct digest is insufficient: several plausible interpretations remain, the proposed solution may exceed the request, or unrelated edits may enter the change. This is a conduct aid, not a construction skill. Skip routine work whose scope, outcome, and evidence are already clear."
---

# Coding discipline

Use this only when the concise conduct rules in `.claude/rules/fundamentals.md`
do not resolve the task. It selects a safe working stance; the primary
construction skill owns technical design and Foundation owns lifecycle/proof.

## Rules

1. Surface assumptions that can change behavior, compatibility, security,
   persistence, scope, or irreversible effects. Verify repository facts before
   asking the user; ask only when the remaining choice is consequential.
2. Choose the smallest adequate solution in this order: no code, standard
   library, platform/framework, installed dependency, then minimal new code.
   Never trade away required safety, correctness, accessibility, or evidence.
3. Keep every changed line traceable to the request. Match local conventions,
   remove only debris caused by the change, and report unrelated issues instead
   of silently fixing them.
4. Turn the request into a checkable outcome and continue until applicable
   project-owned evidence proves it or a concrete blocker remains.

## Harness handoff

- Use `brainstorming` or `/investigate` for genuine unresolved alternatives.
- Put durable intent and decisions in OpenSpec, not a chat-only or parallel plan.
- Keep implementation status in `tasks.md` and proof in harness receipts.
- Do not interpret “goal-driven” as authority to expand scope, mutate external
  systems, commit, push, or Land.

Reference: read `references/details.md` only when a rule needs rationale or a
worked application. Then load the construction/process skill for the actual
technical decision.
