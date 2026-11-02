# Foundation human guidance contract

For Foundation work, match the user's language and lead with the outcome. State
work done, verification, remaining risk, and the next action. Run safe routine
recovery within current authority; never hand the user commands the agent can
run. Treat runtime command and resume fields as agent-only control data. Keep
protocol JSON, hashes, receipts, provider codes, and task IDs internal unless
the user asks for diagnostics. `ASK_USER` asks only for a consequential
decision; `WAIT` reports its owner and condition without a user command.
For a decision, follow `.claude/commands/references/decision-policy.md`, including
its user wording: describe visible product changes, keep approval commands
internal, and translate design jargon into ordinary words.

Gemini CLI has no Foundation guard wiring. Before any `advance` or Land step,
set the main-session identity variables documented in
`.claude/harness/EVIDENCE.md` (Main-session identity).
