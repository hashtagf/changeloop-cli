import { beforeEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Platform } from "@/context/platform"
import { createPreviewTargetStore } from "@/pages/session/preview-target"

/**
 * The Preview panel unmounts on every side-panel tab switch, so the remembered
 * target only survives if it is written through the persisting setter.
 */
const platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
} as unknown as Platform

const stored = () =>
  Object.keys(localStorage)
    .map((key) => localStorage.getItem(key) ?? "")
    .join("|")

beforeEach(() => localStorage.clear())

describe("preview target persistence", () => {
  test("a target remembered in one panel instance is read back by the next", () => {
    createRoot((dispose) => {
      const first = createPreviewTargetStore({ directory: "/project", platform })
      first.remember("http://localhost:3000/")

      expect(first.target()).toBe("http://localhost:3000/")
      expect(stored()).toContain("http://localhost:3000/")

      const second = createPreviewTargetStore({ directory: "/project", platform })
      expect(second.target()).toBe("http://localhost:3000/")
      dispose()
    })
  })

  test("forgetting clears the stored target for the next instance", () => {
    createRoot((dispose) => {
      const first = createPreviewTargetStore({ directory: "/project", platform })
      first.remember("http://localhost:3000/")
      first.forget()

      expect(stored()).not.toContain("http://localhost:3000/")
      expect(createPreviewTargetStore({ directory: "/project", platform }).target()).toBe("")
      dispose()
    })
  })

  test("one project never inherits another project's target", () => {
    createRoot((dispose) => {
      createPreviewTargetStore({ directory: "/project-one", platform }).remember("http://localhost:3000/")

      expect(createPreviewTargetStore({ directory: "/project-two", platform }).target()).toBe("")
      dispose()
    })
  })
})
