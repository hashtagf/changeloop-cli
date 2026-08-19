import { describe, expect, test } from "bun:test"
import {
  runFoundationDoctor,
  runFoundationMutation,
  runFoundationStatus,
  type FoundationDependencies,
} from "../../src/cli/cmd/foundation"

describe("foundation CLI", () => {
  test("mutation requires authority before invoking the installer", async () => {
    let installed = false
    const dep = fixture({
      confirm: async () => false,
      install: async () => {
        installed = true
        return { exitCode: 0, stdout: "", stderr: "" }
      },
    })

    const result = await runFoundationMutation({ path: "." }, dep)

    expect(result).toEqual({ exitCode: 1, cancelled: true })
    expect(installed).toBe(false)
  })

  test("yes performs installation and reports the pinned release", async () => {
    const output: string[] = []
    const dep = fixture({ write: (text) => output.push(text) })

    const result = await runFoundationMutation({ path: ".", yes: true }, dep)

    expect(result).toEqual({ exitCode: 0, cancelled: false })
    expect(output).toEqual(["installed", "Foundation 3.3.0 (v3.3.0) is installed", "healthy"])
  })

  test("status exposes stable machine-readable release identity", async () => {
    const output: string[] = []
    const dep = fixture({ write: (text) => output.push(text) })

    const exitCode = await runFoundationStatus({ path: ".", json: true }, dep)

    expect(exitCode).toBe(0)
    expect(JSON.parse(output[0])).toMatchObject({ bundle: { release: "v3.3.0" }, installed: { state: "installed" } })
  })

  test("doctor forwards non-zero diagnostics", async () => {
    const dep = fixture({ doctor: async () => ({ exitCode: 7, stdout: "", stderr: "broken" }) })

    expect(await runFoundationDoctor({ path: "." }, dep)).toBe(7)
  })
})

function fixture(overrides: Partial<FoundationDependencies> = {}): FoundationDependencies {
  return {
    confirm: async () => true,
    install: async () => ({ exitCode: 0, stdout: "installed", stderr: "" }),
    status: async (directory) => ({
      root: directory,
      bundle: {
        schema: 1,
        release: "v3.3.0",
        commit: "a".repeat(40),
        version: "3.3.0",
        tagged: true,
        hostProtocols: { instruction: 1, agentContract: 1 },
        files: [],
      },
      installed: { state: "installed", runtime: "foundation", runtimeApi: "24" },
    }),
    doctor: async () => ({ exitCode: 0, stdout: "healthy", stderr: "" }),
    write: () => {},
    ...overrides,
  }
}
