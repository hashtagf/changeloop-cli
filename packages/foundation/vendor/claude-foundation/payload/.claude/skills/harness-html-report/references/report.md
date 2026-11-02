# Harness HTML report — procedure

## Scope

Default to the active change (`.foundation/runtime/` state; ask which change
when several exist under `openspec/changes/`). "Latest change" with no active
one = newest `proof.json` `createdAt` under `.foundation/receipts/`; its packet
is usually archived at `openspec/changes/archive/<date>-<id>/`. A repo-wide
report covers every change that has receipts.

The default shape is a **read-only round summary**: the newest finished change told as a
complete story, with the currently active change appended as "next round"
status. Name the report after the work it covers (a short product-like name),
never "harness report".

## Data sources (read-only)

| Section | Source |
|---|---|
| Change intent, tasks ledger | `openspec/changes/<id>/proposal.md`, `tasks.md`, `design.md` |
| Status, revision, budget used/target | `.foundation/runtime/<id>.json` (`status`, `budget.usedRequests/targetRequests`, `budget.usedTokens/targetTokens`, quote `budget.measures` verbatim) |
| Gate outcomes | `.foundation/receipts/<id>/*.json` — always `discovery`, `test`, `proof`, `review`; profiles may add more (e.g. `compatibility`, `mutation`) |
| Evidence runs | `.foundation/evidence/<id>/` (collect/proof run directories) |
| Review attempts | `.foundation/receipts/<id>/review-attempts/` |
| Profile and budget config | `openspec/config.yaml`, `foundation.json` |
| Attestations | `.foundation/attestations/` |
| Code volume | the change's retained Land projection or bounded sandbox diff against its recorded baseline; separate product, tests/fixtures, and docs |

Missing data may be not-run, unavailable, or not retained. Establish the reason
before labeling it; never turn absence into zero, pass, or a guessed lifecycle state.
Land preserves HEAD/index and creates no commit. Existing commits can be a
separately attributed source only when they are verified to belong to this change.

## Metrics sources (read-only)

Per-change telemetry lives in `.foundation/logs/<id>/`:

| Metric | Source |
|---|---|
| Walltime + duration per phase/operation | `operations.jsonl` — `phase`, `startedAt`, `finishedAt`, `durationMs`, `exitCode`, `status` |
| Tokens and cost per request/model | `events.jsonl` — `modelId`, input/output/cache tokens; group by `operationId` for per-phase totals; aggregates in `operations.jsonl` (`requests`, `cost`) |
| Phase transitions, model tier, context mode | `phase-context.jsonl` |
| Human wait time | `user-transitions.jsonl` |
| Cause-aware timing, blocker coverage, reuse, next action | `claude-foundation feedback <change>` |
| Exact runtime source cohort | `claude-foundation metrics <change>` — `sourceCohort.runtimeVersion`, `sourceCohort.protocolBundle`, and `sourceCohort.contentDigest` |
| Command duration per evidence run | receipt `observed` field (e.g. `exit 0; 19425ms`) |
| Quality / defects | `review.json` verdicts and findings, `review-attempts/` retry count, failed test claims |

Derived figures (compute, do not store):

- **Source cohort** = runtime semantic version + the complete protocol bundle +
  the content digest emitted by `claude-foundation metrics`. Show all three in
  the report. If two reports have different source cohorts, label any KPI
  comparison as cross-cohort and do not attribute the delta solely to product
  behavior.

- **Span** = first `startedAt` → last `finishedAt`; say explicitly it includes
  human wait. **Busy** = sum of `durationMs`; give it as % of span.
- **Phase attribution is non-overlapping**: phases interleave, so assign each
  wall-clock span to the phase of the most recent command at that moment;
  the per-phase times must sum exactly to the span. Note the longest single
  unattributed interval and what command preceded it.
- **Inspect behavior before naming a gap**: read the preceding receipt/review
  findings, the later workspace hash, relevant task state, and the code paths
  that own the command. Prefer the structured `feedback` classification. An
  interval after a failed review with blocker/major findings is **repair** only
  when a later changed workspace and proof resume provide evidence; it is not
  reviewer wait or human wait. If the evidence is insufficient, say
  "ยังระบุสาเหตุไม่ได้" rather than calling it quiet, idle, or agent delay.
- **Prove timing**: report reviewer execution, evidenced repair, human wait,
  and unattributed time separately. Do not compare Prove with Build until the
  repair component has been separated; explain when Prove is larger because it
  contains product repair triggered by review findings.
