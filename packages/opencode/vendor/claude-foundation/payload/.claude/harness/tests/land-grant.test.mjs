import assert from "node:assert/strict";
import test from "node:test";

import { createLandGrantRuntime } from "../runtime/core/land-grant.mjs";

const stableHash = (value) => JSON.stringify(value);

function fixture() {
  const values = new Map();
  const env = { FOUNDATION_CLAUDE_SESSION_ID: "session-a" };
  const state = {
    id: "change-a", status: "proven", revision: 1,
    contractRevision: 2, executionRevision: 3,
    workspace: { targetPath: "/root", baseHead: "root-base" },
    repositories: {
      root: { targetPath: "/root", baseHead: "root-base" },
      api: { targetPath: "/api", baseHead: "api-base" }
    }
  };
  const proof = { status: "pass", proofRunId: "proof-a", workspaceHash: "hash-a" };
  const repositories = [
    { id: "root", path: "/root", mode: "write", dependsOn: [] },
    { id: "api", path: "/api", mode: "write", dependsOn: ["root"] },
    { id: "docs", path: "/docs", mode: "read", dependsOn: [] }
  ];
  let checks = 0;
  const runtime = createLandGrantRuntime({
    transactions: "/transactions",
    loadRuntime: () => state,
    selectedRepositories: () => repositories,
    proofPath: () => "/proof.json",
    readJson: (path, fallback) => path === "/proof.json"
      ? proof : values.has(path) ? values.get(path) : fallback,
    writeJson: (path, value) => values.set(path, structuredClone(value)),
    stableHash,
    now: () => "2026-09-05T00:00:00.000Z",
    landCheck: () => { checks += 1; return { archived: false }; },
    env
  });
  return { runtime, state, proof, env, checks: () => checks };
}

test("Land grant binds session, proof, revisions, graph, and writable targets", () => {
  const { runtime } = fixture();
  const grant = runtime.issue("change-a");
  assert.equal(runtime.valid("change-a").valid, true);
  assert.equal(grant.sessionId, "session-a");
  assert.deepEqual(grant.binding.targets.map((row) => row.id), ["api", "root"]);
  assert(grant.forbidden.includes("commit"));
  assert(grant.forbidden.includes("push"));
});

test("Land grant cannot cross a session or stale proof identity", () => {
  const { runtime, proof, env } = fixture();
  runtime.issue("change-a");
  env.FOUNDATION_CLAUDE_SESSION_ID = "session-b";
  assert.equal(runtime.valid("change-a").reason, "land-grant-session-mismatch");
  env.FOUNDATION_CLAUDE_SESSION_ID = "session-a";
  proof.workspaceHash = "hash-b";
  assert.equal(runtime.valid("change-a").reason, "stale-land-grant");
});

test("consumed Land authority cannot be reused", () => {
  const { runtime } = fixture();
  runtime.issue("change-a");
  runtime.consume("change-a");
  assert.equal(runtime.valid("change-a").reason, "missing-land-grant");
});

test("Land authority cannot cross missing and named session identities", () => {
  const { runtime, env } = fixture();
  runtime.issue("change-a");
  delete env.FOUNDATION_CLAUDE_SESSION_ID;
  assert.equal(runtime.valid("change-a").reason, "land-grant-session-mismatch");
  // Hosts without session metadata retain direct CLI compatibility, but their
  // grant cannot subsequently be adopted by a named host session.
  runtime.issue("change-a");
  assert.equal(runtime.valid("change-a").valid, true);
  env.FOUNDATION_SESSION_ID = "new-session";
  assert.equal(runtime.valid("change-a").reason, "land-grant-session-mismatch");
});

test("Land grant is issued only after readiness and is unnecessary for archived recovery", () => {
  const ready = fixture();
  ready.runtime.issue("change-a");
  assert.equal(ready.checks(), 1);

  const archived = fixture();
  archived.state.status = "archived";
  assert.equal(archived.runtime.issue("change-a"), null);
  assert.equal(archived.checks(), 0);
});
