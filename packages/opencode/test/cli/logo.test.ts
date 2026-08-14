import { describe, expect, test } from "bun:test"
import { logo as glyphs } from "@opencode-ai/tui/logo"
import { logo } from "../../src/cli/ui"
// Not an exported subpath of @opencode-ai/tui — reach the source file directly.
import { sessionEpilogue } from "../../../tui/src/util/presentation"

// The banner is a 5-row pixel wordmark: left half CHANGE, right half LOOP
// with a circular-arrow loop icon standing in for both O letters. The rows
// contain only pixels (█) and spaces, so they render identically in the
// plain and TTY branches.
const CHANGE_ROW = " ████ █   █  ███  █   █  ████ █████"
const LOOP_ROW = "█      ███ █  ███ █ ████ "
const LOOP_ICON_TOP = " ███ █"

const stripAnsi = (text: string) => text.replaceAll(/\x1b\[[0-9;]*m/g, "")
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe("changeloop pixel banner", () => {
  test("glyph tables are internally consistent", () => {
    expect(glyphs.left.length).toBe(glyphs.right.length)
    for (const half of [glyphs.left, glyphs.right]) {
      const widths = new Set(half.map((row) => [...row].length))
      expect(widths.size).toBe(1)
    }
  })

  test("rows spell pixel CHANGELOOP with a loop icon as both O letters", () => {
    expect(glyphs.left[0]).toBe(CHANGE_ROW)
    expect(glyphs.right[0]).toBe(LOOP_ROW)
    expect(count(glyphs.right[0], LOOP_ICON_TOP)).toBe(2)
  })

  test("UI.logo output carries the pixel wordmark in both render branches", () => {
    const rendered = stripAnsi(logo())
    expect(rendered).toContain(CHANGE_ROW.trimStart())
    expect(rendered).toContain(LOOP_ROW.trimEnd())
    // The old block-glyph font used half-blocks; the pixel wordmark must not.
    expect(rendered).not.toContain("▀")
  })

  test("session epilogue hints the changeloop command and shares the wordmark", () => {
    const rendered = stripAnsi(sessionEpilogue({ title: "t", sessionID: "ses_x" }))
    expect(rendered).toContain("changeloop -s ses_x")
    expect(rendered).toContain(CHANGE_ROW.trimStart())
    expect(rendered).not.toContain("opencode -s")
  })
})
