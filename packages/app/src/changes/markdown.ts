import DOMPurify from "dompurify"
import { Marked } from "marked"

export type MarkdownInput = {
  text: string
  /** Where the text was read from, relative to the project; relative links resolve against it. */
  sourcePath: string
  /** The indexed documents a relative link may open. */
  documents: readonly { id: string; sourcePath: string }[]
  /** The server's sections of the text, which give the top-level headings their ids. */
  sections: readonly { id: string; title: string; line: number; level: number }[]
}

const TAGS = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "strong",
  "em",
  "del",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "span",
]

const ATTRIBUTES = ["href", "id", "target", "rel", "data-document-id"]

/**
 * Markdown as sanitized HTML. Raw HTML is shown as text, images are dropped, and a link survives only as an https link
 * or as a link to an indexed document or a section of this one; any other link keeps its label and says it is
 * unavailable. The result is filtered through an allowlist, so it holds no script, no remote resource and no handler.
 */
export function renderMarkdown(input: MarkdownInput) {
  const anchors = new Map<object, string>()
  const parser = new Marked({
    renderer: {
      html: (token) => (token.block ? `<p>${escape(token.text.trim())}</p>` : escape(token.text)),
      image: (token) => `${escape(token.text)} <span>(image omitted)</span>`,
      heading(token) {
        const id = anchors.get(token)

        return `<h${token.depth}${id ? ` id="${escape(id)}"` : ""}>${this.parser.parseInline(token.tokens)}</h${token.depth}>`
      },
      link(token) {
        const label = this.parser.parseInline(token.tokens)

        if (/^https:\/\//i.test(token.href)) {
          const url = URL.parse(token.href)

          if (url?.protocol === "https:")
            return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        }

        if (!/^[a-z][a-z\d+.-]*:|^\/\//i.test(token.href)) {
          const url = URL.parse(token.href, `https://reader.invalid/${input.sourcePath}`)
          const item =
            url?.origin === "https://reader.invalid"
              ? input.documents.find((item) => encodeURI(`/${item.sourcePath}`) === url.pathname)
              : undefined

          if (item && !token.href.startsWith("#"))
            return `<a href="#" data-document-id="${escape(item.id)}">${label}</a>`

          if (token.href.startsWith("#")) {
            const slug = token.href.slice(1)
            const section = input.sections.find(
              (item) =>
                item.id === slug ||
                encodeURI(
                  item.title
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\s-]/gu, "")
                    .replace(/\s+/g, "-"),
                ) === slug,
            )

            if (section) return `<a href="#${escape(section.id)}">${label}</a>`
          }
        }

        return `${label} <span>(link unavailable: outside indexed documents or unsupported URL)</span>`
      },
    },
  })
  const tokens = parser.lexer(input.text.replace(/\r\n?/g, "\n"))
  let line = 1

  for (const token of tokens) {
    // Only top-level source headings receive the server's line anchors. Extra CommonMark headings must not shift
    // later section identities.
    if (token.type === "heading") {
      const section = input.sections.find((section) => section.line === line && section.level === token.depth)

      if (section) anchors.set(token, section.id)
    }
    line += token.raw.split("\n").length - 1
  }

  return DOMPurify.sanitize(parser.parser(tokens), {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
  })
}

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
