---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

With `--prototype-selection`, summarize that file; never use it as evidence.

Run `doctor --stage change`; reuse the change.
Otherwise classify before creating it: `change new <intent> --rapid` only for
low-impact, isolated, unit/static work, standard otherwise. Resolve ambiguity,
impact, coupling, security, surface, and evidence.
Omit `--security` when there are no triggers. Require review only for policy
triggers. Declare `--surface`, then act on its forecast before signing: wire
what `evidence init --write` can wire, and settle the reviewer now. When the
forecast names review and no independent reviewer will exist, ask the user to
choose one or set `review.independence: "self"`; found after Build, it costs
the build.

Complete artifacts, tasks, evidence, execution. Run `change validate`, then
`doctor --stage build --change <change>`. Sync any sandbox.

Offer `change abandon` for an unprovable change; never retire one unasked.

Ask material decisions in the user's language. Classify subjective
acceptance—never infer it from silence or expose harness fields.
