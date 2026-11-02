import { logo } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

const halfWidth = (rows: readonly string[]) => Math.max(...rows.map((row) => row.length))

// Side by side when it fits, stacked (CHANGE over LOOP) when only one half fits, and omitted below that, so a narrow
// terminal never soft-wraps the pixel rows.
function wordmark(pad = "", width = Infinity) {
  const draw = (line: string, fg: string, shadow: string, bg: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${bg} ${reset}`
        if (char === "^") return `${fg}${bg}▀${reset}`
        if (char === "~") return `${shadow}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  const drawLeft = (line: string) => draw(line, dim, "\x1b[38;5;235m", "\x1b[48;5;235m")
  const drawRight = (line: string) => draw(line, reset, "\x1b[38;5;238m", "\x1b[48;5;238m")
  const leftWidth = halfWidth(logo.left)
  const joined = pad.length + leftWidth + 1 + halfWidth(logo.right)
  if (width >= joined)
    return logo.left.map((line, index) => `${pad}${drawLeft(line)} ${drawRight(logo.right[index] ?? "")}`)
  if (width >= pad.length + leftWidth)
    return [...logo.left.map((line) => `${pad}${drawLeft(line)}`), ...logo.right.map((line) => `${pad}${drawRight(line)}`)]
  return []
}

export type SessionEpilogue = { readonly title: string; readonly sessionID?: string }

// Printed after the TUI closes.
export function epilogue(input: {
  readonly session?: SessionEpilogue
  readonly updatedVersion?: string
  /** Columns available for printing; defaults to the terminal's width. */
  readonly width?: number
}) {
  if (!input.session && !input.updatedVersion) return
  const row = (label: string, value: string) => `  ${dim}${label.padEnd(10, " ")}${reset}${bold}${value}${reset}`
  const mark = wordmark("  ", input.width ?? process.stdout.columns ?? Infinity)
  return [
    ...mark,
    ...(mark.length ? [""] : []),
    ...(input.updatedVersion
      ? [`  ${dim}Run ${reset}${bold}changeloop${reset}${dim} to use ${reset}${bold}${input.updatedVersion}${reset}`, ""]
      : []),
    ...(input.session
      ? [row("Session", input.session.title), row("Continue", `changeloop -s ${input.session.sessionID}`), ""]
      : []),
  ].join("\n")
}
