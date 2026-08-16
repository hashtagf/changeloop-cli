---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

Start fresh from `packet <change> --phase land`. Run `land check`; it is
read-only. Resolve interrupted apply through authorized `land recover
--decision-ref`; a manual recovery also needs `--resolution keep-current` or
`--resolution restore-backup`. For multi-repo work bind authorized child commits/CI with
`land record`, then `land resume`; re-Prove when requested.

Check `handoff status`. Accepted tracked `post-land` work may remain only when
its claim proves `safe-before-activation`. Unresolved `pre-land` or
`activation-coupled` work returns `WAITING_EXTERNAL`; send its packet to the
named owner and resume after completion evidence. Store no credentials.

Run `land archive` only when ready; `ALREADY ARCHIVED` is success. Explain
visible effects before authority actions. Never commit, push, or open a PR
without separate authority.
