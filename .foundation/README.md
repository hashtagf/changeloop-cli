# Foundation runtime

This directory is machine-owned. Runtime state, receipts, immutable evidence
bundles, workspace snapshots, provider logs, request-usage events, incremental
transcript cursors, recoverable Land transaction journals/backups, and sandboxes
are intentionally ignored.
Repository worktrees, model/agent execution plans, and resource leases are also
machine-owned. Disposable comparison prototypes live under `prototypes/`; the
runtime rejects them as evidence artifacts or local references so they never
enter proof or product artifacts. Repository topology and model policy remain
reviewable in `openspec/repositories.yaml` and `foundation.json`.
Emitted plan and packet byte counts live in
`logs/<change>/context.jsonl`; they contain sizes and scope metadata, not prompt
or artifact content.
`install-manifest.txt` is the exception: it records only files owned by the
Foundation installer so upgrades can remove stale managed files safely.
Durable intent belongs in `openspec/`; implementation truth belongs in code and
tests.
