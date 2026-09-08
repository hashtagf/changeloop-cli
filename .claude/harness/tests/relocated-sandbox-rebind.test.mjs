import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRelocatedSandboxIdentity,
  assertRelocatedSandboxLayout,
  rebindRelocatedSandboxOperation,
  relocatedSandboxCandidate
} from "../runtime/workflow/sandbox-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const candidate = "/project/.foundation/sandboxes/change";

function context(overrides = {}) {
  return {
    root: "/project",
    sandboxRoot: (id) => `/project/.foundation/sandboxes/${id}`,
    canonicalPath: (path) => path,
    pathExists: () => false,
    directoryExists: () => true,
    fileDigest: () => "marker-digest",
    gitMetadataPresent: () => true,
    saveRuntime: () => {},
    clearSnapshotCache: () => {},
    now: () => "2026-08-26T00:00:00.000Z",
    fail,
    output: { log: () => {} },
    ...overrides
  };
}

function workspace(overrides = {}) {
  return {
    mode: "copy",
    path: "/old-project/.foundation/sandboxes/change",
    packetSnapshot: { ".openspec.yaml": "marker-digest" },
    ...overrides
  };
}

test("candidate selection ignores non-isolated, live, absent, and unchanged sandboxes", () => {
  assert.equal(relocatedSandboxCandidate(context(), "change", workspace({ mode: "none" })), null);
  assert.equal(relocatedSandboxCandidate(context(), "change", workspace({ path: null })), null);
  assert.equal(relocatedSandboxCandidate(context({
    pathExists: (path) => path.startsWith("/old-project")
  }), "change", workspace()), null);
  assert.equal(relocatedSandboxCandidate(context({ directoryExists: () => false }),
    "change", workspace()), null);
  assert.equal(relocatedSandboxCandidate(context(), "change",
    workspace({ path: candidate })), null);
});

test("candidate selection rejects paths escaping the canonical sandbox root", () => {
  assert.throws(() => relocatedSandboxCandidate(context({
    sandboxRoot: () => "/project/elsewhere/change"
  }), "change", workspace()), /candidate escapes the canonical sandbox directory/);
  assert.equal(relocatedSandboxCandidate(context(), "change", workspace()), candidate);
});

test("identity validation requires packet, expected marker, marker file, and digest", () => {
  const packet = `${candidate}/openspec/changes/change`;
  const marker = `${packet}/.openspec.yaml`;
  assert.doesNotThrow(() => assertRelocatedSandboxIdentity(context({
    pathExists: (path) => path === marker
  }), "change", workspace(), candidate));
  assert.throws(() => assertRelocatedSandboxIdentity(context({
    directoryExists: (path) => path !== packet,
    pathExists: () => true
  }), "change", workspace(), candidate), /change identity does not match/);
  assert.throws(() => assertRelocatedSandboxIdentity(context({ pathExists: () => true }),
    "change", workspace({ packetSnapshot: {} }), candidate), /change identity does not match/);
  assert.throws(() => assertRelocatedSandboxIdentity(context({ pathExists: () => false }),
    "change", workspace(), candidate), /change identity does not match/);
  assert.throws(() => assertRelocatedSandboxIdentity(context({
    pathExists: () => true, fileDigest: () => "wrong"
  }), "change", workspace(), candidate), /change identity does not match/);
});

test("layout validation requires runtime/config files and mode-appropriate Git metadata", () => {
  assert.doesNotThrow(() => assertRelocatedSandboxLayout(context({ pathExists: () => true }),
    workspace(), candidate));
  assert.throws(() => assertRelocatedSandboxLayout(context({ pathExists: () => false }),
    workspace(), candidate), /sandbox layout is incomplete/);
  assert.throws(() => assertRelocatedSandboxLayout(context({
    pathExists: () => true, gitMetadataPresent: () => false
  }), workspace({ mode: "worktree" }), candidate), /recorded worktree metadata is not valid/);
  assert.throws(() => assertRelocatedSandboxLayout(context({
    pathExists: () => true, gitMetadataPresent: () => false
  }), workspace({ mode: "copy", git: "carried" }), candidate),
  /recorded copied Git metadata is not valid/);
  assert.doesNotThrow(() => assertRelocatedSandboxLayout(context({
    pathExists: () => true, gitMetadataPresent: () => false
  }), workspace({ mode: "copy", git: "absent" }), candidate));
});

test("successful rebind persists canonical paths, clears cache, and reports", () => {
  const saved = [];
  const cleared = [];
  const logs = [];
  const state = { id: "change", workspace: workspace() };
  const marker = `${candidate}/openspec/changes/change/.openspec.yaml`;
  assert.equal(rebindRelocatedSandboxOperation(context({
    pathExists: (path) => !path.startsWith("/old-project") &&
      (path === marker || path.startsWith(candidate)),
    saveRuntime: (value) => saved.push(value),
    clearSnapshotCache: (id) => cleared.push(id),
    output: { log: (message) => logs.push(message) }
  }), "change", state), true);
  assert.equal(state.workspace.path, candidate);
  assert.equal(state.workspace.relocatedFrom,
    "/old-project/.foundation/sandboxes/change");
  assert.equal(state.workspace.reboundAt, "2026-08-26T00:00:00.000Z");
  assert.equal(saved.length, 1);
  assert.deepEqual(cleared, ["change"]);
  assert.match(logs[0], /REBOUND change[\s\S]*workspace: \/project/);
});

test("ineligible rebind performs no mutation", () => {
  const state = { workspace: workspace({ mode: "current" }) };
  assert.equal(rebindRelocatedSandboxOperation(context({
    saveRuntime: assert.fail,
    clearSnapshotCache: assert.fail,
    output: { log: assert.fail }
  }), "change", state), false);
});
