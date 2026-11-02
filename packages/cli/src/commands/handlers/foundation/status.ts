import { FoundationCommand } from "@opencode/foundation/foundation-command"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { args, dependencies } from "./shared"

export default Runtime.handler(
  Commands.commands.foundation.commands.status,
  Effect.fn("cli.foundation.status")(function* (input) {
    const exitCode = yield* Effect.promise(() => FoundationCommand.runStatus(args(input), dependencies()))
    if (exitCode !== 0) process.exitCode = exitCode
  }),
)
