import { expect, test } from "bun:test"
import { assertBrowserReport, assertBunTests, sameBuild } from "../../script/foundation-webui-verification"

test("verification rejects absent, skipped, filtered, failed and undersized Bun suites", () => {
  expect(() => assertBunTests("9 pass\n0 fail", 9)).not.toThrow()
  for (const output of ["", "0 pass\n0 fail", "9 pass\n1 fail", "9 pass\n0 fail\n1 skip", "9 pass\n0 fail\n1 filtered out", "9 pass\n0 fail\n1 todo"]) expect(() => assertBunTests(output, 9)).toThrow()
})
test("verification rejects missing, failed, skipped or flaky browser reports", () => {
  const good = { stats: { expected: 6, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] }
  expect(() => assertBrowserReport(good, 6)).not.toThrow()
  for (const report of [{}, { ...good, stats: { ...good.stats, expected: 0 } }, ...["unexpected", "skipped", "flaky"].map((key) => ({ ...good, stats: { ...good.stats, [key]: 1 } })), { ...good, errors: ["crash"] }]) expect(() => assertBrowserReport(report, 6)).toThrow()
})
test("compiled reuse requires all source, binary and served-asset digests", () => {
  const current = { source: "source", binary: "binary", assets: "assets" }
  expect(sameBuild(current, current)).toBe(true)
  for (const old of [undefined, {}, ...Object.keys(current).map((key) => ({ ...current, [key]: "changed" }))]) expect(sameBuild(old, current)).toBe(false)
})
