import { expect, test } from "bun:test"
import { changeDraft } from "./changes-draft"

test("session handoff drafts only discovered commands and treats archives and unknown phases as inspection", () => {
  const item = { id: "example", status: "building", phase: "build", updatedAt: null }
  expect(changeDraft(item, [{ name: "build" }])).toBe("/build example")
  expect(changeDraft(item, [{ name: "changes" }])).toBe("/changes")
  expect(changeDraft({ ...item, status: "archived", phase: "land" }, [{ name: "changes" }, { name: "land" }])).toBe("/changes")
  expect(changeDraft({ ...item, phase: "unknown" }, [{ name: "changes" }])).toBe("/changes")
  expect(changeDraft(item, [])).toBeUndefined()
})
