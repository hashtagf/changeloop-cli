# Design

## Current state

- `FoundationWorkflowPlugin` is an internal plugin and injects eight dispatcher
  commands by default. It resolves host instruction and agent contract through
  `FoundationRuntime.command(runtimeMode)`.
- Bundled mode materializes a verified Foundation release into a
  content-addressed cache and invokes its `cli.sh` through an explicit argv
  array. The materialized release is not currently discoverable by agent shell
  commands.
- Canonical instructions intentionally name the public executable
  `claude-foundation`; for example `changes.md` runs `claude-foundation changes`.
- The bundled `cli.sh` routes `init --host opencode` to
  `install-opencode.sh`, but the current bundle sync roots omit that installer,
  so the advertised host route cannot execute from the embedded release.
- The upstream OpenCode adapter layers over the shared installer, copies
  canonical commands to `.opencode/commands`, installs
  `.opencode/plugins/foundation.js`, and records its owned files in
  `.foundation/adapter-manifests/opencode.txt` while preserving user-owned
  collisions.
- OpenCode loads `.opencode/commands` before internal plugin config hooks. Those
  canonical adapter commands therefore win normal user-command precedence and
  leave the plugin's current `injected` set empty even though Foundation owns
  the installed command surface.
- Shell tools, background command execution, and PTYs already merge the
  Location-scoped plugin `shell.env` hook into their child environment.
- The existing compiled smoke removes PATH Foundation but proves only
  `foundation status`, initialization, and doctor. It does not execute the
  lifecycle command returned by a host instruction.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| Selected runtime | The bundled or explicit PATH Foundation source chosen once for one plugin instance | available CLI |
| Execution shim | A generated `claude-foundation` executable that delegates only to the verified materialized bundle | installed Foundation |
| Project harness | Foundation runtime and schemas installed in the target repository | bundled CLI |
| Managed OpenCode adapter | Host command/plugin paths recorded by Foundation in `.foundation/adapter-manifests/opencode.txt` | any `.opencode` file |

## Decisions

<!-- Record only choices that are hard to reverse, surprising without context, and selected among meaningful alternatives. -->

- **Decision:** In bundled mode, prepend an execution-shim directory through
  the existing Location-scoped `shell.env` hook only while Changeloop owns at
  least one Foundation built-in.
  - **Why:** Canonical instructions, shell tools, background execution, and PTYs
    then resolve the same bundled release without mutating process-global or
    user PATH. Per-instance scope also permits bundled and explicit PATH
    projects to coexist in one server process.
  - **Rejected:** Mutating `process.env.PATH`, which leaks across project
    instances; rewriting canonical instruction prose, which forks the upstream
    contract; and a new public arbitrary-argv passthrough, which expands the CLI
    surface without solving canonical executable lookup.
- **Decision:** Materialize a minimal executable shim alongside the verified
  content-addressed bundle and bind its target to that bundle's absolute
  `cli.sh` path.
  - **Why:** The upstream script resolves sibling payload files relative to its
    own location, so a wrapper must delegate to the real script rather than use
    a symlink whose invocation path can change `BASH_SOURCE`. Atomic cache
    materialization and validation keep unverified files out of execution.
  - **Rejected:** Copying or renaming `cli.sh` into a generic mutable bin
    directory, which loses release identity and can be replaced independently.
- **Decision:** Preserve synchronous execution and upstream exit semantics.
  The shim adds no retry and fails closed if materialization is invalid.
  - **Why:** Each lifecycle result controls the agent's next decision; mutations
    are not safe for implicit retry, and the existing CLI already owns API
    compatibility, telemetry, and recovery diagnostics.
  - **Rejected:** Async dispatch or fallback to a PATH executable after a
    bundled failure, either of which can split state ownership or hide the
    selected-runtime failure.
- **Decision:** Bundle `install-opencode.sh` and invoke initialization through
  the bundled public CLI as `init --host opencode`; Foundation remains the sole
  owner of shared and adapter install, preservation, manifest, and rollback
  semantics.
  - **Why:** The host adapter is an upstream release contract layered over
    `install.sh`. Calling it through `cli.sh` proves the same route users and
    other hosts receive without reimplementing `.opencode` ownership in
    TypeScript.
  - **Rejected:** Calling shared `install.sh` and copying `.opencode` files in
    Changeloop, which creates a second installer and loses adapter-manifest
    preservation semantics.
- **Decision:** Treat a validated Foundation OpenCode adapter manifest as
  Foundation command ownership for bundled execution activation, while keeping
  ordinary user-defined command precedence unchanged.
  - **Why:** Adapter commands intentionally occupy the same names as built-ins;
    relying only on the injected-name set disables the shim immediately after a
    correct host install. The manifest is the upstream ownership authority and
    distinguishes those files from user commands.
  - **Rejected:** Activating the shim whenever `foundation_workflow` is enabled,
    which would shadow PATH even when all colliding commands are genuinely
    user-owned; and overwriting adapter commands with built-in markers, which
    defeats the requested native OpenCode host integration.

## Compatibility and migration

The eight slash-command names, canonical Foundation instructions, and explicit
`foundation_runtime: "path"` config remain compatible. Fresh bundled init and
upgrade now add Foundation-managed `.opencode/commands`, the OpenCode guard
plugin, and its ownership manifest through upstream semantics. Existing
user-owned collisions remain untouched. Bundled mode gains one per-instance
child-environment PATH entry; it does not alter the user's shell or persisted
config. PATH mode never injects the shim.

Roll out with focused hook/runtime tests and a compiled-binary smoke that has no
external Foundation executable. Rollback removes the hook and shim generation;
the already-installed project harness remains valid and explicit PATH mode is
the compatibility escape hatch.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Shim shadows a user-managed executable outside bundled workflow scope | Activate only for bundled mode with at least one Changeloop-owned built-in; prove disabled, fully user-owned, and PATH modes preserve PATH | test, security |
| Shim target is tampered with or detached from bundle identity | Create it inside the validated content-addressed materialization and validate its exact target/content before reuse | security, integration |
| Shell tools and PTYs receive different environments | Exercise the shared `shell.env` contract through both production consumers | integration |
| Evidence repeats the prior endpoint-only blind spot | Compiled smoke initializes a temp project and executes a real lifecycle read with external Foundation absent | deployment |
| Bundle materialization failure silently falls back to PATH | Return no PATH override and surface the stable bundled-runtime failure; never select another executable implicitly | resilience |
| OpenCode host route is advertised but installer is omitted from the binary | Make the host installer a required sync root and compiled-manifest assertion | supply-chain, deployment |
| Adapter command precedence disables bundled runtime activation | Resolve ownership from the validated adapter manifest and prove init → config load → shell execution end to end | integration |
| Host install overwrites user-owned `.opencode` artifacts | Delegate to upstream adapter manifest semantics and exercise collision preservation plus repeated upgrade | test, security |
