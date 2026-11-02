---
name: skill-creator
description: "Create or revise skills only when explicitly requested or approved. Use for skill authoring and scoped procedure capture. Follow Change Loop for shipped changes, skill-evaluation for behavioral/trigger comparisons, and skill-suite-auditor for catalog audits."
---

# Skill creator

Use this explicit authoring handoff for approved skill changes. For material
shipped changes, use Change Loop and keep implementation status in the active
OpenSpec tasks, never a second ledger.

1. Capture the user's settled intent, examples, constraints, and corrections.
   Ask only for consequential choices still missing.
2. Define the task, positive and negative triggers, output, tool requirements,
   and boundaries. A description selects a skill; it never grants authority.
3. Write the shortest operational body. Keep technical depth in selectively
   loaded references and link canonical contracts instead of copying them.
4. Validate metadata, references, install independence, and harness ownership.
5. Use `skill-evaluation` for meaningful old/new comparisons. Label static
   checks separately from observed model behavior; missing runs are unknown.
6. Review the diff and resume the current harness action. Publishing or Git
   mutations require separate authority.

Read [authoring overview](references/authoring-overview.md) for the complete
authoring phases and existing templates. Read only the phase references it
names. Use `skill-suite-auditor` when the problem spans the whole catalog.
