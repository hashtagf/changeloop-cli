import { Command } from "@opencode/core/command"
import { CommandPreparation } from "@opencode/core/command-preparation"
import { Location } from "@opencode/core/location"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () =>
    Effect.gen(function* () {
      // Commands come from plugin transforms; a fresh location answers an empty list until activation settles.
      yield* awaitPlugins
      return yield* response(
        Effect.gen(function* () {
          const command = yield* Command.Service
          const preparation = yield* CommandPreparation.Service
          const location = yield* Location.Service
          return yield* preparation.list(location.directory, yield* command.list())
        }),
      )
    }),
  ),
)
