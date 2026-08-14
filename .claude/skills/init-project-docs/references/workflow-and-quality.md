# Init Project Docs — Workflow Detail & Quality Bar

Companion to `SKILL.md`. Full per-file guidance, the five workflow steps in detail, mermaid validity rules, the self-review quality bar, and anti-patterns.

## File-level guidance

`COREFEATURE.md` is the centrepiece: each core feature gets its own **sequence diagram** showing the real call chain (actor → entry point → service → datastore → external system → back).

`BUSINESSRULE.md` captures the **rules the code enforces** — the behavioural counterpart to DATAMODEL's schema constraints and the *why* behind COREFEATURE's flows — pulled from validators, domain services, conditional logic, and named constants, not how the domain "should" work.

`DESIGN.md` is the UX/UI companion—produced only for a project with a user-facing UI and grounded in frontend code. For a headless service, pure API, or library, drop it. Forward-looking UI decisions belong in the active OpenSpec change.

## Workflow

Run in order. Steps 1–2 are most of the value — never skip them. In update mode the existing docs are an extra input you read and reconcile, not output you overwrite blind.

### 1. Scope the repo

Locate the project root and confirm where docs go (`docs/` by default). Get a high-level lay of the land before reading deeply:

- Dependency manifests: `package.json`, `pyproject.toml` / `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, `composer.json` — these answer TECHSTACK almost entirely.
- Entry points: `main`, `index`, `app`, `cmd/`, `server`, framework bootstrap files.
- Top-level layout (`src/`, `internal/`, `apps/`, `services/`, `migrations/`, `infra/`), the README, and any existing `docs/`. **If that `docs/` already holds the suite, you're in update mode — read it now as your starting point.**
- Config: `Dockerfile`, `docker-compose.yml`, CI workflows, `.env.example`, IaC.

Use `LSP`, `Grep`, and search tools. For a large repo, delegate only independent subsystem maps as native work packages, then synthesize once.

### 2. Understand before writing (the grounding rule)

**Every claim in every doc must trace to something you actually read** — the single rule separating a useful brownfield doc from confident fiction:

- TECHSTACK from the **manifests** (lockfiles for real versions), not what the framework "usually" uses.
- DATAMODEL from **migrations, ORM models, schema files, or `CREATE TABLE`** — real fields, types, foreign keys. Don't infer columns from variable names.
- API from **route definitions, controllers, decorators, or an OpenAPI/GraphQL schema** — real methods, paths, status codes.
- COREFEATURE diagrams by **tracing one call from entry point to effects** (handler → service → repository → external client). The arrows are real calls, not a guess at how it "should" flow.
- BUSINESSRULE from **validators, domain services, guards, conditional logic, enums, and named constants** — the real thresholds, formulas, and state guards, each cited to its function or constant. A rule you can't point at in code doesn't go in.
- DESIGN from the **frontend code** — the theme/token file, Tailwind/CSS config or `:root` properties, the component dir, the router/pages. The palette, type scale, components, and screen map the UI *uses*, not a framework's defaults. ([[ui-ux-pro-max]] names the patterns; [[tailwind-design-system]] the token mechanics.)
- When the code doesn't tell you, **say so** ("auth mechanism not found in the reviewed files"). A documented unknown is honest; an invented answer is a trap.
- Cite real anchors — file paths, route strings, table names — so a reader can verify and the doc resists drift.

**Update mode** — read each existing doc against its code and sort every claim: **keep** (accurate — including human prose), **fix** (drifted), **add** (in code, not the doc), **remove** (in the doc, gone from code). That four-bucket diff is your edit plan for step 3.

Read [[refactoring-fundamentals]]'s current-state mapping mindset if the codebase is large or tangled.

### 3. Write (or update) the Markdown docs

**Fresh** — write each file into `docs/`. Open **`references/doc-templates.md`** for the exact section skeleton and a worked mermaid example per file; follow them so the suite is consistent across projects. Lead with structure (tables, bullets, diagrams) over prose.

**Update** — apply the four-bucket diff as **surgical edits**: rewrite only what drifted, add for new code, delete the stale, leave accurate content (especially human-authored prose) untouched. Minimise the diff. Realign to `references/doc-templates.md` only if the docs predate the current skeleton — preserving project substance.

Pick the **3–6 genuinely core** features for `COREFEATURE.md` — the flows that define the product (auth, primary create/update, the money path, the main read path), one sequence diagram each. Not every endpoint. (Update mode: keep the existing set unless a flow was added/removed/materially changed.)

For `BUSINESSRULE.md`, one row per rule (condition → effect + source), plus validations, formulas, thresholds, and state-transition guards where they exist. Drop any sub-section with no real instances rather than inventing one.

Write `DESIGN.md` **only when there's a user-facing UI**. Capture design tokens, the component inventory, the screen/navigation map, and key per-screen states — from the frontend code. Else drop it or leave the one-line "Not applicable" stub.

### 4. Build the viewer

Generate `document.html` with the bundled script (do **not** hand-write it — the script handles escaping, ordering, mermaid wiring):

```bash
python3 .claude/skills/init-project-docs/scripts/build_doc_viewer.py --docs-dir docs --title "<Project Name>"
```

It embeds the current Markdown into one file (marked.js + mermaid.js from CDN) with a sidebar in canonical order. Content is embedded, so it's a **snapshot** — re-run after editing any `.md` (update mode too). Opens by double-clicking, no server needed.

### 5. Self-review (see Quality bar) and report

Validate the mermaid, re-run the script, and tell the user what was produced and the one or two things you couldn't determine from code. **Update mode: lead with a changelog** — fixed / added / removed / kept.

## Mermaid: keep it valid

A broken diagram renders as an error box — worse than none. Guard the common breakers:

- Fenced ` ```mermaid ` blocks (the script promotes them automatically).
- `sequenceDiagram` (COREFEATURE), `erDiagram` (DATAMODEL), `flowchart TD`/`graph LR` (ARCHITECTURE), `flowchart`/`stateDiagram-v2` (DESIGN), `stateDiagram-v2`/`flowchart` (BUSINESSRULE, when present).
- Quote labels with spaces/punctuation: `API->>DB: "fetch by id"`. Avoid raw parens/semicolons/`#` in unquoted labels.
- Declare participants/actors before use; keep flowchart node ids alphanumeric.
- Eyeball each block against the examples in `references/doc-templates.md`; if unsure, render `document.html` once and confirm no error boxes.

