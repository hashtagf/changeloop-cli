import { describe, expect, test } from "bun:test"
import { changeSection, currentStep, emptyKey, evidenceStatus, measurement, nextTab, WORKFLOW } from "./view-model"

describe("Changes view model", () => {
  test("an empty list names the search first, then the archive, then the active scope", () => {
    expect(emptyKey({ scope: "active", search: "zzz" })).toBe("changes.empty.search")
    expect(emptyKey({ scope: "archive", search: "zzz" })).toBe("changes.empty.search")
    expect(emptyKey({ scope: "archive", search: "" })).toBe("changes.empty.archive")
    expect(emptyKey({ scope: "active", search: "" })).toBe("changes.empty.active")
  })

  test("evidence status is the snapshot's own value and unknown when absent", () => {
    expect(evidenceStatus({ evidenceStatus: "unverified", evidence: null })).toBe("unverified")
    expect(
      evidenceStatus({ evidence: { status: "pass", recordedStatus: null, freshness: "fresh", providers: [] } }),
    ).toBe("pass")
    expect(evidenceStatus({ evidence: null })).toBeUndefined()
  })

  test("a null or missing measurement is unknown while a reported zero is kept", () => {
    expect(measurement(null)).toBeUndefined()
    expect(measurement(undefined)).toBeUndefined()
    expect(measurement(0)).toBe("0")
    expect(measurement(1200)).toBe("1200")
  })

  test("arrow keys wrap around the tabs and every other key stays", () => {
    expect(nextTab(0, 3, "ArrowRight")).toBe(1)
    expect(nextTab(2, 3, "ArrowRight")).toBe(0)
    expect(nextTab(0, 3, "ArrowLeft")).toBe(2)
    expect(nextTab(1, 3, "Enter")).toBe(1)
  })

  test("only the phase of the change is the current step, whatever its case", () => {
    expect(WORKFLOW.filter((step) => currentStep("Build", step))).toEqual(["build"])
    expect(WORKFLOW.filter((step) => currentStep(undefined, step))).toEqual([])
    expect(WORKFLOW.filter((step) => currentStep("archived", step))).toEqual([])
  })

  test("an unknown section in the address falls back to the overview", () => {
    expect(changeSection("usage")).toBe("usage")
    expect(changeSection("documents")).toBe("overview")
    expect(changeSection(undefined)).toBe("overview")
  })
})
