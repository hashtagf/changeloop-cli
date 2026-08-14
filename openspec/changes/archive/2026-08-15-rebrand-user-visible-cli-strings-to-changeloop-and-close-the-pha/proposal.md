# Change: Rebrand user-visible CLI strings to changeloop and close the Phase-0 identity shim gaps

## Why

The CLI bin and scriptName already say changeloop, but --help command descriptions, runtime messages, and command hints still say opencode, and four Phase-0 compat shims have gaps, so the product presents a mixed identity

## What changes

- CLI --help descriptions and user-facing runtime strings in packages/opencode/src say changeloop; command hints suggest `changeloop ...`; help snapshots regenerated and a brand test forbids stray opencode tokens outside an explicit functional-literal allowlist
- packages/core/package.json publishes a changeloop bin alongside the kept opencode bin
- packages/opencode/src/config/config.ts global config discovery prefers changeloop.jsonc/changeloop.json over opencode.jsonc/opencode.json/config.json, and the merge order lets changeloop values win
- packages/core/src/global.ts honors CHANGELOOP_TEST_HOME with OPENCODE_TEST_HOME fallback
- Project config discovery walks .changeloop directories before .opencode in packages/opencode/src/config/paths.ts, packages/core/src/config.ts, and packages/core/src/plugin/agent.ts
- docs/sync/UPSTREAM.md branding-file allowlist records the reviewed user-visible-string surface

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none

## Non-goals

- npm scope @opencode-ai/*, Effect service tags, SDK exports, openapi.json, docs site, READMEs, opencode.ai URLs, GitHub repo references, installer, desktop app ids: all deferred to roadmap Phase 3 per docs/sync/UPSTREAM.md
- Functional literals stay opencode: provider ids, OAuth client identifiers, default basic-auth username, mDNS opencode.local, /etc/opencode managed paths, tui migration paths, httpapi/OpenAPI descriptions
