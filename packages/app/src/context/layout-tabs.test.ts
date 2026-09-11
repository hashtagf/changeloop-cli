import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  SESSION_OPEN_FILE_TAB,
  SESSION_PREVIEW_PANE_TAB,
  closeSessionTab,
  openSessionTab,
  previewSessionTab,
  type SessionTabState,
} from "./layout-tabs"
import { createSessionTabs } from "@/pages/session/helpers"

const state = (all: string[], active?: string, preview?: string): SessionTabState => ({
  tabs: { all, active },
  preview,
})

describe("previewSessionTab", () => {
  test("appends the Open File placeholder", () => {
    expect(previewSessionTab(state(["file://a.ts"], "file://a.ts"), SESSION_OPEN_FILE_TAB)).toEqual(
      state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
    )
  })

  test("replaces the current preview in place", () => {
    expect(
      previewSessionTab(
        state(["context", SESSION_OPEN_FILE_TAB, "file://b.ts"], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
        "file://a.ts",
      ),
    ).toEqual(state(["context", "file://a.ts", "file://b.ts"], "file://a.ts", "file://a.ts"))
  })

  test("activates a durable tab without duplicating it", () => {
    expect(
      previewSessionTab(
        state(["file://a.ts", SESSION_OPEN_FILE_TAB, "file://b.ts"], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
        "file://b.ts",
      ),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://b.ts"))
  })

  test("replaces a restored Open File placeholder", () => {
    expect(
      previewSessionTab(state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB), "file://b.ts"),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://b.ts", "file://b.ts"))
  })
})

describe("openSessionTab", () => {
  test("pins the current preview", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://a.ts")).toEqual(
      state(["file://a.ts"], "file://a.ts"),
    )
  })

  test("replaces a preview with a directly opened file", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://b.ts")).toEqual(
      state(["file://b.ts"], "file://b.ts"),
    )
  })

  test("keeps the preview when switching to Review", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "review")).toEqual(
      state(["file://a.ts"], "review", "file://a.ts"),
    )
  })

  test("replaces a restored Open File placeholder with a direct open", () => {
    expect(openSessionTab(state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB), "file://b.ts")).toEqual(
      state(["file://a.ts", "file://b.ts"], "file://b.ts"),
    )
  })
})

describe("closeSessionTab", () => {
  test("clears preview metadata and selects the left neighbor", () => {
    expect(
      closeSessionTab(
        state(["file://a.ts", "file://b.ts", "file://c.ts"], "file://b.ts", "file://b.ts"),
        "file://b.ts",
      ),
    ).toEqual(state(["file://a.ts", "file://c.ts"], "file://a.ts"))
  })
})

describe("preview pane tab", () => {
  test("appends and activates the pane without consuming the preview slot", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), SESSION_PREVIEW_PANE_TAB)).toEqual(
      state(["file://a.ts", SESSION_PREVIEW_PANE_TAB], SESSION_PREVIEW_PANE_TAB, "file://a.ts"),
    )
  })

  test("reactivates an already open pane without duplicating it", () => {
    expect(
      openSessionTab(state(["file://a.ts", SESSION_PREVIEW_PANE_TAB], "file://a.ts"), SESSION_PREVIEW_PANE_TAB),
    ).toEqual(state(["file://a.ts", SESSION_PREVIEW_PANE_TAB], SESSION_PREVIEW_PANE_TAB))
  })

  test("closing the pane selects the left neighbour and keeps the other tabs", () => {
    expect(
      closeSessionTab(
        state(["file://a.ts", SESSION_PREVIEW_PANE_TAB, "file://b.ts"], SESSION_PREVIEW_PANE_TAB),
        SESSION_PREVIEW_PANE_TAB,
      ),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://a.ts"))
  })

  const sessionTabs = (all: string[], active?: string) =>
    createSessionTabs({
      tabs: createMemo(() => ({ active: () => active, all: () => all })),
      pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
      normalizeTab: (tab) => tab,
      review: () => true,
      hasReview: () => true,
      fileBrowser: () => true,
    })

  test("is an active, closable tab that is never treated as a file tab", () => {
    createRoot((dispose) => {
      const [store] = createStore({ ready: true })
      expect(store.ready).toBe(true)
      const result = sessionTabs(["file://a.ts", SESSION_PREVIEW_PANE_TAB], SESSION_PREVIEW_PANE_TAB)

      expect(result.previewPaneOpen()).toBe(true)
      expect(result.activeTab()).toBe(SESSION_PREVIEW_PANE_TAB)
      expect(result.closableTab()).toBe(SESSION_PREVIEW_PANE_TAB)
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.panelTabs()).toEqual(["file://a.ts"])
      dispose()
    })
  })

  test("restores the pane as the fallback tab when nothing else is active", () => {
    createRoot((dispose) => {
      const result = sessionTabs([SESSION_PREVIEW_PANE_TAB])

      expect(result.previewPaneOpen()).toBe(true)
      expect(result.activeTab()).toBe(SESSION_PREVIEW_PANE_TAB)
      dispose()
    })
  })

  test("leaves existing review and context selection untouched", () => {
    createRoot((dispose) => {
      const result = sessionTabs(["context"], "context")

      expect(result.previewPaneOpen()).toBe(false)
      expect(result.activeTab()).toBe("context")
      dispose()
    })
  })
})
