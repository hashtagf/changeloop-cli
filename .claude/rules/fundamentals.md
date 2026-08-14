# Rule: Fundamentals router

This always-on file detects which one skill to load. Skill bodies hold the
procedure; do not preload them.

## Conduct

- Think before coding. State consequential assumptions; investigate genuinely
  ambiguous direction.
- Put user decisions through the host's structured question tool
  (AskUserQuestion) when the session provides one, options with your
  recommendation first; otherwise ask in plain text. Verify every open
  decision was asked; record the answers in the change packet, not chat.
- Prefer no code, then stdlib/platform, installed dependencies, and finally the
  smallest new implementation.
- Keep every changed line traceable to the request. Do not bundle cleanup.
- Define a checkable outcome and continue until it is met.
- Code/tests outrank specs; specs outrank investigation notes. Resolve conflicts.
- Choose the faster of equally safe paths. Never cut security, error/data-loss
  handling, accessibility, evidence, regression contracts, or Land guards.
- Be terse but complete. Durable intent belongs in OpenSpec; machine status
  belongs in `.foundation/`.
- Skills supply judgment and procedures; the harness owns lifecycle, authority,
  evidence execution, receipts, budgets, and Land. Never create parallel state
  or treat a skill checklist as proof.

Load `coding-discipline` only when scope, assumptions, or diff shape remain
unclear after this digest.

## Process skills

| Trigger | Load |
|---|---|
| Unknown-cause bug, crash, regression, flake, or performance cliff | `debug-fundamentals` first |
| Behavior-preserving restructure | `refactoring-fundamentals` first |
| Test design, level, coverage, or review | `testing-fundamentals` |

## Construction skills

Load one primary construction skill for the task's hardest decision. Add
`security-fundamentals` only for a trust boundary and
`observability-fundamentals` only for a changed runtime failure surface. Do not
load adjacent layers merely because the code imports them. Read a skill
reference only when its named decision is active.

| Trigger | Load |
|---|---|
| Bounded contexts, subdomains, aggregates, semantic ownership | `ddd-strategic` |
| Non-trivial logic, model, module boundary, abstraction depth, implementation, or code review | `programming-fundamentals` |
| Threads, async, shared mutable state, locks, races | `concurrency-fundamentals` |
| Schema, query, index, migration, persistence model | `database-fundamentals` |
| Backend domain logic, use cases, ports, repositories | `hexagonal-backend` |
| Published endpoint/resource/request/response/error/version contract | `api-design-fundamentals` |
| Runtime/deployable split, component relationship, cross-service call, scaling/failure model | `architecture-fundamentals` |
| Broker, stream, job, worker, pub/sub, cross-process async | `queue-fundamentals` |
| Auth/session/token, secrets, untrusted input, SQL/HTML/file/exec sink, crypto, dependency, external endpoint | `security-fundamentals` |
| Runtime failure mode, logs, metrics, traces, SLO, alert, blind spot | `observability-fundamentals` |

Semantic boundaries belong to DDD; local logic to programming; storage
correctness to database; ports to hexagonal; published contracts to API design;
runtime relationships to architecture. Transaction isolation is database work,
in-process races are concurrency work, and cross-process async is queue work.
Choose the deepest decision actually being made, then add only required
cross-cutting skills.

## Delivery skills

| Trigger | Load |
|---|---|
| Branch, commit, merge, rebase, force operation, PR, destructive Git cleanup | `git-workflow` |
| CI/CD, build, container, deploy, environment, rollout/rollback, release | `delivery-engineering` |

Non-lifecycle skills trigger from their descriptions or explicit commands.
