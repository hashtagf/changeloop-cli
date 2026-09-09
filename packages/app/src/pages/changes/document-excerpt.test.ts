import { describe, expect, test } from "bun:test"
import type { Foundation } from "@opencode-ai/schema/foundation"
import { documentExcerpt } from "./document-excerpt"

const document: Foundation.Document = {
  id: "note",
  title: "Research",
  sourcePath: "openspec/investigations/note.md",
  modifiedAt: "",
  readAt: "",
  size: 1,
  sha256: "",
  text: "# Research\r\n\r\n## Findings\r\nObserved behavior.\r\n### Detail\r\nKeep this nested detail.\r\n## Options\r\nAlternative.\r\n## Why\r\nExplain the outcome.",
  sections: [
    { id: "line-1", title: "Research", line: 1, level: 1 },
    { id: "line-3", title: "Findings", line: 3, level: 2 },
    { id: "line-5", title: "Detail", line: 5, level: 3 },
    { id: "line-7", title: "Options", line: 7, level: 2 },
    { id: "line-9", title: "Why", line: 9, level: 2 },
  ],
  references: [],
  tasks: [],
  claims: [],
  diagnostics: [],
}

describe("focused document reading", () => {
  test("opens findings with nested content, excluding repeated title and sibling sections", () => {
    const value = documentExcerpt(document)
    expect(value.text).toBe("## Findings\nObserved behavior.\n### Detail\nKeep this nested detail.")
    expect(value.sections.map((section) => [section.id, section.line])).toEqual([
      ["line-3", 1],
      ["line-5", 3],
    ])
  })
  test("route section selection restores the selected content and invalid anchors fall back", () => {
    expect(documentExcerpt(document, "line-7").text).toBe("## Options\nAlternative.")
    expect(documentExcerpt(document, "missing").id).toBe("line-3")
  })
  test("overview uses only Why and distinguishes missing summary from absent documents", () => {
    expect(documentExcerpt(document, undefined, "why").text).toBe("Explain the outcome.")
    expect(documentExcerpt({ ...document, sections: [] }, undefined, "why").text).toBe("Why section unavailable.")
    expect(documentExcerpt(undefined).text).toBe("")
  })
  test("unstructured notes retain their content", () => {
    expect(documentExcerpt({ ...document, sections: [], text: "Unstructured research" }).text).toBe(
      "Unstructured research",
    )
  })
})
