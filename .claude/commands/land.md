---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

Start from `packet <change> --phase land` in a fresh context; Land reads
recorded state.

Run `claude-foundation land check`; it mutates nothing. On an unresolved apply
it reports update/create/delete counts; settle it with `land recover
--decision-ref` only once the user authorizes. For multi-repo work follow its
next action, bind authorized child commits/CI with `land record`, then
`land resume`, which stages root pointers and reports when fresh Prove is
required.

Run `claude-foundation land archive` only when ready. Its journal applies the
proof, preserves unrelated edits, syncs specs, audits evidence, and cleans isolation.
`ALREADY ARCHIVED` is success.

Before authority actions, explain visible effects in ordinary language. Offer
inspect, proceed, and pause; commands are not approval.

Never commit, push, or open a PR without separate authority.
