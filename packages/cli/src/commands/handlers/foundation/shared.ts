import { confirm, isCancel } from "@clack/prompts"
import { FoundationCommand } from "@opencode/foundation/foundation-command"
import { Option } from "effect"

// Nobody can approve without a terminal, so a missing --yes is a refusal there rather than a hang.
export function dependencies() {
  return FoundationCommand.dependencies({
    confirm: async () => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) return false
      const answer = await confirm({ message: "Initialize Foundation-managed workflow files in this project?" })
      return !isCancel(answer) && answer
    },
  })
}

export function args(input: { path: Option.Option<string>; yes?: boolean; json?: boolean }): FoundationCommand.Args {
  return { path: Option.getOrUndefined(input.path), yes: input.yes, json: input.json }
}
