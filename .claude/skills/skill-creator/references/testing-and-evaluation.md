# Running and evaluating skill cases

[skill-evaluation](../../skill-evaluation/SKILL.md) and its
[procedure](../../skill-evaluation/references/procedure.md) own experiments.
Use these resources for formats and presentation, not another execution loop.

## Prepare

Pin the original version before editing; a new skill uses a no-skill baseline.
Select discriminating cases, including near-misses and authority failures.
Define expected actions/artifacts independently of the candidate. Keep variant
labels and grading instructions out of candidate inputs.

Use an approved scratch directory inside the returned workspace or a
host-provided evaluation scope. Keep runs outside the managed skill catalog.
Read-only baseline snapshots do not authorize writes to installed skills.
Retain completed artifacts; never reset another writer's outputs.

## Execute

Confirm a real runner, model identity, concurrency limit, budget, isolation,
and any external/paid authority before execution. Use matched inputs/settings
for candidate and baseline. Sequential runs are valid; parallel runs require
available capacity and permission. Do not launch all cases automatically.

Capture actual transcripts, source identity, commands, outputs, elapsed time,
and usage when reported. Missing usage/cost stays null. If the host cannot run
independent variants, report not-run; inline author interpretation is not a
baseline experiment or independent grade.

## Grade and present

Use deterministic checks for objective outcomes. A blind judge may evaluate
subjective output; required independence cannot be replaced by author grading.
Existing grader/comparator/analyzer prompts are optional rubrics, not dispatch
instructions. Read [schemas](schemas.md) for artifact fields: viewer grades use
an expectations array with text, passed, and evidence.

Use bundled aggregation/viewer scripts only when their required input data is
available. Do not fill missing metrics with zero to satisfy a script. Report
unavailable metrics separately instead of producing a misleading aggregate.

For review, a static HTML viewer is sufficient. Run generate_review.py with
--static and an output path within the permitted scratch scope; inspect its
actual output before sharing the link. Start a server only when supported and
authorized by host policy, manage its lifetime, and stop it after review.
No viewer is required to finish static validation.

Read feedback from the user or the exact selected artifact; do not scan private
Downloads for a guessed file. Empty or absent feedback is not approval.
Summarize per-case pass/fail/not-run and uncertainty, then resume the active
Change Loop action. Evaluation output alone does not establish harness proof.
