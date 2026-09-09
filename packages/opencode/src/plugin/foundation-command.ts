export * as FoundationCommand from "./foundation-command"

import { CommandPreparation } from "@opencode-ai/core/command-preparation"
import { Command } from "@opencode-ai/schema/command"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { InstanceStore } from "@/project/instance-store"
import { FOUNDATION_COMMANDS, bootstrapInstruction, resolveFoundationInstruction } from "./foundation"
import { FoundationRuntime } from "./foundation-runtime"

export const layer = Layer.effect(CommandPreparation.Service, Effect.gen(function* () {
  const config = yield* Config.Service
  const instances = yield* InstanceStore.Service
  const settings = (directory: string) => instances.provide({ directory }, config.get())
  return CommandPreparation.Service.of({
    list: (directory, commands) => Effect.gen(function* () {
      const cfg = yield* settings(directory)
      const configured = Object.entries(cfg.command ?? {}).filter(([name, command]) => !Object.entries(FOUNDATION_COMMANDS).some(([builtin, info]) => builtin === name && info.template.trim() === command.template.trim())).map(([name, command]) => ({ name, template: command.template, description: command.description }))
      const discovered = [...commands.filter((command) => !configured.some((entry) => entry.name === command.name)), ...configured]
      if (cfg.foundation_workflow === false) return discovered
      return [...discovered, ...Object.entries(FOUNDATION_COMMANDS).filter(([name]) => !discovered.some((command) => command.name === name)).map(([name, command]) => ({ name, template: command.template, description: command.description }))]
    }),
    prepare: (input) => Effect.gen(function* () {
      const cfg = yield* settings(input.directory)
      const configured = cfg.command?.[input.name]
      const builtin = Object.entries(FOUNDATION_COMMANDS).find(([name]) => name === input.name)
      // Native V2 commands and explicit legacy config overrides retain their templates.
      const override = configured && (!builtin || configured.template.trim() !== builtin[1].template.trim())
        ? { name: input.name, template: configured.template, description: configured.description, agent: configured.agent,
          subtask: configured.subtask,
          model: configured.model ? Model.Ref.make({ providerID: Provider.ID.make(configured.model.split("/")[0]), id: Model.ID.make(configured.model.split("/").slice(1).join("/")), variant: configured.variant ? Model.VariantID.make(configured.variant) : undefined }) : undefined }
        : input.command && (!builtin || input.command.template.trim() !== builtin[1].template.trim()) ? input.command : undefined
      if (override) {
        if (override.subtask || override.template.includes("!`")) return yield* Effect.fail(new CommandPreparation.Error("command_unavailable", "This command requires legacy subtask or shell preparation"))
        const args = (input.arguments.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((arg) => arg.replace(/^["']|["']$/g, ""))
        const positions = [...override.template.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))
        const expanded = override.template.replace(/\$(\d+)/g, (_, position) => Number(position) === Math.max(...positions) ? args.slice(Number(position) - 1).join(" ") : args[Number(position) - 1] ?? "").replaceAll("$ARGUMENTS", input.arguments)
        return { ...override, template: positions.length || override.template.includes("$ARGUMENTS") || !input.arguments.trim() ? expanded : `${expanded}\n\n${input.arguments}` }
      }
      if (!builtin || cfg.foundation_workflow === false) return yield* Effect.fail(new CommandPreparation.Error("command_not_found", "Command is not available in this project"))
      const instruction = yield* Effect.promise(() => resolveFoundationInstruction({ command: builtin[0] as keyof typeof FOUNDATION_COMMANDS, arguments: input.arguments, directory: input.directory, runtimeMode: cfg.foundation_runtime ?? "bundled" }))
      if (!instruction.ok) return yield* Effect.fail(new CommandPreparation.Error("command_unavailable", `Foundation command unavailable (${instruction.code})`))
      const project = cfg.foundation_runtime !== "path" ? yield* Effect.promise(() => FoundationRuntime.status(input.directory).catch(() => undefined)) : undefined
      return Command.Info.make({ name: input.name, template: cfg.foundation_runtime !== "path" && project?.installed.state !== "installed" ? bootstrapInstruction(instruction.instruction) : instruction.instruction, description: builtin[1].description })
    }),
  })
}))
