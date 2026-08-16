import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const document = {
  model: "anthropic/claude-sonnet-4-5",
  router: {
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
  },
}

describe("router config", () => {
  it.effect("v1 decode preserves the router section", () =>
    Effect.sync(() => {
      const decoded = Schema.decodeUnknownSync(ConfigV1.Info)(document, { errors: "all" })
      expect(decoded.router).toEqual(document.router)
    }),
  )

  it.effect("v1 to v2 migration of a document with router succeeds and drops the field", () =>
    Effect.sync(() => {
      const decoded = Schema.decodeUnknownSync(ConfigV1.Info)(document, { errors: "all" })
      const migrated = ConfigMigrateV1.migrate(decoded)
      const v2 = Schema.decodeUnknownSync(Config.Info)(migrated, { errors: "all" })
      expect("router" in v2).toBe(false)
    }),
  )
})
