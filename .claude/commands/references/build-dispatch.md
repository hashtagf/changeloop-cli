# Build dispatch actions

The native host owns spawning, cancellation, leases, and the task ledger.
Foundation only returns the next bounded action.

For `spawn-group`, acquire every returned lease before regenerating its
`packet --task`. Give each native worker only that packet and repository state;
never replay the parent transcript. Wait for the whole returned group, release
each matching lease, then mark only accepted successes complete in `tasks.md`.
Leave failed tasks pending and dispatch again.

If an acquire loses to another host, do not spawn that worker. Keep and run any
leases already acquired by this host, release their results, then dispatch
again. For `wait`, wait for the named live workers or recover the existing
lease; never create duplicates.
