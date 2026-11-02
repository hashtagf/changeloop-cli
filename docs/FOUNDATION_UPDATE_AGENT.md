# Coding-agent runbook: update bundled Foundation

Use this when asked to update the Foundation version shipped with Changeloop.
For end-user project upgrades, see [FOUNDATION_UPDATE.md](FOUNDATION_UPDATE.md).
Follow repository instructions and the applicable Foundation workflow. This
runbook supplies dependency-update details; it does not replace lifecycle gates
or authorize committing, publishing, or changing unrelated project files.

## 1. Establish the target and current state

- Read root and relevant package `AGENTS.md` files. Preserve existing user edits.
- Inspect `packages/foundation/vendor/claude-foundation/manifest.json` for the
  bundled version, release, commit, and host protocols.
- Inspect the bundled `payload/.claude/harness/protocol.json` and the project's
  `.claude/harness/protocol.json` for runtime/API versions. These are separate
  installations; updating the vendor bundle does not update the project harness.
- Use the version settled in the conversation. If asked for the latest release
  without a settled target, verify upstream releases rather than assuming the
  local installation is current. State the selected version before syncing.
- Read `packages/foundation/script/sync-foundation.ts`,
  `packages/foundation/src/foundation-bundle.ts` and
  `packages/foundation/src/foundation-runtime.ts` before relying on their
  behavior. Check the upstream installer (`install.sh`, `install-opencode.sh`)
  for new required payload paths and for its list of unshipped paths.

Run package tests and typecheck per package (`bun test --cwd packages/foundation`,
`bun run --cwd packages/foundation typecheck`), never from the repository root:
the root `bunfig.toml` refuses to run tests there.

## 2. Obtain a clean, tagged source checkout

The upstream repository is `Maximumsoft-Co-LTD/claude-foundation`, not
`claude-foundation-template`. A local checkout of it may already exist; if it has
uncommitted edits, clone it into a separate temporary directory and check out the
tag there, so the sync reads the tag and not the edits. Example for a release
(replace the tag for a new update):

```sh
git clone --local /path/to/claude-foundation /tmp/foundation-source
git -C /tmp/foundation-source checkout --detach v3.6.8
git -C /tmp/foundation-source status --short
git -C /tmp/foundation-source rev-parse HEAD
git -C /tmp/foundation-source tag --points-at HEAD
cat /tmp/foundation-source/VERSION
```

Choose an unused destination. Verify a clean checkout, the expected tag at HEAD,
and a matching `VERSION`. Annotated tags have a tag-object ID distinct from the
commit ID; the manifest records the checked-out commit. Cross-check the payload
against an installed `claude-foundation` of the same version when one exists.
Do not download release archives from the network to avoid a missing checkout.

Do not sync an edited source tree: the sync script copies working-tree contents,
not Git blobs. Do not use `--allow-untagged` for a distributable release or invent
release metadata to bypass validation.

## 3. Regenerate and verify the bundle

From the repository root:

```sh
bun packages/foundation/script/sync-foundation.ts --source /tmp/foundation-source --release v3.6.8
bun packages/foundation/script/verify-foundation.ts
```

The sync script replaces the vendor payload and regenerates its manifest with
file modes and SHA-256 checksums. It also skips the paths that upstream's
installer declares `UNSHIPPED` (the harness `tests` and `fixtures` directories):
the runtime never reads them, and they are deep enough to exceed the Change Loop
discovery depth limit of 12 directory levels. Keep that list in step with
upstream's `install.sh`. After generation inspect release, version, commit,
`tagged`, file count and bundled runtime API, then check that no file or
directory under `packages/foundation/vendor` is deeper than 12 levels from the
repository root, and that the sync left no empty `tests/` or `fixtures/`
directories behind (an empty deep directory still counts).

Preserve upstream payload bytes. Do not hand-edit vendor files, repair whitespace
inside them, or manually rewrite checksums. If the new installer needs files
outside the sync script's selected roots, update the sync logic and regenerate;
prove the resulting installation with integration tests.

## 4. Run integration checks and resolve actual failures

```sh
bun test --cwd packages/foundation
bun run --cwd packages/foundation typecheck
bun install --frozen-lockfile
```

Inspect every failure before editing expectations. Compare changed upstream
content with the previous release. Update pinned text or installer hashes only
when the new upstream content explains the difference. Do not weaken protocol,
checksum, ownership, rollback, or fail-closed assertions to make tests pass.
Tests that run the real installer can time out at 60 seconds when the machine is
busy; rerun them alone before treating them as failures.

The suite exercises real bundled host endpoints, initialization, repeated
installation, user-owned collisions, tampering, symlink rejection, interrupted
install rollback, and the `changeloop foundation` commands' logic.

## 5. Check compatibility with the current project

Build the binary (section 7) and, from the project you want to check:

```sh
changeloop foundation status --json
changeloop foundation doctor
```

Compare `bundle.version` with `installed.runtime` and inspect the doctor output
for API incompatibility. `installed.state: "installed"` alone is not a
compatibility check. These commands do not run the project installer and write
nothing. Do not downgrade a newer project harness just to silence a mismatch.
Project harness changes require scope covering that upgrade.

## 6. Review the diff and report completion accurately

- Review changed and untracked files. Account for every manifest payload file;
  use `git check-ignore --no-index` if new payload paths may be ignored.
- Run `git diff --check`. If it reports whitespace copied verbatim from the
  release, preserve the bytes and report the upstream finding. Fix whitespace
  introduced in local code or docs.
- Update version examples in [FOUNDATION_UPDATE.md](FOUNDATION_UPDATE.md) when
  needed. Keep this runbook's example identified as an example.
- Report the selected release/API, provenance, checks actually run, failures or
  limitations, and whether a binary was built or released. Do not label a source
  update as installed or delivered to users.

The v3.6.8 source update (the first on OpenCode v2) produced 478 payload files
after the unshipped paths were skipped, with a deepest path of 10 levels, and
passed the package tests. These numbers are historical evidence, not fixed
expectations for future releases.

## 7. Build and delivery when included in the task

Build for the current machine (needs Bun 1.4.4 or newer):

```sh
cd packages/cli && bun run build --single --skip-install
```

The build verifies the bundle and embeds it (`script/foundation-files.ts`). Test the
resulting `packages/cli/dist/cli-<target>/bin/changeloop` directly: inspect
`foundation status --json`, run `foundation init --yes` in a disposable project,
and run `foundation doctor`. When validating upgrades, use a disposable project
initialized with the prior release, then run `foundation upgrade --yes` using the
new binary. Also confirm `changeloop serve` lists the eight Foundation commands
in `/api/command` and that `/experimental/foundation/capability` reports the new
runtime version.

Follow the repository's release process and existing user authority for delivery.
Users need the new Changeloop binary and a per-project harness upgrade. Installing
a newer standalone `claude-foundation` does not change the bundled runtime.

The Web UI snapshot reader needs the payload's `dashboard/client.sh` dispatch
guard and the dependency-free `dashboard/snapshot.mjs`; include
`packages/foundation/test/foundation-webui.test.ts` in focused checks. The
materialization cache key includes the manifest digest, so a same-release payload
change gets a distinct immutable directory while existing caches remain untouched.
