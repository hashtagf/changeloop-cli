import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  assertRecoveredArchiveReadyOperation,
  buildApplyEntriesOperation,
  buildReapplyEntriesOperation,
  createApplyRuntime,
  gitApplyInputsOperation,
  prepareApplyTransactionOperation,
  refreshAppliedProjectionOperation,
  sandboxDiffNamesOperation
} from "../runtime/workflow/apply-runtime.mjs";

const fail = (message) => { throw new Error(message); };

test("sandbox diff names handles empty scopes, git failures, and sorted NUL output", () => {
  assert.deepEqual(sandboxDiffNamesOperation({
    applyPathspec: () => [], git: assert.fail, sandboxBase: () => "base", fail
  }, "change", "/sandbox", {}), []);

  assert.throws(() => sandboxDiffNamesOperation({
    applyPathspec: () => [":(exclude).foundation"],
    git: () => ({ status: 1, stdout: "", stderr: "bad revision" }),
    sandboxBase: () => "base",
    fail
  }, "change", "/sandbox", {}), /cannot inspect sandbox paths: bad revision/);

  const calls = [];
  assert.deepEqual(sandboxDiffNamesOperation({
    applyPathspec: assert.fail,
    git: (args, cwd) => {
      calls.push([args, cwd]);
      return { status: 0, stdout: "z.js\0a.js\0", stderr: "" };
    },
    sandboxBase: () => "base",
    fail
  }, "change", "/sandbox", {}, ["src/**"]), ["a.js", "z.js"]);
  assert.deepEqual(calls[0], [[
    "diff", "--name-only", "-z", "base", "--", "src/**"
  ], "/sandbox"]);
  assert.deepEqual(calls[1], [[
    "ls-files", "--others", "--exclude-standard", "-z", "--", "src/**"
  ], "/sandbox"]);
});

