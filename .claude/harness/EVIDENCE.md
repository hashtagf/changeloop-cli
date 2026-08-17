# Executable evidence adapters

Foundation separates the stable behavioral contract from replaceable execution
wiring. Foundation does not install test frameworks, browsers, or project
dependencies; the project owns and locks every executable named by an adapter.

## Behavioral contract

`evidence.yaml` changes only when observable claims or obligations change:

```json
{
  "version": 2,
  "claims": [
    {
      "id": "profile-update",
      "scenario": "The owner can update their profile",
      "impact": "medium",
      "capabilities": ["test", "browser", "accessibility"]
    }
  ]
}
```

Discovery is an implicit suite-level obligation whenever `test` is selected; do
not repeat `discovery` on every claim.

## Execution wiring

`execution.yaml` may change as Build discovers the actual commands, ports, and
reports. Wiring changes invalidate only affected provider fingerprints.

```json
{
  "version": 1,
  "providers": {
    "test": {
      "adapter": "test-discovery",
      "command": ["npm", "test", "--", "--reporter=json"],
      "report": "test-results/unit.json",
      "minimum": 1,
      "timeoutMs": 120000
    },
    "browser": {
      "adapter": "playwright",
      "command": ["npx", "playwright", "test"],
      "outputs": ["accessibility"],
      "project": "chromium",
      "inputMode": "browser-automation",
      "service": "web",
      "readiness": {
        "url": "http://127.0.0.1:4173",
        "expectHeader": {"x-foundation-app": "profile"}
      },
      "timeoutMs": 120000
    }
  },
  "services": {
    "web": {
      "command": ["npm", "run", "start", "--", "--port", "4173"],
      "readiness": {
        "url": "http://127.0.0.1:4173",
        "expectHeader": {"x-foundation-app": "profile"}
      }
    }
  }
}
```

Evidence v1 and evidence v2 with embedded `providers` remain readable. Separate
them explicitly:

```bash
claude-foundation evidence upgrade <change>
```

The upgrade moves known wiring into `execution.yaml`; it never guesses commands.

## Bootstrap project-owned wiring

Use the bootstrap commands when a change declares claims but `execution.yaml`
has no executable providers yet:

```bash
claude-foundation evidence detect <change>
claude-foundation evidence init <change>
claude-foundation evidence init <change> --write
claude-foundation evidence doctor <change>
```

`detect` reads repository-owned manifests and configuration without executing
scripts. `init` is preview-only unless `--write` is present; even then it adds
only high-confidence wiring and preserves existing providers. Ambiguous,
external-authority, missing structured-test-count, and operator-review cases
remain unresolved with an explicit next action. Bootstrap never installs a
dependency, creates a receipt, weakens a claim, or treats detection as proof.

## Signed CI and external authority

An external provider may declare `ci.issuer` and an Ed25519 `ci.publicKey` in
`execution.yaml`. Import only its signed, workspace-bound envelope:

```bash
claude-foundation evidence verify-ci <change> <provider> signed-result.json
```

The envelope binds the change, provider, workspace hash, optional Git commit,
run URL, status, observation, and artifact SHA-256 digests. The hash it must
carry is the one that provider binds, which
`claude-foundation hash <change> <provider>` prints; without a provider the same
command prints the change's workspace hash. An invalid signature,
stale workspace, wrong issuer, or unsigned passing artifact is rejected before
a receipt is written.

Use `proof advance` as the normal resumable path:

```bash
claude-foundation proof advance <change>
```

It executes missing project evidence once, routes review before acceptance, and
returns a stable waiting handoff. Repeating it against an unchanged open request
does not rerun evidence or dispatch another reviewer. Configured AI review uses
`authority run`; a named human review uses `authority dispatch` before
`authority record`; acceptance uses request/status/record without a review
dispatch. Requests contain bounded packets and expire or become stale with the
workspace. Responses must match the request identity and workspace, then pass
the ordinary review or acceptance receipt validator. Completed requests cannot
be replayed.
Readiness exposes this boundary as a structured user decision with pass, fail,
inconclusive, error, and pause paths. It never emits a pre-filled passing receipt.
The agent translates the packet and owns the response artifact; users answer in
ordinary language. Direct `evidence record` remains a low-level integration path,
not the normal interactive recovery flow.

