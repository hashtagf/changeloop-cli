import path from "path"
import fs from "fs/promises"
import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin"
import { Global } from "@opencode-ai/core/global"

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

export function resolveRouting(
  table: RouterTable,
  existing: RouterSlots,
  isProviderAvailable: (providerID: string) => boolean,
): RouterResolution {
  const warnings: string[] = []

  const pick = (target: string, slot: string): string | undefined => {
    const candidates = table.tiers?.[target] ?? [target]
    for (const candidate of candidates) {
      const separator = candidate.indexOf("/")
      if (separator <= 0) continue
      if (isProviderAvailable(candidate.slice(0, separator))) return candidate
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

// The config hook runs before the Effect service graph is reachable from a
// plugin, so availability reads the same on-disk state those services own,
// read-only: the auth store and the models.dev cache (absent cache just means
// env-key detection is skipped until first fetch).
async function readAuthProviders(): Promise<Set<string>> {
  try {
    const body = process.env["OPENCODE_AUTH_CONTENT"] ?? (await fs.readFile(path.join(Global.Path.data, "auth.json"), "utf8"))
    return new Set(Object.keys(JSON.parse(body)))
  } catch {
    return new Set()
  }
}

declare const OPENCODE_MODELS_DEV: Record<string, { env?: string[] }> | undefined

export function envKeyProviders(
  providers: Record<string, { env?: string[] }>,
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  return new Set(
    Object.entries(providers)
      .filter(([, provider]) => (provider.env ?? []).some((key) => env[key]))
      .map(([id]) => id),
  )
}

async function readEnvKeyProviders(): Promise<Set<string>> {
  // The compiled-in models.dev snapshot keeps env-key providers visible on a
  // clean install where the cache file does not exist yet.
  const snapshot = typeof OPENCODE_MODELS_DEV === "undefined" ? undefined : OPENCODE_MODELS_DEV
  const providers = envKeyProviders(snapshot ?? {})
  try {
    const body = await fs.readFile(path.join(Global.Path.cache, "models.json"), "utf8")
    for (const id of envKeyProviders(JSON.parse(body))) providers.add(id)
  } catch {
    // no cache yet; the snapshot alone answers
  }
  return providers
}

export async function providerAvailability(config: Config): Promise<(providerID: string) => boolean> {
  const configured = new Set(Object.keys(config.provider ?? {}))
  const [authed, envKeyed] = await Promise.all([readAuthProviders(), readEnvKeyProviders()])
  return (providerID) => configured.has(providerID) || authed.has(providerID) || envKeyed.has(providerID)
}

export function applyRouting(config: Config & { router?: RouterTable }, resolution: RouterResolution) {
  for (const warning of resolution.warnings) console.warn(`[changeloop-router] ${warning}`)
  if (Object.keys(resolution.agents).length) {
    config.agent ??= {}
    for (const [name, model] of Object.entries(resolution.agents)) {
      config.agent[name] = { ...config.agent[name], model }
    }
  }
  if (resolution.smallModel) config.small_model = resolution.smallModel
}

export async function ModelRouterPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    config: async (config) => {
      const cfg = config as Config & { router?: RouterTable }
      const table = cfg.router
      if (!table) return
      const isProviderAvailable = await providerAvailability(cfg)
      const resolution = resolveRouting(
        table,
        {
          agentModels: Object.fromEntries(Object.entries(cfg.agent ?? {}).map(([name, agent]) => [name, agent?.model])),
          smallModel: cfg.small_model,
        },
        isProviderAvailable,
      )
      applyRouting(cfg, resolution)
    },
  }
}
