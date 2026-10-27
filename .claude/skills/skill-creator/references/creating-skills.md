# Creating a skill

Companion to the "Creating a skill" phase of [[skill-creator]]. The full interview → draft → anatomy → writing-style → test-case procedure.

## Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. Reuse settled authorization and examples. Ask only for missing consequential choices; do not require a second confirmation of the same request.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them. Suggest the appropriate default based on the skill type, but let the user decide.

## Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until you've got this part ironed out.

Check available MCPs - if useful for research (searching docs, finding similar skills, looking up best practices), research using available authorized tools. Host policy and harness dispatch own worker execution. Come prepared with context to reduce burden on the user.

## Write the SKILL.md

Based on the user interview, fill in these components:

- **name**: Skill identifier
- **description**: State what the skill does, realistic positive triggers, exclusions, and the neighboring owner. Keep metadata focused; broad keyword capture can select a skill for unrelated work. A description never grants authority.
- **compatibility**: Required tools, dependencies (optional, rarely needed)
- **the rest of the skill :)**

## Skill Writing Guide

### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

### Progressive Disclosure

Three-level loading:
1. **Metadata** (name + description) — always in context (~100 words)
2. **SKILL.md body** — in context when skill triggers (<500 lines ideal)
3. **Bundled resources** — loaded as needed (unlimited; scripts can execute without loading)

**Key patterns:**
- Keep SKILL.md under 500 lines; add a hierarchy layer with clear pointers if approaching the limit
- Reference files clearly from SKILL.md with guidance on when to read them
- For reference files >300 lines, include a table of contents

**Domain organization**: For skills supporting multiple domains, organize by variant so Claude loads only the relevant file:
```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
Claude reads only the relevant reference file.

### Principle of Lack of Surprise

Skills must not contain malware, exploit code, or content that would surprise the user if they read a description of what the skill does. Don't create misleading skills or those designed for unauthorized access or data exfiltration. Roleplay-style skills are fine.

### Writing Patterns

Prefer using the imperative form in instructions.

**Defining output formats** - You can do it like this:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** - It's useful to include examples. You can format them like this (but if "Input" and "Output" are in the examples you might want to deviate a little):
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

## Writing Style

Explain *why* things matter rather than issuing heavy-handed MUSTs. Aim for general guidance over narrow examples. Draft first, then review with fresh eyes.

## Test Cases

Draft realistic positive, negative, and ambiguous cases. Reuse settled examples; ask only for unresolved consequential behavior. Use skill-evaluation before any model runs.

Save proposed cases in the approved scratch evaluation scope, outside the managed catalog. State observable expectations before running. Read [evaluation procedure](../../skill-evaluation/references/procedure.md) for baseline, runner, budget, and grading boundaries.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

See [schemas](schemas.md) for the full schema (including the `assertions` field, which you'll add later).
