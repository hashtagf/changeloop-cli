import type { ServerConnection } from "./server"
import type { Tab } from "./tabs"

export function migrateTabs(value: unknown, fallback: ServerConnection.Key): Tab[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<Tab>((tab) => {
    if (!tab || typeof tab !== "object") return []
    if ("server" in tab && typeof tab.server !== "string") return []
    const server = ("server" in tab ? tab.server : fallback) as ServerConnection.Key
    if (
      tab.type === "changes" &&
      typeof tab.directory === "string" &&
      (tab.scope === "active" || tab.scope === "archive" || tab.scope === "investigations")
    ) {
      return [
        {
          type: tab.type,
          server,
          directory: tab.directory,
          scope: tab.scope,
          search: typeof tab.search === "string" ? tab.search : undefined,
          changeID: typeof tab.changeID === "string" ? tab.changeID : undefined,
          section: typeof tab.section === "string" ? tab.section : undefined,
          investigationID: typeof tab.investigationID === "string" ? tab.investigationID : undefined,
          documentID: typeof tab.documentID === "string" ? tab.documentID : undefined,
          anchor: typeof tab.anchor === "string" ? tab.anchor : undefined,
          documentOffset:
            typeof tab.documentOffset === "number" &&
            Number.isSafeInteger(tab.documentOffset) &&
            tab.documentOffset >= 0
              ? tab.documentOffset
              : undefined,
          offset:
            typeof tab.offset === "number" && Number.isSafeInteger(tab.offset) && tab.offset >= 0
              ? tab.offset
              : undefined,
        },
      ]
    }
    if (tab.type === "session" && typeof tab.sessionId === "string") {
      return [{ type: tab.type, server, sessionId: tab.sessionId }]
    }
    if (
      tab.type === "draft" &&
      typeof tab.draftID === "string" &&
      typeof tab.directory === "string" &&
      (tab.worktree === undefined || typeof tab.worktree === "string")
    ) {
      return [{ type: tab.type, server, draftID: tab.draftID, directory: tab.directory, worktree: tab.worktree }]
    }
    return []
  })
}
