# Improving the skill

Companion to the "Improving the skill" phase of [[skill-creator]].

## How to think about improvements

1. **Generalize from feedback.** You're iterating on a few examples, but the skill must work across many different prompts. Avoid overfitting or rigid MUSTs. For stubborn issues, try different metaphors or working patterns rather than fiddly constraints.

2. **Keep the prompt lean.** Remove what isn't pulling its weight. Read the transcripts — if the skill causes unproductive work, cut the parts driving it.

3. **Explain the why.** LLMs respond better to understanding than rigid commands. If you find yourself writing ALWAYS/NEVER in all caps or imposing super-rigid structures, reframe as reasoning. Draft a revision, then review it fresh.

4. **Look for repeated work.** If multiple test transcripts show subagents writing the same helper script, bundle it in `scripts/` and tell the skill to use it.

## The iteration loop

After improving the skill:

1. Apply your improvements to the skill
2. Rerun all test cases into a new `iteration-<N+1>/` directory, including baseline runs. If you're creating a new skill, the baseline is always `without_skill` (no skill) — that stays the same across iterations. If you're improving an existing skill, use your judgment on what makes sense as the baseline: the original version the user came in with, or the previous iteration.
3. Launch the reviewer with `--previous-workspace` pointing at the previous iteration
4. Wait for the user to review and tell you they're done
5. Read the new feedback, improve again, repeat

Keep going until:
- The user says they're happy
- The feedback is all empty (everything looks good)
- You're not making meaningful progress

## Advanced: Blind comparison

For rigorous version comparisons, read `agents/comparator.md` and `agents/analyzer.md`. An independent agent judges two outputs without knowing which skill produced which, then the analyzer explains why the winner won. Optional; the human review loop is usually sufficient.
