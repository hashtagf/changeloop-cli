import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// Guard for the Changeloop rebrand of user-visible prose in packages/core, packages/server and packages/protocol.
//
// Rule: prose that names the program, and commands the user is told to type, say Changeloop / `changeloop`.
// Identifiers stay as they were because users, plugins and servers depend on them: `@opencode/*` packages, SDK symbols
// (`OpenCode.make`, `OpenCodeClient`, `OpenCodeEvent`), `opencode.*` ids, `OPENCODE_*` env vars, `x-opencode-*` headers,
// config files and directories, opencode.ai URLs, quoted ids such as the "opencode" integration/namespace/username,
// and the names of the opencode.ai services (OpenCode Console, Go, Zen). Comments are not user-visible.
//
// Not covered here, deliberately kept and reported: text sent to the model (plugin/system-prompt/*.txt,
// session/runner/prompt/system.txt, plugin/skill/*.md) and the wordmark SVG of the OAuth page.
const packages = ["core", "server", "protocol"]
const root = path.resolve(import.meta.dir, "../..")
const roots = packages.map((name) => path.join(root, name, "src"))

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
// A lowercase program name or command: not part of an id, path, URL, header or env var.
const commandPattern = /(?<![\w@./:$-])opencode(?![\w./:@-])/
const quotedId = /(["'`])opencode\1/g
const isProse = (text: string) => prosePattern.test(text) || commandPattern.test(text.replace(quotedId, ""))

// Kept on purpose, each an identity sent to a third party, a service plugin or a model-facing contract.
const allowedFiles: ReadonlyArray<{ file: string; reason: string }> = [
  { file: "core/src/plugin/provider/opencode.ts", reason: "plugin of the opencode.ai Console service" },
  { file: "core/src/plugin/provider/opencode-legacy.ts", reason: "plugin of the opencode.ai Console service" },
  { file: "core/src/oauth/page.ts", reason: "wordmark SVG label (needs a new logo, not new prose)" },
  { file: "core/src/plugin/skill.ts", reason: "built-in skill descriptions and report template sent to the model" },
]
const allowedLines: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  { file: "core/src/plugin/provider/chatgpt.ts", text: 'agentName = "OpenCode"', reason: "agent name registered with ChatGPT" },
  { file: "core/src/tool/plugin/opencode.ts", text: "Tools for managing OpenCode itself", reason: "model-facing tool namespace description" },
  { file: "core/src/voice.ts", text: "OpenCode Console connection", reason: "service name" },
  { file: "core/src/plugin/provider/nvidia.ts", text: '?? "OpenCode"', reason: "billing origin value NVIDIA attributes usage to" },
  { file: "core/src/tool/plugin/webfetch.ts", text: "OpenCode-User/1.0", reason: "User-Agent sites filter on" },
  { file: "server/src/cors.ts", text: "opencode\\.ai", reason: "regex of the opencode.ai origin" },
]

function offenders() {
  const found: string[] = []
  for (const file of roots.flatMap(files)) {
    const rel = path.relative(root, file)
    if (allowedFiles.some((item) => item.file === rel)) continue
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (comment(line) || importLine(line)) return
        if (allowedLines.some((item) => item.file === rel && line.includes(item.text))) return
        let text = line.replace(services, "")
        for (const symbol of symbols) text = text.replace(symbol, "")
        if (isProse(text)) found.push(`${rel}:${index + 1}: ${line.trim().slice(0, 140)}`)
      })
  }
  return found
}

describe("brand prose", () => {
  test("no OpenCode prose or opencode command remains in core/server/protocol source strings", () => {
    expect(offenders()).toEqual([])
  })

  test("the guard recognises the prose it is meant to catch", () => {
    const sample = ['title: "Update OpenCode"', "Run `opencode pair` to get a new one", "message: `opencode can call it`"]
    for (const line of sample) expect(isProse(line)).toBe(true)
  })

  test("the guard leaves identifiers and service names alone", () => {
    const sample = [
      'const id = "opencode"',
      "const client = OpenCode.make(options)",
      'headers: { "x-opencode-ticket": ticket }',
      "path.join(directory, 'opencode.json')",
      "Sign in to OpenCode Console",
      "process.env.OPENCODE_CONFIG",
      'username: "opencode"',
    ]
    for (const line of sample) {
      let text = line.replace(services, "")
      for (const symbol of symbols) text = text.replace(symbol, "")
      expect(isProse(text)).toBe(false)
    }
  })

  test("contract identifiers are kept", () => {
    const keep = [
      "@opencode/",
      "OPENCODE_",
      "x-opencode-ticket",
      "x-opencode-directory",
      'username: "opencode"',
      "opencode.ai",
      'Integration.ID.make("opencode")',
      "OpenCode Go",
    ]
    const source = roots.flatMap(files).map((file) => fs.readFileSync(file, "utf8")).join("\n")
    for (const identifier of keep) expect(source).toContain(identifier)
  })
})
