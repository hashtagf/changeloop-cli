---
name: claude-md
description: "Generate, tighten, or update the root CLAUDE.md for an existing repository. Use when the user asks to create or revise the agent-facing project guide. Ground it in actual code and preserve hand-authored rules. Produce a concise nine-section index: Project Overview, Tech stack, Architecture, Domain Model, Folder Structure, Current State, Team Agent, Roadmap, and Common Command. Use init-project-docs for deep human-facing documentation."
---

# Revise CLAUDE.md

`CLAUDE.md` loads every session. Keep it small, current, and traceable to files
actually read. Preserve repository-owned instructions verbatim unless the user
explicitly asks to change them.

## Fixed shape

Use one `#` title and these nine `##` sections; avoid deeper headings:

1. **Project Overview** — purpose, audience, entry point, one-command run.
2. **Tech stack** — versions from manifests and lockfiles.
3. **Architecture** — top components and boundaries; link deep docs.
4. **Domain Model** — real entities and important relationships.
5. **Folder Structure** — top-level nodes and purpose.
6. **Current State** — built, active, and known gaps grounded in code/specs.
7. **Team Agent** — actual `.claude/agents/*.md`, or `none`.
8. **Roadmap** — only repository roadmap/milestones/TODO; otherwise say none.
9. **Common Command** — exact run/build/test/lint commands from project files.

## Workflow

1. Read the existing `CLAUDE.md` and identify protected house rules.
2. Inspect only authoritative project sources for each section.
3. Reorganize and compress; link existing docs instead of copying them.
4. Verify every command and path, check heading depth, and review the diff for
   lost instructions or invented facts.

Name environment variables but never values. State an honest unknown instead of
filler. Do not copy Foundation runtime state, active task progress, receipts, or
ephemeral context into this always-loaded file.

Use `init-project-docs` when the user needs the detailed `docs/` suite; this
skill should link that suite rather than duplicate it.
