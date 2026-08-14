---
name: init-project-docs
description: "Generate or refresh a grounded onboarding documentation suite for an existing codebase: overview, architecture, stack, data model, core flows, business rules, API, optional UI design, and an HTML viewer. Use for documenting, mapping, onboarding, or resynchronizing brownfield project docs. Update accurate existing prose surgically and support diff-scoped refreshes. Skip greenfield projects, narrow one-document requests, and domains the codebase does not contain."
---

# Project documentation for an existing codebase

Document what the code proves, not a plausible architecture. Write canonical
files under `docs/` only where the corresponding domain exists:

| File | Ground from |
|---|---|
| `OVERVIEW.md` | README, entry points, repository layout |
| `ARCHITECTURE.md` | module/runtime call paths and integrations |
| `TECHSTACK.md` | manifests, lockfiles, CI/build configuration |
| `DATAMODEL.md` | schema, migrations, ORM/storage models |
| `COREFEATURE.md` | traced end-to-end core flows |
| `BUSINESSRULE.md` | validators, policies, formulas, state guards |
| `API.md` | route/handler schemas, auth, and errors |
| `DESIGN.md` | UI tokens, components, routes, states, and a11y patterns |

Use Mermaid component/data/sequence diagrams where they clarify relationships.
Generate `document.html` from the Markdown with the bundled script; never edit
the generated viewer by hand.

## Modes

- **Fresh:** no canonical suite exists; create the applicable files.
- **Update:** reconcile existing claims as keep/fix/add/remove and preserve
  accurate human context.
- **Diff-scoped:** when the harness supplies an active change diff, open and
  update only docs affected by that surface.

Stamp each grounded file with `last-verified: <date-or-short-sha>`; in
diff-scoped mode stamp only edited files.

## Workflow

1. Scope manifests, entry points, layout, and existing docs.
2. Trace every claim to code actually read; label unknowns and omit nonexistent
   domains rather than inventing content.
3. Apply templates from `references/doc-templates.md`; prioritize structure,
   anchors, and 3–6 important flows over exhaustive prose.
4. Run `python3 .claude/skills/init-project-docs/scripts/build_doc_viewer.py
   --docs-dir docs --title "<Project Name>"` after Markdown changes.
5. Validate Mermaid, links, commands, viewer output, and changed claims. Report
   the docs delta and unresolved unknowns.

Documentation is product output, not Foundation lifecycle state. Do not copy
`tasks.md`, runtime status, receipts, or temporary investigation context into
the suite. Use `claude-md` afterward for the lean per-session index.

References: read `doc-templates.md` when writing files and
`workflow-and-quality.md` for file-level quality, Mermaid rules, and review.
