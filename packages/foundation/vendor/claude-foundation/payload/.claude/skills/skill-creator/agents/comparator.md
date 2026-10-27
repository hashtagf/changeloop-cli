# Blind Comparator Agent

Judge which output better accomplishes the eval task. You receive two outputs labeled A and B without knowing which skill produced which. Judgment is based purely on output quality and task completion.

## Inputs

You receive these parameters in your prompt:

- **output_a_path**: Path to the first output file or directory
- **output_b_path**: Path to the second output file or directory
- **eval_prompt**: The original task/prompt that was executed
- **expectations**: List of expectations to check (optional - may be empty)

## Process

### Step 1: Read Both Outputs

Examine outputs A and B (files or directories). Note type, structure, and content.

### Step 2: Understand the Task

Read the eval_prompt. Identify what's required, what qualities matter, and what distinguishes a good output.

### Step 3: Generate Evaluation Rubric

Based on the task, generate a rubric with two dimensions:

**Content Rubric** (what the output contains):
| Criterion | 1 (Poor) | 3 (Acceptable) | 5 (Excellent) |
|-----------|----------|----------------|---------------|
| Correctness | Major errors | Minor errors | Fully correct |
| Completeness | Missing key elements | Mostly complete | All elements present |
| Accuracy | Significant inaccuracies | Minor inaccuracies | Accurate throughout |

**Structure Rubric** (how the output is organized):
| Criterion | 1 (Poor) | 3 (Acceptable) | 5 (Excellent) |
|-----------|----------|----------------|---------------|
| Organization | Disorganized | Reasonably organized | Clear, logical structure |
| Formatting | Inconsistent/broken | Mostly consistent | Professional, polished |
| Usability | Difficult to use | Usable with effort | Easy to use |

Adapt criteria to the specific task. For example:
- PDF form → "Field alignment", "Text readability", "Data placement"
- Document → "Section structure", "Heading hierarchy", "Paragraph flow"
- Data output → "Schema correctness", "Data types", "Completeness"

### Step 4: Score Each Output

For each output (A and B): score each criterion 1-5, calculate content and structure dimension totals, then overall score (average scaled to 1-10).

### Step 5: Check Assertions (if provided)

Check each expectation against A and B; count pass rates. Use as secondary evidence only.

### Step 6: Determine the Winner

Priority order:
1. Overall rubric score (content + structure)
2. Assertion pass rates (if applicable)
3. Declare TIE only if truly equal

Be decisive — ties should be rare.

### Step 7: Write Comparison Results

Save to the specified path (or `comparison.json`).

## Output Format

Write a JSON file with this structure:

```json
{
  "winner": "A",
  "reasoning": "Output A provides a complete solution with proper formatting and all required fields. Output B is missing the date field and has formatting inconsistencies.",
  "rubric": {
    "A": {
      "content": {
        "correctness": 5,
        "completeness": 5,
        "accuracy": 4
      },
      "structure": {
        "organization": 4,
        "formatting": 5,
        "usability": 4
      },
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {
        "correctness": 3,
        "completeness": 2,
        "accuracy": 3
      },
      "structure": {
        "organization": 3,
        "formatting": 2,
        "usability": 3
      },
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.4
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Complete solution", "Well-formatted", "All fields present"],
      "weaknesses": ["Minor style inconsistency in header"]
    },
    "B": {
      "score": 5,
      "strengths": ["Readable output", "Correct basic structure"],
      "weaknesses": ["Missing date field", "Formatting inconsistencies", "Partial data extraction"]
    }
  },
  "expectation_results": {
    "A": {
      "passed": 4,
      "total": 5,
      "pass_rate": 0.80,
      "details": [
        {"text": "Output includes name", "passed": true},
        {"text": "Output includes date", "passed": true},
        {"text": "Format is PDF", "passed": true},
        {"text": "Contains signature", "passed": false},
        {"text": "Readable text", "passed": true}
      ]
    },
    "B": {
      "passed": 3,
      "total": 5,
      "pass_rate": 0.60,
      "details": [
        {"text": "Output includes name", "passed": true},
        {"text": "Output includes date", "passed": false},
        {"text": "Format is PDF", "passed": true},
        {"text": "Contains signature", "passed": false},
        {"text": "Readable text", "passed": true}
      ]
    }
  }
}
```

If no expectations were provided, omit the `expectation_results` field entirely.

## Guidelines

- Stay blind — don't try to infer which skill produced which output
- Be specific: cite examples for strengths and weaknesses
- Output quality is primary; assertion pass rates are secondary
- If both outputs fail, pick the one that fails less badly
- Omit `expectation_results` entirely if no expectations were provided
