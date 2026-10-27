import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createProcessRuntime, serviceWorkspace,
  pathInside,
  readinessMatches,
  servesOverNetwork,
  serviceEnvironment,
  startNativeStaticService,
  startSpawnedService,
  staticServiceIdentity,
  staticServiceRequestHandler,
  writeServiceLog
} from "../runtime/core/process-runtime.mjs";

test("service workspace resolves repository, runtime, and root locations", () => {
  const loaded = [];
  const context = {
    root: "/root",
    loadRuntime: (id) => {
      loaded.push(id);
      return { workspace: { path: "/runtime" } };
    },
    repositoryById: (id, repository, state) => {
      assert.equal(id, "change");
      assert.equal(repository, "api");
      assert.equal(state.workspace.path, "/runtime");
      return { workspacePath: "/repository" };
    }
  };
  assert.equal(serviceWorkspace(context, "change", { repository: "api" }), "/repository");
  assert.equal(serviceWorkspace(context, "change", {}), "/runtime");
  assert.equal(serviceWorkspace({
    ...context, loadRuntime: (id) => {
      loaded.push(id);
      return { workspace: {} };
    }
  }, "change", {}), "/root");
  assert.deepEqual(loaded, ["change", "change", "change"]);
});

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-process-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("path and readiness URL classification reject escapes and non-network schemes", () => {
  assert.equal(pathInside("/root", "/root"), true);
  assert.equal(pathInside("/root", "/root/child"), true);
  assert.equal(pathInside("/root", "/outside"), false);
  assert.equal(servesOverNetwork("http://localhost:3000/ready"), true);
  assert.equal(servesOverNetwork("https://example.test"), true);
  assert.equal(servesOverNetwork("data:text/plain,ok"), false);
  assert.equal(servesOverNetwork("not a url"), false);
  assert.equal(servesOverNetwork(null), false);
});

function response({ status = 200, headers = {}, body = "ready" } = {}) {
  return {
    status,
    headers: { get: (key) => headers[key] ?? null },
    text: async () => body
  };
}

test("readiness matching checks status, headers, body, and request failures", async () => {
  const request = async () => response({ headers: { "x-ready": "yes" }, body: "all ready" });
  assert.equal(await readinessMatches({ url: "http://service" }, request), true);
  assert.equal(await readinessMatches({
    url: "http://service", expectStatus: "200", expectHeader: { "x-ready": "yes" },
    expectBody: "ready"
  }, request), true);
  assert.equal(await readinessMatches({ url: "http://service", expectStatus: 201 }, request), false);
  assert.equal(await readinessMatches({
    url: "http://service", expectHeader: { "x-ready": "no" }
  }, request), false);
  assert.equal(await readinessMatches({ url: "http://service", expectBody: "missing" }, request),
    false);
  assert.equal(await readinessMatches({ url: "http://service" }, async () => {
    throw new Error("offline");
  }), false);
});

