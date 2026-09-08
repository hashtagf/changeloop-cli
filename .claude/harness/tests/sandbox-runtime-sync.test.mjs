import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createSandboxRuntime, recordSandboxBaseMove, reportSandboxSync,
  sandboxMovementLine, unusedCopyResolveMessage
} from "../runtime/workflow/sandbox-runtime.mjs";

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fail = (message) => { throw new Error(message); };

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function capture(fn) {
  const prior = console.log;
  const rows = [];
  console.log = (value) => rows.push(String(value));
  try { return { value: fn(), rows }; } finally { console.log = prior; }
}

function syncFixture(id = "sync-copy") {
  const root = mkdtempSync(join(tmpdir(), "sandbox-sync-source-"));
  const sandbox = join(root, ".foundation", "sandboxes", id);
  const source = join(root, "openspec", "changes", id);
  const destination = join(sandbox, "openspec", "changes", id);
  write(join(source, "tasks.md"), "- [ ] T001 keep progress\n");
  write(join(source, "proposal.md"), "target proposal\n");
  write(join(destination, "tasks.md"), "- [x] T001 keep progress\n");
  write(join(destination, "proposal.md"), "target proposal\n");
  write(join(root, "forward.txt"), "target-new\n");
  write(join(sandbox, "forward.txt"), "base-old\n");
  write(join(sandbox, "deleted.txt"), "base-old\n");
  write(join(root, "resolved.txt"), "target-new\n");
  write(join(sandbox, "resolved.txt"), "merged-result\n");
  write(join(root, "conflict.txt"), "target-new\n");
  write(join(sandbox, "conflict.txt"), "sandbox-new\n");
  const proof = join(root, ".foundation", "proof", `${id}.json`);
  write(proof, "{}\n");
  const targetManifest = {
    "same.txt": "same", "already.txt": "new", "forward.txt": "new",
    "resolved.txt": "new", "conflict.txt": "new"
  };
  const sandboxManifest = {
    "same.txt": "same", "already.txt": "new", "forward.txt": "old",
    "resolved.txt": "merged", "conflict.txt": "sandbox", "deleted.txt": "old"
  };
  const state = {
    status: "resolved", revision: 0, contractRevision: 0, executionRevision: 0,
    workspace: {
      mode: "copy", path: sandbox,
      recovery: { reason: "old" },
      baseline: {
        "same.txt": "same", "already.txt": "old", "forward.txt": "old",
        "resolved.txt": "old", "conflict.txt": "old", "deleted.txt": "old"
      }
    }
  };
  let repositoryScope = { source: [], destination: [] };
  let saves = 0;
  const runtime = createSandboxRuntime({
    root,
    policy: () => ({ sandbox: {} }),
    loadRuntime: () => state,
    saveRuntime: () => { saves += 1; },
    workspaceManifest: (path) => path === root ? targetManifest : sandboxManifest,
    directoryHash: () => "source-hash",
    fileDigest: digest,
    changePath: () => source,
    selectedRepositories: () => [],
    clearSnapshotCache: () => {},
    validate: () => {},
    repositorySelectionIdsAt: (path) => path === source
      ? repositoryScope.source : repositoryScope.destination,
    contractFingerprint: (_changeId, path) => path === source
      ? "contract-next" : "contract-prior",
    executionFingerprint: (_changeId, path) => path === source
      ? "execution-next" : "execution-prior",
    taskBlocks: (text) => text.includes("[x]")
      ? [{ id: "T001", text: "T001 keep progress", done: true }] : [],
    proofPath: () => proof,
    relevantHash: () => "relevant-hash",
    now: () => "2026-08-26T00:00:00.000Z",
    fail
  });
  return {
    root, sandbox, source, destination, state, runtime,
    setRepositoryScope(value) { repositoryScope = value; },
    saves: () => saves
  };
}

