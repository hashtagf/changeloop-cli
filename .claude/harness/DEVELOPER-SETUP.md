# Developer setup

Change Loop v3.5.17 front-loads material decisions so Build and Prove can run to a
bounded conclusion without repeatedly interviewing the developer. The shipped
workflow adds:

- six primary user commands, with semantic draft v3 compiling stable OpenSpec
  links and conditional artifacts instead of asking the model to maintain them;
- optional Grounding v3 containing only non-derived material decisions, while
  legacy Grounding v2 remains readable;
- strictest-wins low/medium/high review routing with at most two delivered AI
  review waves: one full packet and one finding-bound delta;
- deterministic repair closure after the second AI review instead of a third AI
  loop or a mandatory human approval;
- one resumable `advance --through build|proven|archived` coordinator, which
  invokes compatible proof/Land primitives, reruns only stale providers, and
  returns one bounded action at a real boundary;
- Codex-only and Claude-Code-only coding/review configurations that retain a
  distinct read-only reviewer identity and fresh session; and
- conditional `handoffs.yaml` packets for AWS, Terraform, secrets, cluster, and
  other external operations that the developer is not authorized to perform.

Before the first Change Loop packet on a developer machine:

1. Install Node.js 20.19 or later.
2. Verify `claude-foundation version` is `3.5.17` and the repository runtime API
   is `36`. A delta between the two is advisory while both doctors still pass:
   the CLI forwards to the runtime installed in the project, so an older CLI
   prints `warning: project runtime API … differs from CLI API …` and keeps
   working. Only a doctor that exits non-zero is a blocked machine.
3. When the CLI itself is behind, upgrade it: `brew upgrade claude-foundation`.
   If instead the pinned source is absent, clone tag `v3.5.17` from
   `Maximumsoft-Co-LTD/claude-foundation` into
   `~/.local/share/claude-foundation/3.5.17`.
4. Install or refresh the runtime inside the project with
   `claude-foundation init <project-path>`. The equivalent entrypoint inside a
   source checkout is `bash /path/to/claude-foundation/install.sh
   <project-path> --yes`.
5. Add `~/.local/bin` to `PATH`, then run
   `claude-foundation doctor --stage change`.
6. Install and authenticate the reviewer CLI your project selects:
   - Codex: `npm install -g @openai/codex && codex login`
   - Claude Code: `npm install -g @anthropic-ai/claude-code && claude auth login`
7. Set the committed `foundation.json` review profile once. A Codex-only team
   uses `defaultReviewer: "codex-sol"`; a Claude-Code-only team uses
   `defaultReviewer: "claude-opus"`. Set `fallbackReviewers` to configured
   reviewer names followed optionally by `"main-session"`, and set
   `infraFailureThreshold` to bound infrastructure retries per reviewer. The
   route never runs after `fail` or `inconclusive`; `main-session` is explicit
   self-review and requires `independence: "self"`. Change Loop automatically reuses complete AI
   subject provenance only when its session matches the ambient host; otherwise
   the caller supplies the `--main-session-*` provenance fields. When coding and review use the same
   provider/model family, also set `diversity: "single-model"`, but keep
   `independence: "required"` so Change Loop still requires a distinct reviewer
   identity and fresh session.
8. Run `claude-foundation doctor --stage prove`. It checks the selected CLI,
   authentication and required headless/read-only flags and prints the exact
   install, login or upgrade command when the machine is not ready.

## Optional consumer-quality onboarding

To add changed-code CRAP and mutation gates, run `quality discover` first. It
reads repository manifests without executing scripts. Preview
`quality init`; only use `--write` after checking detected profiles and
commands. Then install the project-owned language tools and run
`quality doctor`.

Keep `quality/foundation-quality.json` at `policy.mode: "report"` for at least
three representative runs. Check function/source mapping, skipped mutants,
unsupported capabilities, repository selection, and false positives. Approve
the initial baseline only with `quality baseline --write --decision-ref …
--reason …`, then enable enforcement in CI. `quality init --write --ci github`
provides reusable/manual changed-code, nightly, and release templates; add the
consumer's runtime/tool setup and call the reusable workflow from the existing
PR trigger.

The Change Loop harness does not install Jest, Stryker, gocyclo, Radon, coverage.py,
PHPUnit, ShellCheck, database engines, browsers, or accessibility tools. Each
consumer repository owns and pins them. See `CONSUMER-QUALITY.md` for protocols,
adapters, isolation, baseline, exception, and multi-repository rules.

Safe single-family profiles (merge either selection into the existing
`review` object; keep the shipped `reviewers` map):

```json
{ "review": { "independence": "required", "diversity": "single-model", "defaultReviewer": "codex-sol" } }
```

```json
{ "review": { "independence": "required", "diversity": "single-model", "defaultReviewer": "claude-opus" } }
```

Do not set `independence: "self"` merely because one model family is used.
That separate waiver permits the same identity/session and is not needed for
Codex-only or Claude-Code-only operation.

Developers do not need AWS, secret-store, cluster-admin, Terraform-apply, or
production-deploy credentials merely to complete Build and Prove. `/change`
records those operations in `handoffs.yaml`; send
`claude-foundation handoff packet <change> --id <H00n>` to the named owner.
After the operator accepts or completes it, record only their name, ticket/run,
and evidence reference with `handoff record`—never copy a secret value into the
change or record.

Do not substitute another package, tag, or runtime. `.agents/skills` exposes
the canonical Change Loop skills to Codex. `.codex/foundation-rules` exposes
behavioral rules. `.codex/hooks` is a readable compatibility link only; Codex
does not execute project tool-call hooks. Install the documented Git hook
explicitly if repository-side mutation guards are required.

## Daily use

Use `/feature <PRD or backlog group>` for normal product delivery. It reads the
requirement, architecture, production path, and test topology before presenting
all material questions in one Decision Sheet. Once confirmed, the agent runs
Change → Build → Review → Prove without reopening locked choices.

Existing changes can use `/change`, `/build`, `/prove`, and `/land` separately.
A deterministic failure resumes at the affected provider. First-review findings
receive one delta review; after two delivered AI waves Change Loop uses current
test, mutation, integration, and static evidence to close verified repairs. It
asks again only for a real contract contradiction or new material risk, not for
warnings or optional improvements.

When an operation needs authority the developer does not have, send the
generated handoff packet to its named owner. Record only the operator name,
ticket or run, and evidence reference after completion. Never put AWS keys,
passwords, tokens, or other secret values in the change, receipt, or chat.
