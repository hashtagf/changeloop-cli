# Change workflow

Read requirements, locked decisions, architecture/contracts, production path,
tests, dependencies, and repository facts first. Challenge production entry,
real wire, activation, negative oracles, and environment authority. Ask every
material choice in one Decision Sheet and hash reads in `grounding.yaml`.
Only a real contradiction permits one batched `--reopen-grounding`.

Before writing each spec delta, read the canonical
`openspec/specs/<capability>/spec.md` when it exists and select the operation
from that state:

- `ADDED` introduces a requirement name the canonical spec does not declare.
- `MODIFIED` changes an existing requirement without changing its identity;
  copy the complete requirement and every existing scenario, then edit it.
- `REMOVED` retires an existing requirement and states a non-empty
  `**Migration:**` or `**Compatibility:**` consequence.
- A rename is the old requirement under `REMOVED` plus the new requirement
  under `ADDED`; never reuse one requirement name in two sections.

Do not default to `ADDED` without comparing the canonical spec. Emit only
sections that contain requirements and delete every unused template section.

Record AWS/IAM/secret/Terraform/deploy/restart ownership in `handoffs.yaml` with
timing, activation safety, evidence, runbook, rollback, claims, and tasks.

Run `doctor --stage change`; reuse an existing change. Otherwise classify before creating it:
rapid is only low-impact isolated unit/static work. Resolve impact, coupling,
security, surface, acceptance, and review. Omit `--security` when there are no triggers.
Declare surface, wire evidence, and settle the reviewer now. Prove must not
discover an unnamed operator.

Complete artifacts/tasks, validate, run Build doctor, and sync. Offer
`change abandon` for an unprovable contract; never retire one unasked, infer
acceptance from silence, or expose harness fields. Summarize outcome,
boundaries, proof, completed work, and next action in the user's language;
keep lifecycle fields internal.
