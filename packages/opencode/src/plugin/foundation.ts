import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin"
import TEMPLATE_INVESTIGATE from "./foundation/investigate.txt"
import TEMPLATE_CHANGE from "./foundation/change.txt"
import TEMPLATE_BUILD from "./foundation/build.txt"
import TEMPLATE_PROVE from "./foundation/prove.txt"
import TEMPLATE_LAND from "./foundation/land.txt"
import TEMPLATE_CHANGES from "./foundation/changes.txt"
import TEMPLATE_FEATURE from "./foundation/feature.txt"
import TEMPLATE_DEV from "./foundation/dev.txt"

export const FOUNDATION_COMMANDS: Record<string, { description: string; template: string }> = {
  investigate: {
    description: "Explore a problem or bounded alternatives without committing.",
    template: TEMPLATE_INVESTIGATE,
  },
  change: {
    description: "Create or complete an OpenSpec change and evidence contract.",
    template: TEMPLATE_CHANGE,
  },
  build: {
    description: "Implement one OpenSpec change in isolation.",
    template: TEMPLATE_BUILD,
  },
  prove: {
    description: "Produce content-bound evidence for an OpenSpec change.",
    template: TEMPLATE_PROVE,
  },
  land: {
    description: "Land and archive a proven OpenSpec change.",
    template: TEMPLATE_LAND,
  },
  changes: {
    description: "List active OpenSpec changes, readiness, blockers, and stale proof.",
    template: TEMPLATE_CHANGES,
  },
  feature: {
    description: "Ground a PRD once, then run one group through change, build, and prove.",
    template: TEMPLATE_FEATURE,
  },
  dev: {
    description: "Compatibility composition for change → build → prove.",
    template: TEMPLATE_DEV,
  },
}

export function applyFoundationCommands(config: Config & { foundation_workflow?: boolean }) {
  if (config.foundation_workflow === false) return
  config.command ??= {}
  for (const [name, command] of Object.entries(FOUNDATION_COMMANDS)) {
    // A user-defined command with the same name always wins over the bundled one.
    if (config.command[name]) continue
    config.command[name] = { template: command.template, description: command.description }
  }
}

export async function FoundationWorkflowPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    config: async (config) => {
      applyFoundationCommands(config as Config & { foundation_workflow?: boolean })
    },
  }
}
