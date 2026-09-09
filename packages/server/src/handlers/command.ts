import { CommandV2 } from "@opencode-ai/core/command"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { CommandPreparation } from "@opencode-ai/core/command-preparation"
import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () => response(Effect.gen(function* () {
    const command = yield* CommandV2.Service
    const preparation = yield* CommandPreparation.Service
    const location = yield* Location.Service
    return yield* preparation.list(location.directory, yield* command.list())
  }))),
)
