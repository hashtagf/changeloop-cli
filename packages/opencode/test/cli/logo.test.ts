import { describe, expect, test } from "bun:test"
import { logo as glyphs } from "@opencode-ai/tui/logo"
import { logo } from "../../src/cli/ui"
// Not an exported subpath of @opencode-ai/tui — reach the source file directly.
import { sessionEpilogue } from "../../../tui/src/util/presentation"

// The banner spells "changeloop": left half "change" (6 letters), right half
// "loop" (4 letters). Row 1 has no _/^/~ marks, so it renders identically in
// the plain and TTY branches — that makes it the stable brand assertion.
const CHANGE_ROW = "█▀▀▀ █▀▀▄ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█"
const LOOP_ROW = "█    █▀▀█ █▀▀█ █▀▀█"
const OLD_OPEN_ROW = "█▀▀█ █▀▀█ █▀▀█ █▀▀▄"

const stripAnsi = (text: string) => text.replaceAll(/\x1b\[[0-9;]*m/g, "")
const resolveMarks = (row: string) => row.replaceAll("_", " ").replaceAll(/[\^~]/g, "▀")

describe("changeloop banner", () => {
  test("glyph tables are internally consistent", () => {
    expect(glyphs.left.length).toBe(glyphs.right.length)
    for (const half of [glyphs.left, glyphs.right]) {
      const widths = new Set(half.map((row) => [...row].length))
      expect(widths.size).toBe(1)
    }
  })

  test("glyph rows spell changeloop, not opencode", () => {
    expect(resolveMarks(glyphs.left[1])).toBe(CHANGE_ROW)
    expect(resolveMarks(glyphs.right[1])).toBe(LOOP_ROW)
    for (const row of [...glyphs.left, ...glyphs.right]) {
      expect(resolveMarks(row)).not.toContain(OLD_OPEN_ROW)
    }
  })

  test("UI.logo output carries the changeloop wordmark in both render branches", () => {
    const rendered = stripAnsi(logo())
    expect(rendered).toContain(CHANGE_ROW)
    expect(rendered).toContain(LOOP_ROW)
    expect(rendered).not.toContain(OLD_OPEN_ROW)
  })

  test("session epilogue hints the changeloop command", () => {
    const rendered = stripAnsi(sessionEpilogue({ title: "t", sessionID: "ses_x" }))
    expect(rendered).toContain("changeloop -s ses_x")
    expect(rendered).toContain(CHANGE_ROW)
    expect(rendered).not.toContain("opencode -s")
  })
})
