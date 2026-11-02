export * as ModelRouterPlugin from "./router.js"

import { define } from "@opencode/plugin/effect/plugin"
import { isRecord } from "@opencode/util/record"
import { Effect, Stream } from "effect"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Model } from "../model.js"
import { ConfigMigrateV1 } from "../v1/config/migrate.js"

export const id = "opencode.router"

export interface RouterTable {
  tiers?: Record<string, readonly string[]>
  agents?: Record<string, string>
  small_model?: string
}

export interface RouterSlots {
  agentModels: Record<string, string | undefined>
  smallModel?: string
}

export interface RouterResolution {
  agents: Record<string, string>
  smallModel?: string
  warnings: string[]
}

/**
 * Picks the first usable candidate for every agent and the small-model slot the table maps.
 * Slots that already hold a model are never touched, and a slot with no usable candidate stays
 * unset with one warning so the engine's default model chain applies.
 */
export function resolveRouting(
  table: RouterTable,
  existing: RouterSlots,
  isAvailable: (providerID: string, modelID: string) => boolean,
): RouterResolution {
  const warnings: string[] = []

  const pick = (target: string, slot: string): string | undefined => {
    const candidates = table.tiers?.[target] ?? [target]
    for (const candidate of candidates) {
      const separator = candidate.indexOf("/")
      if (separator <= 0 || separator === candidate.length - 1) continue
      if (isAvailable(candidate.slice(0, separator), candidate.slice(separator + 1))) return candidate
    }
    warnings.push(`no available candidate for ${slot} -> ${target}; leaving it to the default model chain`)
    return undefined
  }

  const agents: Record<string, string> = {}
  for (const [agent, target] of Object.entries(table.agents ?? {})) {
    if (existing.agentModels[agent]) continue
    const model = pick(target, `agent "${agent}"`)
    if (model) agents[agent] = model
  }

  let smallModel: string | undefined
  if (table.small_model && !existing.smallModel) smallModel = pick(table.small_model, "small_model")

  return { agents, smallModel, warnings }
}

/** Reads the plugin option the config normalizer writes; anything malformed is ignored. */
export function parseTable(value: unknown): RouterTable {
  const table: RouterTable = {}
  if (!isRecord(value)) return table
  if (isRecord(value.tiers)) {
    const tiers: Record<string, string[]> = {}
    for (const [name, candidates] of Object.entries(value.tiers))
      if (Array.isArray(candidates) && candidates.every((item) => typeof item === "string")) tiers[name] = candidates
    table.tiers = tiers
  }
  if (isRecord(value.agents)) {
    const agents: Record<string, string> = {}
    for (const [name, target] of Object.entries(value.agents)) if (typeof target === "string") agents[name] = target
    table.agents = agents
  }
  if (typeof value.small_model === "string") table.small_model = value.small_model
  return table
}

// v2 has no separate small-model setting: the title agent is the slot a small model fills.
const smallModelAgent = Agent.ID.make("title")

const split = (reference: string) => {
  const separator = reference.indexOf("/")
  return {
    providerID: ConfigMigrateV1.providerID(reference.slice(0, separator)),
    modelID: reference.slice(separator + 1),
  }
}

export const Plugin = define({
  id,
  effect: Effect.fn("ModelRouterPlugin")(function* (ctx) {
    const table = parseTable(ctx.options.router)
    if (!table.agents && !table.small_model) return
    const models = yield* Model.Service
    const bus = yield* Bus.Service

    let available = new Set<string>()
    const readAvailable = models.available().pipe(
      Effect.map((list) => new Set(list.map((item) => `${item.providerID}/${item.id}`))),
    )
    let warnings: string[] = []
    const logged = new Set<string>()
    const flush = Effect.suspend(() =>
      Effect.forEach(
        warnings.filter((warning) => !logged.has(warning)),
        (warning) => {
          logged.add(warning)
          return Effect.logWarning(`[changeloop-router] ${warning}`)
        },
        { discard: true },
      ),
    )

    yield* ctx.agent.transform((editor) => {
      const missing: string[] = []
      const mapped: Record<string, string> = {}
      for (const [name, target] of Object.entries(table.agents ?? {})) {
        if (editor.get(Agent.ID.make(name))) mapped[name] = target
        else missing.push(`agent "${name}" is not defined; skipping its routing rule`)
      }
      const reference = (model: { providerID: string; id: string } | undefined) =>
        model ? `${model.providerID}/${model.id}` : undefined
      const resolution = resolveRouting(
        { ...table, agents: mapped },
        {
          agentModels: Object.fromEntries(
            editor.list().map((agent) => [agent.id as string, reference(agent.model)]),
          ),
          smallModel: reference(editor.get(smallModelAgent)?.model),
        },
        (providerID, modelID) => available.has(`${ConfigMigrateV1.providerID(providerID)}/${modelID}`),
      )
      warnings = [...missing, ...resolution.warnings]
      const apply = (agent: string, candidate: string) => {
        const { providerID, modelID } = split(candidate)
        editor.update(Agent.ID.make(agent), (item) => {
          item.model = { providerID, id: modelID } as typeof item.model
        })
      }
      for (const [agent, candidate] of Object.entries(resolution.agents)) apply(agent, candidate)
      if (resolution.smallModel) apply(smallModelAgent, resolution.smallModel)
    })

    const refresh = Effect.gen(function* () {
      const next = yield* readAvailable
      const changed = next.size !== available.size || [...next].some((item) => !available.has(item))
      available = next
      if (changed) yield* ctx.agent.reload()
      // Reading the agents runs the transform so its warnings exist before they are reported.
      yield* ctx.agent.list().pipe(Effect.ignore)
      yield* flush
    })
    yield* refresh
    yield* bus.subscribe(Model.Event.Updated).pipe(
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