- **Harness interventions**: `status == "blocked"` rows grouped by what the
  guard was preventing (same operation + adjacent timestamps = one story).
  For each group: count, timestamps, what the harness prevented (the risk,
  in plain language), and what it took to pass.
- **Budget**: used vs target requests/tokens from the runtime state file.

Token/cost fields in `operations.jsonl` are `null` when host telemetry is
unavailable — report the `measurement` note verbatim, never a bare made-up
number. When `events.jsonl` still has per-request tokens, a cost estimate is
allowed only if every derived figure is marked "ประมาณการ" and the assumed
per-MTok rates are stated inline next to it.

## Report structure

Write all report prose in Thai. Keep identifiers, file paths, and receipt
verdicts verbatim in their original language, with a Thai explanation beside
any quoted verdict. Paraphrase harness jargon into plain Thai on first use
(sandbox → พื้นที่แยก, receipt → ใบเสร็จ/ใบรับรอง, land → ปิดงาน/เก็บเข้าคลัง)
and keep using the Thai term. Every claim traces to a file above; quote
verdicts verbatim; never summarize a failure into a pass.

1. **Header**: eyebrow (`Change Loop · รายงานรอบงาน`), report name, a
   2–3 line Thai lede saying what the round fixed/built and how it ended, and
   chips: overall verdict, change id, profile, land/archive date, active next
   round + its task progress, report update date, runtime version, abbreviated
   source digest, and protocol bundle identity.
2. **KPI scorecard** directly under the header — one card per dimension, each
   named Thai + English keyword, each with its evidence in the subline:
   Quality (gates/claims passed), Bug (found → fixed / open), Time (span),
   Speed (busy time + % of span, slowest command), Token (output + cache
   write, requests, model), Cost (real, or "ไม่มีข้อมูล" with the verbatim
   `measurement` note), Harness (blocked/total commands), Code (+/− lines,
   prod vs test split), Docs (observed openspec/documentation +/− lines), Well (overall health verdict with its evidence). Never bury
   these inside prose tables only.
3. **Timeline**: per-phase bars using the non-overlapping attribution (time +
   % of round, with the rule stated), then a per-phase table — commands,
   blocked count, busy time, requests, output/cache-write/cache-read tokens,
   cost — plus a totals row and a busy-share bar.
4. **Harness interventions**: the grouped blocked-command table (count · what
   was stopped with timestamps · what the harness prevented · what it took to
   pass), then up to three cards: the clearest win (a guard that prevented a
   real mistake), what the harness did **not** catch (name the disabled or
   missing policy), and the price paid (rework the strictness forced).
5. **What took time**: slowest commands table plus the cause-aware timing from
   `feedback` (reviewer execution, evidenced repair, human wait, unattributed),
   with command, phase, duration, outcome tag, cause, and evidence basis.
6. **Code volume**: KPI mini-cards (added/removed, prod, test+fixtures), a
   per-file table from the same bounded change projection, with separate
   documentation volume. A live worktree diff may contain unrelated changes;
   do not attribute those to the round.
7. **Gate table**: every receipt provider with status tag, claim counts,
   duration, and the `observed` value quoted verbatim + Thai gloss.
8. **Tasks**: done/total cards from `tasks.md` for the finished round and the
   active round, listing unfinished scope in prose.
9. **Bugs**: review findings and failed claims — found/fixed/open, each with
   its measured downstream effect (numbers from the round's own measurement
   notes, e.g. a revenue delta or a forced re-proof).
10. **Risks and waivers**: cards for anything a receipt flags — waived review
    independence, acceptance limits, attestations — each citing the receipt
    field verbatim.
11. **Improvement candidates**: numbered table — observation, proposal,
    source row cited.
12. **Footer**: the read-only statement plus one totals line (commands,
    requests, model; the active round's usage so far).

Sections whose data is absent are dropped, not faked; renumber accordingly.

## Render and presentation

Write the self-contained HTML only in an allowed artifact path: the returned
Build scope for an active change, or the host-provided report scope for a
standalone request. The report is a projection, never a second status ledger.
Share a local artifact by default. An available Artifact tool does not grant
upload/publication authority; publish only when requested and permitted by
host policy. Preserve an existing authorized artifact identity when updating it.

HTML constraints either way: fully self-contained (inline CSS, no external
requests), theme-aware light/dark, wide tables scroll in their own container,
under 16 MB. This is a scanned dashboard-document: status reads from tags and
tone (pass/warn/stop), numbers are tabular, KPI cards and chips carry the
summary before any table. Prose style:
[writing](../../init-project-docs/references/writing.md).
