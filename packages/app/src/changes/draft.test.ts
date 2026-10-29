import { describe, expect, test } from "bun:test"
import { changeDraft, investigateDraft } from "./draft"
import type { ChangeItem } from "./reader"

const item = (input: Partial<ChangeItem>): ChangeItem => ({
  id: "alpha",
  status: "building",
  phase: "build",
  updatedAt: null,
  evidence: null,
  budget: null,
  run: null,
  ...input,
})

const commands = (...names: string[]) => names.map((name) => ({ name }))

describe("Changes draft handoff", () => {
  test("continues a change with the command of its phase and the change ID", () => {
    expect(changeDraft(item({ phase: "build" }), commands("build", "changes"))).toBe("/build alpha")
    expect(changeDraft(item({ phase: "prove" }), commands("prove"))).toBe("/prove alpha")
  })

  test("opens the history command for an archived change or a phase without its own command", () => {
    expect(changeDraft(item({ status: "archived", phase: "land" }), commands("land", "changes"))).toBe("/changes")
    expect(changeDraft(item({ phase: "investigate" }), commands("changes"))).toBe("/changes")
    expect(changeDraft(item({ phase: "build" }), commands("changes"))).toBe("/changes")
  })

  test("drafts nothing when the project has neither the phase command nor the history command", () => {
    expect(changeDraft(item({ phase: "build" }), commands("investigate"))).toBeUndefined()
    expect(changeDraft(item({ phase: "build" }), [])).toBeUndefined()
  })

  test("starts an investigation only when that command exists", () => {
    expect(investigateDraft(commands("investigate"))).toBe("/investigate")
    expect(investigateDraft(commands("changes"))).toBeUndefined()
  })
})
