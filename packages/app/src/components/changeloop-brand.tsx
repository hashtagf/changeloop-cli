import { For } from "solid-js"

// Same pixel glyphs as packages/tui/src/logo.ts, including the circular-arrow O's.
const rows = [
  " ████ █   █  ███  █   █  ████ █████  █      ███ █  ███ █ ████ ",
  "█     █   █ █   █ ██  █ █     █      █     █   ██ █   ██ █   █",
  "█     █████ █████ █ █ █ █  ██ ████   █     █  ███ █  ███ ████ ",
  "█     █   █ █   █ █  ██ █   █ █      █     █      █      █    ",
  " ████ █   █ █   █ █   █  ███  █████  █████  ████   ████  █    ",
]
const pixels = rows.flatMap((row, y) => [...row].flatMap((cell, x) => cell === "█" ? [{ x, y }] : []))

export function ChangeloopWordmark(props: { class?: string }) {
  return <svg role="img" aria-label="Changeloop" data-component="changeloop-wordmark" viewBox="0 0 720 129" class={props.class} fill="currentColor">
    <g transform={`translate(0 24) scale(${720 / Math.max(...rows.map((row) => row.length))} 14)`} opacity="0.35">
      <For each={pixels}>{(pixel) => <rect x={pixel.x} y={pixel.y} width="1" height="1" />}</For>
    </g>
  </svg>
}

export function ChangeloopMark(props: { class?: string }) {
  return <svg role="img" aria-label="Changeloop" data-component="changeloop-mark" viewBox="0 0 7 5" class={props.class} fill="currentColor">
    <path d="M1 0h3v1H1zM0 1h1v3H0zM4 1h1v1H4zM5 0h1v3H3V2h2zM1 4h4v1H1z" />
  </svg>
}
