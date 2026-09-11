import { describe, expect, test } from "bun:test"
import {
  canonicalizePreviewTarget,
  isBlockedInsecureTarget,
  previewTargetCandidates,
  previewTargetStorage,
} from "./preview-target"
import { observeTerminalOutput, clearTerminalOutputTail, terminalOutputTail } from "@/context/terminal"

const ESC = "\u001b"

describe("canonicalizePreviewTarget", () => {
  test("accepts an explicit http and https target", () => {
    expect(canonicalizePreviewTarget("http://localhost:3000")).toEqual({
      accepted: true,
      target: "http://localhost:3000/",
    })
    expect(canonicalizePreviewTarget("https://staging.example.com/app?tab=1")).toEqual({
      accepted: true,
      target: "https://staging.example.com/app?tab=1",
    })
  })

  test("assumes http for a bare host and port", () => {
    expect(canonicalizePreviewTarget(" localhost:5173 ")).toEqual({
      accepted: true,
      target: "http://localhost:5173/",
    })
    expect(canonicalizePreviewTarget("127.0.0.1:8080/app")).toEqual({
      accepted: true,
      target: "http://127.0.0.1:8080/app",
    })
  })

  test("rejects every other scheme without navigating", () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>x</b>", "about:blank"]) {
      expect(canonicalizePreviewTarget(value)).toEqual({ accepted: false, rejection: "unsupported-scheme" })
    }
  })

  test("rejects empty and malformed input", () => {
    expect(canonicalizePreviewTarget("   ")).toEqual({ accepted: false, rejection: "empty" })
    expect(canonicalizePreviewTarget("http://")).toEqual({ accepted: false, rejection: "malformed" })
    expect(canonicalizePreviewTarget("http:// ")).toEqual({ accepted: false, rejection: "malformed" })
  })
})

describe("isBlockedInsecureTarget", () => {
  test("blocks plain http on a remote host inside a secure app origin", () => {
    expect(isBlockedInsecureTarget("http://staging.example.com/", "oc://renderer")).toBe(true)
    expect(isBlockedInsecureTarget("http://staging.example.com/", "https://app.example.com")).toBe(true)
  })

  test("allows loopback and https targets", () => {
    expect(isBlockedInsecureTarget("http://localhost:3000/", "oc://renderer")).toBe(false)
    expect(isBlockedInsecureTarget("http://127.0.0.1:3000/", "oc://renderer")).toBe(false)
    expect(isBlockedInsecureTarget("https://staging.example.com/", "oc://renderer")).toBe(false)
  })

  test("does not block anything from a plain http app origin", () => {
    expect(isBlockedInsecureTarget("http://staging.example.com/", "http://localhost:4096")).toBe(false)
  })
})

describe("previewTargetCandidates", () => {
  test("collects http(s) targets from dev server output, newest last", () => {
    const output = [
      "  VITE v6.0.0  ready in 210 ms",
      "",
      `  ${ESC}[32m→${ESC}[39m  Local:   http://localhost:5173/`,
      "  Network: http://192.168.1.10:5173/",
    ].join("\n")

    expect(previewTargetCandidates(output)).toEqual(["http://localhost:5173/", "http://192.168.1.10:5173/"])
  })

  test("deduplicates repeats and keeps the latest mention last", () => {
    const output = "http://localhost:3000 restarting...\nhttp://localhost:4000\nhttp://localhost:3000\n"

    expect(previewTargetCandidates(output)).toEqual(["http://localhost:4000/", "http://localhost:3000/"])
  })

  test("drops trailing punctuation and non-http targets", () => {
    const output = "listening on http://localhost:3000, ws://localhost:3000, file:///tmp/x"

    expect(previewTargetCandidates(output)).toEqual(["http://localhost:3000/"])
  })

  test("returns nothing when no target was printed", () => {
    expect(previewTargetCandidates("compiled successfully\n")).toEqual([])
    expect(previewTargetCandidates("")).toEqual([])
  })
})

describe("previewTargetStorage", () => {
  test("keys the remembered target by project so another project cannot inherit it", () => {
    const one = previewTargetStorage("/Users/me/app-one")
    const two = previewTargetStorage("/Users/me/app-two")

    expect(one.storage).not.toBe(two.storage)
    expect(one.key).toContain("preview-target")
    expect(previewTargetStorage("/Users/me/app-one").storage).toBe(one.storage)
  })
})

// The remembered-target round trip needs the client Solid build; it lives in
// test-browser/preview-target-persistence.test.ts.

describe("app-origin targets", () => {
  test("refuses the app's own origin, which a same-origin frame would fully control", () => {
    expect(canonicalizePreviewTarget("http://localhost:4096/", "http://localhost:4096")).toEqual({
      accepted: false,
      rejection: "app-origin",
    })
    expect(canonicalizePreviewTarget("localhost:4096/changes", "http://localhost:4096")).toEqual({
      accepted: false,
      rejection: "app-origin",
    })
    expect(canonicalizePreviewTarget("http://localhost:3000/", "http://localhost:4096")).toEqual({
      accepted: true,
      target: "http://localhost:3000/",
    })
  })

  test("never suggests the app's own origin seen in terminal output", () => {
    const output = "server listening on http://localhost:4096\nLocal: http://localhost:5173/\n"

    expect(previewTargetCandidates(output, "http://localhost:4096")).toEqual(["http://localhost:5173/"])
  })
})

describe("terminal output tail", () => {
  test("exposes what a running process printed and stays bounded", () => {
    clearTerminalOutputTail("/project")
    observeTerminalOutput("/project", "Local: http://localhost:5173/\n")
    expect(previewTargetCandidates(terminalOutputTail("/project"))).toEqual(["http://localhost:5173/"])

    observeTerminalOutput("/project", "x".repeat(9000))
    expect(terminalOutputTail("/project").length).toBe(8000)
    clearTerminalOutputTail("/project")
    expect(terminalOutputTail("/project")).toBe("")
  })

  test("ignores empty chunks and unknown projects", () => {
    clearTerminalOutputTail("/other")
    observeTerminalOutput("/other", "")
    observeTerminalOutput("", "ignored")
    expect(terminalOutputTail("/other")).toBe("")
    expect(terminalOutputTail("/never-seen")).toBe("")
  })
})
