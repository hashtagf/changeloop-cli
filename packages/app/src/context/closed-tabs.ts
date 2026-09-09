import type { ChangesTab, SessionTab, Tab } from "./tabs"

export type ClosedTab = {
  tab: SessionTab | ChangesTab
  index: number
}

const CLOSED_TAB_LIMIT = 25

// Session and Changes tabs are recorded; closing a draft tab deletes its persisted
// state, so a reopened draft would come back empty anyway.
export function pushClosedTab(stack: ClosedTab[], tab: Tab, index: number): ClosedTab[] {
  if (tab.type === "draft") return stack
  return [...stack, { tab: { ...tab }, index }].slice(-CLOSED_TAB_LIMIT)
}

// Pops the most recently closed tab that is not open again,
// discarding stale entries along the way.
export function takeClosedTab(stack: ClosedTab[], tabs: Tab[]): { entry?: ClosedTab; stack: ClosedTab[] } {
  const remaining = [...stack]
  while (remaining.length) {
    const entry = remaining.pop()
    if (entry && !isOpen(tabs, entry.tab)) return { entry, stack: remaining }
  }
  return { stack: remaining }
}

export function removeClosedTabs(stack: ClosedTab[], server: SessionTab["server"], sessionIDs: string[]) {
  const removed = new Set(sessionIDs)
  return stack.filter(
    (entry) => entry.tab.server !== server || entry.tab.type !== "session" || !removed.has(entry.tab.sessionId),
  )
}

export function nextTabAfterClose(tabs: Tab[], index: number, active: boolean) {
  if (!active) return undefined
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

function isOpen(tabs: Tab[], tab: SessionTab | ChangesTab) {
  return tabs.some(
    (item) =>
      item.server === tab.server &&
      (tab.type === "changes"
        ? item.type === "changes" && item.directory === tab.directory
        : item.type === "session" && item.sessionId === tab.sessionId),
  )
}
