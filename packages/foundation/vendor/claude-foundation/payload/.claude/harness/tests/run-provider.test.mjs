import assert from "node:assert/strict";
import test from "node:test";

import {
  runProviderOperation,
  runProviderRequest,
  runProviderStatus
} from "../runtime/evidence/adapter-runtime.mjs";

const fail = (message) => { throw new Error(message); };

function requestContext(config = { adapter: "external" }) {
  return {
    providers: new Set(["test"]),
    providerConfig: () => config,
    providerCapability: (_provider, value) => value?.capability || "test",
    parseFlags: () => ({ flags: { claims: "declared" }, rest: [] }),
    die: fail
  };
}

test("run-provider request validates provider, adapter, separator, flags, and command", () => {
  assert.deepEqual(runProviderRequest(requestContext(), "change", "test",
    ["--claims", "declared", "--", "npm", "test"]), {
    flags: { claims: "declared" }, command: "npm", commandArgs: ["test"]
  });
  const unknown = requestContext({ adapter: "external", capability: "missing" });
  assert.throws(() => runProviderRequest(
    unknown, "change", "test", ["--", "npm"]), /unknown provider/);
  assert.throws(() => runProviderRequest(requestContext({
    adapter: "command", capability: "test"
  }), "change", "test", ["--", "npm"]), /declares adapter 'command'/);
  for (const values of [[], ["--"]])
    assert.throws(() => runProviderRequest(
      requestContext(), "change", "test", values), /requires '-- <command>/);
  const rest = requestContext();
  rest.parseFlags = () => ({ flags: { claims: "declared" }, rest: ["extra"] });
  assert.throws(() => runProviderRequest(
    rest, "change", "test", ["extra", "--", "npm"]), /unexpected.*extra/);
  const noClaims = requestContext();
  noClaims.parseFlags = () => ({ flags: {}, rest: [] });
  assert.throws(() => runProviderRequest(
    noClaims, "change", "test", ["--", "npm"]), /requires --claims/);
});

test("run-provider status separates checks from infrastructure failures", () => {
  assert.equal(runProviderStatus({ status: 0 }), "pass");
  assert.equal(runProviderStatus({ status: 2 }), "fail");
  assert.equal(runProviderStatus({ status: null }), "error");
  assert.equal(runProviderStatus({ status: 0, error: new Error("spawn") }), "error");
});

function operationContext(result) {
  const receipts = [];
  const writes = [];
  const exits = [];
  const ticks = [100, 101, 105];
  const context = {
    ...requestContext(),
    root: "/root", logs: "/root/logs",
    providerWorkspace: () => "/workspace",
    recordReceipt: (...args) => receipts.push(args),
    now: () => "started",
    dateNow: () => ticks.shift(),
    environment: { PATH: "/bin", CLAUDE_FOUNDATION_PROJECT: "/control" },
    spawn: (...args) => { context.spawnArgs = args; return result; },
    mkdir: (...args) => { context.mkdirArgs = args; },
    write: (...args) => writes.push(args),
    exit: (code) => exits.push(code)
  };
  return { context, receipts, writes, exits };
}

test("run-provider operation executes, logs, and records a passing receipt", () => {
  const fixture = operationContext({
    status: 0, stdout: "out", stderr: "err", error: null
  });
  runProviderOperation(fixture.context, "change", "test",
    ["--claims", "declared", "--", "npm", "test"]);
  assert.deepEqual(fixture.context.spawnArgs.slice(0, 2), ["npm", ["test"]]);
  assert.equal(fixture.context.spawnArgs[2].cwd, "/workspace");
  assert.equal(fixture.context.spawnArgs[2].maxBuffer, 64 * 1024 * 1024);
  assert.equal(fixture.context.spawnArgs[2].env.FOUNDATION_CHANGE_ID, "change");
  assert.equal(fixture.context.spawnArgs[2].env.CLAUDE_FOUNDATION_PROJECT, undefined);
  assert.deepEqual(fixture.context.mkdirArgs, ["/root/logs/change", { recursive: true }]);
  assert.deepEqual(fixture.writes, [["/root/logs/change/test-101.log", "outerr"]]);
  assert.equal(fixture.receipts[0][2], "pass");
  assert.equal(fixture.receipts[0][3].durationMs, 5);
  assert.equal(fixture.receipts[0][3].command, "npm test");
  assert.deepEqual(fixture.receipts[0][4], { executed: true });
  assert.deepEqual(fixture.exits, []);
});

test("run-provider operation records failures before forwarding exit status", () => {
  const failed = operationContext({ status: 3, stdout: "", stderr: "bad" });
  runProviderOperation(failed.context, "change", "test",
    ["--claims", "declared", "--", "check"]);
  assert.equal(failed.receipts[0][2], "fail");
  assert.equal(failed.receipts[0][3].observed, "exit 3");
  assert.deepEqual(failed.exits, [3]);

  const missing = operationContext({
    status: null, stdout: undefined, stderr: undefined, error: new Error("missing")
  });
  runProviderOperation(missing.context, "change", "test",
    ["--claims", "declared", "--", "missing"]);
  assert.equal(missing.receipts[0][2], "error");
  assert.equal(missing.receipts[0][3].observed, "exit error");
  assert.deepEqual(missing.writes[0].slice(1), [""]);
  assert.deepEqual(missing.exits, [1]);
});
