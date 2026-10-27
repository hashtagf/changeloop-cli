# Phase mutation guard

`phase-mutation-guard.mjs` is a `PreToolUse` policy layer for file mutations and
obviously mutating shell commands. Its default `auto` mode blocks whenever a
fresh Foundation phase is active and stays out of adoption-only sessions where
no lifecycle context exists.

What `.claude/settings.json` wires is `phase-mutation-guard.sh`, a prefilter that
answers the "no phase to guard" case with shell builtins alone and `exec`s the
`.mjs` whenever a decision is actually needed. On a stock install with no active
change that is the difference between ~50ms and ~4ms on every mutating tool call.
The prefilter never reports a violation and never reads the event body: `block`
mode and any recorded phase context always reach the guard, so enforcement and
freshness policy stay in one place.

The phase comes from one of two places, in this order:

1. `FOUNDATION_ACTIVE_PHASE=change|build|prove|land`, if the host exports it.
2. Otherwise the most recent row in `.foundation/logs/<change>/phase-context.jsonl`.
   `change start` establishes Change/Build context and `advance` records the
   phase for its current action, so `/change`, `/build`, `/prove`, and `/land`
   share the same authority without a preparatory `packet` command. A row older
   than 12 hours is treated as no phase: the loop is not running.

A recorded row governs only while its change is still an active OpenSpec
change — `openspec/changes/<id>` exists. Logs outlive their change, so an
archived, abandoned, deleted, or fixture change leaves its last row behind;
without that check the newest such row governed whoever opened the next
session, and one fixture stuck at `building` with no workspace refused every
mutation in its repository for the whole freshness window. Ineligible rows are
skipped and the newest remaining one decides; if none remain there is no phase
to enforce.

The host may also supply:

- `FOUNDATION_WORKSPACE_ROOT=/absolute/build/workspace` during Build
- `FOUNDATION_ALLOWED_PATHS_JSON='["/absolute/extra/path"]'` for explicitly
  declared Build paths
- `FOUNDATION_GUARDRAIL_MODE=auto|audit|block|off` (`auto` is the default)

`FOUNDATION_LAND_TRANSACTION=1` is set by the runtime itself, for the duration
of the Land apply transaction and its child processes. Do not set it by hand:
it is the carve-out that distinguishes a runtime-owned projection from an agent
mutating the tree during Land.

During active Land every mutating shell command requires the transaction
marker, including `git add`, `git commit`, `git push`, amend, force-push, branch
deletion, checkout, reset, cleanup, redirects, and opaque script runners. The
Land slash command authorizes only the recoverable lifecycle transaction; it
never implies delivery authority. Once the change is archived, the phase row
is no longer eligible and a separately authorized commit, push, publication,
or pull request proceeds through the project's normal process.

When no phase can be established, `audit` mode records nothing — there is no
policy to check against, and a row per mutation is noise. `block` mode still
refuses, so a host that asked for enforcement gets it.

Audit records contain policy metadata, not command text or file paths, and are
appended to `.foundation/logs/guardrail-audit.jsonl`. Select explicit `audit`
only for a controlled rollout; `auto` is the normal fail-closed lifecycle mode.

The Bash inspection is a conservative command-word screen, not a shell sandbox.
During Build, an obviously mutating Bash command must begin with `cd`/`pushd`
to a literal absolute directory that is the isolated workspace or inside it,
joined by `&&`; `;` is accepted only for the workspace root, which the harness
guarantees exists. The event's cwd is never authority: when the host reports
the shell inside the workspace, the hook pins that directory into the command
as the literal anchor (`updatedInput`) and audits the pin, so an unanchored
write an agent meant for its sandbox runs there instead of costing a refused
turn; a report outside the workspace, no report (OpenCode synthesizes events
without one), or a pinned form the policy still refuses keeps the refusal, and
audit mode never rewrites. The pin carries no permission decision; when
another PreToolUse hook rewrites the same command with an `allow` decision
(a token-saving proxy, for example), the host applies that hook's rewrite and
the command runs unanchored in the directory the host reported. It checks recognized filesystem operands,
later directory changes, redirection targets, and canonical symlink targets;
literal paths outside that workspace are blocked before execution. A copy or
link whose source lies outside the workspace (`cp ../x .`,
`ln -s <checkout>/node_modules node_modules`) is refused with a reason that
names `sandbox.setupCommand` and an in-workspace install as the routes: a
workspace never borrows the checkout's files. The
`claude-foundation exec` runtime uses the same policy, derives its phase from
change state, and starts Build children in the canonical workspace. Use
structured Edit/Write operations where possible.
A heredoc body behind a quoted delimiter and the inside of a single-quoted
word are literal to the shell and inert to these screens, so template
literals in a TypeScript heredoc, a backtick in a Python docstring, or
`"/status: {` inside a sed script no longer refuse an anchored command; code
handed to an inner shell (`sh -c`, `eval`) or to a writing interpreter is
still read, because it resolves its own paths. A quoted mutation target such
as `> "$OUT"` is refused as dynamic.
Formatter write modes, package-manager scripts (`npm run`, `npx`, and peers,
including read-only checks such as `npx tsc --noEmit`), and shell-script
runners enter the same policy. Dynamic mutation paths using environment
variables, command substitution, backticks, or home expansion are rejected
because their target cannot be proven isolated before execution; exit-status
expansions such as `${PIPESTATUS[0]}` with a literal subscript are integers, not
paths, and stay allowed.
Every Build refusal names the refused operation or fragment, the workspace, and
the prefix or path shape that repairs the command, so an agent can continue
without asking the user or retrying unchanged.
Host process isolation remains required for shell commands, network authority,
and indirect mutations.

## Bounded retry integration

`../harness/runtime/reliability/bounded-retry.mjs` is intentionally standalone. Runtime
providers may wrap only read-only/idempotent infrastructure operations and must
pass `idempotent: true`. Its default classifier retries timeouts, transient
network codes, HTTP 408/429, and HTTP 5xx; validation, security, test assertion,
and business failures are not retried. Pass `onAttempt` to project attempt
metadata into the host execution contract without recording payloads.

Mutation providers and Land transactions must never use this helper unless they
independently implement an idempotency key and recovery contract.
