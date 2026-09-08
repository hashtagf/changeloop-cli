# Change workflow

Read the smallest canonical sources that settle the requested behavior:
existing OpenSpec requirements, relevant code/tests, architecture decisions,
prototype selection, and versioned integration documentation. Reuse settled answers without asking them again.
Ask every unresolved material behavior, compatibility, security,
migration, rollout, or authority choice in one batch; do not create an interview
ledger.

Create one semantic draft v3 from `change start --template`. Keep its core small:
`intent`, semantic `requirements`, implementation `tasks` with `covers`, and
evidence capabilities keyed by requirement. Put only real complexity in typed
extensions:

- `decisions` only for choices hard to reverse, surprising without context,
  and selected among meaningful alternatives;
- `diagrams` for Mermaid or referenced SVG/PNG contracts;
- `prototypeSelection` for an existing selection note (never prototype code or
  prototype output as proof);
- `integrations` with documentation source/version, linked requirements, and
  security/resilience/compatibility concerns;
- repositories only for multi-repository work;
- external operations only for permission-bound work;
- Grounding v3 only for non-derived material decisions.

Local diagram, prototype-selection, and integration references must resolve to
regular files inside the project; reject directories and escaping symlinks.
Remote integration sources must use HTTPS and name a fixed version rather than
`latest` or a branch.

Create no decision-tree or interview ledger. Never create `CONTEXT.md`, a glossary artifact, or an ADR store;
durable terms and choices belong in the
compiled packet. Always hash reads in `grounding.yaml` when a material decision
needs a grounding read; do not create an empty file.

Compare canonical requirements before choosing `ADDED`, `MODIFIED`, or
`REMOVED`. Do not default to `ADDED`. For `MODIFIED`, copy the complete
requirement and every existing scenario; for `REMOVED`, include a
`**Migration:**` or `**Compatibility:**` consequence. Do not guess
upstream API behavior when documentation or version is missing—return a research
or user-decision boundary.

For defect behavior, include adjacent input partitions and source-language representation/coercion boundaries,
not only the reported reproduction.

Write the draft to `.foundation/drafts/<id>.json` and run
`claude-foundation change start .foundation/drafts/<id>.json --consume-draft`.
Never inspect managed `.claude/harness/**` merely to reconstruct this schema.
The compiler owns classification, stable requirement/claim/task IDs,
cross-links, conditional artifacts, versioned defaults, structural validation,
and rollback. The first Build `advance` owns idempotent sandbox creation and
setup. Repair only the draft fields it reports, as one
batch, then retry. Never patch a partially generated packet or create parallel
IDs by hand.

If Build discovers new observable behavior, create a semantic amendment v1 and
run `change amend <change> <amendment.json> --consume-amendment`. It preserves
completed tasks and custom prose/assets, increments the revision, invalidates
the affected contract, validates, and rolls back on failure. Existing legacy
changes keep their legacy authoring path; do not rewrite them merely to migrate.
`updateTasks` may extend claim coverage but must not replace an existing outcome
or verification command; add a new task when that contract changes.

The compiled `openspec/changes/<id>/` documents—not the temporary draft or
`.foundation` state—are the source of truth. Never create product code during
Change. A successful start is already validated; continue with
`claude-foundation advance <id> --through build`. At a real decision,
authority, resource, contradiction, or repeated no-progress boundary, preserve
the draft, present supported alternatives and the exact resume route. The agent
must never retire one unasked or infer acceptance from silence.
Optional audit warnings are advisory and do not invent missing grounding.
