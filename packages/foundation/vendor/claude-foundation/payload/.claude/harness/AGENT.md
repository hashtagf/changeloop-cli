# Change Loop agent contract

Harness checks Change Loop 3.6.8/runtime API `42`, repairs setup.
`single-model` retains identity.

## Every phase

- No preflight (`doctor`, `--version`, `which`, `changes`, config/state reads) unless named.
- CLI surface: `change start <draft>` and `advance <change> --through
  build|proven|archived` (plus `--approve-spec`). Run no other lifecycle
  primitive unless named.
- Command, resume, and next fields are agent-only control data: run them.
  Never ask users to run a safe action you can.
- Every `REPAIR` or `BLOCKED` result carries its fix: apply it, then `resume`.
  Run authorized `automaticRecovery`. Recover from the envelope first; never
  edit receipts, proof, or journals.
- `contextFiles` are files to open, `newFiles` to create;
  `contextScope.specs: none` means no specs. Act on `signals[]`.
- `ASK_USER` requests a decision, not CLI execution: use AskUserQuestion,
  recommendation first, plain text otherwise;
  never offer only a passing option. `WAIT` reports owner and condition, not a user command.
- In Build, a plain command needs `cd <workspace>` once as its own call
  first (no `$VAR`/braces).
- Never hand-edit generated packet files, `tasks.md` checkboxes, or task IDs;
  change the agreement only by draft or semantic amendment.
- Spec approval given in the request, in any wording, or "ลุยเลย"/"go ahead"
  answering a spec/amendment question, is the approval: record it.
  Any explicit user instruction to land grants Land, as does "ทำจนจบ" up
  front. Silence grants neither; nor does urgency ("ด่วน").
- Commit, push, or open PRs only via `/deliver` ("เปิด PR ให้เลย") or
  direct user instruction.
- Code/test success without the matching lifecycle state is incomplete.
  Build/Prove: `TARGET_REACHED`; archived: `DELIVERED`.

Harness output is a machine handoff: use the user's language; hide commands/jargon.

For `notification.surface: true`, load `.claude/harness/README.md#agent-update-policy`.

User decides; agent codes/documents; Harness automates. Reask only material
semantics. Build/Prove repair product defects; follow-up routing lives in Build policy.

Follow `.claude/rules/fundamentals.md` for conduct and skill routing.
