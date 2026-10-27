---
name: skill-suite-auditor
description: "Audit a skill catalog for metadata, trigger overlap, references, dependencies, and Change Loop ownership conflicts. Use for suite maintenance, imports, or upgrade planning. Return evidenced findings and scoped improvements; skip ordinary implementation and behavioral model evaluation."
---

# Skill suite auditor

1. Pin the catalog, version, and audit scope. Preserve dirty work and custom
   consumer skills. Inventory actual entry points and dependencies.
2. Run `node .claude/skills/skill-suite-auditor/scripts/audit.mjs .claude/skills`.
   The read-only helper checks metadata and explicit local references;
   its JSON reports static coverage only, never harness proof.
3. Read descriptions and bodies for competing triggers, missing task owners,
   undeclared tools, and instructions conflicting with canonical lifecycle,
   workspace, evidence, authority, or recovery contracts.
4. Prioritize defects by concrete failure. Recommend merge, revise, reference,
   or new skill with a positive/negative trigger and acceptance check.
5. Report audited coverage, source paths, findings, and unknowns. An empty
   static report does not establish behavioral correctness.

For pstack-derived work read [adoption map](references/pstack-adoption.md).
Use `skill-evaluation` for live comparisons and `skill-creator` for approved
edits. Store durable implementation choices in OpenSpec, not another ledger.
Do not import routing hooks, fabricate receipts, or grant external authority.
