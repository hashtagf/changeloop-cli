# Investigation: Phase 1.1 — Model Router (plugin)

Date: 2026-08-15. Scope: roadmap item 1.1 (`docs/plan/ROADMAP.md`), PRD module 3
(`CHANGELOOP.PRD.md`). No product edits made.

## Facts

### Engine paths: v1 is live, v2 is dormant

- The shipped `changeloop` binary is `packages/opencode`. It mounts the v2
  layer graph (Catalog, PluginV2, ConfigExternalPlugin boot via
  `packages/core/src/location-services.ts:42-74`), so v2 plugins *load*, **but
  the session/model-selection path that actually runs is v1**
  (`packages/opencode/src/session/*`). Zero imports of `AgentV2`/`Catalog`
  from the live session code besides `cli/cmd/debug/v2.ts`.
- Consequence: a v2 `catalog.transform` (incl. `model.default.set`) does not
  affect which model a real chat turn uses today.

### Where the per-message model is decided (v1)

- `packages/opencode/src/session/prompt.ts:646`:
  `model = input.model ?? agent.model ?? currentModel(sessionID)`;
  `currentModel` (614-633) = session sticky → last user msg → `provider.defaultModel()`.
- The agentic loop re-reads the model from the persisted user message every
  step (`prompt.ts:1141`).
- Agent `model:` pin comes from markdown frontmatter
  (`packages/opencode/src/config/agent.ts:11-32`) merged into `cfg.agent`;
  built-in agents ship with no pin.
- Subagents (task tool): `packages/opencode/src/tool/task.ts:181-184` — own
  pinned model, else inherit parent assistant message's model.

### Hooks that can and cannot route (v1 plugin API, `packages/plugin/src/index.ts`)

| Hook | Model control |
|---|---|
| `chat.message` (`prompt.ts:999`) | **Yes, per-message** — mutate `output.message.model` before persist at `prompt.ts:1046`; loop honors it. |
| `config` (`plugin/index.ts:243`) | **Yes, boot-time** — set `cfg.model`, `cfg.small_model`, `cfg.agent[x].model`; normal fallback chain does the rest. |
| `provider` hook (`provider.ts:1397`) | Yes, catalog-level — can publish/replace a provider's model map. |
| `experimental.provider.small_model` (`provider.ts:1892`) | Small-model slot only (title generation). |
| `chat.params` (`llm/request.ts:114`) | **No.** SDK model instance already bound (`llm.ts:95-113`); sampling params only. |

→ **Roadmap assumption "insertion points = catalog draft transform +
`chat.params` hook" is wrong on both halves** for the live path. The real
levers are `config` (static) and `chat.message` (dynamic).

### Cost metadata (for rule-based tiers)

- Live: `ModelsDev.Model.cost` (`packages/core/src/models-dev.ts:36`,
  input/output/cache/tiers) normalized to `ProviderCost`
  (`packages/opencode/src/provider/provider.ts:1016-1028`); per-message cost
  math already exists (`session/session.ts:381-406`).
- Existing "different model for different job" patterns to copy: title agent +
  `getSmallModel` heuristic (`provider.ts:1878-1945`), compaction model
  (`compaction.ts:358-361`).

### Plugin scaffold (Phase 0.3)

- Template at `packages/plugin/src/template-transform.ts` is **v2
  promise-flavor** (`ctx.agent.transform`), tested via
  `packages/core/test/plugin/template.test.ts`, CI
  `.github/workflows/plugin.yml`. A router on the v1 hook API is a different
  shape from this scaffold (v1 = `async (input) => Hooks`), loaded from the v1
  `plugin` config field; v2 loader reads `plugins` and silently skips
  v1-shaped modules (`packages/core/src/config/plugin/external.ts:87`).

## Hypotheses

- H1: For the V1 proof loop, task-type == workflow agent
  (understand/plan/code/test/review/debug from item 1.2). Agent-level model
  assignment therefore covers "router selects model per step" without
  per-message classification.
- H2: Upstream's v1→v2 rewrite will eventually flip the live path to v2; a
  router kept as a plugin with the routing *table* separated from the *lever*
  can swap `config`-hook lever for `catalog/agent.transform` later cheaply.

## Options

**A. Boot-time router (v1 `config` hook) — recommended for V1**
Plugin reads a routing table (task-type → provider/model tier), resolves tiers
against catalog cost metadata, writes `cfg.agent[<workflow-agent>].model` +
`cfg.small_model`. The engine's existing `input.model ?? agent.model ?? …`
chain and task-tool inheritance do all the routing.
- - simplest; zero engine edits; deterministic; matches 1.2 ("each agent pins
  model through the router"); testable without a live model.
- - static per boot — cannot re-route mid-session on cost/latency signals
  (that is explicitly Router v2 / Phase 2).

**B. Dynamic per-message router (v1 `chat.message` hook)**
Mutate `output.message.model` per message.
- - true per-task routing.
- - rough edges found: session-sticky model set pre-hook (`prompt.ts:679`) →
  TUI header can disagree; needs its own classification of "task type" from
  prompt text, which V1 does not need under H1.

**C. v2 catalog/agent transform plugin (extend Phase-0 scaffold)**
- - matches the scaffold and the API upstream is converging on.
- - routes nothing today (v2 dormant in live path). Reject for V1; revisit at
  Router v2.

Recommended shape: **A now, B as the documented escalation path**, table format
designed so the same table drives B later (fields: task/agent, tier or explicit
`provider/model`, optional fallback list).

## Unknowns (to settle in /change, none blocking)

- Where the routing table lives: v1 `plugin` field takes bare specifiers
  (no options object), so table likely a top-level config key (must confirm v1
  config schema tolerates unknown keys) or a `.changeloop/router.json` file
  the plugin reads. Decide at proposal time.
- Whether tier resolution should hard-fail or fall back to `cfg.model` when a
  tier has no authenticated provider.

## Verdict

Phase 0 scaffold, cost metadata, and insertion points are all confirmed
sufficient; scope is decidable from evidence.

ready for /change
