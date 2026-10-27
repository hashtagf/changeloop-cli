---
name: skill-evaluation
description: "Evaluate approved skill or description changes against the old version or no-skill baseline. Use for trigger accuracy, instruction regressions, or promotion decisions. Compare actual transcripts and artifacts; skip static catalog validation alone and ordinary product testing."
---

# Skill evaluation

1. Name the changed behavior, baseline, task inputs, observable success criteria,
   and available host capabilities. Pin both variants before running.
2. Author realistic positive, negative, and ambiguous prompts, including Thai
   when supported. Keep expected routes and grading criteria from candidates.
3. Run matched variants in isolated outputs with the same inputs and settings.
   Respect host policy, concurrency, permissions, and budget; never mutate a
   live user's data or infer authority from a fixture prompt.
4. Grade actions, transcripts, and artifacts against independent expectations,
   including false triggers, missed triggers, scope escapes, and evidence gaps.
   Candidate self-reports and reviewer vote counts are not proof.
5. Report per-case outcomes, repetitions, measured usage/time, uncertainty,
   regressions, and promotion recommendation. Missing runs or costs stay unknown.

Read [evaluation cases](references/evaluation-cases.json) for catalog examples
and [evaluation procedure](references/procedure.md) for comparison safeguards.
Static checks are not model evaluations. Keep results outside shipped files.
Shipped edits follow Change Loop; only its providers can establish proof.
Use `skill-creator` to author accepted changes.
