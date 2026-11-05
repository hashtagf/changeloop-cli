---
description: Compose change → build → prove → land.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Run **$ARGUMENTS** as the separate commands, in order:

1. `.claude/commands/change.md`: read it once, now.
2. `.claude/commands/build.md` (reaches `proven`),
   3. `.claude/commands/prove.md`: read each only for a failure, stale proof,
   or a non-`EDIT` action (run its `tasks` in `workspace`, then `resume`).
4. `.claude/commands/land.md`, only with Land authority, at a Land boundary.

Do not stop between phases except at a user gate or a real boundary. With
Land authority, every `advance` uses `--through archived`; without it, stop
at `proven`.

`--resume <change>`: continue from its current phase; `advance` skips
completed Build work and reuses fresh evidence.
`--plan-only`: run Change only.

Do not reread framework files.
