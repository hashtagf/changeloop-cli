import type { ChangeItem } from "./changes-reader"

export function changeDraft(item: ChangeItem, commands: readonly { name: string }[]) {
  const known = ["change", "build", "prove", "land"]
  const preferred = item.status === "archived" || !known.includes(item.phase) ? "changes" : item.phase
  const command = commands.some((command) => command.name === preferred) ? preferred
    : commands.some((command) => command.name === "changes") ? "changes" : undefined
  if (!command) return undefined
  return command === "changes" ? "/changes" : `/${command} ${item.id}`
}
