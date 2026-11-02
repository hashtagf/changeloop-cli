import { describe, expect, test } from "bun:test"
import { renderMarkdown, sectionForSlug, slugOf } from "./markdown"

const documents = [
  { id: "design", sourcePath: "openspec/changes/alpha/design.md" },
  { id: "tasks", sourcePath: "openspec/changes/alpha/tasks.md" },
]

// happy-dom's DOMParser makes DOMPurify drop the first top-level node of its input, which a real browser does not. A
// leading paragraph absorbs that loss so the cases below see the rest of the output unchanged; it adds two lines.
const LEAD = "lead\n\n"

const render = (text: string, sections: Parameters<typeof renderMarkdown>[0]["sections"] = []) => {
  const root = document.createElement("div")
  root.innerHTML = renderMarkdown({
    text: LEAD + text,
    sourcePath: "openspec/changes/alpha/proposal.md",
    documents,
    sections,
  })

  return root
}

describe("safe Markdown", () => {
  test("raw HTML is shown as text and never becomes elements", () => {
    const root = render("<script>alert(1)</script>\n\n<img src=x onerror=x>\n\nplain")

    expect(root.querySelector("script")).toBeNull()
    expect(root.querySelector("img")).toBeNull()
    expect(root.textContent).toContain("<script>alert(1)</script>")
    expect(root.innerHTML).not.toContain("onerror=x>")
  })

  test("javascript, data and http links lose their href and say they are unavailable", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//example.com/x"]) {
      const root = render(`[label](${href})`)

      expect(root.querySelector("a")).toBeNull()
      expect(root.textContent).toContain("label")
      expect(root.textContent).toContain("link unavailable")
    }
  })

  test("an https link opens in a new tab without a referrer", () => {
    const link = render("[site](https://example.com/a?b=1)").querySelector("a")

    expect(link?.getAttribute("href")).toBe("https://example.com/a?b=1")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer")
  })

  test("a relative link to an indexed document names that document and one outside the index is unavailable", () => {
    const inside = render("[design](design.md)").querySelector("a")
    expect(inside?.getAttribute("data-document-id")).toBe("design")

    const outside = render("[secret](../../../etc/passwd)")
    expect(outside.querySelector("a")).toBeNull()
    expect(outside.textContent).toContain("link unavailable")
  })

  test("an image is dropped and its alt text stays", () => {
    const root = render("![tracker](https://tracker.example/x.png)")

    expect(root.querySelector("img")).toBeNull()
    expect(root.textContent).toContain("tracker")
    expect(root.textContent).toContain("image omitted")
  })

  test("headings take the server's section ids and #slug links point at them", () => {
    const sections = [
      { id: "line-3", title: "Title", line: 3, level: 1 },
      { id: "line-5", title: "Why now", line: 5, level: 2 },
    ]
    const root = render("# Title\n\n## Why now\n\nSee [why](#why-now) and [none](#missing).", sections)

    expect(root.querySelector("h1")?.id).toBe("line-3")
    expect(root.querySelector("h2")?.id).toBe("line-5")
    expect(root.querySelector("a")?.getAttribute("href")).toBe("#line-5")
    expect(root.textContent).toContain("none")
    expect(root.querySelectorAll("a")).toHaveLength(1)
  })

  test("a #slug link to a part of the note outside the focused excerpt resolves through the whole note", () => {
    const excerpt = [{ id: "line-3", title: "Findings", line: 3, level: 2 }]
    const whole = [...excerpt, { id: "line-9", title: "Options", line: 9, level: 2 }]
    const root = document.createElement("div")
    root.innerHTML = renderMarkdown({
      text: LEAD + "## Findings\n\nSee [options](#options) and [none](#missing).",
      sourcePath: "openspec/investigations/note.md",
      documents,
      sections: excerpt,
      targets: whole,
    })

    expect(root.querySelector("a")?.getAttribute("href")).toBe("#line-9")
    expect(root.querySelectorAll("a")).toHaveLength(1)
    expect(root.textContent).toContain("link unavailable")
  })

  test("a link to another document keeps its fragment and the slug names the section", () => {
    const link = render("[why](design.md#why-now)").querySelector("a")
    expect(link?.getAttribute("data-document-id")).toBe("design")
    expect(link?.getAttribute("data-fragment")).toBe("why-now")
    expect(render("[plain](design.md)").querySelector("a")?.hasAttribute("data-fragment")).toBe(false)

    const sections = [
      { id: "line-1", title: "Design", line: 1, level: 1 },
      { id: "line-3", title: "Why now", line: 3, level: 2 },
    ]
    expect(sectionForSlug(sections, "why-now")?.id).toBe("line-3")
    expect(sectionForSlug(sections, "line-1")?.title).toBe("Design")
    expect(sectionForSlug(sections, "missing")).toBeUndefined()
    expect(slugOf("Why, now?")).toBe("why-now")
  })

  test("attributes outside the allowlist never reach the output", () => {
    const html = renderMarkdown({
      text: "[x](https://example.com)",
      sourcePath: "a.md",
      documents: [],
      sections: [],
    })

    expect(html).not.toMatch(/\son[a-z]+=/i)
    expect(html).not.toContain("style=")
  })
})
