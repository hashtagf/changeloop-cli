import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { blockingConflictRows } from "../runtime/core/graph-execution.mjs";
import {
  activeProofRunIsCurrent,
  activeRepositoryConflictsOperation,
  conflictChangeIsEligible,
  readRuntimeDirectory,
  repositoryConflictRows,
  runtimeEntryIsJsonFile
} from "../runtime/workflow/agent-planning.mjs";

function entry(name, file = true) {
  return { name, isFile: () => file };
}

test("runtime conflict entry helpers filter files and active changes", () => {
  assert.equal(runtimeEntryIsJsonFile(entry("change.json")), true);
  assert.equal(runtimeEntryIsJsonFile(entry("change.txt")), false);
  assert.equal(runtimeEntryIsJsonFile(entry("change.json", false)), false);
  assert.equal(conflictChangeIsEligible({ id: "other", status: "building" }, "current"), true);
  assert.equal(conflictChangeIsEligible({}, "current"), false);
  assert.equal(conflictChangeIsEligible({ id: "current" }, "current"), false);
  assert.equal(conflictChangeIsEligible({ id: "other", status: "archived" }, "current"), false);
});

test("runtime directory reader returns file-type entries", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-runtime-entries-"));
  try {
    writeFileSync(join(root, "change.json"), "{}");
    mkdirSync(join(root, "nested"));
    const entries = readRuntimeDirectory(root);
    assert.equal(entries.find((row) => row.name === "change.json").isFile(), true);
    assert.equal(entries.find((row) => row.name === "nested").isFile(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("proof-run freshness rejects absent, malformed, and stale markers", () => {
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  assert.equal(activeProofRunIsCurrent({}, now), false);
  assert.equal(activeProofRunIsCurrent({
    activeProofRun: { startedAt: "invalid" }
  }, now), false);
  assert.equal(activeProofRunIsCurrent({
    activeProofRun: { startedAt: "2026-08-27T10:00:00.000Z" }
  }, now), true);
  assert.equal(activeProofRunIsCurrent({
    activeProofRun: { startedAt: "2026-08-27T09:59:59.999Z" }
  }, now), false);
});

test("repository conflict rows report the first held overlap per requested key", () => {
  const rows = repositoryConflictRows(
    { id: "other", status: "building" },
    ["repo:api", "path:web:src", "global"],
    ["repo:other", "repo:api", "path:web:src", "global"],
    (left, right) => left === right);
  assert.deepEqual(rows, [{
    changeId: "other", repository: "api",
    key: "repo:api <> repo:api", status: "building"
  }, {
    changeId: "other", repository: "web",
    key: "path:web:src <> path:web:src", status: "building"
  }, {
    changeId: "other", repository: null,
    key: "global <> global", status: "building"
  }]);
  assert.deepEqual(repositoryConflictRows(
    { id: "other" }, ["repo:api"], ["repo:web"], () => false), []);
});

function operationFixture() {
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  const values = {
    "current.json": { id: "current", status: "building" },
    "archived.json": { id: "archived", status: "archived" },
    "missing.json": {},
    "broken.json": { id: "broken", status: "building" },
    "unselected.json": { id: "unselected", status: "building" },
    "stale.json": {
      id: "stale", status: "building",
      activeProofRun: { startedAt: "2026-08-27T09:00:00.000Z" }
    },
    "live.json": {
      id: "live", status: "proving",
      activeProofRun: { startedAt: "2026-08-27T11:00:00.000Z" }
    }
  };
  return {
    runtime: "/runtime",
    loadRuntime: () => ({ id: "current" }),
    changeConflictKeys: (id) => id === "current"
      ? ["repo:api"] : ["repo:api"],
    exists: () => true,
    readDirectory: () => [
      entry("notes.txt"), entry("folder.json", false),
      ...Object.keys(values).map((name) => entry(name))
    ],
    readJson: (path) => values[path.split("/").at(-1)],
    safeSelectedRepositories: (id) => {
      if (id === "broken") throw new Error("bad topology");
      if (id === "unselected") return null;
      return [{ id: "api", mode: "write" }];
    },
    conflictKeysOverlap: (left, right) => left === right,
    nowMs: () => now
  };
}

test("repository conflict operation skips unreadable state and scopes execution to live proofs", () => {
  const context = operationFixture();
  const repositories = [{ id: "api", mode: "write" }];
  assert.deepEqual(activeRepositoryConflictsOperation(
    { ...context, exists: () => false }, "current", repositories), []);

  const planned = activeRepositoryConflictsOperation(context, "current", repositories);
  assert.deepEqual(planned.map((row) => row.changeId), ["stale", "live"]);
  const executing = activeRepositoryConflictsOperation(
    context, "current", repositories, { executing: true });
  assert.deepEqual(executing.map((row) => row.changeId), ["live"]);
  assert.equal(executing[0].repository, "api");
});

// Two consumer changes that both touched `src/lib` waited on each other until
// one was abandoned. Scope overlap across changes is the concurrency model's
// normal case — the later landing synchronizes — so only a declared shared
// resource may stop a plan or a proof run.
test("only shared-resource overlaps block across changes", () => {
  const rows = [
    { changeId: "other", key: "repo:root <> repo:root", status: "building" },
    { changeId: "other", key: "path:root:src/lib <> path:root:src", status: "building" },
    { changeId: "other", key: "contract:api-v1 <> contract:api-v1", status: "proven" },
    { changeId: "other", key: "resource:staging-db <> resource:staging-db", status: "building" },
    { changeId: "other", status: "building" }
  ];
  assert.deepEqual(blockingConflictRows(rows), [rows[3]]);
  assert.deepEqual(blockingConflictRows([]), []);
});
