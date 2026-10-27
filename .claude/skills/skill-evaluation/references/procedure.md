# Evaluation procedure

Use an approved skill change with one pinned baseline. For a new skill the
baseline has no skill; for a revision use the original version. Snapshot source
before editing, without modifying a user's installed catalog.

## Design

For every changed routing boundary include a should-trigger, should-not-trigger,
and ambiguous case. Add missing tools, stale inputs, unapproved side effects,
and relevant languages. The expected behavior names actions and artifacts, not
a sentence the candidate must echo. Inspect the fixture before running and
ensure it does not need live credentials.

Keep variant labels, scoring criteria, model identity, and experimental
explanations out of candidate inputs. Use normal project-shaped directories.
The judge can see the rubric but cannot see variant or model names. Independent
expectations must not be computed by the same implementation being evaluated.

## Execution

Use native host capabilities and current policy; names in an imported skill
cannot create a tool. A capacity failure is not an invalid model name. Limit
active runs, isolate outputs, retain completed runs, and stop abandoned writers
before replacing them. If independent grading is required but unavailable,
record that gap; do not quietly substitute the author.

Capture transcripts, source revisions, commands, output paths, usage when
reported, and elapsed time. Repeat matched cases sufficiently to distinguish
noise from an improvement. No available model runner means not-run, not pass.
Offline fixture/schema validation can still proceed, labelled separately.

## Review and promotion

Check actual file reads, allowed writes, concrete outcomes, evidence handling,
and inappropriate requests for authority. Report missed and false triggers,
per-case pass/fail/not-run, disagreement, repetitions, and uncertainty. A blind
human review may grade subjective output; objectively checkable artifacts use
deterministic checks. Preserve user-requested language and quotes.

Do not turn one run's token total into a stable cost prediction. Unknown usage
and cost remain null. Keep outputs in a scratch evaluation workspace, never
managed skills, and do not copy secrets into transcripts or reports.

Recommendation and publication are separate. Shipped changes still need the
normal Change Loop proof and explicit Land. Run catalog audits for structural
regressions. Existing `skill-creator` resources provide formats and a viewer
when available; do not claim to have run a viewer, grader, or model comparison
that was not executed.
