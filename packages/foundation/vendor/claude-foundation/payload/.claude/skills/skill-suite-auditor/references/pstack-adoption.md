# pstack adoption map

Reviewed source: Michael Denyer's pstack 0.9.78, commit
[5062f28d9d0cedaed2622a9be82961a7d1df051a](https://github.com/michael-denyer/pstack-claude/tree/5062f28d9d0cedaed2622a9be82961a7d1df051a/plugins/pstack/skills).
The original project credits Lauren Tan and Cursor imports; its MIT licenses
and notices remain at that pinned source. This map records ideas reviewed,
not an imported plugin or a promise to retain every upstream instruction.
The Change Loop guidance is independently written for its existing contracts.

Second reviewed source, 2026-10-15: Cursor's upstream `cursor/plugins` at commit
[e5136d82418d2db3165ea1050d17577cd618cc05](https://github.com/cursor/plugins/tree/e5136d82418d2db3165ea1050d17577cd618cc05/pstack),
directory `pstack/` (MIT, credits Lauren Tan). Its ideas map to the same owners
below; the table rows are unchanged.

## Disposition

All 58 source skills have a destination below. Destinations select the owner of
the idea, not a requirement to invoke every skill or copy its text. Retain
existing Change Loop command names and aliases.

| Source skill | Change Loop owner |
|---|---|
| `how` | `investigate` |
| `why` | `investigate` |
| `recall` | `investigate` |
| `architect` | `architecture-fundamentals / programming-fundamentals` |
| `arena` | `brainstorming / investigation comparison` |
| `swarm` | `build dispatch policy` |
| `deslop` | `coding-discipline` |
| `no-comments` | `coding-discipline` |
| `tdd` | `testing-fundamentals` |
| `create-verification-skill` | `testing-fundamentals` |
| `maintain-verification-skill` | `testing-fundamentals` |
| `benchmark-checklist` | `performance-investigation` |
| `interrogate` | `prove configured review` |
| `thermo-nuclear-code-quality-review` | `prove configured review` |
| `fix-ci` | `delivery-engineering / git-workflow` |
| `babysit` | `delivery-engineering / git-workflow` |
| `fix-merge-conflicts` | `delivery-engineering / git-workflow` |
| `get-pr-comments` | `delivery-engineering / git-workflow` |
| `make-pr-easy-to-review` | `delivery-engineering / git-workflow` |
| `automate-me` | `skill-creator / skill-evaluation / skill-suite-auditor` |
| `reflect` | `skill-creator / skill-evaluation / skill-suite-auditor` |
| `correct` | `skill-creator / skill-evaluation / skill-suite-auditor` |
| `teach` | `init-project-docs / claude-md` |
| `technical-writing` | `init-project-docs / claude-md` |
| `unslop` | `init-project-docs / claude-md` |
| `bro` | `init-project-docs / claude-md` |
| `show-me-your-work` | `changes / harness-html-report` |
| `what-did-i-get-done` | `changes / harness-html-report` |
| `poteto-mode` | `existing lifecycle entry points` |
| `poteto-help` | `existing lifecycle entry points` |
| `setup-pstack` | `existing lifecycle entry points` |
| `blast-radius` | `change-impact-analysis` |
| `figure-it-out` | `plan-writing / existing lifecycle entry points` |
| `typescript-best-practices` | `programming-fundamentals / hexagonal-backend` |
| `principle-attack-the-premise` | `debug-fundamentals` |
| `principle-fix-root-causes` | `debug-fundamentals` |
| `principle-boundary-discipline` | `programming-fundamentals` |
| `principle-model-the-domain` | `programming-fundamentals` |
| `principle-type-system-discipline` | `programming-fundamentals` |
| `principle-laziness-protocol` | `coding-discipline / refactoring-fundamentals` |
| `principle-minimize-reader-load` | `coding-discipline / refactoring-fundamentals` |
| `principle-subtract-before-you-add` | `coding-discipline / refactoring-fundamentals` |
| `principle-redesign-from-first-principles` | `coding-discipline / refactoring-fundamentals` |
| `principle-foundational-thinking` | `architecture-fundamentals / plan-writing` |
| `principle-exhaust-the-design-space` | `architecture-fundamentals / plan-writing` |
| `principle-outcome-oriented-execution` | `architecture-fundamentals / plan-writing` |
| `principle-sequence-verifiable-units` | `architecture-fundamentals / plan-writing` |
| `principle-make-operations-idempotent` | `concurrency-fundamentals / queue-fundamentals` |
| `principle-separate-before-serializing-shared-state` | `concurrency-fundamentals / queue-fundamentals` |
| `principle-migrate-callers-then-delete-legacy-apis` | `api-design-fundamentals / change-impact-analysis` |
| `principle-prove-it-works` | `testing-fundamentals / prove` |
| `principle-test-behavior-not-implementation` | `testing-fundamentals / prove` |
| `principle-explain-the-number` | `performance-investigation / skill-evaluation` |
| `principle-experience-first` | `ux-ui-principles / frontend-design` |
| `principle-build-the-lever` | `skill-creator / coding-discipline` |
| `principle-encode-lessons-in-structure` | `skill-creator / coding-discipline` |
| `principle-guard-the-context-window` | `native host and harness packets` |
| `principle-never-block-on-the-human` | `native host and harness packets` |

## Adaptation constraints

- Replace poteto-mode's orchestration and setup with existing lifecycle entry
  points, host capabilities, and returned packets. Do not install a second
  SessionStart router or overwrite project model configuration.
- Use design alternatives only for real uncertainty. Design findings go into
  the active OpenSpec design; workers follow harness dispatch, not an arena
  scheduler, private task ledger, or self-created worktrees.
- Code cleanup preserves non-obvious rationale, public contracts, and safety
  checks until evidence supports removal. Comment ambiguity is not deletion
  authority; a file-size threshold is not a correctness failure.
- Historical recall/reporting separates authored, verified, merged, deployed,
  and archived states. Original human decisions outrank agent paraphrases.
  Read only the authorized workspace's history.
- Product repair continues while progress changes; imported retry ceilings do
  not replace the harness's budget or no-progress boundary. Application
  network/job retries still have their own bounded failure contracts.
- Build-produced verification helpers must exercise real surfaces, retain
  evidence after teardown, and pass their own success/failure checks. Providers
  bind proof; a generated skill or reviewer summary cannot write receipts.
- Reviewer independence and diversity come from configured policy, not vote
  counts, model names, or a new reviewer dispatch initiated by a skill.
- Git, PR, tracker messages, deployment, paid execution, and publication keep
  separate authority. Land applies uncommitted diffs and archives through the
  canonical advance route; it preserves repository HEAD and index.
- Not adopted from e5136d8: never-block-on-the-human,
  outcome-oriented-execution, subtract-before-you-add, autonomy for external
  actions, and playbook Git/PR steps. User decision gates, approved scope,
  and separate external authority stay in force. "Fix every instance" is
  limited to the change's scope; report other instances as follow-up.

## Verification boundary

Operational procedures supplement the concept map:

- Mechanics, rationale, scoped recall, and fair option comparison:
  [source reconstruction](../../investigate/references/source-reconstruction.md).
- Residue removal that preserves rationale and failure-path guards:
  [cleanup](../../coding-discipline/references/cleanup.md).
- Current-revision CI diagnosis and dependency-ordered review repair:
  [CI and review repair](../../delivery-engineering/references/ci-and-review-repair.md).
- Real-surface driver creation, failure discrimination, and maintenance:
  [verification drivers](../../testing-fundamentals/references/verification-drivers.md).
- Bounded optimization attempts with a frozen harness and plateau stop:
  [hillclimb](../../performance-investigation/references/hillclimb.md).
- Stopping repeated failed fixes until a falsifiable premise is tested:
  [root cause](../../debug-fundamentals/references/root-cause.md).
- Stating how far an impact claim was proven:
  [proof ladder](../../change-impact-analysis/references/proof-ladder.md).
- Document mode, plain prose, and protected text:
  [writing](../../init-project-docs/references/writing.md).

These procedures are written instructions. Offline helper regressions establish
measurement handling and held-out independence; they do not execute the proposed
model routing cases or establish a model-quality improvement.

Catalog checks establish metadata/reference integrity only. Trigger cases in
`../../skill-evaluation/references/evaluation-cases.json` are proposed behavioral
inputs with expected actions. A static audit does not execute those inputs.
Use actual transcripts and observed artifacts before claiming model behavior
or an improvement in time, tokens, or quality.
