import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// Guard for the Changeloop rebrand of user-visible prose in packages/cli/src and packages/tui/src.
//
// Rule: prose that names the program, and commands the user is told to type, say Changeloop / `changeloop`.
// Identifiers stay as they were because users, plugins and servers depend on them: `@opencode/*` packages, the SDK
// symbols (`OpenCode.make`, `OpenCodeClient`), `opencode.*` plugin/command ids, `OPENCODE_*` env vars, config files
// and directories, opencode.ai URLs, quoted ids such as the "opencode" provider/theme/username, and the names of the
// opencode.ai services (OpenCode Console, Go, Zen). Comments are not user-visible.
const roots = ["../../cli/src", "../src"].map((dir) => path.resolve(import.meta.dir, dir))

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })

const services = /OpenCode (Console|Go|Zen)\b|Web Search via OpenCode/g
// SDK symbol usage, not prose.
const symbols = [/\bOpenCode\.\w+/g, /\btypeof OpenCode\b/g, /\{[^}]*\bOpenCode\b[^}]*\}/g, /^\s*OpenCode,?\s*$/g]

const comment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line)
const importLine = (line: string) => /^\s*(import|export)\b.*\bfrom\b/.test(line)

const prosePattern = /\bOpenCode\b(?![A-Za-z0-9_])/
// A lowercase program name or command: not part of an id, path, URL or env var.
const commandPattern = /(?<![\w@./:$-])opencode(?![\w./:@-])/
const quotedId = /(["'])opencode\1/g
const isProse = (text: string) => prosePattern.test(text) || commandPattern.test(text.replace(quotedId, ""))

// Kept on purpose, each an identifier or a development fixture rather than text the user reads.
const allowed: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  { file: "cli/src/commands/handlers/uninstall.ts", text: '"# opencode"', reason: "rc-file marker the installer wrote" },
  { file: "cli/src/services/updater.ts", text: '"Anomaly.OpenCode"', reason: "winget package id" },
  { file: "tui/src/context/keymap.tsx", text: "opencode?: KeymapCommand", reason: "keymap property key" },
  { file: "tui/src/theme/index.ts", text: 'parseThemeDocument(opencode, "opencode")', reason: "theme id" },
  { file: "tui/src/util/tool-display.ts", text: 'provider === "opencode"', reason: "label of the opencode.ai provider" },
]

function offenders() {
  const found: string[] = []
  for (const file of roots.flatMap(files)) {
    const rel = path.relative(path.resolve(import.meta.dir, "../.."), file).replaceAll("\\", "/")
    // The storybook fixtures are development-only sample data.
    if (rel.startsWith("tui/src/feature-plugins/system/storybook/")) continue
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (comment(line) || importLine(line)) return
        if (allowed.some((item) => item.file === rel && line.includes(item.text))) return
        let text = line.replace(services, "")
        for (const symbol of symbols) text = text.replace(symbol, "")
        if (isProse(text)) found.push(`${rel}:${index + 1}: ${line.trim().slice(0, 140)}`)
      })
  }
  return found
}

describe("brand prose", () => {
  test("no OpenCode prose or opencode command remains in cli/tui source strings", () => {
    expect(offenders()).toEqual([])
  })

  test("the guard recognises the prose it is meant to catch", () => {
    const sample = ['title: "Update OpenCode"', "run `opencode upgrade` again", "<text>opencode / stats</text>"]
    for (const line of sample) expect(isProse(line)).toBe(true)
  })

  test("the guard leaves identifiers and service names alone", () => {
    const sample = [
      'const id = "opencode"',
      "import { OpenCode } from '@opencode/client'",
      "const client = OpenCode.make(options)",
      "path.join(directory, 'opencode.json')",
      "Sign in to OpenCode Console",
      "process.env.OPENCODE_CONFIG",
    ]
    for (const line of sample) {
      let text = line.replace(services, "")
      for (const symbol of symbols) text = text.replace(symbol, "")
      expect(isProse(text)).toBe(false)
    }
  })

  test("contract identifiers are kept", () => {
    const keep = [
      "@opencode/client",
      "OpenCode.make",
      "OPENCODE_VERSION",
      "opencode.json",
      ".opencode",
      "opencode.ai",
      "opencode.status",
      "OpenCode Go",
    ]
    const source = roots.flatMap(files).map((file) => fs.readFileSync(file, "utf8")).join("\n")
    for (const identifier of keep) expect(source).toContain(identifier)
  })
})
