import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import { envKeyProviders, ModelRouterPlugin, resolveRouting, type RouterTable } from "../../src/plugin/router"

const table: RouterTable = {
  tiers: {
    fast: ["anthropic/claude-haiku-4-5", "google/gemini-2.5-flash"],
    deep: ["anthropic/claude-opus-4-1"],
  },
  agents: {
    plan: "deep",
    test: "fast",
    debug: "openai/gpt-5",
  },
  small_model: "fast",
}

const none = { agentModels: {}, smallModel: undefined }

describe("resolveRouting", () => {
  test("pins the first available candidate per agent and the small-model slot", () => {
    const resolution = resolveRouting(table, none, (provider) => provider === "anthropic")
    expect(resolution.agents).toEqual({
      plan: "anthropic/claude-opus-4-1",
      test: "anthropic/claude-haiku-4-5",
    })
    expect(resolution.smallModel).toBe("anthropic/claude-haiku-4-5")
    expect(resolution.warnings).toHaveLength(1) // debug -> openai unavailable
  })

  test("skips to a later candidate when the first provider is unavailable", () => {
    const resolution = resolveRouting(table, none, (provider) => provider === "google")
    expect(resolution.agents["test"]).toBe("google/gemini-2.5-flash")
    expect(resolution.agents["plan"]).toBeUndefined()
  })

  test("warns and pins nothing when no candidate is available", () => {
    const resolution = resolveRouting(table, none, () => false)
    expect(resolution.agents).toEqual({})
    expect(resolution.smallModel).toBeUndefined()
    expect(resolution.warnings).toHaveLength(4) // plan, test, debug, small_model
  })

  test("never overwrites an existing explicit pin", () => {
    const resolution = resolveRouting(
      table,
      { agentModels: { plan: "openai/gpt-5" }, smallModel: "openai/gpt-5-nano" },
      () => true,
    )
    expect(resolution.agents["plan"]).toBeUndefined()
    expect(resolution.smallModel).toBeUndefined()
  })

  test("treats a tier name without candidates or a bare model id as unresolvable", () => {
    const resolution = resolveRouting({ agents: { plan: "missing-tier" } }, none, () => true)
    expect(resolution.agents).toEqual({})
    expect(resolution.warnings).toHaveLength(1)
  })
})

describe("envKeyProviders", () => {
  const metadata = {
    anthropic: { env: ["ANTHROPIC_API_KEY"] },
    openai: { env: ["OPENAI_API_KEY"] },
    local: {},
  }

  test("selects only providers whose API-key env var is set", () => {
    const providers = envKeyProviders(metadata, { ANTHROPIC_API_KEY: "k" })
    expect(providers).toEqual(new Set(["anthropic"]))
  })

  test("selects nothing when no env var is set", () => {
    expect(envKeyProviders(metadata, {})).toEqual(new Set())
  })
})

describe("ModelRouterPlugin config hook", () => {
  let savedAuth: string | undefined
  beforeAll(() => {
    savedAuth = process.env["OPENCODE_AUTH_CONTENT"]
    process.env["OPENCODE_AUTH_CONTENT"] = "{}"
  })
  afterAll(() => {
    if (savedAuth === undefined) delete process.env["OPENCODE_AUTH_CONTENT"]
    else process.env["OPENCODE_AUTH_CONTENT"] = savedAuth
  })

  const hook = async (config: Config) => {
    const hooks = await ModelRouterPlugin({} as never)
    await hooks.config!(config)
    return config
  }

  test("is a no-op without a router table", async () => {
    const config = { model: "anthropic/claude-sonnet-4-5" } as Config
    const before = structuredClone(config)
    await hook(config)
    expect(config).toEqual(before)
  })

  test("pins mapped agents from configured providers and respects explicit pins", async () => {
    const config = {
      provider: { anthropic: {} },
      agent: { debug: { model: "openai/gpt-5" } },
      router: table,
    } as unknown as Config
    await hook(config)
    const cfg = config as Config & { agent: Record<string, { model?: string }> }
    expect(cfg.agent["plan"]?.model).toBe("anthropic/claude-opus-4-1")
    expect(cfg.agent["test"]?.model).toBe("anthropic/claude-haiku-4-5")
    expect(cfg.agent["debug"]?.model).toBe("openai/gpt-5")
    expect(cfg.small_model).toBe("anthropic/claude-haiku-4-5")
  })

  test("pins from an env-key provider using the compiled snapshot on a clean cache (no auth, no cfg.provider)", async () => {
    ;(globalThis as Record<string, unknown>)["OPENCODE_MODELS_DEV"] = { envprov: { env: ["ENVPROV_API_KEY"] } }
    process.env["ENVPROV_API_KEY"] = "k"
    try {
      const config = {
        router: { tiers: { fast: ["envprov/model-z"] }, agents: { test: "fast" } },
      } as unknown as Config
      await hook(config)
      const cfg = config as Config & { agent?: Record<string, { model?: string }> }
      expect(cfg.agent?.["test"]?.model).toBe("envprov/model-z")
    } finally {
      delete (globalThis as Record<string, unknown>)["OPENCODE_MODELS_DEV"]
      delete process.env["ENVPROV_API_KEY"]
    }
  })

  test("leaves slots unset when no candidate is available", async () => {
    const config = {
      router: { tiers: { deep: ["unconfigured/model-x"] }, agents: { plan: "deep" } },
    } as unknown as Config
    await hook(config)
    const cfg = config as Config & { agent?: Record<string, { model?: string }> }
    expect(cfg.agent?.["plan"]?.model).toBeUndefined()
    expect(cfg.small_model).toBeUndefined()
  })
})
