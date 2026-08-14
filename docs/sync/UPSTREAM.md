# Upstream sync policy

`changeloop-cli` is a fork of [OpenCode](https://github.com/anomalyco/opencode).
This document is the sync policy roadmap Phase 0 requires: remote, branch
layout, cadence, and the branding-file allowlist that keeps merge cost bounded
(`docs/plan/ROADMAP.md`, principle 2 — "แตะ fork internals ให้น้อยที่สุด").

## Remote

```
upstream  https://github.com/anomalyco/opencode.git (fetch)
```

Add it once per clone:

```
git remote add upstream https://github.com/anomalyco/opencode.git
```

`origin` stays `hashtagf/changeloop-cli` — the only remote anyone pushes to.

## Branch layout

```
upstream/main ──(merge)──> dev ──(feature branches)──> PRs into dev
```

- `upstream/main` is read-only: fetched, never pushed to, never branched from
  directly for feature work.
- `dev` is this fork's integration branch and the target of every upstream
  merge.
- Feature and fix branches fork from `dev` and merge back into `dev`, same as
  any other change in this repository.

## Merge cadence

- Sync `upstream/main` into `dev` **at the start of every Phase** (roadmap
  Phase 0/1/2/3 boundaries), not continuously — OpenCode is mid v1→v2
  rewrite, so batching sync points avoids chasing a moving target inside a
  single phase of work.
- Also sync ad hoc when a needed upstream fix or the v2 plugin API changes
  in a way that blocks in-progress fork work.
- Each sync is its own change (`/change` → `/build` → `/prove` → `/land`);
  a live `git merge upstream/main` cannot be deterministic evidence, so it is
  never bundled into a change that also claims other behavior.

## Branding-file allowlist

A branding edit may touch only these paths without extra review:

- `packages/core/src/global.ts` — the `app`/`legacyApp` identity constants
  and their directory-fallback helper.
- `packages/core/src/flag/flag.ts` — the `CHANGELOOP_*`/`OPENCODE_*` env
  aliasing.
- `packages/core/src/config.ts` — the `changeloop.json(c)`/`opencode.json(c)`
  discovery `names` list.
- `packages/opencode/package.json` — the `bin` map (adding the `changeloop`
  entry; the package `name` itself is out of scope until roadmap Phase 3).
- `packages/core/package.json` — the `bin` map (dual `changeloop`/`opencode`
  entries; same Phase 3 boundary for the package `name`).
- `packages/opencode/src/config/config.ts` and
  `packages/opencode/src/config/paths.ts` — the v1 CLI's
  `changeloop.json(c)`/`.changeloop` discovery with the legacy
  `opencode.json(c)`/`.opencode` fallback.
- `packages/core/src/plugin/agent.ts` — the `.changeloop/plans` plan-mode
  edit permission next to the kept `.opencode/plans` one.
- **User-visible strings** in `packages/opencode/src` — command `describe:`
  text, printed runtime messages, and command hints say `changeloop`
  (rebrand-user-visible-cli-strings change). Functional literals stay
  `opencode`: provider ids, OAuth client names, the default basic-auth
  username, `opencode.local`, `opencode.internal`, managed paths, URLs, and
  the GitHub app integration. These are string-level diffs; on upstream sync
  conflicts, keep the changeloop wording and re-apply it over upstream's
  surrounding changes. The help snapshots plus
  `packages/opencode/test/brand.test.ts` pin this surface.

Everything else that changeloop needs ships as a plugin under
`packages/plugin/` (roadmap principle 1: "สิ่งใดทำเป็น plugin ได้ให้ทำเป็น
plugin"). A change that needs to touch `packages/core` or `packages/opencode`
outside this allowlist is a deep-fork edit and needs explicit review before
merging, because it is exactly the kind of change that makes every future
upstream sync more expensive.

## Conflict playbook

1. `git fetch upstream`
2. `git checkout dev && git merge upstream/main`
3. Conflicts inside the branding allowlist above: keep the fork's identity
   constants and env/config aliasing; re-apply them on top of upstream's
   surrounding code changes.
4. Conflicts anywhere else: prefer upstream's version unless a landed
   changeloop change specifically depends on the fork's version — check
   `openspec/changes/` (active) and `openspec/specs/` (landed) for a
   requirement that would break.
5. Run `sh .claude/tests/run-all.sh` before completing the merge commit.
6. Record the merge as its own `/change` with a `test` claim asserting the
   deterministic suites still pass post-merge.

## Deferred renames

npm scope (`@opencode-ai/*`, ~30 packages) and service tags
(`@opencode/v2/*`) are deliberately **not** renamed yet — each is a
mechanical change that would conflict on every future sync. They move to
roadmap Phase 3, once the fork and the v1→v2 upstream rewrite are both
stable.