## Adapters

| Adapter | Purpose |
|---|---|
| `command` | Run one deterministic project command for one provider |
| `test-discovery` | Run a test command once and emit both test and discovery receipts |
| `playwright` | Run project-owned Playwright tests and map structured claim annotations |
| `contract-digest` | Hash one declared artifact in two or more repositories and pass only when the bytes agree |
| `external` | Require a receipt from a system Foundation does not execute |

### Test and discovery in more than one repository

`test-discovery` writes both receipts from a single run: the test receipt under
the provider's own name, and the discovery receipt under `discoveryProvider`
(default `discovery`). A provider named exactly `test` needs nothing further.

Two repositories need two test providers, so at most one of them can be named
`test`. Each of the others names its own discovery provider, and that provider
must be configured — repository-scoped claims resolve to repository-scoped
providers:

```json
{
  "test-api": {
    "capability": "test", "adapter": "test-discovery", "repository": "api",
    "discoveryProvider": "discovery-api",
    "command": ["npm", "test", "--", "--test-reporter=tap"],
    "minimum": 1, "reportFormat": "tap"
  },
  "discovery-api": {
    "capability": "discovery", "adapter": "test-discovery", "repository": "api",
    "command": ["npm", "test", "--", "--test-reporter=tap"],
    "minimum": 1, "reportFormat": "tap"
  }
}
```

The discovery entry declares the same adapter but never runs on its own — the
test provider that names it produces its receipt in the same execution. Giving
it a different adapter passes validation and then fails at run time, because no
other adapter produces a discovered count.

Configured commands run from the active workspace. The normal path is:

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

`proof readiness` reports a `next` array whenever it is not `READY`, and every
command that stops on a readiness result prints that recovery rather than the
blocker alone. When a required provider has no adapter but the project owns a
safe command for its capability, the recommended route is
`evidence init --write`, not a request to a person. A capability the
changed-surface policy inferred and nobody wired is not a required provider at
all: it appears under `advisories` in readiness, `proof plan`, and the proof
record, and does not block.

Prototype files under `.foundation/prototypes/` are non-authoritative. The
runtime rejects them, including local-path references and symlinked origins,
before copying any artifact or writing a receipt.

Valid receipts are reused. Commands with identical executable arguments,
environment, working directory, and timeout are deduplicated within one proof
execution. Providers with non-conflicting resources run concurrently.

What expires a receipt is what it is bound to. A provider that runs a command
binds the workspace minus the change packet, so editing `proposal.md`,
`design.md`, `tasks.md`, or a spec delta after proving re-finalizes the proof
without re-executing anything. `review` and `acceptance` bind the whole
workspace including the packet — a reviewer read it — and cannot narrow that.
In a multi-repository snapshot, both hashes compose repository content rather
than recorded Git base commits. Base heads remain explicit sandbox/Land state,
so an unreconciled target is still blocked while a history-only base movement
with byte-identical content does not expire evidence.

Narrow it further with workspace-relative `inputs`, and an edit outside them
rebinds the receipt instead of re-earning it:

```json
{"providers": {
  "test": {"adapter": "test-discovery", "command": ["npm", "test"],
           "minimum": 1, "inputs": ["src/**", "tests/**", "package.json"]},
  "static-analysis": {"adapter": "command", "command": ["npm", "run", "lint"],
                      "inputs": ["src/**", ".eslintrc.json"]}
}}
```

A `discovery` provider produced by a `test-discovery` adapter reads the test
provider's config, so declaring `inputs` once covers both. A cross-repository
provider may scope a pattern to a repository: `api:openapi.yaml`. Patterns are
workspace-relative, reject `..`, and a passing receipt whose declared inputs
matched no file is refused rather than bound to an empty set. `inputs` is a
claim about what the command reads: name too little and a real code edit reuses
evidence that never saw it. `proof plan` prints each provider's binding, and
reuse is logged to `.foundation/logs/<change>/reuse.jsonl`.

A receipt records how it was produced. Receipts the harness executed carry
`execution: "harness"` and their command log; everything recorded by hand is
`execution: "manual"` and must include `--observed`, `--source` or `--reviewer`,
and at least one `--artifact` or `--reference`. That floor does not depend on
`--adapter`, which the caller supplies: naming an executing adapter by hand is
refused, and a provider configured for one cannot be given a passing receipt at
all — run `proof run` so the declared command is what executes. A `--reference`
must be a URI or a path that exists; free text is not a reference.

