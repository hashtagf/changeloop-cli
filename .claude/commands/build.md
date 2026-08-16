---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Validate; `sandbox create <change>` or `sandbox sync`; read `packet <change>
--phase build`. `--unattended` requires the runtime guard. Use `agents plan`
only for multi-repo work.

Edit only allowed sandbox paths. Update `tasks.md` after focused checks. Move
unauthorized infrastructure operations to `handoffs.yaml`; relay `handoff
packet` once and never ask for credentials. Time long commands with `exec
<change> -- <command>`.

The host owns leases. Give workers only `packet --task <task>`. Declare new files
in the owning task's `[paths:]`.

Auto-repair findings inside the locked contract. Provider and permission
failures follow typed recovery. Ask again only if behavior, compatibility,
security, data, or rollout must change. Run `proof readiness <change>` before
fresh Prove. Never replay history, expose raw JSON, archive, commit, or Land.
Translate readiness for the user; ask only for structured decisions.