function fakeResponse() {
  return {
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test("static request handler serves index and MIME types while rejecting bad paths", (t) => {
  const root = workspace(t);
  writeFileSync(join(root, "index.html"), "<h1>home</h1>");
  writeFileSync(join(root, "app.js"), "export default true;");
  writeFileSync(join(root, "asset.bin"), "binary");
  mkdirSync(join(root, "folder"));
  let requests = 0;
  const headers = staticServiceIdentity("web", "run-1", { "x-custom": "yes" });
  assert.deepEqual(headers, {
    "x-custom": "yes", "x-foundation-proof-run": "run-1"
  });
  assert.equal(staticServiceIdentity("web", 2)["x-foundation-service"], "web");
  const handler = staticServiceRequestHandler({
    staticRoot: root, readinessUrl: "http://127.0.0.1:3000/", identityHeaders: headers,
    onRequest: () => { requests += 1; }
  });
  const index = fakeResponse();
  handler({ url: "/" }, index);
  assert.equal(index.status, 200);
  assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(String(index.body), "<h1>home</h1>");
  const js = fakeResponse();
  handler({ url: "/app.js" }, js);
  assert.equal(js.headers["content-type"], "text/javascript; charset=utf-8");
  const binary = fakeResponse();
  handler({ url: "/asset.bin" }, binary);
  assert.equal(binary.headers["content-type"], "application/octet-stream");
  for (const url of ["/missing", "/folder", "/%2e%2e%2fsecret"]) {
    const missing = fakeResponse();
    handler({ url }, missing);
    assert.equal(missing.status, 404, url);
  }
  const bad = fakeResponse();
  handler({ url: "http://[" }, bad);
  assert.equal(bad.status, 400);
  assert.equal(requests, 7);

  const defaultRequest = staticServiceRequestHandler({
    staticRoot: root, readinessUrl: "http://127.0.0.1:3000/", identityHeaders: headers
  });
  const defaultResponse = fakeResponse();
  defaultRequest({ url: "/" }, defaultResponse);
  assert.equal(defaultResponse.status, 200);
});

test("service logs are durable and environments preserve declared inheritance", (t) => {
  const root = workspace(t);
  const logs = join(root, "logs");
  const prior = process.env.FOUNDATION_TEST_INHERIT;
  process.env.FOUNDATION_TEST_INHERIT = "host";
  try {
    const env = serviceEnvironment({
      envFrom: ["FOUNDATION_TEST_INHERIT", "FOUNDATION_TEST_MISSING"],
      env: { FOUNDATION_TEST_INHERIT: "override", LOCAL: "yes" }, repository: "api"
    }, "change", root, "run", "web");
    assert.equal(env.FOUNDATION_TEST_INHERIT, "override");
    assert.equal(env.LOCAL, "yes");
    assert.equal(env.FOUNDATION_REPOSITORY_ID, "api");
    assert.equal(env.FOUNDATION_CHANGE_ID, "change");
    assert.equal(serviceEnvironment({}, "c", root, "r", "n").FOUNDATION_REPOSITORY_ID,
      "root");
  } finally {
    if (prior === undefined) delete process.env.FOUNDATION_TEST_INHERIT;
    else process.env.FOUNDATION_TEST_INHERIT = prior;
  }
  const result = writeServiceLog({
    root, logs, id: "change", proofRunId: "run", name: "web",
    content: "output\n", status: "terminated"
  });
  assert.deepEqual(result, {
    name: "web", path: "logs/change/run-service-web.log", status: "terminated"
  });
  assert.equal(readFileSync(join(root, result.path), "utf8"), "output\n");
});

function fakeServer() {
  const state = { handler: null, closed: 0, port: null, host: null };
  const factory = (handler) => {
    state.handler = handler;
    return {
      once(_event, _callback) {},
      listen(port, host, callback) { state.port = port; state.host = host; callback(); },
      close(callback) { state.closed += 1; if (callback) callback(); }
    };
  };
  return { state, factory };
}

test("native static service validates roots, binds run identity, and closes on failure", async (t) => {
  const root = workspace(t);
  const logs = join(root, "logs");
  const cwd = join(root, "workspace");
  const publicDir = join(cwd, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "index.html"), "ready");
  const base = {
    id: "change", name: "web", proofRunId: "run-1", cwd, root, logs,
    now: () => "now",
    config: { staticRoot: "public", readiness: { url: "https://127.0.0.1/" } }
  };
  await assert.rejects(() => startNativeStaticService({
    ...base, config: { ...base.config, staticRoot: "../outside" }
  }), /staticRoot is not a workspace directory/);
  await assert.rejects(() => startNativeStaticService({
    ...base, config: { ...base.config, staticRoot: "missing" }
  }), /staticRoot is not a workspace directory/);

  const failedServer = fakeServer();
  await assert.rejects(() => startNativeStaticService({
    ...base, serverFactory: failedServer.factory, readinessCheck: async () => false
  }), /native static readiness failed/);
  assert.equal(failedServer.state.closed, 1);

  const readyServer = fakeServer();
  let observed;
  const session = await startNativeStaticService({
    ...base, serverFactory: readyServer.factory,
    readinessCheck: async (readiness) => { observed = readiness; return true; }
  });
  assert.equal(readyServer.state.port, 443);
  assert.equal(observed.expectHeader["x-foundation-proof-run"], "run-1");
  const response = fakeResponse();
  readyServer.state.handler({ url: "/" }, response);
  assert.equal(response.status, 200);
  const stopped = session.stop();
  assert.equal(stopped.status, "terminated");
  assert.match(readFileSync(join(root, stopped.path), "utf8"), /requests=1/);
});

function fakeChild() {
  const handlers = { stdout: {}, stderr: {}, child: {} };
  const child = {
    stdout: { on: (event, callback) => { handlers.stdout[event] = callback; } },
    stderr: { on: (event, callback) => { handlers.stderr[event] = callback; } },
    on: (event, callback) => { handlers.child[event] = callback; },
    kills: [], kill(signal) { this.kills.push(signal); }
  };
  return { child, handlers };
}

test("spawned service returns a stoppable session with output and environment", async (t) => {
  const root = workspace(t);
  const fake = fakeChild();
  let spawnCall;
  const session = await startSpawnedService({
    id: "change", name: "api", proofRunId: "run", cwd: root, root,
    logs: join(root, "logs"), now: () => "now",
    config: { command: ["node", "server.mjs"], readiness: { url: "data:,ready" } },
    spawnProcess: (...args) => { spawnCall = args; return fake.child; },
    readinessCheck: async () => {
      fake.handlers.stdout.data("out\n");
      fake.handlers.stderr.data("err\n");
      return true;
    }
  });
  assert.deepEqual(spawnCall[1], ["server.mjs"]);
  assert.equal(spawnCall[2].env.FOUNDATION_SERVICE_NAME, "api");
  const stopped = session.stop();
  assert.deepEqual(fake.child.kills, ["SIGTERM"]);
  assert.equal(stopped.status, "terminated");
  assert.equal(readFileSync(join(root, stopped.path), "utf8"), "out\nerr\n");

  const closed = fakeChild();
  const closedSession = await startSpawnedService({
    id: "change", name: "closed", proofRunId: "run", cwd: root, root,
    logs: join(root, "logs"), now: () => "now",
    config: { command: ["node"], readiness: {} }, spawnProcess: () => closed.child,
    readinessCheck: async () => true
  });
  closed.handlers.child.close(0);
  assert.equal(closedSession.stop().status, 0);
  assert.deepEqual(closed.child.kills, []);
});

test("spawned service reports spawn, early-exit, and timeout failures", async (t) => {
  const root = workspace(t);
  const input = (fake, overrides = {}) => ({
    id: "change", name: "api", proofRunId: "run", cwd: root, root,
    logs: join(root, "logs"), now: () => "now",
    config: { command: ["node"], readiness: {}, timeoutMs: 20 },
    spawnProcess: () => fake.child, readinessCheck: async () => false, ...overrides
  });
  const spawnFailed = fakeChild();
  await assert.rejects(() => startSpawnedService(input(spawnFailed, {
    wait: async () => { spawnFailed.handlers.child.error(new Error("ENOENT")); }
  })), /could not start: ENOENT/);

  const exited = fakeChild();
  await assert.rejects(() => startSpawnedService(input(exited, {
    wait: async () => {
      exited.handlers.stderr.data("startup failed");
      exited.handlers.child.close(2);
    }
  })), /exited before readiness.*startup failed/);

  const silent = fakeChild();
  await assert.rejects(() => startSpawnedService(input(silent, {
    wait: async () => { silent.handlers.child.close(null); }
  })), /exited before readiness.*no output/);

  const timedOut = fakeChild();
  await assert.rejects(() => startSpawnedService(input(timedOut, {
    config: { command: ["node"], readiness: {}, timeoutMs: 1 },
    wait: () => new Promise((resolve) => setTimeout(resolve, 3))
  })), /readiness timed out/);
  assert.deepEqual(timedOut.child.kills, ["SIGTERM"]);
});

test("process runtime executes commands, handles spawn errors, and times out", async (t) => {
  const root = workspace(t);
  let tick = 0;
  const runtime = createProcessRuntime({
    root, logs: join(root, "logs"), now: () => `t${tick += 1}`,
    resolveServiceCwd: () => root
  });
  const success = await runtime.runCommand(process.execPath,
    ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
    { cwd: root, env: process.env, timeoutMs: 1000 });
  assert.equal(success.status, 0);
  assert.equal(success.stdout, "out");
  assert.equal(success.stderr, "err");
  assert.equal(success.readinessObserved, true);

  const failed = await runtime.runCommand(join(root, "missing-command"), [],
    { cwd: root, env: process.env, timeoutMs: 100 });
  assert.equal(failed.status, null);
  assert.match(failed.error.message, /ENOENT/);

  const timeout = await runtime.runCommand(process.execPath,
    ["-e", "setTimeout(() => {}, 10000)"],
    { cwd: root, env: process.env, timeoutMs: 10 });
  assert.equal(timeout.timedOut, true);

  const port = await freePort();
  let probes = 0;
  const ready = createServer((_request, response) => {
    probes += 1;
    response.writeHead(probes === 1 ? 503 : 200, { "x-ready": "yes" });
    response.end("service ready");
  });
  await new Promise((resolve) => ready.listen(port, "127.0.0.1", resolve));
  try {
    const observed = await runtime.runCommand(process.execPath,
      ["-e", "setTimeout(() => {}, 250)"], {
        cwd: root, env: process.env, timeoutMs: 1000,
        readiness: {
          url: `http://127.0.0.1:${port}/`, expectHeader: { "x-ready": "yes" },
          expectBody: "ready"
        }
      });
    assert.equal(observed.status, 0);
    assert.equal(observed.readinessObserved, true);
    assert.equal(probes >= 2, true);
  } finally {
    await new Promise((resolve) => ready.close(resolve));
  }
});

test("process runtime starts native static sessions and rejects occupied readiness URLs", async (t) => {
  const root = workspace(t);
  const publicDir = join(root, "public");
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, "index.html"), "ready");
  const port = await freePort();
  const runtime = createProcessRuntime({
    root, logs: join(root, "logs"), now: () => "now", resolveServiceCwd: () => root
  });
  const config = {
    staticRoot: "public",
    readiness: { url: `http://127.0.0.1:${port}/`, expectBody: "ready" }
  };
  const session = await runtime.startServiceSession("change", "web", config, "run");
  const response = await fetch(config.readiness.url);
  assert.equal(await response.text(), "ready");
  session.stop();

  const spawnedPort = await freePort();
  const script = join(root, "service.mjs");
  writeFileSync(script, [
    "import { createServer } from 'node:http';",
    `const server = createServer((_q, r) => r.end('spawned ready')).listen(${spawnedPort}, '127.0.0.1');`,
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));"
  ].join("\n"));
  const spawned = await runtime.startServiceSession("change", "api", {
    command: [process.execPath, script], timeoutMs: 3000,
    readiness: { url: `http://127.0.0.1:${spawnedPort}/`, expectBody: "spawned ready" }
  }, "run-spawned");
  const spawnedClosed = new Promise((resolve) => spawned.child.once("close", resolve));
  const spawnedResult = spawned.stop();
  assert.equal(spawnedResult.status, "terminated");
  await spawnedClosed;

  const occupiedPort = await freePort();
  const occupied = createServer((_request, response) => response.end("ready"));
  await new Promise((resolve) => occupied.listen(occupiedPort, "127.0.0.1", resolve));
  try {
    await assert.rejects(() => runtime.startServiceSession(
      "change", "other", {
        command: ["node"], readiness: { url: `http://127.0.0.1:${occupiedPort}/` }
      }, "run-2"
    ), /already being served/);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