Review receipts additionally identify reviewer type/identity, the actual model
session for AI reviewers, one or more structured implementation-subject tuples,
finding IDs/details, verified closure IDs, and changed-artifact scope after the
first round. The review packet unions committed base-to-HEAD and dirty paths per
repository with all review contract artifacts. Critical policy
requires a different provider/model family or a human, unless the project has
declared `"review": { "diversity": "single-model" }` in `foundation.json`; that
waiver is named in the packet and recorded as `review.policy.diversityWaived`.
Reviewer independence is waived the same way and nowhere else: with
`"review": { "independence": "self" }`, a reviewer may share an implementer's
identity and session at any impact, the receipt still records the observed
`review.policy.independent` as false alongside `independenceWaived`, and each
waiver relaxes only its own axis. The shipped `foundation.json` requires both
axes and configures fresh read-only Codex and Claude Code reviewer profiles,
with Codex selected by default. A Codex-only or Claude-Code-only project may
commit only the `single-model` diversity waiver while keeping identity/session
independence required. The runtime also defaults to `required` when either key is
absent. Risk routing bounds the circuit: low gets one full AI review; medium
and high may use one full plus one finding-bound delta after one correction
batch. High-risk decisions are settled in the initial Decision Sheet, so Prove
has no mandatory human-final gate. Reviewer infrastructure failures receive one
full retry and never create a delivered baseline. If the final delta reports an
in-contract blocker, it must bind that finding to affected claims and declared
critical cases; a later current pass of those providers creates a deterministic
repair-closure receipt, not a third AI review. A change-level hash chain binds
dispatch, completion, scope, findings, closure evidence, and receipt payload.
Corrupt history fails closed. Legacy review receipts remain readable but cannot
satisfy protocol v3.

External operations use `handoffs.yaml`, not evidence receipts or unchecked
developer tasks. Prove may finish while those operations are pending. Land
requires completion evidence for pre-Land or activation-coupled work; accepted
post-Land work may remain only when its activation-proof claim establishes a
dark merge. Handoff packets and records reject credential material.

Acceptance is external and human-only. A passing receipt requires explicit claim
scope, `--acceptor`, `--decision accept`, unique nonblank `--criterion` values,
`--observed`, provenance, and a durable artifact or reference. Every read
revalidates those fields, the contract reason, and final workspace identity.
New standard changes must explicitly decide whether acceptance is required;
silence remains `undecided` and blocks validation rather than becoming approval.

## Test and discovery

The configured structured JSON report must expose a non-negative integer such as
`numTotalTests`, `totalTests`, `testCount`, or `expected`. If the command passes
but no deterministic count is available, test evidence may pass while discovery
is `inconclusive`; landing remains blocked. Arrays, numeric strings, arbitrary
nested keys, and mixed stdout are not coerced into a count.

## Playwright

Install and lock Playwright in the application repository. A typical command is:

```json
["npx", "playwright", "test"]
```

For a direct Playwright command, the adapter adds `--reporter=json` and the
configured `--project` unless they are already supplied. Wrapper commands such
as `npm run e2e` must forward those options themselves or write the configured
`report` file. Use Playwright `webServer` configuration or a named Foundation
service for server startup. Every explicit readiness probe requires an expected
body or header identity. A status-only probe is rejected because a different
process could occupy the port.

Every browser test that proves a claim must carry a claim annotation:

```ts
test("owner updates profile", {
  annotation: { type: "claim", description: "profile-update" }
}, async ({ page }) => {
  // interaction and assertions
});
```

A successful exit without all required annotations is `inconclusive`, never
`pass`. Playwright attachments present in the JSON report are referenced from
the receipt. One Playwright adapter may declare `outputs`, for example
`["accessibility"]`; it emits separate capability receipts from one command
execution. Configure traces, screenshots, and videos in the project.

Browser automation is not physical operating-system input. Use
`browser-automation` for Playwright and reserve `os-input` or `both` for
evidence that genuinely requires a focused native window.

Projects should also install an automatic Playwright fixture that fails on
unexpected `console.error` and uncaught page errors. Foundation cannot infer
that policy from a successful browser exit.

