export * as ConfigRouterV1 from "./router"

import { Schema } from "effect"

export const Info = Schema.Struct({
  tiers: Schema.optional(Schema.Record(Schema.String, Schema.mutable(Schema.Array(Schema.String)))).annotate({
    description: "Named model tiers: tier name to ordered provider/model candidates; the first available candidate wins",
  }),
  agents: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Agent name to tier name or explicit provider/model; applied at boot unless the agent already pins a model",
  }),
  small_model: Schema.optional(Schema.String).annotate({
    description: "Tier name or explicit provider/model for the small-model slot; applied unless small_model is already set",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
