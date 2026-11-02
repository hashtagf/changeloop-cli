import { FoundationCommand } from "@opencode/foundation/foundation-command"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { args, dependencies } from "./shared"

export default Runtime.handler(
  Commands.commands.foundation.commands.init,
  Effect.fn("cli.foundation.init")(function* (input) {
    const result = yield* Effect.promise(() => FoundationCommand.runMutation(args(input), dependencies()))
    if (result.exitCode !== 0) process.exitCode = result.exitCode
  }),
)
