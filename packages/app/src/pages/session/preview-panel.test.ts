import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  PREVIEW_FRAME_ATTRIBUTES,
  PREVIEW_TEXT,
  createPreviewController,
  previewStateText,
  type PreviewPhase,
} from "./preview-panel"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const controller = (input: { reachable: boolean; appOrigin?: string; confirmMs?: number }) => {
  const remembered: string[] = []
  const value = createPreviewController({
    directory: "/project",
    appOrigin: input.appOrigin ?? "http://localhost:4096",
    probe: async () => input.reachable,
    confirmMs: input.confirmMs ?? 20,
    remember: (target) => remembered.push(target),
  })
  return { value, remembered }
}

describe("preview controller states", () => {
  test("loads an accepted target and reports it loaded once the frame reports back", async () => {
    await createRoot(async (dispose) => {
      const { value, remembered } = controller({ reachable: true })

      expect(value.phase()).toBe("no-target")
      expect(value.submit("localhost:3000")).toBe("http://localhost:3000/")
      expect(value.phase()).toBe("loading")
      expect(remembered).toEqual(["http://localhost:3000/"])

      await settle()
      value.frameLoaded()
      expect(value.phase()).toBe("loaded")
      dispose()
    })
  })

  test("reports an unreachable target instead of an empty frame", async () => {
    await createRoot(async (dispose) => {
      const { value } = controller({ reachable: false })
      value.submit("http://localhost:9999")

      await settle()
      expect(value.phase()).toBe("unreachable")
      expect(value.target()).toBe("http://localhost:9999/")
      dispose()
    })
  })

  test("reports framing refusal when a reachable target never renders", async () => {
    await createRoot(async (dispose) => {
      const { value } = controller({ reachable: true, confirmMs: 10 })
      value.submit("https://example.com")

      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(value.phase()).toBe("framing-refused")
      expect(value.target()).toBe("https://example.com/")
      dispose()
    })
  })

  test("never frames insecure remote content from a secure app origin", async () => {
    await createRoot(async (dispose) => {
      const { value } = controller({ reachable: true, appOrigin: "oc://renderer" })
      value.submit("http://staging.example.com")

      expect(value.phase()).toBe("blocked-insecure-content")
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(value.phase()).toBe("blocked-insecure-content")
      expect(value.target()).toBe("http://staging.example.com/")
      dispose()
    })
  })

  test("rejects unsupported schemes without navigating", () => {
    createRoot((dispose) => {
      const { value, remembered } = controller({ reachable: true })

      expect(value.submit("file:///etc/passwd")).toBeUndefined()
      expect(value.phase()).toBe("invalid-target")
      expect(value.rejection()).toBe("unsupported-scheme")
      expect(value.target()).toBe("")
      expect(value.frameToken()).toBe("")
      expect(remembered).toEqual([])
      dispose()
    })
  })

  test("keeps an empty submission in the no-target state", () => {
    createRoot((dispose) => {
      const { value } = controller({ reachable: true })

      value.submit("   ")
      expect(value.phase()).toBe("no-target")
      expect(value.rejection()).toBe("empty")
      dispose()
    })
  })
})

describe("preview reload", () => {
  test("recreates the frame while keeping the same target", async () => {
    await createRoot(async (dispose) => {
      const { value } = controller({ reachable: true })
      value.submit("http://localhost:3000")
      await settle()
      value.frameLoaded()

      const before = value.frameToken()
      value.reload()

      expect(value.target()).toBe("http://localhost:3000/")
      expect(value.frameToken()).not.toBe(before)
      expect(value.phase()).toBe("loading")
      dispose()
    })
  })

  test("does nothing without a target", () => {
    createRoot((dispose) => {
      const { value } = controller({ reachable: true })
      value.reload()

      expect(value.phase()).toBe("no-target")
      expect(value.frameToken()).toBe("")
      dispose()
    })
  })

  test("restores a remembered target once and never overrides an explicit one", async () => {
    await createRoot(async (dispose) => {
      const { value } = controller({ reachable: true })
      value.restore("http://localhost:5173/")
      expect(value.target()).toBe("http://localhost:5173/")

      value.restore("http://localhost:4321/")
      expect(value.target()).toBe("http://localhost:5173/")

      value.submit("http://localhost:4321")
      expect(value.target()).toBe("http://localhost:4321/")

      value.clear()
      expect(value.phase()).toBe("no-target")
      expect(value.target()).toBe("")
      dispose()
    })
  })
})

describe("preview frame isolation", () => {
  test("frames a foreign origin without granting it the app", () => {
    const sandbox = PREVIEW_FRAME_ATTRIBUTES.sandbox.split(" ")

    expect(sandbox).toContain("allow-scripts")
    expect(sandbox).toContain("allow-forms")
    // The target keeps its own origin; that grants nothing against the app origin.
    expect(sandbox).toContain("allow-same-origin")
    for (const escalation of [
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-popups",
      "allow-downloads",
      "allow-modals",
      "allow-presentation",
    ]) {
      expect(sandbox).not.toContain(escalation)
    }
    expect(PREVIEW_FRAME_ATTRIBUTES.referrerPolicy).toBe("no-referrer")
    expect(PREVIEW_FRAME_ATTRIBUTES.allow).toBe("")
  })
})

describe("preview state text", () => {
  const phases: PreviewPhase[] = [
    "no-target",
    "invalid-target",
    "loading",
    "loaded",
    "unreachable",
    "framing-refused",
    "blocked-insecure-content",
  ]

  test("every state and rejection has its own sentence", () => {
    const messages = [
      ...phases.map((phase) => previewStateText(phase)),
      ...(["empty", "unsupported-scheme", "malformed"] as const).map((rejection) =>
        previewStateText("invalid-target", rejection),
      ),
    ]

    for (const message of messages) expect(message.length).toBeGreaterThan(0)
    expect(new Set(messages).size).toBe(messages.length)
    expect(PREVIEW_TEXT.tab).toBe("Preview")
  })

  test("names the browser fallback in the states the user cannot fix in place", () => {
    for (const phase of ["framing-refused", "blocked-insecure-content"] as PreviewPhase[]) {
      expect(previewStateText(phase)).toContain("browser")
    }
  })
})