## Resources and dependencies

Default resources are repository-qualified, so two repositories' suites do not
serialize against each other:

- command/test: `workspace-read`;
- Playwright: `workspace-read`, `dev-server:<repo>`, `browser:<repo>`;
- mutation: `workspace-write:<repo>`;
- `contract-digest`: `workspace-read`.

A provider without `repository` keeps the unqualified names. Two providers in
different repositories that genuinely share one resource — a single database, a
single browser profile — must declare it explicitly; the defaults cannot infer
it.

Override with `resources` and order providers with `dependsOn`. Read-only
providers may run together. `workspace-write` conflicts with all workspace
readers, and named exclusive resources such as `browser`, `dev-server`, or
`database` cannot overlap.

Use parameterized names such as `port:4173`, `database:test`, or
`browser:chromium` when independent instances may run concurrently. Provider
dependency cycles and structured-report collisions are rejected by
`proof preflight`.

Literal non-sensitive environment values may use `env`. Secrets, credentials,
tokens, passwords, and API keys must use `envFrom`, which names variables to
inherit without storing their values in OpenSpec.

## Services, ports, and isolation

A service's readiness URL names a literal port, and `execution.yaml` is copied
byte-identical into every sandbox — so two changes of one project declare the
same port. Before starting a service the runtime probes its readiness URL and
refuses to start when something already answers: a server left behind by a
failed run would otherwise satisfy the very first poll and hand this change a
green suite for code that never started. The built-in static server also echoes
`x-foundation-proof-run`, and readiness requires it to match this run.

Services started by a proof run are reclaimed on failure, on `SIGINT`/`SIGTERM`,
and at exit. A provider or service failure no longer leaves a listener holding
the port.

Sandboxes carry the file tree and nothing else:

- **worktree** mode checks out tracked files only — `node_modules`, local env
  files, and generated assets are absent;
- **copy** mode additionally excludes `node_modules`, `coverage`,
  `test-results`, and `playwright-report` — unless git tracks the path, since a
  committed fixture is content whatever its directory is called. Symbolic links
  are copied verbatim and keep pointing inside the sandbox.

Write every provider report and artifact to one of those excluded directories.
The workspace hash is taken before providers run and again at finalization, so
a report written anywhere else changes the surface mid-run and expires the
receipt it was produced to justify. `change validate` warns when a configured
`report` path sits inside the hashed surface.

Everything outside the file tree is shared with the host and with every other
change: environment variables (including `DATABASE_URL` and API keys passed
through `envFrom`), ports, `/tmp`, the Playwright browser cache, and any
external database or queue a service talks to. An end-to-end provider that
needs installed dependencies must either install them as part of its command or
run against the control workspace; the sandbox will not provide them.

## Receipt reuse

Reuse is bound to:

- workspace hash and change revision;
- provider and adapter protocol versions;
- adapter and command configuration;
- claim scope;
- declared environment names and project lockfile digests;
- Node/platform architecture;
- required artifact SHA-256 and byte size.

Reports, logs, and attachments are copied immediately into
`.foundation/evidence/<change>/<proof-run>/`. `proof audit` verifies copied
receipt and artifact digests even after sandbox cleanup or archival.

## A gate that executed and failed

A provider that ran and exited non-zero blocks proof with validity `fail`. It
has exactly three honest exits, and the blocker output prints all three:

- fix the cause and `proof run` again — right when the gate caught a defect;
- rewire the provider in `execution.yaml` — right when the gate is wrong;
- withdraw the gate on record — right when the user decides to land without it:

```sh
claude-foundation change waive <change> --capability <capability> \
  --reason <why> --decision-ref <host-user-decision>
```

The waiver removes the capability from the required set; the claim keeps
declaring it, and the waiver is carried as a `user-waived` advisory in proof
readiness, the proof record, the archive, and on the `LAND READY` line. The
receipts already earned stay valid — a waiver is subtractive and cannot change
what any other provider attested — so the next `proof run` executes nothing.
`--revoke` restores the requirement. There is no route that lands a failing
proof. `review` and `acceptance` are refused here: review is waived through
`review.independence` / `review.diversity` in `foundation.json`, and acceptance
is withdrawn through `change resolve --acceptance-not-required` or by dropping
the capability from the claim.