test("copy sync reconciles target movement and preserves task progress", () => {
  const fixture = syncFixture();

  const output = capture(() => fixture.runtime.sync("sync-copy", {
    resolve: "resolved.txt"
  }));

  assert.match(output.rows.join("\n"), /fast-forwarded: 2 file/);
  assert.match(output.rows.join("\n"), /CONFLICT conflict\.txt/);
  assert.match(readFileSync(join(fixture.destination, "tasks.md"), "utf8"),
    /\[x\] T001/);
  assert.equal(readFileSync(join(fixture.sandbox, "forward.txt"), "utf8"),
    "target-new\n");
  assert.equal(existsSync(join(fixture.sandbox, "deleted.txt")), false);
  assert.equal(fixture.state.workspace.baseline["resolved.txt"], "new");
  assert.equal(fixture.state.workspace.baseline["conflict.txt"], "old");
  assert.equal(fixture.state.revision, 1);
  assert.equal(fixture.state.contractRevision, 1);
  assert.equal(fixture.state.executionRevision, 1);
  assert.equal(fixture.state.workspace.recovery, undefined);
  assert.equal(existsSync(join(fixture.root, ".foundation", "proof", "sync-copy.json")),
    false);
  assert.equal(fixture.saves(), 1);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync rejects a resolve path that is not a conflict", () => {
  const fixture = syncFixture("unused-resolve");

  assert.throws(() => fixture.runtime.sync("unused-resolve", {
    resolve: "same.txt"
  }), /not in conflict/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("unused copy resolution diagnostics preserve singular and plural instructions", () => {
  assert.match(unusedCopyResolveMessage(["one.txt"]),
    /'one\.txt'.*which is not in conflict; drop it/s);
  assert.match(unusedCopyResolveMessage(["one.txt", "two.txt"]),
    /'one\.txt', 'two\.txt'.*which are not in conflict; drop them/s);
});

test("sync creates a missing packet for an already-applied copy", () => {
  const fixture = syncFixture("missing-packet");
  rmSync(fixture.destination, { recursive: true, force: true });
  fixture.state.workspace.packetSnapshot = {};
  fixture.state.workspace.applied = true;

  fixture.runtime.sync("missing-packet");

  assert.equal(existsSync(join(fixture.destination, "tasks.md")), true);
  assert.equal(fixture.state.workspace.baseline["forward.txt"], "old");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync rejects sandbox-only packet edits before overwriting them", () => {
  const fixture = syncFixture("packet-loss");
  fixture.state.workspace.packetSnapshot = {
    "tasks.md": digest(join(fixture.destination, "tasks.md")),
    "proposal.md": "previous-copy",
    "removed.md": "previously-present"
  };
  write(join(fixture.destination, "proposal.md"), "sandbox-only edit\n");
  write(join(fixture.destination, "sandbox-only.md"), "sandbox-only file\n");

  assert.throws(() => fixture.runtime.sync("packet-loss"),
    /sandbox packet edits would be lost/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync rejects a repository topology revision during Build", () => {
  const fixture = syncFixture("scope-change");
  fixture.setRepositoryScope({ source: ["root", "api"], destination: ["root"] });

  assert.throws(() => fixture.runtime.sync("scope-change"),
    /repository scope changed during Build/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("sync requires an existing active sandbox", () => {
  const fixture = syncFixture("inactive");
  fixture.state.workspace = null;

  assert.throws(() => fixture.runtime.sync("inactive"), /has no active sandbox/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("movement formatting distinguishes rebased, moved, and multi-repository results", () => {
  assert.equal(sandboxMovementLine(null), "");
  assert.match(sandboxMovementLine({
    rebased: true, multiRepository: false, from: "123456789",
    to: "abcdefghi", repositories: [{ from: "123456789", to: "abcdefghi" }]
  }), /rebased: 12345678 -> abcdefgh/);
  assert.match(sandboxMovementLine({
    rebased: false, multiRepository: false,
    repositories: [{ from: "old-head", to: "new-head" }]
  }), /target moved: old-head -> new-head/);
  assert.match(sandboxMovementLine({
    rebased: false, multiRepository: false,
    repositories: [{ from: null, to: null }]
  }), /target moved:  -> /);
  assert.match(sandboxMovementLine({
    rebased: true, multiRepository: true,
    repositories: [
      { repository: "root", from: "a", to: "b", rebased: true },
      { repository: "api", from: "c", to: "d", rebased: false }
    ]
  }), /target moved api: c -> d/);
});

test("base-move recording includes only successfully replayed repositories", () => {
  const state = {};
  recordSandboxBaseMove({
    id: "move", state, preDiffIdentity: "before",
    movement: {
      rebased: true,
      repositories: [
        { repository: "root", from: "a", to: "b", rebased: true },
        { repository: "api", from: "c", to: "d", rebased: false }
      ]
    },
    now: () => "now", changeDiffIdentity: () => "after"
  });
  assert.equal(state.lastBaseMove.movementKey, "root:b");
  assert.equal(state.lastBaseMove.postDiffIdentity, "after");
  const unchanged = {};
  recordSandboxBaseMove({ state: unchanged, movement: null });
  assert.equal(unchanged.lastBaseMove, undefined);
});

test("sync reporting renders copy and moved-target conflicts", () => {
  const rows = [];
  reportSandboxSync({
    id: "report", state: { revision: 2 }, forwarded: 1,
    conflicts: ["copy.txt"], relevantHash: () => "hash", log: (row) => rows.push(row),
    movement: {
      rebased: false, multiRepository: true,
      repositories: [{ repository: "api", from: "a", to: "b", rebased: false }],
      conflicts: [{ repository: "api", path: "api.txt" }]
    }
  });
  assert.match(rows.join("\n"), /fast-forwarded: 1 file/);
  assert.match(rows.join("\n"), /CONFLICT copy\.txt/);
  assert.match(rows.join("\n"), /CONFLICT api:api\.txt/);
  reportSandboxSync({
    id: "retry", state: { revision: 1 }, forwarded: 0, conflicts: [],
    relevantHash: () => "hash", log: (row) => rows.push(row),
    movement: {
      rebased: false, multiRepository: false,
      repositories: [{ from: "a", to: "b", rebased: false }], conflicts: []
    }
  });
  assert.match(rows.at(-1), /TARGET MOVED retry/);
});
