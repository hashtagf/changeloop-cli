---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

Read `.claude/skills/change/references/workflow.md` completely.
Apply its agreement-detail and document-language rules to the authored packet,
then inspect the compiled documents; obtain explicit spec approval before Build.
Inspect the smallest relevant canonical code/spec/doc set, settle material decisions in
one batch, and write one semantic draft v3 under `.foundation/drafts/`. Use
semantic requirement/task keys; never invent cross-file claim IDs or create
OpenSpec artifacts by hand. Include typed `decisions`, `diagrams`,
`prototypeSelection`, `integrations`, repositories, or external operations only
when the change actually needs them.

Run `claude-foundation change start <draft.json> --consume-draft`. The compiler
owns classification, stable links, conditional artifacts, validation, and
rollback. Build `advance` owns sandbox preparation and setup.
If an active semantic change gains a requirement,
use one `change amend <change> <amendment.json> --consume-amendment`; do not
rewrite its ledgers independently. On compiler errors, repair the named draft
fields as one batch and retry. Ask the user only for a material behavior,
compatibility, security, migration, rollout, prototype, or authority decision.
Do not implement product code during Change.

Keep protocol fields internal. Return the outcome, material decisions, compiled
agreement, and `advance` action in the user's language.
