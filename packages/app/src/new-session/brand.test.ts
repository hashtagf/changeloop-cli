import { describe, expect, test } from "bun:test"
import { HEIGHT, LOOP_START, pixels, ROWS, VIEW_BOX, WEAK_OPACITY, WIDTH } from "./brand"

describe("Changeloop wordmark", () => {
  test("is five rows of 62 columns drawn in a 310 by 25 box with no padding", () => {
    expect(ROWS).toHaveLength(5)
    expect(new Set(ROWS.map((row) => [...row].length))).toEqual(new Set([62]))
    expect([WIDTH, HEIGHT]).toEqual([310, 25])
    expect(VIEW_BOX).toBe("0 0 310 25")
    // The glyphs touch the box: something is drawn in the first and last row and the first and last column.
    expect(pixels.some((pixel) => pixel.y === 0)).toBe(true)
    expect(pixels.some((pixel) => pixel.y === 4)).toBe(true)
    expect(pixels.some((pixel) => pixel.x === 0)).toBe(true)
    expect(Math.max(...pixels.map((pixel) => pixel.x))).toBe(61)
  })

  test("has no duplicate or out-of-box pixel", () => {
    expect(new Set(pixels.map((pixel) => `${pixel.x},${pixel.y}`)).size).toBe(pixels.length)
    expect(pixels.every((pixel) => pixel.x >= 0 && pixel.x < 62 && pixel.y >= 0 && pixel.y < 5)).toBe(true)
  })

  test("keeps a one-cell gap between CHANGE and LOOP in every row", () => {
    expect(ROWS.every((row) => row[LOOP_START - 1] === " ")).toBe(true)
    expect(pixels.some((pixel) => pixel.x === LOOP_START - 1)).toBe(false)
  })

  test("draws CHANGE lighter than LOOP", () => {
    expect(new Set(pixels.filter((pixel) => pixel.x < LOOP_START).map((pixel) => pixel.opacity))).toEqual(
      new Set([WEAK_OPACITY]),
    )
    expect(new Set(pixels.filter((pixel) => pixel.x >= LOOP_START).map((pixel) => pixel.opacity))).toEqual(
      new Set([1]),
    )
  })
})