test("sandbox diff discovery includes untracked files without mutating the index", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-apply-inputs-"));
  try {
    const git = (args, cwd = root) => spawnSync("git", args, {
      cwd, encoding: "utf8"
    });
    assert.equal(git(["init", "-q"]).status, 0);
    assert.equal(git(["config", "user.email", "test@example.invalid"]).status, 0);
    assert.equal(git(["config", "user.name", "Foundation Test"]).status, 0);
    writeFileSync(join(root, "tracked.js"), "before\n");
    assert.equal(git(["add", "tracked.js"]).status, 0);
    assert.equal(git(["commit", "-qm", "base"]).status, 0);
    writeFileSync(join(root, "tracked.js"), "after\n");
    writeFileSync(join(root, "new.test.js"), "new\n");
    const indexPath = git(["rev-parse", "--git-path", "index"]).stdout.trim();
    const before = readFileSync(join(root, indexPath));
    const names = sandboxDiffNamesOperation({
      applyPathspec: () => ["*.js"], git, sandboxBase: () => "HEAD", fail
    }, "change", root, {});
    assert.deepEqual(names, ["new.test.js", "tracked.js"]);
    assert.deepEqual(readFileSync(join(root, indexPath)), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function applyContext(overrides = {}) {
  const identities = new Map();
  const modes = new Map();
  const blobs = new Map();
  const kinds = new Map();
  const calls = { git: [], buffers: [], spawn: [] };
  const state = { workspace: { baseHead: "base" }, repositories: {} };
  const context = {
    root: "/target",
    git: (args, cwd) => { calls.git.push([args, cwd]); return { status: 0 }; },
    loadRuntime: () => state,
    sandboxDiffNames: () => ["file.js"],
    pathIdentity: (path) => identities.get(path) ??
      (path.startsWith("/sandbox/") ? "sandbox" : "target"),
    pathMode: (path) => modes.get(path) ?? null,
    lstat: (path) => kinds.has(path) ? {
      isDirectory: () => kinds.get(path) === "directory",
      isSymbolicLink: () => kinds.get(path) === "symlink"
    } : null,
    gitBuffer: (args, cwd) => {
      calls.buffers.push([args, cwd]);
      if (args[0] === "show") return { status: 0, stdout: Buffer.from("base") };
      return { status: 0, stdout: Buffer.from("patch") };
    },
    sandboxBase: () => "base",
    spawn: (...args) => { calls.spawn.push(args); return { status: 0, stderr: "" }; },
    readlink: (path) => blobs.get(path).toString(),
    readFile: (path) => blobs.get(path),
    fail,
    ...overrides
  };
  return { context, identities, modes, blobs, kinds, calls, state };
}

test("git apply inputs accepts paths already projected byte-for-byte", () => {
  const fixture = applyContext();
  fixture.identities.set("/target/file.js", "same");
  fixture.identities.set("/sandbox/file.js", "same");
  fixture.modes.set("/target/file.js", "100644");
  fixture.modes.set("/sandbox/file.js", "100644");

  assert.deepEqual(gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    ["file.js"]);
  assert.equal(fixture.calls.buffers.length, 0);
  assert.equal(fixture.calls.git.length, 0);
});

test("git apply inputs rejects directories and unreadable diffs but permits patchless projection", () => {
  const directory = applyContext();
  directory.kinds.set("/sandbox/file.js", "directory");
  assert.throws(() => gitApplyInputsOperation(directory.context, "change", "/sandbox"),
    /nested repository or directory path\(s\): file\.js/);

  const unreadable = applyContext({
    gitBuffer: () => ({ status: 1, stdout: Buffer.alloc(0) })
  });
  assert.throws(() => gitApplyInputsOperation(unreadable.context, "change", "/sandbox"),
    /cannot inspect sandbox diff/);

  const empty = applyContext({
    gitBuffer: () => ({ status: 0, stdout: Buffer.alloc(0) })
  });
  assert.deepEqual(gitApplyInputsOperation(empty.context, "change", "/sandbox"),
    ["file.js"]);
  assert.equal(empty.calls.spawn.length, 0);
});

test("git apply inputs reports textual conflicts before inspecting target blobs", () => {
  const fixture = applyContext({
    spawn: () => ({ status: 1, stderr: "patch does not apply" })
  });
  assert.throws(() => gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    /sandbox diff conflicts with target: patch does not apply/);
});

test("git apply inputs preserves missing, equal, base-matching, and symlink paths", () => {
  const fixture = applyContext({
    sandboxDiffNames: () => ["missing.js", "equal.js", "base.js", "link.js"]
  });
  fixture.kinds.set("/sandbox/missing.js", "file");
  fixture.blobs.set("/sandbox/missing.js", Buffer.from("new"));

  for (const name of ["equal.js", "base.js"]) {
    fixture.kinds.set(`/target/${name}`, "file");
    fixture.kinds.set(`/sandbox/${name}`, "file");
  }
  fixture.blobs.set("/target/equal.js", Buffer.from("same"));
  fixture.blobs.set("/sandbox/equal.js", Buffer.from("same"));
  fixture.blobs.set("/target/base.js", Buffer.from("base"));
  fixture.blobs.set("/sandbox/base.js", Buffer.from("new"));

  fixture.kinds.set("/target/link.js", "symlink");
  fixture.kinds.set("/sandbox/link.js", "symlink");
  fixture.blobs.set("/target/link.js", Buffer.from("destination"));
  fixture.blobs.set("/sandbox/link.js", Buffer.from("destination"));

  assert.deepEqual(gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    ["missing.js", "equal.js", "base.js", "link.js"]);
  assert.equal(fixture.calls.spawn.length, 1);
});

test("git apply inputs refuses target edits absent from the sandbox base", () => {
  const fixture = applyContext();
  fixture.kinds.set("/target/file.js", "file");
  fixture.kinds.set("/sandbox/file.js", "file");
  fixture.blobs.set("/target/file.js", Buffer.from("local edit"));
  fixture.blobs.set("/sandbox/file.js", Buffer.from("new"));
  fixture.context.gitBuffer = (args) => args[0] === "show"
    ? { status: 1, stdout: Buffer.alloc(0) }
    : { status: 0, stdout: Buffer.from("patch") };

  assert.throws(() => gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    /overwrite uncommitted target edits at: file\.js/);
});

function entryContext(overrides = {}) {
  const manifests = {
    "/target": { "file.js": "base" },
    "/sandbox": { "file.js": "changed" }
  };
  const calls = { head: 0, git: 0 };
  return {
    calls,
    context: {
      root: "/target",
      workspaceManifest: (path) => manifests[path],
      copyCodePaths: () => ["file.js"],
      pathMode: () => "100644",
      assertTargetHeadUnmoved: () => { calls.head += 1; },
      gitApplyInputs: () => { calls.git += 1; return ["git.js"]; },
      safeRootPath: (path) => `/target/${path}`,
      pathIdentity: (path) => `identity:${path}`,
      currentChangeRelativePath: () => "openspec/changes/change",
      changePath: () => "/target/openspec/changes/change",
      fail,
      ...overrides
    },
    manifests
  };
}

test("apply entries build copy and worktree projections and reject invalid modes", () => {
  const copy = entryContext();
  const copyEntries = buildApplyEntriesOperation(copy.context, "change", {
    workspace: { mode: "copy", path: "/sandbox", baseline: { "file.js": "base" } }
  });
  assert.equal(copyEntries[0].path, "file.js");
  assert.equal(copyEntries[0].role, "code");
  assert.equal(copyEntries[1].role, "change-artifacts");

  const conflict = entryContext();
  conflict.manifests["/target"]["file.js"] = "local";
  assert.throws(() => buildApplyEntriesOperation(conflict.context, "change", {
    workspace: { mode: "copy", path: "/sandbox", baseline: { "file.js": "base" } }
  }), /isolated-copy conflict at 'file\.js'/);

  const modeConflict = entryContext({
    pathMode: (path) => path.startsWith("/sandbox/") ? "100755" : "100644"
  });
  modeConflict.manifests["/target"]["file.js"] = "same";
  modeConflict.manifests["/sandbox"]["file.js"] = "same";
  assert.throws(() => buildApplyEntriesOperation(modeConflict.context, "change", {
    workspace: { mode: "copy", path: "/sandbox", baseline: { "file.js": "base" } }
  }), /isolated-copy conflict at 'file\.js'/);

  const noBaseline = entryContext();
  noBaseline.manifests["/target"]["file.js"] = "same";
  noBaseline.manifests["/sandbox"]["file.js"] = "same";
  assert.equal(buildApplyEntriesOperation(noBaseline.context, "change", {
    workspace: { mode: "copy", path: "/sandbox" }
  })[0].path, "file.js");

  const worktree = entryContext();
  const worktreeEntries = buildApplyEntriesOperation(worktree.context, "change", {
    workspace: { mode: "worktree", path: "/sandbox" }
  });
  assert.equal(worktree.calls.head, 1);
  assert.equal(worktree.calls.git, 1);
  assert.equal(worktreeEntries[0].path, "git.js");

  assert.throws(() => buildApplyEntriesOperation(entryContext().context, "change", {
    workspace: { mode: "direct", path: "/sandbox" }
  }), /change has no isolated sandbox/);
});

test("reapply entries preserve prior projection identity and add new owned paths", () => {
  const context = {
    currentChangeRelativePath: () => "change",
    reapplyCodePaths: () => ["old.js", "new.js", "legacy.js"],
    safeRootPath: (path) => `/target/${path}`,
    pathIdentity: (path) => `identity:${path}`,
    pathMode: (path) => `mode:${path}`
  };
  const entries = buildReapplyEntriesOperation(context, "change", {
    workspace: { path: "/sandbox" }
  }, { entries: [
    { path: "old.js", role: "code", after: "prior-old", afterMode: "100755" },
    { path: "legacy.js", after: "prior-legacy" }
  ] });

  assert.deepEqual(entries.map((entry) => entry.path), [
    "change", "legacy.js", "new.js", "old.js"
  ]);
  assert.equal(entries[0].role, "change-artifacts");
  assert.equal(entries[1].before, "prior-legacy");
  assert.equal(entries[1].beforeMode, "mode:/target/legacy.js");
  assert.equal(entries[2].role, "code");
  assert.equal(entries[3].beforeMode, "100755");
});

function transactionContext(overrides = {}) {
  const copies = [];
  const saves = [];
  const context = {
    root: "/target",
    directoryHash: () => "source-hash",
    changePath: () => "/target/change",
    buildApplyEntries: () => [],
    nestedRepositoryPathMatcher: (paths) => (path) => paths.includes(path),
    nestedRepositoryPaths: () => [],
    assertDeletionsAreDeclared: () => {},
    dateNow: () => 123,
    pid: 456,
    applyTransactionRoot: (_id, transactionId) => `/transactions/${transactionId}`,
    makeDirectory: () => {},
    copyPath: (...args) => copies.push(args),
    safeRootPath: (path) => `/target/${path}`,
    readJson: () => ({ proofRunId: "proof" }),
    proofPath: () => "/proof.json",
    stableHash: (value) => JSON.stringify(value),
    now: () => "now",
    saveApplyJournal: (journal) => saves.push(structuredClone(journal)),
    fail,
    ...overrides
  };
  return { context, copies, saves };
}

test("apply transaction preparation validates source, child scope, and records backups", () => {
  assert.throws(() => prepareApplyTransactionOperation(transactionContext({
    directoryHash: () => "changed"
  }).context, "change", {
    workspace: { mode: "copy", path: "/sandbox", changeSourceHash: "source-hash" }
  }), /active change was edited/);

  const child = transactionContext({ nestedRepositoryPaths: () => ["child/file.js"] });
  assert.throws(() => prepareApplyTransactionOperation(child.context, "change", {
    workspace: { mode: "copy", path: "/sandbox", changeSourceHash: "source-hash" }
  }, [{ path: "child/file.js", role: "code", before: null }]),
  /crosses into a child repository/);

  const fixture = transactionContext();
  const journal = prepareApplyTransactionOperation(fixture.context, "change", {
    workspace: { mode: "copy", path: "/sandbox", changeSourceHash: "source-hash" }
  }, [
    { path: "existing.js", role: "code", before: "old", after: "new", afterMode: "100" },
    { path: "new.js", role: "code", before: null, after: "new", afterMode: "100" }
  ]);
  assert.equal(journal.transactionId, "apply-123-456");
  assert.equal(journal.proofRunId, "proof");
  assert.equal(journal.status, "prepared");
  assert.deepEqual(journal.entries.map((entry) => entry.backup), ["backup/0", "backup/1"]);
  assert.deepEqual(fixture.copies, [[
    "/target/existing.js", "/transactions/apply-123-456/backup/0"
  ]]);
  assert.equal(fixture.saves.length, 1);

  const generated = transactionContext({
    buildApplyEntries: () => [{
      path: "generated.js", role: "code", before: null,
      after: "new", afterMode: "100"
    }]
  });
  assert.equal(prepareApplyTransactionOperation(generated.context, "change", {
    workspace: { mode: "copy", path: "/sandbox", changeSourceHash: "source-hash" }
  }).entries[0].path, "generated.js");
});

function refreshContext(overrides = {}) {
  const journal = { entries: [{ path: "file.js", after: "old", afterMode: "old-mode" }] };
  const saved = { journals: [], runtime: [] };
  return {
    journal,
    saved,
    context: {
      transactionJournalPath: () => "/journal.json",
      pathExists: () => true,
      readJson: (path) => path === "/proof.json"
        ? { proofRunId: "new-proof" } : journal,
      pathIdentity: (path) => path.startsWith("/sandbox/") ? "desired" : "desired",
      pathMode: () => "100644",
      safeRootPath: (path) => `/target/${path}`,
      stableHash: (value) => JSON.stringify(value),
      proofPath: () => "/proof.json",
      now: () => "now",
      saveApplyJournal: (value) => saved.journals.push(structuredClone(value)),
      saveRuntime: (value) => saved.runtime.push(structuredClone(value)),
      fail,
      ...overrides
    }
  };
}

test("projection refresh rejects missing/diverged journals and persists verified identity", () => {
  const state = {
    id: "change",
    workspace: { path: "/sandbox", apply: { transactionId: "tx" } }
  };
  assert.throws(() => refreshAppliedProjectionOperation(refreshContext().context, {
    id: "change", workspace: { path: "/sandbox", apply: {} }
  }), /without its transaction journal/);
  assert.throws(() => refreshAppliedProjectionOperation(refreshContext({
    pathExists: () => false
  }).context, state), /without its transaction journal/);
  assert.throws(() => refreshAppliedProjectionOperation(refreshContext({
    pathIdentity: (path) => path.startsWith("/sandbox/") ? "desired" : "diverged"
  }).context, state), /diverged applied path 'file\.js'/);

  const fixture = refreshContext();
  refreshAppliedProjectionOperation(fixture.context, state);
  assert.equal(fixture.journal.after, undefined);
  assert.equal(fixture.journal.entries[0].after, "desired");
  assert.equal(fixture.journal.proofRunId, "new-proof");
  assert.equal(fixture.journal.status, "verified");
  assert.equal(state.workspace.apply.status, "verified");
  assert.equal(fixture.saved.journals.length, 1);
  assert.equal(fixture.saved.runtime.length, 1);
});

function recoveryContext(overrides = {}) {
  return {
    root: "/target",
    proofAudit: () => ({ valid: true }),
    assertMultiRepositoryArchiveReady: () => {},
    verifyAppliedProjection: () => ({ valid: true }),
    pendingTasks: () => [],
    fail,
    ...overrides
  };
}

test("interrupted archive readiness enforces proof, projection, and completed tasks", () => {
  const direct = { workspace: { mode: "direct" } };
  assert.doesNotThrow(() => assertRecoveredArchiveReadyOperation(
    recoveryContext(), "change", direct, "archive/change"));
  assert.throws(() => assertRecoveredArchiveReadyOperation(recoveryContext({
    proofAudit: () => ({ valid: false, reason: "bad signature" })
  }), "change", direct, "archive/change"), /invalid proof: bad signature/);
  assert.throws(() => assertRecoveredArchiveReadyOperation(recoveryContext(), "change", {
    workspace: { mode: "copy", applied: false }
  }, "archive/change"), /never projected the sandbox/);
  assert.throws(() => assertRecoveredArchiveReadyOperation(recoveryContext({
    verifyAppliedProjection: () => ({ valid: false, reason: "changed" })
  }), "change", {
    workspace: { mode: "worktree", applied: true }
  }, "archive/change"), /invalid applied projection: changed/);
  assert.throws(() => assertRecoveredArchiveReadyOperation(recoveryContext({
    pendingTasks: () => [{ id: "task" }]
  }), "change", direct, "archive/change"), /1 implementation task\(s\) remain unchecked/);
});

test("apply runtime factory supports default and explicit telemetry policy dependencies", () => {
  assert.equal(typeof createApplyRuntime({}).archive, "function");
  assert.equal(typeof createApplyRuntime({
    telemetryReadiness: () => ({ classification: "measured" }),
    foundationPolicy: () => ({ telemetry: { requireUsage: true } })
  }).applySandbox, "function");
});
