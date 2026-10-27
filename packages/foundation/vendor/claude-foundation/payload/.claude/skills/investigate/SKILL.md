---
name: investigate
description: Investigate an unclear problem before committing to a Foundation change. Use when the user invokes investigate or asks Codex to explore evidence, causes, repository facts, or options without implementing a solution yet.
---

Treat the text after `$investigate` as the command arguments. Read
`../../commands/investigate.md` completely and follow it as the canonical
workflow. Preserve the investigation-only boundary.

At each investigation gate, gather all independent available facts before
revising conclusions. Reconcile falsified hypotheses as one batch and continue
while evidence changes the result. If evidence cannot resolve a material
choice, preserve the investigation, present supported alternatives with a
recommendation, and resume after the user decides; never impose a retry count.
