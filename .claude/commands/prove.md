---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Start from `packet <change> --phase prove` in a fresh context, not Build
history. Inherit only the packet. A provider with no adapter is wiring, not a
person: run `evidence init --write`, then retry. For external review or
acceptance, run `proof collect` and `authority request`; explain the packet and
ask whether to inspect, send, or pause. Record real responses through
`authority record`. Run `proof run`; reuse fresh receipts.

Follow deterministic steps, but stop on decisions. Never expose raw readiness JSON
or ask users for receipt syntax, provenance, or placeholders.
Relay every blocker with the route the harness prints for it.
Responses may pass, fail, be inconclusive, or pause.

Use a fresh independent reviewer when policy requires one; under
`review.independence: "self"` a project reviews itself — a recorded waiver, not
a substitute. Human acceptance inspects the final workspace.

Never substitute self-review for a required reviewer, fabricate provenance,
claim an unproven pass, or Land.
