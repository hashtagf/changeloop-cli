import { describe, expect, test } from "bun:test"
import path from "node:path"

async function help(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args, "--help"], {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

// The USAGE line carries the executable name that the build embeds (OPENCODE_CLI_NAME), so it is proven with the built
// binary. Everything else in help is prose that must already say Changeloop.
const withoutUsage = (text: string) => {
  let inUsage = false
  return text
    .split(/\r?\n/)
    .filter((line) => {
      if (/^[A-Z][A-Z ]+$/.test(line)) inUsage = line === "USAGE"
      return !inUsage
    })
    .join("\n")
}

describe("help prose", () => {
  test("root help names Changeloop and never OpenCode", async () => {
    const result = await help([])

    expect(result.exitCode).toBe(0)
    const prose = withoutUsage(result.stdout)
    expect(prose).toContain("Changeloop command line interface")
    expect(prose).toMatch(/^ {2}upgrade, update {4}Upgrade Changeloop to the latest or a specific version$/m)
    expect(prose).toMatch(/^ {2}run {16}Run Changeloop with a message$/m)
    expect(prose).not.toMatch(/opencode/i)
  })

  test.each([
    ["upgrade"],
    ["uninstall"],
    ["run"],
    ["acp"],
    ["mcp"],
    ["plugin"],
    ["service"],
    ["pair"],
    ["stats"],
    ["mini"],
    ["auth"],
    ["models"],
    ["session"],
  ])("%s help has no OpenCode prose", async (command) => {
    const result = await help([command])

    expect(result.exitCode).toBe(0)
    expect(withoutUsage(result.stdout)).not.toMatch(/opencode/i)
  })

  test("the usage filter keeps everything outside the USAGE section", () => {
    const sample = ["DESCRIPTION", "  OpenCode thing", "", "USAGE", "  opencode run", "", "FLAGS", "  --x OpenCode"].join("\n")
    expect(withoutUsage(sample)).toBe(["DESCRIPTION", "  OpenCode thing", "", "FLAGS", "  --x OpenCode"].join("\n"))
  })
})
