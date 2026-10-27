---
description: Optionally deliver an archived change as a pull request and return its verified URL.
argument-hint: <change>
---

Deliver **$ARGUMENTS**. A direct request ("เปิด PR ให้เลย", "open a PR")
is this command.

Run `claude-foundation deliver advance <change>` once; a proven change Lands
first. It grants only Land, isolation, committing the proven projection,
pushing its feature branch, and opening or updating a pull request—never
force-push, default-branch push, merge, or deploy. A review follow-up citing
a delivered, still-open PR updates that PR; otherwise a new one opens, saying
why.

Recover and resume internally; never give the user commands, SHAs, or JSON.
Ask only consequential decisions. `DONE` requires read-back binding an open
PR to the delivered commit. Without Deliver, `archived` is complete.
