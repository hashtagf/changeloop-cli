# Upstream sync policy

`changeloop-cli` is a fork of [OpenCode](https://github.com/anomalyco/opencode).
Since the move to OpenCode v2 it is **upstream v2 plus a Changeloop layer**: the
repository tracks upstream's tree and keeps its own changes small, enumerated
and re-appliable. This document says how to take new upstream releases and
which files are the layer.

> The v1 based fork (OpenCode 1.18.x with a large `packages/opencode`) is
> retired. Upstream deleted `packages/opencode`, renamed the workspace scope
> from `@opencode-ai/*` to `@opencode/*` and moved to Effect 4.0.1, TypeScript 6
> and Bun 1.4. The last v1 state is the tag `changeloop-v1-final`.

## Remote

```
upstream  https://github.com/anomalyco/opencode.git (fetch)
```

Add it once per clone:

```
git remote add upstream https://github.com/anomalyco/opencode.git
```

`origin` stays `hashtagf/changeloop-cli`, the only remote anyone pushes to.

## Branch layout

```
upstream vX.Y.Z (tag) ──(merge)──> sync/vX.Y.Z ──(change)──> dev
```

- Upstream's default branch is **`dev`**, and it publishes releases as tags
  named `vMAJOR.MINOR.PATCH` (`v2.2.0` is the base of the first v2 port).
- Sync from a release **tag**, not from the moving `upstream/dev` tip.
- `dev` is this fork's integration branch. Feature and fix branches fork from
  `dev` and merge back into it.

## Cadence

- Take upstream at a release tag when Changeloop needs a fix or feature in it,
  and at least once per upstream minor release. Upstream ships patch releases
  often, so batching avoids chasing a moving target.
- Each sync is its own change (`/change` → `/build` → `/prove` → `/land`). A
  live `git merge` is not deterministic evidence, so it is never bundled into
  a change that also claims other behavior.

## The Changeloop layer

Keep every edit to a file that upstream owns inside this list. Anything else
that Changeloop needs belongs in `packages/foundation` or in a new file.

**Owned by Changeloop (new files, no upstream counterpart)**

- `packages/foundation/**`: the Foundation runtime (`FoundationRuntime`), the
  workflow plugin, the bundled `claude-foundation` payload under `vendor/`
  (regenerate with `script/sync-foundation.ts`, verify with
  `script/verify-foundation.ts`), and their tests.
- `packages/core/src`: `foundation.ts`, `foundation-documents.ts`,
  `foundation-document-reader.ts`, `foundation-live.ts`,
  `command-preparation.ts`, `config/plugin/configure-only.ts` and the model
  router plugin `plugin/router.ts` (config section `router`).
- `packages/cli/src/commands/handlers/foundation/**` and
  `packages/foundation/src/foundation-command.ts`: the `changeloop foundation
  status | init | doctor | upgrade` commands.
- `packages/util/src/env-alias.ts`: the `CHANGELOOP_*` to `OPENCODE_*` alias.
- `packages/schema/src/foundation.ts`, `packages/protocol/src/groups/foundation.ts`,
  `packages/server/src/handlers/foundation.ts`.
- `packages/app/src/changes/**` and the `new-session/brand*` files in
  `packages/app`: the Foundation views and the Changeloop wordmark.
- `.claude/`, `.agents/`, `.foundation/`, `openspec/`, `foundation.json`,
  `WORKFLOW.md`, `CLAUDE.md`, `docs/`: the Change Loop harness and its records.

**Edits inside upstream-owned files (the ones a sync can conflict on)**

- Identity: `packages/cli/script/build.ts` (binary name `changeloop`,
  `OPENCODE_CLI_NAME`, `CHANGELOOP_UPDATE_URL`) and the embedded runtime bundle
  step.
- Wiring: `packages/core/src/plugin/internal.ts` and `packages/core/package.json`
  (registers the Foundation and router plugins), `packages/core/src/config/normalize.ts` and
  `packages/core/src/plugin/supervisor.ts` (the `foundation_workflow`,
  `foundation_runtime` and `router` config keys), `packages/cli/src/commands/commands.ts`
  and `packages/cli/src/index.ts` (the `foundation` command and the first import),
  `packages/server/src/{routes,options,
  workerd,handlers}.ts` and `handlers/command.ts`, `packages/protocol/src/{api,
  client}.ts`, `packages/protocol/src/groups/command.ts`,
  `packages/protocol/openapi.json` and the generated files under
  `packages/client`.
- Update safety: `packages/cli/src/services/updater.ts`, `src/version.ts` and
  `src/commands/handlers/upgrade.ts`. Upstream's updater installs upstream
  OpenCode. A build without `CHANGELOOP_UPDATE_URL` must never fetch or install
  anything; keep that when merging.
- Wordmark and navigation: `packages/tui/src/{logo.ts,component/logo.tsx,
  util/presentation.ts}` and, in `packages/app`, the shell routes, layout,
  titlebar and Home files that expose the Changes entry.
- **User-visible strings** in `packages/cli/src`, `packages/tui/src`,
  `packages/core/src` and `packages/server/src` say Changeloop (`changeloop`
  commands, "Changeloop" in help and messages). On a conflict keep the
  Changeloop wording and re-apply it over upstream's surrounding change. These
  tests pin the surface: `packages/cli/test/rebrand-help.test.ts`,
  `packages/tui/test/brand-prose.test.ts`,
  `packages/core/test/brand-prose.test.ts`,
  `packages/server/test/openapi-brand.test.ts`.
- Model-facing text: command lines in `packages/core/src/plugin/skill/*.md`
  say `changeloop`. The identity lines ("You are opencode…") are kept on
  purpose.
- CI: `.github/workflows`. Upstream's triage, nix and bot-scope workflows are
  guarded with `github.repository == 'anomalyco/opencode'` and `check`,
  `check-test` run on GitHub-hosted runners (`ubuntu-24.04`, `windows-2025`)
  instead of Blacksmith. Re-apply both on every sync.

**Kept as OpenCode on purpose (contracts, not branding)**

Workspace scope `@opencode/*`, plugin ids `opencode.*`, `OPENCODE_*`
environment variables (Changeloop adds `CHANGELOOP_*` aliases that win), `x-opencode-*` headers,
the basic-auth username `opencode`, `opencode.ai` URLs, the OpenCode
Console/Go/Zen service names, and identity sent to third parties (MCP client
info, User-Agent). Renaming the scope or the service tags is a mechanical change
that would conflict on every sync, so it stays deferred.

**Identity layer added in the config-names change**

Changeloop reads `changeloop.json(c)` and `.changeloop/` in addition to the
`opencode` names, resolves its data/cache/config/state directories with the
rule "use `changeloop` if it exists, else the existing `opencode` directory,
else create `changeloop`", and aliases `CHANGELOOP_*` onto `OPENCODE_*`. Those
edits live in `packages/util/src/{global.ts,env-alias.ts}`,
`packages/core/src/config/discovery.ts`, `packages/core/src/config.ts`,
`packages/core/src/plugin/plan.ts` and the first import of
`packages/cli/src/index.ts`; treat them as layer files on every sync.

## Conflict playbook

1. `git fetch upstream --tags` and pick the target tag.
2. `git checkout -b sync/<tag> dev && git merge <tag>`.
3. Conflicts in a file listed under **Edits inside upstream-owned files**: keep
   the Changeloop edit and re-apply it on top of upstream's change.
4. Conflicts anywhere else: take upstream's version. If upstream deleted or
   moved a file the layer depends on (this is how `packages/opencode`
   disappeared), stop and write a change that ports the layer first.
5. `bun install` (the lockfile must end up consistent: `bun install
   --frozen-lockfile` passes) and regenerate what upstream's generators own:
   `bun run --cwd packages/protocol check:generated` and `bun run --cwd
   packages/client check:generated`. Commit the regenerated files.
6. Verify, then record the merge as its own change:
   - `bun run check` (lint and typecheck for the whole workspace)
   - tests per package as in `CLAUDE.md` ("การรัน test"); these fail on
     upstream itself and are not regressions: cli `acp additional directories
     subprocess` and `acp prompt content subprocess`, tui `go-upsell-art`,
     core ShellTool/shell tests
   - build the binary (`CLAUDE.md`, Delivery) and smoke it: `--help` has no
     "OpenCode", `/api/command` lists the eight Foundation commands on the first
     call, `changeloop upgrade` exits 1 without a channel, the Foundation
     endpoints answer.
7. After the merge, re-check upstream's new workflows for the repository guard
   (new bots or deploys must not run here).

## Deferred renames

The npm scope (`@opencode/*`) and service tags are deliberately **not** renamed.
Revisit only if the fork stops tracking upstream.
