import { expect, test } from "bun:test"
import { epilogue } from "../../src/util/presentation"
import { logo } from "../../src/logo"

const rows = (text: string | undefined) =>
  Bun.stripANSI(text ?? "")
    .split("\n")
    .filter((line) => line.trim() && !/[▀▄█]/.test(line))

test("prints nothing without a session or update", () => {
  expect(epilogue({})).toBeUndefined()
})

test("formats session continuation summary", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" } }))).toEqual([
    "  Session   A session",
    "  Continue  changeloop -s ses_123",
  ])
})

test("tells the user to start Changeloop again after an update", () => {
  expect(rows(epilogue({ updatedVersion: "2.0.0" }))).toEqual(["  Run changeloop to use 2.0.0"])
})

test("keeps the session continuation after an update", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" }, updatedVersion: "2.0.0" }))).toEqual([
    "  Run changeloop to use 2.0.0",
    "  Session   A session",
    "  Continue  changeloop -s ses_123",
  ])
})

const session = { title: "A session", sessionID: "ses_123" }
const printed = (width: number) => Bun.stripANSI(epilogue({ session, width }) ?? "").split("\n")

test("draws the pixel wordmark in the epilogue", () => {
  const output = printed(80)
  expect(output[0]).toBe(`  ${logo.left[0]} ${logo.right[0]}`)
  expect(output.some((line) => line.includes("█▀▀█ █▀▀█ █▀▀█ █▀▀▄"))).toBe(false)
})

test("stacks the wordmark halves when only one fits across", () => {
  const output = printed(40)
  expect(output.slice(0, 5)).toEqual(logo.left.map((row) => `  ${row}`))
  expect(output.slice(5, 10)).toEqual(logo.right.map((row) => `  ${row}`))
})

test("omits the wordmark when not even one half fits", () => {
  expect(printed(30).some((line) => /[█]/.test(line))).toBe(false)
})

test.each([30, 37, 40, 62, 63, 80])("no wordmark row is wider than %d columns", (width) => {
  for (const line of printed(width).filter((line) => /█/.test(line))) expect(line.length).toBeLessThanOrEqual(width)
})
