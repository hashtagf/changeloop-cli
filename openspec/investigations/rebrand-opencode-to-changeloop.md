# Investigation: rebrand all opencode → changeloop

Date: 2026-08-15. Request: "rebrand all opencode to changeloop".

## Facts

- Fork of `anomalyco/opencode` with a live `upstream` remote. Landed specs
  (`openspec/specs/upstream-sync/spec.md`, `docs/sync/UPSTREAM.md`) pin a
  branding-file allowlist of four files and explicitly defer the npm scope
  (`@opencode-ai/*`, 37 packages) and Effect service tags (`@opencode/…`) to
  roadmap Phase 3 ("Full rebrand — npm scope + service tags เมื่อ fork นิ่ง",
  `docs/plan/ROADMAP.md:70`). Phase 0 is landed; Phase 1 has not started.
- Remaining footprint: **~44,000 occurrences across ~2,800 files** (excluding
  node_modules, bun.lock, dist, `.turbo` logs, `.foundation` receipts).
  Skew: 24,430 in `packages/web/src/content` docs (614 mdx × 20 locales),
  ~1,035 in 22 README translations, 5,985 in `packages/app`. Actual CLI code
  (`packages/opencode/src`) is 1,469.
- Already rebranded (Phase 0, landed): bin entry + yargs `scriptName`,
  `const app = "changeloop"` path fallback (`packages/core/src/global.ts`),
  `CHANGELOOP_*`/`OPENCODE_*` env aliasing (`flag/flag.ts`), config filename
  fallback (`packages/core/src/config.ts`), help snapshots, template plugin.
- **Not renameable without breakage** (no changeloop equivalents exist):
  - `opencode.ai` service URLs — config `$schema` (2,181 occ.), zen gateway,
    `/auth`, `/install`, tui/theme JSON: these are upstream's live endpoints.
  - Third-party deps: `opencode-gitlab-auth`, `opencode-poe-auth`.
  - GitHub release URLs (`anomalyco/opencode`) in `install` and publish CI.
- **Third-party breaking if renamed**: `@opencode-ai/{plugin,sdk,schema,…}`
  package names and SDK exports (`OpencodeClient`, `createOpencodeServer`,
  `packages/sdk/openapi.json` 601 occ.) are the published plugin/SDK contract.
- Gaps inside the *intended* Phase-0 scope (shim misses, small, safe):
  - `packages/core/package.json` bin is still `opencode` only (not dual).
  - `packages/opencode/src/config/config.ts:140,259` has an independent,
    unshimmed `opencode.json(c)` discovery list.
  - `packages/core/src/global.ts:33` reads `OPENCODE_TEST_HOME` directly,
    bypassing the alias layer.
  - `.opencode/` project-dir literal hardcoded in ~7 places; no `.changeloop/`.
  - Runtime/help strings in `packages/opencode/src` still say "opencode"
    (command `describe:`s, "opencode server listening", upgrade/uninstall
    messages) → mixed-brand `--help` and runtime output.
- No rebrand codemod/script exists; no central display-name constant.
- Stale 137 MB artifact `packages/opencode/bin/.opencode` sits untracked.

## Hypotheses

- The request means "make the product present as changeloop", not literally
  every string: the literal reading breaks live endpoints and the published
  plugin contract, and contradicts the landed upstream-sync spec.
- A display-name constant in `packages/core` (next to `const app`) would let
  user-visible strings rebrand with one extra allowlist file, keeping most
  future upstream merges cheap for that category.

## Options

1. **Bounded user-visible rebrand now (recommended).** Scope: display-name
   constant + CLI describe/runtime strings in `packages/opencode/src`
   (~300 strings), the four shim gaps above, dual bin in `packages/core`,
   `.changeloop/` dir with `.opencode/` fallback, snapshot regeneration.
   Defer docs site, READMEs, npm scope, service tags, URLs, SDK surface to
   Phase 3 per existing policy. Cost: deep-fork edits outside the allowlist
   (policy requires explicit review; strings conflict textually but trivially
   on merge). Amend `cli-identity` spec + allowlist accordingly.
2. **Literal full rebrand now.** ~44k occurrences; breaks upstream sync
   economics permanently, breaks plugin/SDK consumers, and the service-URL
   subset breaks the running product outright. Requires overriding two landed
   specs. Rejected unless the user explicitly re-decides the fork strategy.
3. **Do nothing until Phase 3.** Zero cost, but `--help` and runtime output
   stay mixed-brand through V1, and the four shim gaps are genuine defects
   against the landed `cli-identity` spec's intent.

## Tradeoffs

- Option 1 trades a bounded, review-gated merge-cost increase (string-level
  conflicts in `packages/opencode/src`) for a coherent user-facing identity
  during Phase 1. Option 3 preserves merge economics fully but ships V1 with
  visible old branding. Option 2 maximizes brand purity and destroys the
  fork's stated maintenance strategy.

## Decision

User chose Option 1 (2026-08-15): rebrand only user-visible surfaces now;
npm scope, service tags, URLs, SDK exports, docs site, and READMEs stay
deferred to Phase 3 per the landed upstream-sync policy.

## Unknowns

- Whether changeloop-owned service endpoints (config schema host, gateway,
  release repo) will ever exist — decides the Phase-3 scope for URL/installer
  rebranding.
- Upstream v1→v2 rewrite timing: `packages/opencode` → `packages/core`+`llm`
  migration may delete/move many branded files, shrinking Option 1's conflict
  surface if it lands first.
