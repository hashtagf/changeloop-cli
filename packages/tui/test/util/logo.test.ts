import { expect, test } from "bun:test"
import { logo } from "../../src/logo"

// Left half spells CHANGE, right half spells LOOP; the circular-arrow loop icon stands in for both O letters.
const LOOP_ICON_TOP = " ███ █"
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

test("both halves have five rows and every row is pixels and spaces only", () => {
  expect(logo.left).toHaveLength(5)
  expect(logo.right).toHaveLength(5)
  for (const row of [...logo.left, ...logo.right]) expect(row).toMatch(/^[█ ]+$/)
})

test("each half keeps one width so the halves line up", () => {
  expect(new Set(logo.left.map((row) => row.length)).size).toBe(1)
  expect(new Set(logo.right.map((row) => row.length)).size).toBe(1)
})

test("rows spell CHANGE and LOOP with a loop icon as both O letters", () => {
  expect(logo.left[0]).toBe(" ████ █   █  ███  █   █  ████ █████")
  expect(logo.right[0]).toBe("█      ███ █  ███ █ ████ ")
  expect(count(logo.right[0], LOOP_ICON_TOP)).toBe(2)
})

test("does not spell the old opencode glyphs", () => {
  for (const row of [...logo.left, ...logo.right]) {
    expect(row).not.toContain("█▀▀█ █▀▀█")
    expect(row).not.toContain("▀")
  }
})
