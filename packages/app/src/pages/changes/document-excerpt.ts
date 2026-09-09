import type { Foundation } from "@opencode-ai/schema/foundation"

export function documentExcerpt(document?: Foundation.Document, anchor?: string, purpose?: "why") {
  if (!document) return { text: "", sections: [], id: undefined }
  const sections = document.sections.filter((section) => section.level <= 2)
  const selected =
    purpose === "why"
      ? sections.find((section) => /^why$/i.test(section.title))
      : (sections.find((section) => section.id === anchor) ??
        sections.find((section) => /^(summary|findings|ข้อสรุป)/i.test(section.title)) ??
        sections.find((section) => section.level === 2) ??
        sections[0])
  if (!selected)
    return { text: purpose ? "Why section unavailable." : document.text, sections: document.sections, id: undefined }
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
  }
}
