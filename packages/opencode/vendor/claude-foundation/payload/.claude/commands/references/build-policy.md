# Build operating policy

`--unattended` requires the runtime guard. Use `agents plan` only for
multi-repository work. Update `tasks.md` after focused checks, including the
`run-in-session` path.

Move unauthorized infrastructure operations to `handoffs.yaml`; relay `handoff
packet` once and never ask for credentials. Time long commands with `exec
<change> -- <command>` so external wall time reaches metrics.

Ask only for structured decisions. Ask again only if behavior, compatibility,
security, data, or rollout must change. Provider and permission failures follow
typed recovery.
