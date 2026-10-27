# Build operating policy

The protocol-v5 `advance` action is the current authority. Do not call lifecycle
primitives unless its recovery explicitly names one. Update `tasks.md` only for
the returned task after focused checks; the coordinator owns planning and phase
transitions.

For every mutating Bash command — redirects and heredocs, `sed -i`, `ln`,
`cp`, `mv`, `rm`, `touch`, package scripts, `npx` — begin with
`cd <workspace or a directory inside it> && ...`; the live phase guard proves
the command text. On Claude Code it pins the shell's reported directory as
that anchor when it lies inside the workspace; other hosts refuse an
unanchored command, so anchor explicitly. It rejects
an unanchored command, absolute outside operands, later directory escapes,
symlink traversal, and copying or linking from outside the workspace. A fresh
workspace has no installed dependencies: rely on `sandbox.setupCommand` in
`foundation.json`, or run the project's install once inside the workspace;
never link or copy the checkout's `node_modules`. Run returned long commands through
`claude-foundation exec`; it derives the active phase and starts Build children
in the canonical workspace. Prefer structured Edit/Write tools for product
changes.

Move unauthorized infrastructure operations to a semantic amendment that adds
an external operation; never ask for credentials. Time a returned long command
only when its action requests observed execution.

For defect guards, test adjacent input partitions and source-language coercion
boundaries before completing their tasks; do not stop at the reported repro.

Reuse an existing deterministic test command for every claim it actually
observes, including compatibility and validation claims. Do not create a
bespoke evidence executable merely to give a capability its own command. If
no existing check can observe a claim, declare the new checker as product work
in `tasks.md`, test its success and failure paths, and keep those tests in the
normal quality run; an untested checker cannot be completion evidence.

Ask only for structured decisions. Ask again only if behavior, compatibility,
security, data, or rollout must change. Provider and permission failures follow
typed recovery.

## Convergent gates

Before product edits, obey the action boundary. `advance` has already evaluated
authority preflight; do not repeat it.

For every Build gate, run all independent eligible checks before repair. Group
findings by root cause, build one dependency-ordered repair batch, apply every
safe in-contract fix, and rerun only failed, unavailable, downstream,
input-invalidated, or mandatory global checks. Continue without a repair-count
limit while the progress fingerprint changes.

At a decision, authority, resource, conflict, contradictory-contract, or
repeated no-progress boundary, preserve the sandbox, present the typed choices,
and resume the same Build yourself after resolution. Keep the resume route
agent-only unless the user requests diagnosis. Never turn repeated execution or
a stale receipt into a pass.
