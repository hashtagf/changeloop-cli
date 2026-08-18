# Prove workflow

Start from a fresh `packet <change> --phase prove`; inherit no Build history.
Run `proof advance`; it executes once, routes review before acceptance, reuses
`authority request`, and never polls. Send each `handoff packet` once; continue
without asking for cloud credentials.

Review is fresh independent work: full, then one changed delta. When configured
reviewer infrastructure fails and policy names `main-session`, review the
returned bounded packet in this calling session, fill the pre-attributed
response template, and record it; do not rerun the failed adapter. Final
in-contract findings close only from their current claim/critical-case
receipts—never AI round three or a generic redesign/split/pause question.
Reopen one Decision Sheet only for changed behavior, compatibility, security,
data, or rollout.

For a missing adapter use `evidence init --write`. Identity may be shared only
with committed `review.independence: "self"`. Codex-only or Claude-Code-only
review uses `review.diversity: "single-model"`; it requires a fresh
identity/session. Never substitute self-review for a required reviewer.
Never expose raw readiness JSON. Relay every blocker with the route and stop on real
decisions. Never fabricate provenance, claim an unproven pass, or Land. End
with what passed, remains unproven, and the agent's next action.
