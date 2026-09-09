import path from "path"
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, rm, symlink } from "fs/promises"
import os from "os"
import assert from "node:assert/strict"

export const root = path.resolve(import.meta.dir, "../../..")
export const packageDir = path.join(root, "packages/opencode")
export const artifacts = path.join(root, ".foundation/webui-evidence")

export function sameBuild(record: unknown, input: { source: string; binary: string; assets: string }) {
  return !!record && typeof record === "object" && "source" in record && record.source === input.source && "binary" in record && record.binary === input.binary && "assets" in record && record.assets === input.assets
}
export async function build() {
  const binary = path.join(packageDir, `dist/opencode-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}/bin/opencode`)
  const hash = async (files: string[]) => {
    const digest = new Bun.CryptoHasher("sha256")
    digest.update(process.versions.bun + process.platform + process.arch)
    for (const file of files.sort()) {
      digest.update(file)
      const target = path.join(root, file)
      const info = await lstat(target)
      digest.update(info.isSymbolicLink() ? await readlink(target) : await Bun.file(target).bytes())
    }
    return digest.digest("hex")
  }
  const listed = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const paths = (await new Response(listed.stdout).text()).split("\0").filter((file) => file && !file.startsWith(".foundation/") && (file.startsWith("packages/") || ["bun.lock", "package.json", "tsconfig.json"].includes(file)) && !/(?:\/test\/|\/e2e\/|\.test\.|\.stories\.)/.test(file))
  assert.equal(await listed.exited, 0, "Build input inventory failed")
  const source = await hash([...new Set(paths)])
  const assets = async () => hash((await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: path.join(root, "packages/app/dist") }))).filter((file) => !file.endsWith(".map")).map((file) => `packages/app/dist/${file}`))
  const receipt = Bun.file(path.join(artifacts, "build.json"))
  if (await receipt.exists() && await Bun.file(binary).exists()) {
    const current = { source, binary: await hash([path.relative(root, binary)]), assets: await assets() }
    if (sameBuild(await receipt.json(), current)) { console.log("Reusing matching compiled binary and embedded assets"); return binary }
  }
  await run("compiled-build", [process.execPath, "run", "script/build.ts", "--single", "--skip-install"], packageDir, { ...process.env, OPENCODE_CHANNEL: "webui", OPENCODE_VERSION: "0.0.0-webui", OPENCODE_RELEASE: "" })
  assert(await Bun.file(binary).exists(), "Matching compiled binary is missing")
  assert.equal(await hash([...new Set(paths)]), source, "Source changed during compilation; rebuild required")
  await Bun.write(receipt, JSON.stringify({ source, binary: await hash([path.relative(root, binary)]), assets: await assets() }))
  return binary
}

export function assertBunTests(output: string, minimum: number) {
  const count = /(?:^|\n)\s*(\d+) pass\b/.exec(output)
  assert(count && Number(count[1]) >= minimum, "Required test suite did not execute enough tests")
  assert(/(?:^|\n)\s*0 fail\b/.test(output), "Required test suite did not report zero failures")
  assert(!/(?:^|\n)\s*[1-9]\d* (?:skip|todo|filtered out)\b/.test(output), "Required test suite was skipped or filtered")
}
export function assertBrowserReport(report: unknown, minimum: number) {
  assert(report && typeof report === "object" && "stats" in report && report.stats && typeof report.stats === "object")
  const stats = report.stats
  assert("expected" in stats && typeof stats.expected === "number" && stats.expected >= minimum, "Required browser cases are missing")
  for (const key of ["unexpected", "skipped", "flaky"]) assert(key in stats && Reflect.get(stats, key) === 0, `Browser ${key} cases cannot pass evidence`)
  assert("errors" in report && Array.isArray(report.errors) && report.errors.length === 0, "Browser runner errors are not a pass")
}
export async function run(name: string, command: string[], cwd: string, env = process.env, tests = 0) {
  await mkdir(artifacts, { recursive: true })
  console.log(`Checking ${name}`)
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = stdout + "\n" + stderr
  await Bun.write(path.join(artifacts, `${name}.log`), output)
  assert.equal(code, 0, `${name} failed; see ${path.join(artifacts, `${name}.log`)}\n${output.slice(-4000)}`)
  if (tests) assertBunTests(output, tests)
  return output
}

