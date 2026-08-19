# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase. Add
> `[claims:<claim-id>]` after each stable task ID once evidence claims exist.
>
> Annotations the planner reads, all optional for a single-repository change:
> `[repo:<id>]` (default `root`), `[kind:<kind>]` (default `implementation`),
> `[paths:<glob,glob>]` — declare these to let two tasks in one repository run
> in parallel — `[depends:<T00n,T00n>]`, and `[resources:<token>]` for a
> genuinely shared resource such as a database. A multi-repository change must
> annotate `[repo:]` and `[paths:]` on every task.

- [x] **T001** Add a deterministic sync step that imports one tagged Foundation
  release, records version/source/checksums, rejects drift, and exposes the full
  release-owned install payload to Bun's compiled-file map.
  [claims:compiled-binary-works-without-path-foundation,payload-drift-blocks-the-build,runtime-use-performs-no-network-download] —
  `packages/opencode/script`, `packages/opencode/vendor`, build configuration —
  verify: the sync/manifest test detects a changed or missing payload file and a
  single-platform build embeds the pinned manifest. [repo:root]
  [paths:packages/opencode/script/**,packages/opencode/vendor/**,packages/opencode/package.json]
- [x] **T002** Add the internal bundled-runtime runner and runtime-source
  selection so command instructions and agent context use the same bundled
  endpoint by default, while explicit PATH mode, timeout/output bounds,
  user-owned commands, and opt-out behavior remain compatible.
  [claims:additive-protocol-response-remains-compatible,canonical-context-is-injected,canonical-project-instruction-is-used,context-endpoint-fails-closed,explicit-path-compatibility-mode,inactive-built-ins-add-no-context,loop-commands-present-by-default,opt-out-disables-injection,partial-foundation-installation-fails-closed] — `packages/opencode/src/plugin`, config
  schemas, focused tests — verify: real protocol-1 instruction and
  agent-contract calls succeed with Foundation removed from PATH and PATH mode
  remains explicitly selectable. [repo:root] [depends:T001]
  [paths:packages/opencode/src/plugin/**,packages/opencode/test/plugin/**,packages/core/src/v1/config/**,packages/core/test/config/**]
- [x] **T003** Add `changeloop foundation init|status|doctor|upgrade` and safe
  first-use detection, invoking only the release-owned installer with canonical
  target confinement, supported-platform checks, explicit mutation authority,
  and stable recovery diagnostics.
  [claims:first-foundation-command-guides-one-time-bootstrap,fresh-project-is-initialized,interrupted-installation-rolls-back-or-resumes-safely,opening-a-project-remains-read-only,repeated-initialization-converges,unsafe-target-is-rejected-before-mutation] — `packages/opencode/src/cli`, CLI tests —
  verify: temporary-project cases prove fresh install, idempotent retry,
  project-file preservation, symlink rejection, rollback after injected failure,
  unsupported-platform refusal, and explicit upgrade. [repo:root]
  [depends:T001,T002]
  [paths:packages/opencode/src/cli/**,packages/opencode/src/index.ts,packages/opencode/test/cli/**]
- [x] **T004** Add content-bound evidence wrappers, compiled-binary smoke
  coverage, and operator documentation for bundled default, first-use approval,
  PATH migration, version reporting, and rollback.
  [claims:additive-protocol-response-remains-compatible,canonical-context-is-injected,canonical-project-instruction-is-used,compiled-binary-works-without-path-foundation,context-endpoint-fails-closed,explicit-path-compatibility-mode,first-foundation-command-guides-one-time-bootstrap,fresh-project-is-initialized,inactive-built-ins-add-no-context,interrupted-installation-rolls-back-or-resumes-safely,loop-commands-present-by-default,opening-a-project-remains-read-only,opt-out-disables-injection,partial-foundation-installation-fails-closed,payload-drift-blocks-the-build,repeated-initialization-converges,runtime-use-performs-no-network-download,unsafe-target-is-rejected-before-mutation]
  — build/evidence scripts and docs — verify: the scoped evidence command emits
  passing observations for every declared critical case and `bun typecheck`
  passes from `packages/opencode`. [repo:root] [depends:T001,T002,T003]
  [paths:script/**,docs/CONFIGURATION.md,docs/plan/ROADMAP.md]
