import type { ChangeItem } from "./reader"

const PHASES = ["change", "build", "prove", "land"]

/**
 * The command draft that continues a change, or undefined when the project has no usable Foundation command. An
 * archived change or a phase without its own command opens the history command. Opening the draft submits nothing.
 */
export function changeDraft(item: ChangeItem, commands: readonly { name: string }[]) {
  const has = (name: string) => commands.some((command) => command.name === name)
  const preferred = item.status === "archived" || !PHASES.includes(item.phase) ? "changes" : item.phase
  const command = has(preferred) ? preferred : has("changes") ? "changes" : undefined

  if (!command) return undefined

  return command === "changes" ? "/changes" : `/${command} ${item.id}`
}

/** The draft that continues a saved note with `command`, or undefined when the project does not have that command. */
export function noteDraft(command: "investigate" | "change", source: string, commands: readonly { name: string }[]) {
  return commands.some((item) => item.name === command) ? `/${command} ${source}` : undefined
}

/** The draft for a command that takes no change, such as starting an investigation. */
export function investigateDraft(commands: readonly { name: string }[]) {
  return commands.some((command) => command.name === "investigate") ? "/investigate" : undefined
}