## Quality bar — self-review before handing over

- **Grounded**: every component, table, endpoint, and arrow traces to a file you read. No invented fields or routes.
- **Honest gaps**: anything undetermined is labelled, not papered over.
- **Right files**: a doc whose domain doesn't exist says "Not applicable" in one line — no plausible filler.
- **Diagrams render**: valid mermaid — sequence per flow (COREFEATURE), ER (DATAMODEL), component/flow (ARCHITECTURE), screen map (DESIGN when present), state/decision (BUSINESSRULE when present).
- **Skimmable**: tables and diagrams over walls of prose.
- **Update — faithful delta**: stale fixed, new reflected, removed dropped, accurate human edits preserved; you can name what changed.
- **Viewer built last**: `document.html` regenerated from the final `.md` set.
- **No secrets**: name the variable, never the value (mirrors `protect-secrets.sh`).

## Anti-patterns (do not do these)

- **Documenting the framework, not the project** — "Express apps typically have…". Describe *this* repo's middleware, by file.
- **Inventing a schema or endpoints** because they'd "make sense." The reader trusts them and is wrong.
- **A default or invented design system** in DESIGN.md — read the theme file and component dir; document what this UI defines.
- **A guessed COREFEATURE diagram** — trace the real call chain or leave the flow out.
- **Hand-writing `document.html`** — that's what the script prevents.
- **Padding "Not applicable" sections** with filler; **a wall of prose** where a table/diagram is clearer; **forgetting to rebuild the viewer**.
- **Regenerating over an existing suite** — blowing away human edits when a surgical update would do. Update in place by default; rebuild wholesale only when asked or unsalvageable.
- **Leaving stale claims in place** when updating — a doc that *looks* maintained but describes code that's gone is a worse trap than an obvious gap.
