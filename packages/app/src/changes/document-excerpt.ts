import type { Foundation } from "@opencode/schema/foundation"

/**
 * The part of a note to read first: the section of `anchor`, else Summary or Findings, else the first level-2
 * heading. With purpose "why" only the Why section, and `found` is false when the document has none. Sub-headings
 * stay with their section and sibling sections are left out; the returned sections are renumbered to start at line 1.
 */
export function documentExcerpt(document?: Foundation.Document, anchor?: string, purpose?: "why") {
  if (!document) return { text: "", sections: [], id: undefined, found: false }
  const sections = document.sections.filter((section) => section.level <= 2)
  const selected =
    purpose === "why"
      ? sections.find((section) => /^(why|เหตุผล)$/i.test(section.title))
      : (sections.find((section) => section.id === anchor) ??
        sections.find((section) => /^(summary|findings|ข้อสรุป)/i.test(section.title)) ??
        sections.find((section) => section.level === 2) ??
        sections[0])

  if (!selected)
    return { text: purpose ? "" : document.text, sections: document.sections, id: undefined, found: !purpose }
  const next = sections.find((section) => section.line > selected.line && section.level <= selected.level)
  const start = purpose ? selected.line : selected.line - 1

  return {
    text: document.text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .slice(start, next ? next.line - 1 : undefined)
      .join("\n"),
    sections: document.sections
      .filter((section) => section.line > start && (!next || section.line < next.line))
      .map((section) => ({ ...section, line: section.line - start })),
    id: selected.id,
    found: true,
  }
}
