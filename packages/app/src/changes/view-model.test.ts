import { describe, expect, test } from "bun:test"
import {
  changeSection,
  checklistCounts,
  currentStep,
  emptyKey,
  evidenceStatus,
  fileName,
  isArchivedReference,
  measurement,
  nextTab,
  noteTitle,
  plannedTestSections,
  preferredFile,
  proposalTitle,
  taskLabel,
  WORKFLOW,
} from "./view-model"

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
    expect(changeSection("documents")).toBe("documents")
    expect(changeSection("tasks")).toBe("tasks")
    expect(changeSection("agreement")).toBe("overview")
    expect(changeSection(undefined)).toBe("overview")
  })

  test("each section opens its own file first", () => {
    expect(preferredFile("overview")).toBe("proposal.md")
    expect(preferredFile("documents")).toBe("")
    expect(preferredFile("tasks")).toBe("tasks.md")
    expect(preferredFile("evidence")).toBe("evidence.yaml")
  })

  test("titles drop the Change and Investigation prefixes and absent titles stay absent", () => {
    expect(proposalTitle([{ id: "a", title: "Change: Add search", line: 1, level: 1 }])).toBe("Add search")
    expect(proposalTitle([{ id: "a", title: "Why", line: 1, level: 2 }])).toBeUndefined()
    expect(noteTitle("Investigation: Options")).toBe("Options")
    expect(noteTitle("Options")).toBe("Options")
  })

  test("checklist counts and labels come from the document's own checkboxes", () => {
    expect(checklistCounts([{ checked: true }, { checked: false }, { checked: false }])).toEqual({
      checked: 1,
      total: 3,
    })
    expect(checklistCounts([])).toEqual({ checked: 0, total: 0 })
    expect(taskLabel("Implement it [key:task-1] [kind:implementation]")).toBe("Implement it")
  })

  test("references into the archive are recognised by their path and tests sections by their title", () => {
    expect(isArchivedReference("openspec/changes/archive/2026-10-29-x/proposal.md")).toBe(true)
    expect(isArchivedReference("openspec/changes/x/proposal.md")).toBe(false)
    expect(fileName("openspec/changes/x/design.md")).toBe("design.md")
    expect(
      plannedTestSections([
        { id: "a", title: "Test plan", line: 1, level: 2 },
        { id: "b", title: "Overview", line: 2, level: 2 },
        { id: "c", title: "Scenarios", line: 3, level: 2 },
      ]).map((section) => section.id),
    ).toEqual(["a", "c"])
  })
})
