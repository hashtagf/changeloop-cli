import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { CELL, pixels, SQUARE, VIEW_BOX } from "./brand"

/**
 * The Changeloop wordmark. The viewBox is exactly the glyph grid, with no padding, so its box is as tall as the
 * letters (58px at 720px wide) and the composer below it keeps its distance.
 */
export function ChangeloopWordmark(props: { class?: string }) {
  const language = useLanguage()

  return (
    <svg
      role="img"
      aria-label={language.t("brand.name")}
      data-component="changeloop-wordmark"
      viewBox={VIEW_BOX}
      class={props.class}
      fill="currentColor"
    >
      <For each={pixels}>
        {(pixel) => (
          <rect x={pixel.x * CELL} y={pixel.y * CELL} width={SQUARE} height={SQUARE} opacity={pixel.opacity} />
        )}
      </For>
    </svg>
  )
}
