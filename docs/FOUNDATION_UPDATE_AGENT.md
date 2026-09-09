# Coding-agent runbook: update bundled Foundation

Use this when asked to update the Foundation version shipped with Changeloop.
For end-user project upgrades, see [FOUNDATION_UPDATE.md](FOUNDATION_UPDATE.md).
Follow repository instructions and the applicable Foundation workflow. This
runbook supplies dependency-update details; it does not replace lifecycle gates
or authorize committing, publishing, or changing unrelated project files.

## 1. Establish the target and current state

- Read root and relevant package `AGENTS.md` files. Preserve existing user edits.
- Inspect `packages/opencode/vendor/claude-foundation/manifest.json` for the
  bundled version, release, commit, and host protocols.
- Inspect the bundled `payload/.claude/harness/protocol.json` and the project's
  `.claude/harness/protocol.json` for runtime/API versions. These are separate
  installations; updating the vendor bundle does not update the project harness.
- Use the version settled in the conversation. If asked for the latest release
  without a settled target, verify upstream releases rather than assuming the
  local installation is current. State the selected version before syncing.
- Read `script/sync-foundation.ts`, `script/foundation-bundle.ts`, and
  `src/plugin/foundation-runtime.ts` under `packages/opencode` before relying on
  their behavior. Check the upstream installer for new required payload paths.

Prefix shell commands with `rtk`. Use `rtk proxy` when exact output is needed.
Run tests and typecheck from `packages/opencode`, never the repository root.

## 2. Obtain a clean, tagged source checkout

The upstream repository is `Maximumsoft-Co-LTD/claude-foundation`, not
`claude-foundation-template`. Use a separate temporary checkout to avoid changing
an existing checkout's branch or working tree. Example for the previously
selected release (replace the tag for a new update):

```sh
rtk git clone --depth 1 --branch v3.5.14 git@github.com:Maximumsoft-Co-LTD/claude-foundation.git /tmp/foundation-v3.5.14-source
rtk git -C /tmp/foundation-v3.5.14-source status --short
rtk git -C /tmp/foundation-v3.5.14-source rev-parse HEAD
rtk git -C /tmp/foundation-v3.5.14-source tag --points-at HEAD
rtk read /tmp/foundation-v3.5.14-source/VERSION
```

Choose an unused destination. Verify a clean checkout, the expected tag at HEAD,
and a matching `VERSION`. Annotated tags have a tag-object ID distinct from the
commit ID; the manifest records the checked-out commit.

Do not sync an edited source tree: the sync script copies working-tree contents,
not Git blobs. Do not use `--allow-untagged` for a distributable release or invent
release metadata to bypass validation.

## 3. Regenerate and verify the bundle

From `packages/opencode`:

```sh
rtk proxy bun script/sync-foundation.ts --source /tmp/foundation-v3.5.14-source --release v3.5.14
rtk proxy bun script/verify-foundation.ts
```

The sync script replaces the vendor payload and regenerates its manifest with
file modes and SHA-256 checksums. Inspect release, version, commit, `tagged`,
file count, and bundled runtime API after generation.

Preserve upstream payload bytes. Do not hand-edit vendor files, repair whitespace
inside them, or manually rewrite checksums. If the new installer needs files
outside the sync script's selected roots, update the sync logic and regenerate;
prove the resulting installation with integration tests.

## 4. Run integration checks and resolve actual failures

From `packages/opencode`:

```sh
rtk proxy bun test test/plugin/foundation.test.ts test/plugin/foundation-runtime.test.ts test/plugin/foundation-bundle.test.ts
rtk proxy bun typecheck
```

Inspect every failure before editing expectations. Compare changed upstream
content with the previous release. Update pinned text or installer hashes only
when the new upstream content explains the difference. Do not weaken protocol,
checksum, ownership, rollback, or fail-closed assertions to make tests pass.

For the v3.5.14 update, the legitimate expectation changes were:

- The actual agent-contract heading changed from `Foundation agent contract`
  to `Change Loop agent contract` in `foundation.test.ts`.
- The pinned `install-opencode.sh` checksum changed in
  `foundation-bundle.test.ts`.

Rerun affected checks after repairs. The suite exercises real bundled host
endpoints, initialization, repeated installation, user-owned collisions,
tampering, symlink rejection, and interrupted-install rollback.

## 5. Check compatibility with the current project

To check the edited source rather than an older installed binary, run from
`packages/opencode`:

```sh
rtk proxy bun -e 'import { FoundationRuntime } from "./src/plugin/foundation-runtime"; const root = process.cwd() + "/../.."; console.log(JSON.stringify(await FoundationRuntime.status(root))); const result = await FoundationRuntime.doctor(root); console.log(result.stdout); console.error(result.stderr); process.exitCode = result.exitCode;'
```

Compare `bundle.version` with `installed.runtime` and inspect doctor output for
API incompatibility. `installed.state: "installed"` alone is not a compatibility
check. This diagnostic may materialize the runtime cache; it does not run the
project installer. Do not downgrade a newer project harness just to silence a
mismatch. Project harness changes require scope covering that upgrade.

## 6. Review the diff and report completion accurately

- Review changed and untracked files. Account for every manifest payload file;
  use `git check-ignore --no-index` if new payload paths may be ignored.
- Run `rtk proxy git diff --check`. If it reports whitespace copied verbatim
  from the release, preserve the bytes and report the upstream finding. Fix
  whitespace introduced in local code or docs.
- Update version examples in [FOUNDATION_UPDATE.md](FOUNDATION_UPDATE.md) when
  needed. Keep this runbook's historical example identified as an example.
- Report the selected release/API, provenance, checks actually run, failures or
  limitations, and whether a binary was built or released. Do not label a source
  update as installed or delivered to users.

The v3.5.14 source update verified 499 payload files, passed 35 integration tests
and package typecheck, and passed bundled doctor against the API 33 project.
It preserved four upstream trailing-whitespace findings. No binary was built
or published in that update; these numbers are historical evidence, not fixed
expectations for future releases.

## 7. Build and delivery when included in the task

From `packages/opencode`, build for the current machine:

```sh
rtk proxy bun script/build.ts --single
```

The build verifies and embeds the bundle. Test the resulting
`dist/<target>/bin/opencode` directly: inspect `foundation status --json`, run
`foundation init --yes` in a disposable project, and run `foundation doctor`.
When validating upgrades, use a disposable project initialized with the prior
release, then run `foundation upgrade --yes` using the new binary.

Follow the repository's release process and existing user authority for delivery.
Users need the new Changeloop binary and a per-project harness upgrade. Installing
a newer standalone `claude-foundation` does not change the bundled runtime.

The Web UI snapshot closure for v3.5.14 additionally includes the upstream
`dashboard/client.sh` dispatch guard and dependency-free `dashboard/snapshot.mjs`.
Regenerating from clean tagged commit `334e3b94a0624553f8807287e91971fcf8eae203`
produces 501 payload files. Preserve these bytes and include
`test/plugin/foundation-webui.test.ts` in focused checks. The materialization
cache key includes the manifest digest so a same-release closure update gets
a distinct immutable directory while existing caches remain untouched.
