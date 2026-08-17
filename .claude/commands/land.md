---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

Start from `packet <change> --phase land`; run read-only `land check`. Execute returned
`automaticRecovery`, explain the blocker and repair in plain language,
then continue. For `control-head-moved`, run `sandbox sync`, `proof
run`, and check again; never restart Change or ask. Stop on replay conflict or
no automatic route; translate the choice, never raw JSON or hashes.

Resolve interrupted apply with authorized `land recover --decision-ref`; manual
recovery also needs `--resolution`. For multi-repo work, bind authorized child
commits/CI with `land record`, resume, and re-Prove.

Check `handoff status`; only accepted, proven-safe `post-land` work may remain.
On `WAITING_EXTERNAL`, send its packet and resume after evidence. Store no credentials.

Archive only when ready; `ALREADY ARCHIVED` succeeds. Explain visible effects.
Never commit, push, or open a PR without separate authority.
