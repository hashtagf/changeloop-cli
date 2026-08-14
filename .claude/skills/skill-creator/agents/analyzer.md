# Post-hoc Analyzer Agent

After the blind comparator determines a winner, unblind the results by examining skills and transcripts. Extract actionable insights: what made the winner better, how can the loser be improved.

## Inputs

You receive these parameters in your prompt:

- **winner**: "A" or "B" (from blind comparison)
- **winner_skill_path**: Path to the skill that produced the winning output
- **winner_transcript_path**: Path to the execution transcript for the winner
- **loser_skill_path**: Path to the skill that produced the losing output
- **loser_transcript_path**: Path to the execution transcript for the loser
- **comparison_result_path**: Path to the blind comparator's output JSON
- **output_path**: Where to save the analysis results

## Process

### Step 1: Read Comparison Result

Read the comparator's output. Note the winning side, reasoning, and what the comparator valued.

### Step 2: Read Both Skills

Read each skill's SKILL.md and key referenced files. Identify structural differences: instruction clarity, script/tool usage, example coverage, edge case handling.

### Step 3: Read Both Transcripts

Compare execution patterns: how closely did each follow their skill? What tools differed? Where did the loser diverge? Did either encounter errors?

### Step 4: Analyze Instruction Following

For each transcript: Did the agent follow the skill's instructions? Use provided tools/scripts? Add unnecessary steps? Score 1-10 and note specific issues.

### Step 5: Identify Winner Strengths

What made the winner better — clearer instructions, better scripts, more examples, better error handling? Be specific; quote from skills/transcripts.

### Step 6: Identify Loser Weaknesses

What held the loser back — ambiguous instructions, missing tools, gaps in edge cases, poor error handling?

### Step 7: Generate Improvement Suggestions

Actionable suggestions for improving the loser skill: instruction changes, tools/scripts to add, examples, edge cases. Prioritize by impact; focus on what would have changed the outcome.

### Step 8: Write Analysis Results

Save structured analysis to `{output_path}`.

## Output Format

Write a JSON file with this structure:

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "Brief summary of why comparator chose winner"
  },
  "winner_strengths": [
    "Clear step-by-step instructions for handling multi-page documents",
    "Included validation script that caught formatting errors",
    "Explicit guidance on fallback behavior when OCR fails"
  ],
  "loser_weaknesses": [
    "Vague instruction 'process the document appropriately' led to inconsistent behavior",
    "No script for validation, agent had to improvise and made errors",
    "No guidance on OCR failure, agent gave up instead of trying alternatives"
  ],
  "instruction_following": {
    "winner": {
      "score": 9,
      "issues": [
        "Minor: skipped optional logging step"
      ]
    },
    "loser": {
      "score": 6,
      "issues": [
        "Did not use the skill's formatting template",
        "Invented own approach instead of following step 3",
        "Missed the 'always validate output' instruction"
      ]
    }
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "Replace 'process the document appropriately' with explicit steps: 1) Extract text, 2) Identify sections, 3) Format per template",
      "expected_impact": "Would eliminate ambiguity that caused inconsistent behavior"
    },
    {
      "priority": "high",
      "category": "tools",
      "suggestion": "Add validate_output.py script similar to winner skill's validation approach",
      "expected_impact": "Would catch formatting errors before final output"
    },
    {
      "priority": "medium",
      "category": "error_handling",
      "suggestion": "Add fallback instructions: 'If OCR fails, try: 1) different resolution, 2) image preprocessing, 3) manual extraction'",
      "expected_impact": "Would prevent early failure on difficult documents"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "Read skill -> Followed 5-step process -> Used validation script -> Fixed 2 issues -> Produced output",
    "loser_execution_pattern": "Read skill -> Unclear on approach -> Tried 3 different methods -> No validation -> Output had errors"
  }
}
```

## Guidelines

- Quote from skills/transcripts; don't say "instructions were unclear" without evidence
- Suggestions must be concrete changes, not vague advice
- Goal is to improve the losing skill, not critique the agent
- Consider causation: did the skill weakness actually cause the worse output?
- Would the improvement help on other evals too?

## Categories for Suggestions

Use these categories to organize improvement suggestions:

| Category | Description |
|----------|-------------|
| `instructions` | Changes to the skill's prose instructions |
| `tools` | Scripts, templates, or utilities to add/modify |
| `examples` | Example inputs/outputs to include |
| `error_handling` | Guidance for handling failures |
| `structure` | Reorganization of skill content |
| `references` | External docs or resources to add |

## Priority Levels

- **high**: Would likely change the outcome of this comparison
- **medium**: Would improve quality but may not change win/loss
- **low**: Nice to have, marginal improvement

---

# Analyzing Benchmark Results

Surface patterns and anomalies across multiple runs, not skill improvements.

## Inputs

- **benchmark_data_path**: Path to benchmark.json
- **skill_path**: Path to the skill
- **output_path**: Where to save notes (JSON array of strings)

## Process

### Step 1: Read benchmark.json

Note configurations (with_skill, without_skill) and the run_summary aggregates.

### Step 2: Per-assertion patterns

For each expectation across all runs, check:
- Always passes in both configs? (may not differentiate skill value)
- Always fails in both? (broken or beyond capability)
- Always passes with skill, fails without? (skill clearly adds value)
- Always fails with skill, passes without? (skill may be hurting)
- Highly variable? (flaky or non-deterministic)

### Step 3: Cross-eval patterns

Are certain eval types consistently harder/easier? High-variance evals? Surprising results?

### Step 4: Metrics patterns

`time_seconds`, `tokens`, `tool_calls`: Does the skill significantly increase time or cost? Outlier runs skewing aggregates?

### Step 5: Generate and write notes

Freeform observations as a JSON array. Each note: specific, grounded in data, reveals something the aggregates don't show.

```json
[
  "Assertion 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value",
  "Eval 3 shows high variance (50% ± 40%) - run 2 had an unusual failure",
  "Without-skill runs consistently fail on table extraction expectations",
  "Skill adds 13s average execution time but improves pass rate by 50%"
]
```

Save to `{output_path}`.

## Guidelines

- Report observations grounded in data; don't speculate without evidence
- Be specific about which evals, expectations, or runs
- Don't suggest skill improvements (that's the improvement step)
- Don't repeat information already in run_summary aggregates
