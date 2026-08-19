# Package and Present / Environment-Specific Instructions

Companion to the closing phases of [[skill-creator]].

## Package and Present

Only if `present_files` tool is available.

Check whether you have access to the `present_files` tool. If you don't, skip this step. If you do, package the skill and present the .skill file to the user:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

After packaging, direct the user to the resulting `.skill` file path so they can install it.

## Claude.ai-specific instructions

Same workflow (draft → test → review → improve → repeat), but no subagents:

**Running test cases**: Run each test case yourself sequentially — read the SKILL.md and follow its instructions to accomplish the task. Skip baseline runs.

**Reviewing results**: If no browser is available, present results inline. For file outputs, save to filesystem and tell the user where to find them. Ask for feedback inline.

**Benchmarking**: Skip quantitative benchmarking; focus on qualitative feedback.

**Description optimization**: Requires `claude` CLI (`claude -p`), Claude Code only. Skip on Claude.ai.

**Blind comparison**: Requires subagents. Skip.

**Packaging**: `package_skill.py` works anywhere with Python.

**Updating an existing skill**: Preserve the original directory name and `name` frontmatter unchanged. Copy to `/tmp/skill-name/` before editing (installed path may be read-only). Stage in `/tmp/` before copying to output directory.

## Cowork-Specific Instructions

- Subagents work (parallel test runs, baselines, grading). Fall back to serial on severe timeout issues.
- No browser: use `--static <output_path>` for the eval viewer; share the HTML link with the user.
- GENERATE THE EVAL VIEWER *BEFORE* evaluating inputs yourself — use `generate_review.py`, not custom HTML. Get results in front of the human ASAP.
- Feedback: "Submit All Reviews" downloads `feedback.json`; read it from there.
- Packaging: `package_skill.py` works.
- Description optimization: works in Cowork (uses `claude -p` via subprocess); run after the skill is finalized.
- **Updating an existing skill**: Follow the update guidance in the Claude.ai section above.

In Cowork specifically: add "Create evals JSON and run `eval-viewer/generate_review.py` so human can review test cases" to ensure it happens.
