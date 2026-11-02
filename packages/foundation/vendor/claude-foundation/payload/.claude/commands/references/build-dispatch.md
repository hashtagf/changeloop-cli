# Build dispatch actions

The native host owns spawning, cancellation, leases, and the task ledger.
Foundation returns one `EDIT` envelope with `execution.mode`, bounded tasks,
allowed paths, verification, and one resume route.

For a session-mode leased task, `advance` holds the lease itself
(`execution.managedLease`). Implement the embedded task and run its focused
checks; do not acquire or release it. After a success, resume `advance`: it
reruns the task's verify, ticks it in `tasks.md`, releases the lease, and checks
observed writes against the task scope. A failing task keeps its lease.
This keeps a singleton runnable frontier out of a new worker while preserving
the same fencing, observed-write, and result authority as spawned work.

For parallel mode, `advance` holds every lease of the returned group
(`execution.managedLeases`), exactly as for a session task. The parent spawns
one native worker per `execution.workers` entry, in returned order, without
exceeding `maxParallelAgents`, and gives each only its `packetCommand` output
and repository state; never replay the parent transcript. Spawn every worker
before waiting, never implement a worker's task in the parent, then resume
`advance` once: it reruns each task's verify, ticks passing tasks, releases
their leases, and returns only failures.

The task packet carries the worker contract. A worker implements only its
leased task and allowed paths. It reports its summary, focused checks, and
blockers to the parent for coordination; that report is not evidence.
Foundation accepts results from observed workspace writes and lease authority.
Resume `advance`; Proof owns the aggregate graph join.
The planner serializes tasks in a shared repository workspace because lease
release observes the repository diff. Parallel groups use independent
workspaces; do not widen a returned group just because paths look disjoint.
Never acquire or release a lease or edit checkboxes yourself. A task returned
under `reverification` is already implemented: repair what its check reports,
then resume; never redo it or split the diff per task.

For `wait`, wait for the named live workers; never create duplicates.
