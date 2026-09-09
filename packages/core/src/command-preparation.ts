export * as CommandPreparation from "./command-preparation"

import { Context, Effect } from "effect"
import { Command } from "@opencode-ai/schema/command"

export class Error extends globalThis.Error {
  constructor(readonly code: "command_not_found" | "command_unavailable", message: string) {
    super(message)
    this.name = "CommandPreparationError"
  }
}
export class Service extends Context.Service<Service, {
  readonly list: (directory: string, commands: readonly Command.Info[]) => Effect.Effect<readonly Command.Info[]>
  readonly prepare: (input: { directory: string; name: string; arguments: string; command?: Command.Info }) => Effect.Effect<Command.Info, Error>
}>()("@opencode/CommandPreparation") {}
