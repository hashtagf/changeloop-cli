import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// Text sent to the model must only tell it to run commands that exist on the user's machine, and the
// binary is `changeloop`. Identity lines, URLs, service names, config/log paths and env names keep
// the upstream spelling on purpose (see the allowlist below); only commands to run are checked.
const src = path.join(import.meta.dir, "..", "src")
const roots = [
  path.join(src, "plugin", "skill"),
  path.join(src, "plugin", "system-prompt"),
  path.join(src, "session", "runner", "prompt"),
]
const files = roots.flatMap((root) =>
  readdirSync(root)
    .filter((name) => /\.(md|txt)$/.test(name))
    .map((name) => path.join(root, name)),
)

// `opencode` in command position: after start of line, whitespace, a backtick, `$`, `(` or a pipe, and
// followed by a subcommand or flag. `.opencode/`, `~/.config/opencode/` and `opencode.json` do not match.
const command =
  /(?:^|[\s`$(|])opencode\s+(?:mcp|service|api|run|serve|auth|providers?|plugin|pair|debug|stats|session|models?|agent|attach|web|upgrade|uninstall|export|import|github|pr|acp|-{1,2}[a-z])/

// Lines that may keep the upstream name; each needs a reason.
const allowlist: Array<{ file: string; line: RegExp; reason: string }> = []

describe("model-facing command names", () => {
  test("scans the skill guides and every system prompt", () => {
    const names = files.map((file) => path.basename(file))
    expect(names).toContain("opencode.md")
    expect(names).toContain("report.md")
    expect(names).toContain("trinity.txt")
    expect(names).toContain("system.txt")
  })

  test("no text tells the model to run an `opencode` subcommand", () => {
    const found = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          command.test(line) &&
          !allowlist.some((entry) => file.endsWith(entry.file) && entry.line.test(line))
            ? [`${path.relative(src, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    )
    expect(found).toEqual([])
  })

  test("the skill guide runs the commands under the changeloop binary", () => {
    const guide = readFileSync(path.join(src, "plugin", "skill", "opencode.md"), "utf8")
    ;[
      "changeloop mcp add <name> --global --url <remote-url>",
      "changeloop mcp list",
      "changeloop service restart",
      "changeloop service status",
      "changeloop api get /api/info",
      "changeloop --standalone",
    ].forEach((expected) => expect(guide).toContain(expected))
    expect(readFileSync(path.join(src, "plugin", "skill", "report.md"), "utf8")).toContain("changeloop --version")
  })

  test("identity lines, paths, env names and service URLs keep their upstream spelling", () => {
    const guide = readFileSync(path.join(src, "plugin", "skill", "opencode.md"), "utf8")
    expect(guide).toContain("~/.local/share/opencode/log/opencode.log")
    expect(guide).toContain("OPENCODE_LOG_LEVEL=DEBUG")
    expect(guide).toContain("https://opencode.ai/v2/docs/")
    expect(readFileSync(path.join(src, "plugin", "system-prompt", "trinity.txt"), "utf8")).toStartWith("You are opencode,")
    expect(readFileSync(path.join(src, "session", "runner", "prompt", "system.txt"), "utf8")).toContain(
      "running in OpenCode",
    )
  })

  test("the detector flags a command that was not renamed", () => {
    expect(command.test("Run `opencode service restart` now")).toBe(true)
    expect(command.test("opencode api get /api/info")).toBe(true)
    expect(command.test("Compare with `opencode --standalone`")).toBe(true)
    expect(command.test("You are opencode, an interactive CLI tool")).toBe(false)
    expect(command.test("Check ~/.config/opencode/opencode.json and .opencode/plugins")).toBe(false)
    expect(command.test("changeloop service restart")).toBe(false)
  })
})
