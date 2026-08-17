import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const document = {
  model: "anthropic/claude-sonnet-4-5",
  foundation_workflow: false,
}

describe("foundation_workflow config", () => {
  it.effect("v1 decode preserves the foundation_workflow field", () =>
    Effect.sync(() => {
      const decoded = Schema.decodeUnknownSync(ConfigV1.Info)(document, { errors: "all" })
      expect(decoded.foundation_workflow).toBe(false)
    }),
  )

  it.effect("v1 to v2 migration of a document with foundation_workflow succeeds and drops the field", () =>
    Effect.sync(() => {
      const decoded = Schema.decodeUnknownSync(ConfigV1.Info)(document, { errors: "all" })
      const migrated = ConfigMigrateV1.migrate(decoded)
      const v2 = Schema.decodeUnknownSync(Config.Info)(migrated, { errors: "all" })
      expect("foundation_workflow" in v2).toBe(false)
    }),
  )
})
