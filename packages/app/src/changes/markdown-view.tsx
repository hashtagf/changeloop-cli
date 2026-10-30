import { createMemo } from "solid-js"
import { renderMarkdown, type MarkdownInput } from "./markdown"
import "./markdown-view.css"

/**
 * A document rendered as sanitized Markdown. A link to an indexed document calls `onNavigate`, and a link to a
 * section scrolls to it; nothing else is clickable.
 */
export function DocumentMarkdown(props: MarkdownInput & { onNavigate: (id: string) => void }) {
  const html = createMemo(() => renderMarkdown(props))

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
