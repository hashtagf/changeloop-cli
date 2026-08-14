import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

function pathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Only an http(s) readiness URL names a port another run can be holding. A
// data: URL, for instance, always answers, and pre-probing one would report
// every service as already served.
function servesOverNetwork(url) {
  if (!url) return false;
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}

export function createProcessRuntime({ root, logs, now, resolveServiceCwd }) {
  async function readinessMatches(readiness) {
    try {
      const response = await fetch(readiness.url, { signal: AbortSignal.timeout(750) });
      const expectedStatus = readiness.expectStatus === undefined ? 200 : Number(readiness.expectStatus);
      if (response.status !== expectedStatus) return false;
      if (readiness.expectHeader &&
          !Object.entries(readiness.expectHeader).every(([key, value]) =>
            response.headers.get(key) === String(value))) return false;
      if (readiness.expectBody !== undefined) {
        const body = await response.text();
        if (!body.includes(readiness.expectBody)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function runCommand(command, args, options) {
    return new Promise((complete) => {
      const startedAt = now();
      const startedMs = Date.now();
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let readinessObserved = !options.readiness?.url;
      let readinessTimer = null;
      let closed = false;
      const observeReadiness = async () => {
        if (closed || readinessObserved) return;
        if (await readinessMatches(options.readiness)) {
          readinessObserved = true;
          return;
        }
        if (!closed) readinessTimer = setTimeout(observeReadiness, 100);
      };
      const child = spawn(command, args, {
        cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      if (options.readiness?.url) observeReadiness();
      // A spawn failure never emits `close`, so this handler owns the same
      // cleanup: without it the readiness poll rescheduled itself forever and
      // the timeout timer pinned the event loop after the result was known.
      child.on("error", (error) => {
        closed = true;
        clearTimeout(timer);
        if (readinessTimer) clearTimeout(readinessTimer);
        complete({
          status: null, signal: null, error, stdout, stderr,
          timedOut, readinessObserved,
          startedAt, finishedAt: now(), durationMs: Date.now() - startedMs
        });
      });
      const timeoutMs = Number(options.timeoutMs || 120000);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, timeoutMs);
      child.on("close", (status, signal) => {
        closed = true;
        clearTimeout(timer);
        if (readinessTimer) clearTimeout(readinessTimer);
        complete({
          status, signal, error: null, stdout, stderr,
          timedOut, readinessObserved,
          startedAt, finishedAt: now(), durationMs: Date.now() - startedMs
        });
      });
    });
  }

  async function startServiceSession(id, name, config, proofRunId) {
    const cwd = resolveServiceCwd(id, config);
    // Something already answering here is not our service: the readiness loop
    // below polls before it sleeps, so a server left behind by an earlier run
    // satisfies the very first probe and the suite runs green against code
    // that never started. Ports are declared literally, so two changes of one
    // project collide by construction.
    if (servesOverNetwork(config.readiness?.url) && await readinessMatches(config.readiness))
      throw new Error(
        `service '${name}' readiness URL ${config.readiness.url} is already being served ` +
        "before this run started it; another run may have leaked a process holding the port"
      );
    if (config.staticRoot) {
      const staticRoot = resolve(cwd, config.staticRoot);
      if (!pathInside(cwd, staticRoot) || !existsSync(staticRoot) || !statSync(staticRoot).isDirectory())
        throw new Error(`service '${name}' staticRoot is not a workspace directory`);
      const readinessUrl = new URL(config.readiness.url);
      const port = Number(readinessUrl.port || (readinessUrl.protocol === "https:" ? 443 : 80));
      const host = readinessUrl.hostname;
      // The service name is copied byte-identical into every sandbox, so it
      // tells "our service" from "some other program" but cannot tell change
      // A's server from change B's. The run id can.
      const identityHeaders = {
        ...(config.identityHeader || { "x-foundation-service": name }),
        "x-foundation-proof-run": String(proofRunId)
      };
      const mime = {
        ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml"
      };
      let requests = 0;
      const server = createServer((request, response) => {
        requests += 1;
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, config.readiness.url).pathname); }
        catch {
          response.writeHead(400, identityHeaders);
          response.end("bad request");
          return;
        }
        const requested = resolve(staticRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
        if (!pathInside(staticRoot, requested) || !existsSync(requested) || !statSync(requested).isFile()) {
          response.writeHead(404, identityHeaders);
          response.end("not found");
          return;
        }
        const extension = requested.slice(requested.lastIndexOf("."));
        response.writeHead(200, {
          ...identityHeaders,
          "content-type": mime[extension] || "application/octet-stream"
        });
        response.end(readFileSync(requested));
      });
      await new Promise((complete, reject) => {
        server.once("error", reject);
        server.listen(port, host, complete);
      });
      const runBoundReadiness = {
        ...config.readiness,
        expectHeader: {
          ...(config.readiness.expectHeader || {}),
          "x-foundation-proof-run": String(proofRunId)
        }
      };
      if (!await readinessMatches(runBoundReadiness)) {
        await new Promise((complete) => server.close(complete));
        throw new Error(`service '${name}' native static readiness failed`);
      }
      return {
        name, child: null, startedAt: now(),
        stop() {
          server.close();
          const logPath = join(logs, id, `${proofRunId}-service-${name}.log`);
          mkdirSync(dirname(logPath), { recursive: true });
          writeFileSync(logPath, `native-static root=${relative(cwd, staticRoot)} requests=${requests}\n`);
          return { name, path: relative(root, logPath).replaceAll("\\", "/"), status: "terminated" };
        }
      };
    }
    const [command, ...args] = config.command;
    const inherited = Object.fromEntries((config.envFrom || [])
      .filter((envName) => process.env[envName] !== undefined)
      .map((envName) => [envName, process.env[envName]]));
    let stdout = "";
    let stderr = "";
    let closed = false;
    let exitStatus = null;
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env, ...inherited, ...(config.env || {}),
        FOUNDATION_CHANGE_ID: id,
        FOUNDATION_CONTROL_ROOT: root,
        FOUNDATION_REPOSITORY_ID: config.repository || "root",
        FOUNDATION_PROOF_RUN_ID: proofRunId,
        FOUNDATION_SERVICE_NAME: name
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => { closed = true; exitStatus = status; });
    // Without this listener Node rethrows a spawn failure as an asynchronous
    // uncaught exception, so the caller's try/catch — the thing that stops the
    // services already started — never runs, and the process dies holding
    // their ports.
    let spawnError = null;
    child.on("error", (error) => { spawnError = error; closed = true; });
    const deadline = Date.now() + Number(config.timeoutMs || 30000);
    while (Date.now() < deadline) {
      if (spawnError)
        throw new Error(`service '${name}' could not start: ${spawnError.message}`);
      if (closed)
        throw new Error(
          `service '${name}' exited before readiness (status ${exitStatus}): ` +
          `${stderr.trim() || stdout.trim() || "no output"}`
        );
      if (await readinessMatches(config.readiness)) {
        return {
          name, child, startedAt: now(),
          stop() {
            if (!closed) child.kill("SIGTERM");
            const logPath = join(logs, id, `${proofRunId}-service-${name}.log`);
            mkdirSync(dirname(logPath), { recursive: true });
            writeFileSync(logPath, `${stdout}${stderr}`);
            return {
              name,
              path: relative(root, logPath).replaceAll("\\", "/"),
              status: closed ? exitStatus : "terminated"
            };
          }
        };
      }
      await new Promise((complete) => setTimeout(complete, 100));
    }
    if (!closed) child.kill("SIGTERM");
    throw new Error(`service '${name}' readiness timed out`);
  }

  return { runCommand, startServiceSession };
}
