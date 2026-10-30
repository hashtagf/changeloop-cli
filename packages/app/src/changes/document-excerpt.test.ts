import { describe, expect, test } from "bun:test"
import type { Foundation } from "@opencode/schema/foundation"
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
  test("opens findings with nested content, excluding the repeated title and sibling sections", () => {
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

  test("overview uses only Why and distinguishes a missing Why from an absent document", () => {
    const why = documentExcerpt(document, undefined, "why")
    expect(why.text).toBe("Explain the outcome.")
    expect(why.found).toBe(true)

    const missing = documentExcerpt({ ...document, sections: [] }, undefined, "why")
    expect(missing.text).toBe("")
    expect(missing.found).toBe(false)

    expect(documentExcerpt(undefined, undefined, "why").found).toBe(false)
  })

  test("a Thai proposal's reason section is its Why", () => {
    const thai = documentExcerpt(
      {
        ...document,
        text: "# Change: x\n\n## เหตุผล\nเพราะต้องการ\n\n## ขอบเขต\nอื่น",
        sections: [
          { id: "line-1", title: "Change: x", line: 1, level: 1 },
          { id: "line-3", title: "เหตุผล", line: 3, level: 2 },
          { id: "line-6", title: "ขอบเขต", line: 6, level: 2 },
        ],
      },
      undefined,
      "why",
    )

    expect(thai.found).toBe(true)
    expect(thai.text).toBe("เพราะต้องการ\n")
  })

  test("unstructured notes retain their content", () => {
    const value = documentExcerpt({ ...document, sections: [], text: "Unstructured research" })

    expect(value.text).toBe("Unstructured research")
    expect(value.found).toBe(true)
  })
})
