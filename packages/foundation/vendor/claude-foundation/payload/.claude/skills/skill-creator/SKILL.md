---
name: skill-creator
description: Create, modify, evaluate, or optimize skills when the user explicitly asks or approves a recurring-procedure proposal. Do not create skills silently during ordinary implementation.
---

# Skill Creator

A skill for creating new skills and iteratively improving them.

## Change-loop boundary

This skill is an explicit handoff, not a background lifecycle step. A recurring
procedure may be proposed as a follow-up OpenSpec change, but only user approval
authorizes creating or modifying skill files.

Use the Foundation change loop for material shipped-skill changes. Keep test
prompts, measured results, and user feedback as evaluation evidence; do not
invent a parallel implementation-status ledger.

The high-level loop:

- Decide what the skill should do
- Write a draft
- Create test prompts and run claude-with-access-to-the-skill on them
- While runs are in progress, draft quantitative assertions; use `eval-viewer/generate_review.py` to present results
- Rewrite based on feedback and benchmark results; repeat
- Expand the test set at larger scale
- Optionally run the description optimizer

Figure out where the user is in this process and jump in. Be flexible — if they want to skip evals and iterate informally, do that.

## Communicating with the user

Read the user's technical level from context. "Evaluation" and "benchmark" are borderline jargon; "JSON" and "assertion" need clear cues before using without explanation. Brief inline definitions are fine.

## Workflow phases

| Phase | What happens | Reference |
|---|---|---|
| 1. Creating a skill | Capture intent, interview, write SKILL.md (name/description/compatibility), follow the anatomy + progressive-disclosure + writing-pattern conventions, draft test-case prompts | `references/creating-skills.md` |
| 2. Running and evaluating test cases | Spawn with-skill + baseline runs in parallel, draft assertions, capture timing as notifications arrive, grade + aggregate + launch the eval viewer, read feedback | `references/testing-and-evaluation.md` |
| 3. Improving the skill | Generalize from feedback, keep the prompt lean, explain the why, iterate until the user is happy or progress stalls; optional blind A/B comparison | `references/improving-skills.md` |
| 4. Description optimization | Generate trigger eval queries, review with the user, run the automated optimization loop, apply the winning description | `references/description-optimization.md` |
| 5. Package and present / environment specifics | Package via `present_files` + `scripts.package_skill`; Claude.ai and Cowork have different constraints (no subagents, headless viewer, etc.) | `references/environment-specifics.md` |

## Reference files

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent. Do not edit these files as part of a skill-slimming pass.

- `agents/grader.md` — How to evaluate assertions against outputs
- `agents/comparator.md` — How to do blind A/B comparison between two outputs
- `agents/analyzer.md` — How to analyze why one version beat another

The `references/` directory has additional documentation:

| File | Read when |
|---|---|
| `references/creating-skills.md` | Drafting a new skill: intent capture, interview, SKILL.md anatomy, writing patterns, test-case prompts |
| `references/testing-and-evaluation.md` | Running with-skill/baseline test cases, grading, aggregating benchmarks, launching the eval viewer |
| `references/improving-skills.md` | Iterating on feedback, or running a rigorous blind version comparison |
| `references/description-optimization.md` | Tuning the `description` frontmatter field for triggering accuracy |
| `references/environment-specifics.md` | Packaging, or running in Claude.ai / Cowork instead of Claude Code |
| `references/schemas.md` | JSON structures for evals.json, eval_metadata.json, grading.json, timing.json, benchmark.json, comparison.json, analysis.json, feedback.json, etc. |

Track implementation work in the active `tasks.md` when a change exists;
otherwise use the host's transient plan only. Never create a second durable
status store.
