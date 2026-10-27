---
name: init-project-docs
description: "Create or refresh grounded human-facing onboarding docs and an HTML viewer for an existing codebase. Use for architectural walkthroughs or diff-scoped documentation refresh. Preserve canonical sources; skip CLAUDE.md-only requests and parallel lifecycle/status documents."
---

# Project documentation for an existing codebase

Document what traced source and real behavior establish. Read
[documentation workflow](references/documentation-workflow.md) for applicable
files, fresh/update/diff-scoped modes, templates, and the viewer command.

Follow configuration through callers, adapters, and persisted or emitted
results for each core flow. For historical rationale, use original decisions
and PRs; label inference, conflicting sources, and unknowns. Reuse valid
research instead of repeating it.

Preserve accurate authored context and canonical terminology. Write in the
requested language; preserve code identifiers, commands, and source quotations.
Do not invent a domain or a shipped status.

Within Change Loop, edit only scoped documentation and keep agreement/status
in their existing owners. Verify links and generated output through project
tools; a readable document is not a proof receipt.
