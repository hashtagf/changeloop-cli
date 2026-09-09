import { createMemo } from "solid-js"
import { Marked } from "marked"
import DOMPurify from "dompurify"
import "./document-markdown.css"

export function DocumentMarkdown(props: {
  text: string
  sourcePath: string
  documents: readonly { id: string; sourcePath: string }[]
  sections: readonly { id: string; title: string; line: number; level: number }[]
  onNavigate: (id: string) => void
}) {
  const html = createMemo(() => {
    const anchors = new Map<object, string>()
    const parser = new Marked({
      renderer: {
        html: (token) => escape(token.text),
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
            const url = URL.parse(token.href, `https://reader.invalid/${props.sourcePath}`)
            const item =
              url?.origin === "https://reader.invalid"
                ? props.documents.find((item) => encodeURI(`/${item.sourcePath}`) === url.pathname)
                : undefined
            if (item && !token.href.startsWith("#"))
              return `<a href="#" data-document-id="${escape(item.id)}">${label}</a>`
            if (token.href.startsWith("#")) {
              const slug = token.href.slice(1)
              const section = props.sections.find(
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
    const tokens = parser.lexer(props.text.replace(/\r\n?/g, "\n"))
    let line = 1
    for (const token of tokens) {
      // Only top-level source headings receive the server's line anchors.
      // Extra CommonMark headings must not shift later section identities.
      if (token.type === "heading") {
        const section = props.sections.find((section) => section.line === line && section.level === token.depth)
        if (section) anchors.set(token, section.id)
      }
      line += token.raw.split("\n").length - 1
    }
    return DOMPurify.sanitize(parser.parser(tokens), {
      ALLOWED_TAGS: [
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
      ],
      ALLOWED_ATTR: ["href", "id", "target", "rel", "data-document-id"],
      ALLOW_DATA_ATTR: false,
    })
  })
  return (
    <div
      data-component="document-markdown"
      innerHTML={html()}
      onClick={(event) => {
        const link = (event.target as Element).closest("a")
        if (!link || !event.currentTarget.contains(link)) return
        const id = link.getAttribute("data-document-id")
        if (id) {
          event.preventDefault()
          props.onNavigate(id)
          return
        }
        const href = link.getAttribute("href")
        if (href?.startsWith("#")) {
          event.preventDefault()
          event.currentTarget.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "start" })
        }
      }}
    />
  )
}

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