export async function fixture(binary: string) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "changeloop-webui-"))
  const directory = path.join(temporary, "project")
  const bin = path.join(temporary, "bin")
  await mkdir(directory)
  await mkdir(bin)
  const node = Bun.which("node")
  assert(node, "The bundled runtime requires Node")
  await symlink(node, path.join(bin, "node"))
  const env = { PATH: `${bin}:/usr/bin:/bin`, XDG_DATA_HOME: path.join(temporary, "data"), XDG_CACHE_HOME: path.join(temporary, "cache"), XDG_CONFIG_HOME: path.join(temporary, "config"), XDG_STATE_HOME: path.join(temporary, "state"), OPENCODE_TEST_HOME: path.join(temporary, "home"), OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(temporary, "managed"), OPENCODE_DISABLE_MODELS_FETCH: String(true), OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_SERVER_PASSWORD: "webui-fixture", OPENCODE_MODELS_PATH: path.join(packageDir, "test/tool/fixtures/models-api.json") }
  assert.equal(Bun.which("claude-foundation", { PATH: env.PATH }), null, "Fixture must not find external Foundation")
  await run("fixture-git", ["/usr/bin/git", "init"], directory, env)
  await run("fixture-init", [binary, "foundation", "init", "--yes"], directory, env)
  for (const [id, status] of [["webui-active", "building"], ["webui-archived", "archived"]]) {
    await Bun.write(path.join(directory, ".foundation/runtime", `${id}.json`), JSON.stringify({ id, status, phase: "build", revision: 1, updatedAt: "2026-09-09T00:00:00Z", budget: status === "building" ? { lifetime: { usedRequests: null, usedTokens: 0 }, window: { id: "fixture", usedRequests: 0, usedTokens: null, targetRequests: 100, targetTokens: 10000 } } : undefined, workspace: { path: path.join(directory, ".foundation/sandboxes/absent") } }))
  }
  await Bun.write(path.join(directory, "opencode.json"), JSON.stringify({ permission: "ask" }))
  // Reserve an ephemeral port, then bind the owned binary immediately.
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = probe.port!
  await probe.stop(true)
  const child = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  const url = `http://127.0.0.1:${port}`
  const headers = { authorization: `Basic ${btoa(`opencode:${env.OPENCODE_SERVER_PASSWORD}`)}` }
  const deadline = Date.now() + 30_000
  while (true) {
    if (child.exitCode !== null) throw new Error("Compiled fixture server exited during startup")
    const ready = await fetch(`${url}/global/health`, { headers, signal: AbortSignal.timeout(2000) }).then((response) => response.ok, () => false)
    if (ready) break
    assert(Date.now() < deadline, "Compiled server did not become ready")
    await Bun.sleep(100)
  }
  return { directory, temporary, port, url, headers, password: env.OPENCODE_SERVER_PASSWORD,
    async close() {
      child.kill("SIGTERM")
      const force = setTimeout(() => child.kill("SIGKILL"), 3000)
      await child.exited
      clearTimeout(force)
      await Bun.write(path.join(artifacts, "compiled-server.log"), (await output).join("\n"))
      await remove(temporary)
    },
  }
}
async function remove(file: string): Promise<void> {
  const info = await lstat(file)
  if (!info.isSymbolicLink()) {
    await chmod(file, info.isDirectory() ? 0o700 : 0o600)
    if (info.isDirectory()) for (const name of await readdir(file)) await remove(path.join(file, name))
  }
  await rm(file, { recursive: true, force: true })
}

export async function browser(target: Awaited<ReturnType<typeof fixture>>, suite: string, minimum: number) {
  const report = path.join(artifacts, `${suite}.json`)
  await rm(report, { force: true })
  await run(suite, [process.execPath, "--bun", path.join(root, "node_modules/playwright/cli.js"), "test", `e2e/regression/${suite}.spec.ts`, "--config=e2e/foundation.config.ts", "--workers=1", "--reporter=json"], path.join(root, "packages/app"), { ...process.env, CI: "", PLAYWRIGHT_BASE_URL: target.url, PLAYWRIGHT_SERVER_PORT: String(target.port), FOUNDATION_TEST_DIRECTORY: target.directory, FOUNDATION_TEST_PASSWORD: target.password, PLAYWRIGHT_JSON_OUTPUT_FILE: report })
  assertBrowserReport(await Bun.file(report).json(), minimum)
}
