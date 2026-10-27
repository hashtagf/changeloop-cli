---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**. Shared rules: `.claude/harness/AGENT.md`.

1. Read only behavior-settling sources (code, tests, `openspec/specs`).
2. Write the draft folder with the Write tool, not shell, to
   `.foundation/drafts/<id>/`: `change.json` with `version: 5`, `intent`,
   `workType`, `requirements[{description with SHALL, scenarios[{when, then}]}]`,
   `tasks[{outcome, verify, paths}]`; `proposal.md` `## Why`. `verify` fails
   on wrong behavior. Prose: the requested language, else the request's.
   `impact` medium/high also needs `scratch{get, asIs, toBe, ifFail}`.
3. Run `claude-foundation change start .foundation/drafts/<id>`; if the
   request approved the spec, append `--approve-spec --decision-ref <ref>`
   (`/dev`: `--through proven` too).
   - `EDIT`: fix every named field via Edit, rerun.
   - `ASK_USER`: ask, record answers in the draft, rerun.
   - `DONE`: packet files and tasks print; do not reopen them.

Read `.claude/skills/change/references/workflow.md` completely only for a
draft declaring `impact` medium/high, `riskSignals`, `integrations`, external
operations, several repositories; lane `standard`; or a revision or
amendment (a keyword like billing only adds review). It owns
agreement-detail and document-language rules, `scratch` lines, and the approval
question.

Never abandon a change: `change revise <id> <draft>` before Build,
`change amend <id> <amendment>` after. No product code in Change.

## Gate: spec approval

Unless approved, link the packet; explain scope, behavior, criteria, and
open questions in ordinary words. Ask through the host's structured question
tool: approve, edit, details, reject. "ลุยเลย" or
"approve" is the approval. Record it with
`claude-foundation advance <id> --approve-spec --decision-ref <ref>` or step
3's flags. Change stops here. Report in the user's language.
