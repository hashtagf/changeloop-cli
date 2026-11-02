// The Changeloop pixel wordmark, row for row the CLI/TUI logo (packages/tui/src/logo.ts): CHANGE on the left, LOOP on
// the right, and a circular-arrow loop icon standing in for both O letters.
export const ROWS = [
  " ████ █   █  ███  █   █  ████ █████  █      ███ █  ███ █ ████ ",
  "█     █   █ █   █ ██  █ █     █      █     █   ██ █   ██ █   █",
  "█     █████ █████ █ █ █ █  ██ ████   █     █  ███ █  ███ ████ ",
  "█     █   █ █   █ █  ██ █   █ █      █     █      █      █    ",
  " ████ █   █ █   █ █   █  ███  █████  █████  ████   ████  █    ",
] as const

/** The first column of LOOP. Column 35 is the space between the two words. */
export const LOOP_START = 36

/** One cell is 5 units and its square 4.8, so neighbouring squares keep a 0.2 gap. */
export const CELL = 5

export const SQUARE = 4.8

export const WIDTH = ROWS[0].length * CELL

export const HEIGHT = ROWS.length * CELL

export const VIEW_BOX = `0 0 ${WIDTH} ${HEIGHT}`

/** The CHANGE half is drawn lighter than LOOP. */
export const WEAK_OPACITY = 0.6

export const pixels = ROWS.flatMap((row, y) =>
  [...row].flatMap((cell, x) => (cell === "█" ? [{ x, y, opacity: x < LOOP_START ? WEAK_OPACITY : 1 }] : [])),
)
