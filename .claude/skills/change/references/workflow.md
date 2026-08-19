# Change workflow

Read any compact brainstorming agreement, approved Decision Sheet, requirements,
locked decisions, architecture/contracts, production path, tests, dependencies,
and repository facts first. Reuse settled answers without asking them again.
Challenge production entry, real wire, activation, negative oracles, and
environment authority. If no finalized sheet exists, ask every unresolved
material choice in one Decision Sheet. Always hash reads in `grounding.yaml`.
Create no decision-tree or interview ledger. Only a real contradiction permits
one batched `--reopen-grounding`.

For a standard change, source-check project-specific terms from the agreement
and write only resolved canonical terms, meanings, and avoided aliases under
`design.md` Domain language; use `none` when the change introduces none. Record
a durable Decision only when it is hard to reverse, surprising without context,
and chosen among meaningful alternatives. Keep choice, why, and rejected option
together. Never create `CONTEXT.md`, a glossary artifact, or an ADR store; never
add `design.md` to a rapid packet by hand.

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
