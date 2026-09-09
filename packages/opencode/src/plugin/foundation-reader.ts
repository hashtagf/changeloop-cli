export * as FoundationReader from "./foundation-reader"

import { Foundation } from "@opencode-ai/core/foundation"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { InstanceStore } from "@/project/instance-store"
import { FoundationWebui } from "./foundation-webui"

export const layer = Layer.effect(
  Foundation.Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const instances = yield* InstanceStore.Service
    return Foundation.Service.of({
      read: (directory) =>
        Effect.gen(function* () {
          const settings = yield* instances.provide({ directory }, config.get())
          if (settings.foundation_workflow === false)
            return yield* Effect.fail(
              new Foundation.ReadError("unsupported", "Foundation workflow is disabled for this project"),
            )
          return yield* Effect.tryPromise({
            try: () => FoundationWebui.read(directory, settings.foundation_runtime ?? "bundled"),
            catch: (error) =>
              error instanceof FoundationWebui.ReadError
                ? new Foundation.ReadError(error.code, error.message)
                : new Foundation.ReadError("runtime_unavailable", "Foundation runtime is unavailable"),
          })
        }),
    })
  }),
)
