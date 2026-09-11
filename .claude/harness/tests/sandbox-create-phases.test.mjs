import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  assertSandboxGroundingPortable,
  applySetupResult,
  carrySandboxIgnoredArtifacts,
  carryableGitMetadata,
  commitSandboxReplay,
  copiedPreexistingDigests,
  copySandboxEntries,
  copyTrackedRootMetadata,
  createSandbox,
  createSandboxRuntime,
  executeSandboxSetupBatch,
  ignoredSandboxPaths,
  inspectSandbox,
  isolateSelectedRepositories,
  missingDependencySetupAdvisory,
  prepareBuildSandbox,
  repairSelectedRepositories,
  reportMultiRepositorySandbox,
  retryFailedSandboxSetups,
  runMeasuredSandboxSetupBatch,
  runSandboxSetupBatch,
  runSandboxSetupCommand,
  sandboxCopyPlan,
  sandboxCopyWorkspace,
  sandboxCreatePreflight,
  showSandboxInspection,
  setupSelectedRepositories,
  unrelatedSandboxTargetChanges
} from "../runtime/workflow/sandbox-runtime.mjs";

const fail = (message) => { throw new Error(message); };

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "sandbox-create-phases-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = join(root, "child-source");
  mkdirSync(child);
  const state = {
    status: "change",
    workspace: {
      mode: "worktree", path: join(root, "root-worktree"), baseHead: "root-base",
      preexisting: { keep: "digest" }
    }
  };
  const calls = {
    cleanupApplied: 0, cleanupRepositories: 0, cleared: 0,
    created: 0, git: [], saved: [], setup: []
  };
  let repositories = [
    { id: "root", mode: "write", path: root },
    { id: "child", mode: "read", path: child, setupCommand: "npm ci" }
  ];
  const context = {
    root,
    policy: () => ({ sandbox: { setupTimeoutMs: 321 } }),
    hostAttestation: { preflight: () => ({ safeForUnattended: true, reasons: [] }) },
    loadRuntime: () => state,
    saveRuntime: (value) => calls.saved.push(structuredClone(value)),
    repositoryCatalog: () => ({ drift: [] }),
    git: (args, path) => {
      calls.git.push({ args, path });
      return { status: 0, stdout: "", stderr: "" };
    },
    gitHead: (path) => path === root ? "root-head" : "child-head",
    canonicalPath: (path) => path,
    porcelainStatusRecords: () => [],
    selectedRepositories: (_id, value) => value?.repositories
      ? Object.entries(value.repositories).map(([id, record]) => ({
        id, workspacePath: record.path
      }))
      : repositories,
    cleanupRepositorySandboxes: () => { calls.cleanupRepositories += 1; },
    cleanupAppliedSandbox: () => { calls.cleanupApplied += 1; },
    clearSnapshotCache: () => { calls.cleared += 1; },
    createSingle: () => { calls.created += 1; },
    runSetupCommand: (record, command, timeout, path, id) => {
      calls.setup.push({ command, timeout, path, id });
      record.setup = { status: "ok" };
    },
    fail,
    ...overrides
  };
  return {
    root, child, state, calls, context,
    repositories: () => repositories,
    setRepositories: (value) => { repositories = value; }
  };
}

function captureConsole(method, run) {
  const prior = console[method];
  const rows = [];
  console[method] = (value) => rows.push(String(value));
  try { return { value: run(), rows }; }
  finally { console[method] = prior; }
}

test("sandbox inspection classifies interactive and unattended execution", () => {
  const workspaceIsolation = {
    kind: "git-worktree", status: "active", drift: "target-moved",
    baseHead: "1234567890", targetHead: "abcdef1234", repositories: []
  };
  const preflight = {
    securityBoundary: { kind: "container", status: "verified" },
    attestation: { issuer: "host" }, boundaryDetected: true,
    safeForUnattended: false, reasons: ["owner mismatch", "attestation stale"]
  };
  const context = {
    workspaceInspection: () => workspaceIsolation,
    hostAttestation: { preflight: () => preflight }
  };
  const interactive = inspectSandbox(context, "change");
  assert.equal(interactive.execution.mode, "interactive");
  assert.equal(interactive.execution.decision, "allow");
  assert.equal(interactive.securityBoundary.kind, "container");
  assert.deepEqual(interactive.attestation, { issuer: "host" });
  const unattended = inspectSandbox(context, "change", { unattended: true });
  assert.equal(unattended.execution.mode, "unattended");
  assert.equal(unattended.execution.decision, "block");
  preflight.safeForUnattended = true;
  assert.equal(inspectSandbox(context, "change", { unattended: true }).execution.decision,
    "allow");
});

test("sandbox inspection output covers text, JSON, drift, reasons, and blocking", () => {
  const result = {
    version: 1, changeId: "change",
    workspaceIsolation: {
      kind: "git-worktree", status: "active", drift: "target-moved",
      baseHead: "1234567890", targetHead: "abcdef1234"
    },
    securityBoundary: { kind: "container", status: "unverified" },
    execution: { safeForUnattended: false, reasons: ["owner mismatch"] }
  };
  const rows = [];
  const runtimeProcess = {};
  let blocked = 0;
  const context = {
    inspect: () => result,
    output: { log: (value) => rows.push(String(value)) },
    markBlocked: () => { blocked += 1; },
    runtimeProcess
  };
  showSandboxInspection(context, "change");
  assert.ok(rows.some((row) => row.includes("target drift: base 12345678")));
  assert.ok(rows.some((row) => row.includes("safe for unattended: no")));
  assert.ok(rows.some((row) => row.includes("reason: owner mismatch")));
  assert.equal(blocked, 0);
  showSandboxInspection(context, "change", { json: true });
  assert.ok(rows.some((row) => row.includes('"changeId": "change"')));
  showSandboxInspection(context, "change", { unattended: true });
  assert.equal(blocked, 1);
  assert.equal(runtimeProcess.exitCode, 1);

  result.workspaceIsolation.drift = "none";
  result.execution.safeForUnattended = true;
  result.execution.reasons = [];
  showSandboxInspection(context, "change", { unattended: true });
  assert.equal(blocked, 1);
});

test("sandbox setup records success and actionable process failures", () => {
  const record = {};
  const warnings = [];
  let result = { status: 0, stdout: "", stderr: "" };
  const context = {
    spawn: () => result,
    output: { error: (value) => warnings.push(String(value)) }
  };
  assert.deepEqual(runSandboxSetupCommand(
    context, record, "npm ci", 1000, "/workspace", null
  ), { command: "npm ci", status: "ok", exitCode: 0 });
  assert.deepEqual(warnings, []);

  result = {
    status: null, error: { code: "ETIMEDOUT" },
    stdout: "one\ntwo\nthree\nfour\nfive\nsix", stderr: "seven"
  };
  assert.equal(runSandboxSetupCommand(
    context, record, "npm ci", 1000, "/workspace", "api"
  ).exitCode, null);
  assert.match(warnings[0], /for 'api' \(ETIMEDOUT\)/);
  assert.doesNotMatch(warnings[0], /one|two/);
  assert.match(warnings[0], /three[\s\S]*seven/);

  result = { status: 2, stdout: "", stderr: "install failed" };
  runSandboxSetupCommand(context, record, "npm ci", 1000, "/workspace", null);
  assert.match(warnings[1], /\(exit 2\)/);
  assert.equal(record.setup.status, "failed");
});

test("sandbox setup batch runs independent commands concurrently within capacity", (t) => {
  const markers = mkdtempSync(join(tmpdir(), "sandbox-setup-batch-"));
  t.after(() => rmSync(markers, { recursive: true, force: true }));
  const first = join(markers, "first");
  const second = join(markers, "second");
  const rows = runSandboxSetupBatch([
    {
      command: `touch '${first}'; while [ ! -e '${second}' ]; do sleep 0.01; done`,
      cwd: process.cwd(), timeoutMs: 1000
    },
    {
      command: `touch '${second}'; while [ ! -e '${first}' ]; do sleep 0.01; done`,
      cwd: process.cwd(), timeoutMs: 1000
    }
  ], 2);
  assert.deepEqual(rows.map((row) => row.result.status), [0, 0]);
});

test("sandbox setup batch runner surfaces worker failures", () => {
  assert.throws(() => executeSandboxSetupBatch({
    executable: "node",
    spawn: () => ({ status: 1, stderr: "worker crashed" })
  }, "unused", []), /parallel sandbox setup runner failed: worker crashed/);
});

test("sandbox setup batch bounds captured output per job", () => {
  const [row] = runSandboxSetupBatch([{
    command: `node -e "process.stdout.write('x'.repeat(70000))"`,
    // This checks truncation, not startup latency under the shared suite pool.
    cwd: process.cwd(), timeoutMs: 10000
  }]);
  assert.equal(row.result.status, 0);
  assert.equal(row.result.stdout.length, 65536);
});

test("measured sandbox setup reports bounded waves", () => {
  const events = [];
  const rows = runMeasuredSandboxSetupBatch({
    policy: () => ({ execution: { maxParallelSetups: 2 } }),
    recordScheduler: (event) => events.push(event)
  }, [
    { command: "true", cwd: process.cwd(), timeoutMs: 1000 },
    { command: "true", cwd: process.cwd(), timeoutMs: 1000 },
    { command: "true", cwd: process.cwd(), timeoutMs: 1000 }
  ]);
  assert.deepEqual(rows.map((row) => row.wave), [1, 1, 2]);
  assert.deepEqual(events.map((event) => [event.readyNodes, event.executedNodes]),
    [[3, 2], [1, 1]]);
});

test("ignored artifact carry skips failures, existing targets, and unmovable entries", () => {
  const actions = [];
  let listStatus = 1;
  const context = {
    git: () => ({ status: listStatus, stdout: "cache/\0exists/\0broken/\0" }),
    pathExists: (path) => path.endsWith("exists/"),
    makeDirectory: (path) => actions.push(["mkdir", path]),
    rename: (from, to) => {
      actions.push(["rename", from, to]);
      if (from.endsWith("broken/")) throw new Error("cross-device");
    }
  };
  carrySandboxIgnoredArtifacts(context, "/source", "/staging");
  assert.deepEqual(actions, []);
  listStatus = 0;
  carrySandboxIgnoredArtifacts(context, "/source", "/staging");
  assert.equal(actions.filter(([kind]) => kind === "rename").length, 2);
  assert.equal(actions.some(([, path]) => path?.includes("exists")), false);
});

function replayFixture(overrides = {}) {
  const calls = { carry: 0, setup: 0, git: [] };
  let removeStatus = 0;
  let moveStatus = 0;
  let statusResult = { status: 0, stdout: " M generated", stderr: "" };
  const repositories = [{
    id: "api", access: "read", setupCommand: "npm ci"
  }];
  const context = {
    carryIgnoredArtifacts: () => { calls.carry += 1; },
    git: (args, path) => {
      calls.git.push({ args, path });
      if (args[1] === "remove")
        return { status: removeStatus, stdout: "", stderr: "remove failed" };
      if (args[1] === "move")
        return { status: moveStatus, stdout: "", stderr: "move failed" };
      return statusResult;
    },
    fail,
    selectedRepositories: () => repositories,
    runSetupCommand: (record) => {
      calls.setup += 1;
      record.setup = { status: "ok" };
    },
    policy: () => ({ sandbox: { setupTimeoutMs: 1000 } }),
    ...overrides
  };
  return {
    context, calls, repositories,
    setRemoveStatus: (value) => { removeStatus = value; },
    setMoveStatus: (value) => { moveStatus = value; },
    setStatusResult: (value) => { statusResult = value; }
  };
}

test("replay commit preserves recovery artifacts and validates worktree replacement", () => {
  const fixture = replayFixture();
  const state = { workspace: { baseHead: "old" } };
  const prepared = {
    movement: { repository: "api", to: "new" },
    record: { path: "/sandbox/api", access: "read" },
    targetPath: "/target/api", staging: "/staging/api", patch: "/patch/api.diff"
  };
  fixture.setRemoveStatus(1);
  assert.throws(() => commitSandboxReplay(fixture.context, "change", state, prepared),
    /cannot replace.*Prepared replay remains/);
  fixture.setRemoveStatus(0);
  fixture.setMoveStatus(1);
  assert.throws(() => commitSandboxReplay(fixture.context, "change", state, prepared),
    /replacement could not be moved/);
  fixture.setMoveStatus(0);
  commitSandboxReplay(fixture.context, "change", state, prepared);
  assert.equal(prepared.record.baseHead, "new");
  assert.equal(prepared.record.setup.status, "failed");
  assert.match(prepared.record.setup.reason, /read-only repository/);
  assert.equal(prepared.movement.rebased, true);
  assert.equal(fixture.calls.setup, 1);

  prepared.movement = { repository: "root", to: "root-new" };
  prepared.record = { path: "/sandbox/root", access: "write" };
  commitSandboxReplay(fixture.context, "change", state, prepared);
  assert.equal(state.workspace.baseHead, "root-new");
  assert.equal(fixture.calls.setup, 1);
});

test("sandbox target dirt excludes owned and unchanged carried-in paths", () => {
  const rows = [
    { status: "??", path: "openspec/changes/change" },
    { status: " M", path: "openspec/changes/change/tasks.md" },
    { status: "??", path: ".foundation" },
    { status: "??", path: ".foundation/cache/data" },
    { status: "??", path: "openspec/changes" },
    { status: "??", path: "openspec/changes/other/proposal.md" },
    { status: " M", path: "carried.txt" },
    { status: " M", path: "changed.txt" },
    { status: " D", path: "missing.txt" },
    { status: " M", path: "unreadable.txt" },
    { status: "??", path: "new.txt" }
  ];
  const state = { workspace: { preexisting: {
    "carried.txt": "same", "changed.txt": "old",
    "missing.txt": "old", "unreadable.txt": "old"
  } } };
  const result = unrelatedSandboxTargetChanges({
    root: "/repo",
    porcelainStatusRecords: () => rows,
    pathExists: (path) => !path.endsWith("missing.txt"),
    fileDigest: (path) => {
      if (path.endsWith("unreadable.txt")) throw new Error("permission denied");
      return path.endsWith("carried.txt") ? "same" : "new";
    }
  }, "change", state, "ignored by fixture");
  assert.deepEqual(result, rows.slice(7));

  assert.deepEqual(unrelatedSandboxTargetChanges({
    root: "/repo", porcelainStatusRecords: () => [{ status: "??", path: "new.txt" }],
    pathExists: () => true, fileDigest: () => "digest"
  }, "change", {}, ""), [{ status: "??", path: "new.txt" }]);
});

test("sandbox grounding validation accepts absent and packet-local evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-grounding-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec", "changes", "change");
  mkdirSync(packet, { recursive: true });
  const evidence = join(packet, "decision.md");
  writeFileSync(evidence, "decision\n");
  const groundingPath = join(packet, "grounding.yaml");
  const state = { groundingRequired: false };
  const context = {
    changePath: () => packet,
    pathExists: existsSync,
    readText: readFileSync,
    selectedRepositories: () => [{ id: "root", path: root, baseHead: "head" }],
    fileDigest: () => "digest",
    gitBuffer: () => ({ status: 0 }),
    fail
  };
  assert.doesNotThrow(() => assertSandboxGroundingPortable(context, "change", state));
  state.groundingRequired = true;
  writeFileSync(groundingPath, "not-json");
  assert.doesNotThrow(() => assertSandboxGroundingPortable(context, "change", state));
  writeFileSync(groundingPath, JSON.stringify({ readSet: [{
    repository: "root", path: "openspec/changes/change/decision.md", sha256: "digest"
  }] }));
  assert.doesNotThrow(() => assertSandboxGroundingPortable(context, "change", state));
});

test("sandbox grounding validation reports unreadable or changed evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-grounding-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec", "changes", "change");
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "grounding.yaml"), JSON.stringify({ readSet: [{
    repository: "root", path: "missing.md", sha256: "expected"
  }] }));
  const context = {
    changePath: () => packet,
    pathExists: existsSync,
    readText: readFileSync,
    selectedRepositories: () => [{ id: "root", path: root, baseHead: "head" }],
    fileDigest: () => { throw new Error("unreadable"); },
    gitBuffer: () => ({ status: 0 }),
    fail
  };
  assert.throws(
    () => assertSandboxGroundingPortable(context, "change", { groundingRequired: true }),
    /root:missing\.md \(working-tree-digest-mismatch\)/
  );
});

test("sandbox create preflight accepts safe targets and selects repositories", (t) => {
  const f = fixture(t);
  const result = sandboxCreatePreflight(f.context, "change", { unattended: true });
  assert.equal(result.initial, f.state);
  assert.deepEqual(result.repositories, f.repositories());
  assert.equal(f.calls.git[0].path, f.root);
});

test("sandbox create preflight rejects unsafe hosts and topology drift", (t) => {
  const unsafe = fixture(t, {
    hostAttestation: { preflight: () => ({
      safeForUnattended: false, reasons: ["owner unknown", "attestation stale"]
    }) }
  });
  assert.throws(
    () => sandboxCreatePreflight(unsafe.context, "change", { unattended: true }),
    /owner unknown; attestation stale/
  );

  const drift = fixture(t, {
    repositoryCatalog: () => ({ drift: [{ path: "vendor/unregistered" }] })
  });
  assert.throws(
    () => sandboxCreatePreflight(drift.context, "change"),
    /unregistered submodule.*vendor\/unregistered/s
  );
});

test("sandbox create preflight rejects only untracked investigation notes", (t) => {
  const rows = [
    { status: " M", path: "openspec/investigations/tracked.md" },
    { status: "??", path: "notes/other.md" },
    { status: "??", path: "openspec/investigations/race.md" }
  ];
  const f = fixture(t, { porcelainStatusRecords: () => rows });
  assert.throws(
    () => sandboxCreatePreflight(f.context, "change"),
    /untracked investigation note.*race\.md/s
  );

  const failedStatus = fixture(t, {
    git: () => ({ status: 128, stdout: "ignored", stderr: "not a repository" }),
    porcelainStatusRecords: () => { throw new Error("must not parse"); }
  });
  assert.doesNotThrow(() => sandboxCreatePreflight(failedStatus.context, "change"));
});

test("repository isolation records root and child worktrees", (t) => {
  const f = fixture(t);
  f.state.workspace.baseHead = "";
  isolateSelectedRepositories(f.context, "change", f.state, f.repositories());
  assert.deepEqual(f.state.repositories.root, {
    mode: "worktree", path: f.state.workspace.path, targetPath: f.root,
    baseHead: "root-head", access: "write"
  });
  assert.equal(f.state.repositories.child.baseHead, "child-head");
  assert.equal(f.state.repositories.child.access, "read");
  assert.equal(f.calls.git.at(-1).args[1], "add");
});

test("repository repair recovers a partial binding without recreating work", (t) => {
  const f = fixture(t);
  const expected = join(f.root, ".foundation", "repository-sandboxes",
    "change", "child");
  mkdirSync(expected, { recursive: true });
  f.state.repositories = {
    root: {
      mode: "worktree", path: f.state.workspace.path,
      targetPath: f.root, baseHead: "root-base", access: "write"
    }
  };
  f.context.worktreeOwnedByTarget = () => true;
  f.context.gitHead = (path) => path === expected || path === f.child
    ? "child-head" : "root-head";
  const setup = repairSelectedRepositories(
    f.context, "change", f.state, f.repositories());
  assert.deepEqual(setup.map((repository) => repository.id), ["child"]);
  assert.equal(f.state.repositories.child.path, expected);
  assert.equal(f.state.repositories.child.targetPath, f.child);
  assert.equal(f.state.repositories.child.baseHead, "child-head");
  assert.equal(f.calls.git.some(({ args }) => args[1] === "add"), false);
});

test("repository repair creates a missing canonical worktree", (t) => {
  const f = fixture(t);
  f.state.repositories = {};
  const setup = repairSelectedRepositories(
    f.context, "change", f.state, f.repositories());
  assert.deepEqual(setup.map((repository) => repository.id), ["child"]);
  assert.equal(f.state.repositories.child.baseHead, "child-head");
  assert.equal(f.state.repositories.child.applied, false);
  assert.equal(f.calls.git.some(({ args }) => args[1] === "add"), true);
});

test("repository repair removes only worktrees created by a failed attempt", (t) => {
  const f = fixture(t);
  const broken = join(f.root, "broken-source");
  mkdirSync(broken);
  f.state.repositories = {};
  f.context.gitHead = (path) => path === broken ? null :
    (path === f.root ? "root-head" : "child-head");
  const repositories = [
    ...f.repositories(),
    { id: "broken", mode: "write", path: broken }
  ];
  assert.throws(() => repairSelectedRepositories(
    f.context, "change", f.state, repositories),
  /broken.*not an initialized Git repository.*existing work was preserved/);
  assert.equal("child" in f.state.repositories, false);
  assert.equal(f.calls.git.some(({ args }) => args[1] === "remove"), true);
  assert.equal(f.calls.saved.length, 1);
});

test("repository isolation rolls back an uninitialized repository", (t) => {
  const f = fixture(t);
  f.context.gitHead = (path) => path === f.child ? null : "root-head";
  assert.throws(
    () => isolateSelectedRepositories(f.context, "change", f.state, f.repositories()),
    /not an initialized Git repository.*rolled back/
  );
  assert.equal(f.calls.cleanupRepositories, 1);
  assert.equal(f.calls.cleanupApplied, 1);
  assert.deepEqual(f.state.workspace.preexisting, { keep: "digest" });
  assert.equal(f.state.workspace.mode, "current");
  assert.equal(f.state.status, "change");
  assert.equal("repositories" in f.state, false);
  assert.equal(f.calls.saved.length, 1);
});

test("repository isolation rolls back existing paths and failed worktree adds", (t) => {
  const existing = fixture(t);
  mkdirSync(join(existing.root, ".foundation", "repository-sandboxes", "change", "child"), {
    recursive: true
  });
  assert.throws(
    () => isolateSelectedRepositories(
      existing.context, "change", existing.state, existing.repositories()),
    /repository sandbox already exists.*rolled back/
  );

  const failed = fixture(t);
  failed.context.git = (args) => args[1] === "add"
    ? { status: 1, stdout: "", stderr: "permission denied" }
    : { status: 0, stdout: "", stderr: "" };
  assert.throws(
    () => isolateSelectedRepositories(failed.context, "other", failed.state, failed.repositories()),
    /cannot create sandbox for 'child': permission denied.*rolled back/
  );
});

test("repository setup skips inapplicable records and runs write setup", (t) => {
  const f = fixture(t);
  f.state.repositories = {
    root: { mode: "current", access: "write", path: f.root },
    write: { mode: "worktree", access: "write", path: f.child }
  };
  setupSelectedRepositories(f.context, f.state, [
    { id: "none" },
    { id: "missing", setupCommand: "skip" },
    { id: "root", setupCommand: "skip" },
    { id: "write", setupCommand: "build" }
  ]);
  assert.deepEqual(f.calls.setup, [{
    command: "build", timeout: 321, path: f.child, id: "write"
  }]);
  assert.equal(f.calls.git.length, 0);
});

test("parallel repository setup records and reports command failures", (t) => {
  const f = fixture(t);
  f.state.repositories = {
    child: { mode: "worktree", access: "write", path: f.child }
  };
  const context = {
    ...f.context,
    output: console,
    runSetupBatch: (jobs) => jobs.map((job) => ({
      ...job, result: { status: 2, error: "2", stdout: "", stderr: "install failed" }
    }))
  };
  const output = captureConsole("error", () => setupSelectedRepositories(
    context, f.state, [{ id: "child", setupCommand: "install" }]
  ));
  assert.equal(f.state.repositories.child.setup.status, "failed");
  assert.match(output.rows[0], /exit 2[\s\S]*install failed/);
});

test("setup result retains non-process failures without warning", () => {
  const record = { access: "write" };
  applySetupResult({ git: () => assert.fail("write repositories need no status") }, {
    repository: { id: "child" }, record, command: "install",
    result: { status: null, error: "spawn failed", stdout: "", stderr: "" }
  });
  assert.deepEqual(record.setup, {
    command: "install", status: "failed", exitCode: null
  });

  const warnings = captureConsole("error", () => applySetupResult({
    git: () => assert.fail("write repositories need no status")
  }, {
    repository: { id: "child" }, record, command: "install",
    result: { status: null, error: "spawn failed" }
  }, true));
  assert.match(warnings.rows[0], /spawn failed/);
  assert.doesNotMatch(warnings.rows[0], /\n    /);
});

test("parallel repository setup validates successful read-only worktrees", (t) => {
  const f = fixture(t);
  f.state.repositories = {
    child: { mode: "worktree", access: "read", path: f.child }
  };
  const context = {
    ...f.context,
    runSetupBatch: (jobs) => jobs.map((job) => ({
      ...job, result: { status: 0, error: null, stdout: "", stderr: "" }
    })),
    git: () => ({ status: 0, stdout: "", stderr: "" })
  };
  setupSelectedRepositories(context, f.state,
    [{ id: "child", setupCommand: "install" }]);
  assert.deepEqual(f.state.repositories.child.setup, {
    command: "install", status: "ok", exitCode: 0
  });
});

test("failed setup retry batches only failed child records", () => {
  const state = {
    workspace: { path: "/root", setup: { status: "ok" } },
    repositories: {
      api: { path: "/api", access: "write", setup: { status: "failed" } },
      ready: { path: "/ready", access: "write", setup: { status: "ok" } }
    }
  };
  const saved = [];
  const attempted = retryFailedSandboxSetups({
    loadRuntime: () => state,
    saveRuntime: (value) => saved.push(value),
    selectedRepositories: () => [
      { id: "root" }, { id: "api", setupCommand: "install" },
      { id: "ready", setupCommand: "install" }
    ],
    policy: () => ({ sandbox: { setupTimeoutMs: 100 } }),
    runSetupCommand: () => assert.fail("batch path expected"),
    runSetupBatch: (jobs) => jobs.map((job) => ({
      ...job, result: { status: 0, error: null, stdout: "", stderr: "" }
    })),
    git: () => ({ status: 0, stdout: "", stderr: "" })
  }, "change", state);
  assert.deepEqual(attempted, ["api"]);
  assert.equal(state.repositories.api.setup.status, "ok");
  assert.equal(saved.length, 1);
});

test("read-only setup reports dirty output and git failures", (t) => {
  const dirty = fixture(t);
  dirty.state.repositories = {
    child: { mode: "worktree", access: "read", path: dirty.child }
  };
  dirty.context.git = () => ({ status: 0, stdout: " M lockfile\n", stderr: "" });
  const first = captureConsole("error", () => setupSelectedRepositories(
    dirty.context, dirty.state, [{ id: "child", setupCommand: "install" }]
  ));
  assert.match(first.rows[0], /M lockfile/);
  assert.deepEqual(dirty.state.repositories.child.setup, {
    status: "failed", reason: "setup modified a read-only repository"
  });

  const failed = fixture(t);
  failed.state.repositories = {
    child: { mode: "worktree", access: "read", path: failed.child }
  };
  failed.context.git = () => ({ status: 1, stdout: "", stderr: "" });
  const second = captureConsole("error", () => setupSelectedRepositories(
    failed.context, failed.state, [{ id: "child", setupCommand: "install" }]
  ));
  assert.match(second.rows[0], /git status failed/);
});

test("multi-repository report resolves workspace paths at call time", (t) => {
  const f = fixture(t);
  f.state.repositories = {
    root: { path: "/sandbox/root" }, child: { path: "/sandbox/child" }
  };
  const output = captureConsole("log", () =>
    reportMultiRepositorySandbox(f.context, "change", f.state));
  assert.deepEqual(output.rows, [
    "MULTI-REPOSITORY SANDBOX change",
    "  root: /sandbox/root",
    "  child: /sandbox/child"
  ]);
});

test("create sandbox keeps the root-only fast path", (t) => {
  const f = fixture(t);
  f.setRepositories([{ id: "root", mode: "write", path: f.root }]);
  createSandbox(f.context, "change");
  assert.equal(f.calls.created, 1);
  assert.equal(f.calls.saved.length, 0);
  assert.equal(f.calls.cleared, 0);
});

test("create sandbox completes the multi-repository lifecycle", (t) => {
  const f = fixture(t);
  const output = captureConsole("log", () => createSandbox(f.context, "change"));
  assert.equal(f.calls.created, 1);
  assert.equal(f.calls.setup.length, 1);
  assert.equal(f.calls.saved.at(-1).status, "building");
  assert.equal(f.calls.cleared, 1);
  assert.match(output.rows[0], /MULTI-REPOSITORY SANDBOX change/);

  const all = fixture(t);
  all.setRepositories([{ id: "root", mode: "write", path: all.root }]);
  captureConsole("log", () => createSandbox(all.context, "change", { all: true }));
  assert.equal(all.calls.saved.at(-1).status, "building");
});

test("create sandbox repairs an existing partial repository topology", (t) => {
  const f = fixture(t);
  const expected = join(f.root, ".foundation", "repository-sandboxes",
    "change", "child");
  mkdirSync(expected, { recursive: true });
  f.state.repositories = { root: {
    mode: "worktree", path: f.state.workspace.path, targetPath: f.root,
    baseHead: "root-base", access: "write"
  } };
  f.context.worktreeOwnedByTarget = () => true;
  f.context.selectedRepositories = () => f.repositories();
  f.context.gitHead = (path) => path === expected || path === f.child
    ? "child-head" : "root-head";
  captureConsole("log", () => createSandbox(f.context, "change"));
  assert.equal(f.state.repositories.child.path, expected);
  assert.equal(f.calls.setup.length, 1);
  assert.equal(f.calls.saved.at(-1).status, "building");
});

test("prepareBuild repairs an incomplete child repository before execution", () => {
  const calls = [];
  const context = {
    loadRuntime: () => ({ status: "building", workspace: { path: "/sandbox/root" } }),
    validate: () => calls.push("validate"),
    workspaceInspection: () => ({
      status: "active",
      repositories: [
        { id: "root", status: "missing-record" },
        { id: "api", status: "missing-record" }
      ]
    }),
    create: (...args) => calls.push(["create", ...args]),
    retryFailedSetups: (...args) => calls.push(["retry", ...args])
  };
  assert.deepEqual(prepareBuildSandbox(context, "change"), { repaired: true });
  assert.deepEqual(calls, [
    ["create", "change", { quiet: true }],
    ["retry", "change"]
  ]);
});

test("prepareBuild reuses a complete building sandbox", () => {
  const calls = [];
  const context = {
    loadRuntime: () => ({ status: "building", workspace: { path: "/sandbox/root" } }),
    validate: () => calls.push("validate"),
    workspaceInspection: () => ({
      status: "active", repositories: [{ id: "api", status: "active" }]
    }),
    create: () => calls.push("create"),
    retryFailedSetups: (...args) => calls.push(["retry", ...args])
  };
  assert.deepEqual(prepareBuildSandbox(context, "change"), { repaired: false });
  assert.deepEqual(calls, [["retry", "change"]]);
});

test("prepareBuild synchronizes revised agreements before setup and stops on conflicts", () => {
  const calls = [];
  const context = {
    loadRuntime: () => ({ status: "building", workspace: { path: "/sandbox/root" } }),
    workspaceInspection: () => ({ status: "active", repositories: [] }),
    synchronizeAgreement: (id) => calls.push(["sync", id]),
    retryFailedSetups: (id) => calls.push(["setup", id])
  };
  prepareBuildSandbox(context, "change");
  assert.deepEqual(calls, [["sync", "change"], ["setup", "change"]]);
  calls.length = 0;
  context.synchronizeAgreement = () => { throw new Error("packet edits would be lost"); };
  assert.throws(() => prepareBuildSandbox(context, "change"), /packet edits would be lost/);
  assert.deepEqual(calls, []);
});

test("prepareBuild repairs a missing root record in multi-repository state", () => {
  const calls = [];
  const context = {
    loadRuntime: () => ({
      status: "building", workspace: { path: "/sandbox/root" },
      repositories: { api: { path: "/sandbox/api" } }
    }),
    validate: () => assert.fail("building state is already agreed"),
    workspaceInspection: () => ({
      status: "active",
      repositories: [
        { id: "root", status: "missing-record" },
        { id: "api", status: "active" }
      ]
    }),
    create: (...args) => calls.push(["create", ...args]),
    retryFailedSetups: (...args) => calls.push(["retry", ...args])
  };
  assert.deepEqual(prepareBuildSandbox(context, "change"), { repaired: true });
  assert.deepEqual(calls, [
    ["create", "change", { quiet: true }],
    ["retry", "change"]
  ]);
});

test("prepareBuild uses workspace state for a root-only change", () => {
  const calls = [];
  const context = {
    loadRuntime: () => ({ status: "building", workspace: { path: "/sandbox/root" } }),
    validate: () => assert.fail("building state is already agreed"),
    workspaceInspection: () => ({
      status: "active", repositories: [{ id: "root", status: "missing-record" }]
    }),
    create: () => assert.fail("root-only workspace is already active"),
    retryFailedSetups: (...args) => calls.push(args)
  };
  assert.deepEqual(prepareBuildSandbox(context, "change"), { repaired: false });
  assert.deepEqual(calls, [["change"]]);
});

test("copy planning recognizes carryable Git metadata and ignored paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(carryableGitMetadata(root), false);
  writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  assert.equal(carryableGitMetadata(root), false);
  rmSync(join(root, ".git"));
  mkdirSync(join(root, ".git"));
  assert.equal(carryableGitMetadata(root), true);

  let calls = 0;
  assert.deepEqual([...ignoredSandboxPaths(false, root, () => { calls += 1; })], []);
  assert.equal(calls, 0);
  const ignored = ignoredSandboxPaths(true, root, () => ({
    status: 0, stdout: "coverage/\0dist/file.js\0\0"
  }));
  assert.deepEqual([...ignored], ["coverage", "dist/file.js"]);
  assert.deepEqual([...ignoredSandboxPaths(true, root, () => ({ status: 1 }))], []);

  const git = (args) => args.includes("--others")
    ? { status: 0, stdout: "ignored/\0" }
    : { status: 0, stdout: "node_modules/fixture.txt\0src/app.mjs\0" };
  const plan = sandboxCopyPlan({
    root, carriesGit: true, git,
    sandboxCopyExcludedDirs: new Set(["node_modules"]),
    excludedWorkspaceDirs: new Set([".git", "node_modules"])
  });
  assert.equal(plan.excludes("ignored"), true);
  assert.equal(plan.excludes("node_modules"), false);
  assert.equal(plan.excludes("node_modules/fixture.txt"), false);
  assert.equal(plan.excludes("node_modules/untracked.txt"), true);
  assert.equal(plan.excludes("src/app.mjs"), false);

  const noGit = sandboxCopyPlan({
    root, carriesGit: false, git: () => { throw new Error("not called"); },
    sandboxCopyExcludedDirs: new Set(),
    excludedWorkspaceDirs: new Set([".git", "node_modules"])
  });
  assert.deepEqual(noGit.listedPaths, []);
  assert.equal(noGit.excludes(".git/config"), true);
});

test("sandbox tree copy preserves links and removes partial output on failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-tree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "source.txt"), "content\n");
  symlinkSync("source.txt", join(root, "source-link"));
  mkdirSync(join(root, "skip"));
  writeFileSync(join(root, "skip", "ignored.txt"), "ignored\n");
  const destination = join(root, ".foundation", "sandboxes", "ok");
  mkdirSync(destination, { recursive: true });
  copySandboxEntries({
    root, requestedPath: destination,
    plan: {
      excludes: (rel) => rel === ".foundation" || rel === "skip",
      filter: () => true
    }, fail
  });
  assert.equal(readFileSync(join(destination, "source.txt"), "utf8"), "content\n");
  assert.equal(readFileSync(join(destination, "source-link"), "utf8"), "content\n");
  assert.equal(existsSync(join(destination, "skip")), false);

  const failed = join(root, ".foundation", "sandboxes", "failed");
  mkdirSync(failed, { recursive: true });
  assert.throws(() => copySandboxEntries({
    root, requestedPath: failed,
    plan: {
      excludes: (rel) => rel === ".foundation" || rel === "skip",
      filter: () => { throw new Error("disk full"); }
    }, fail
  }), /disk full; partial copy removed/);
  assert.equal(existsSync(failed), false);
});

test("tracked root metadata and preexisting digests carry only existing allowed files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-metadata-"));
  const destination = join(root, "destination");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".foundation"));
  writeFileSync(join(root, ".foundation", "shipped.txt"), "ship\n");
  writeFileSync(join(root, "ordinary.txt"), "ordinary\n");
  copyTrackedRootMetadata(root, destination, [
    ".foundation/shipped.txt", ".workflow/missing.txt", "ordinary.txt"
  ]);
  assert.equal(readFileSync(join(destination, ".foundation", "shipped.txt"), "utf8"),
    "ship\n");
  assert.equal(existsSync(join(destination, "ordinary.txt")), false);

  writeFileSync(join(destination, "good.txt"), "good\n");
  writeFileSync(join(destination, "bad.txt"), "bad\n");
  const digests = copiedPreexistingDigests(destination, {
    "good.txt": "old", "bad.txt": "old", "missing.txt": "old"
  }, (path) => {
    if (path.endsWith("bad.txt")) throw new Error("unreadable");
    return `digest:${readFileSync(path, "utf8").trim()}`;
  });
  assert.deepEqual(digests, { "good.txt": "digest:good" });
  assert.deepEqual(copiedPreexistingDigests(destination, null, () => "digest"), {});
});

test("copy workspace state binds source and sandbox snapshots for Git and no-Git modes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-state-"));
  const path = join(root, "copy");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path);
  writeFileSync(join(path, "pre.txt"), "pre\n");
  const calls = [];
  const input = {
    id: "change", root, path, reason: "dirty", carriesGit: true,
    preexisting: { "pre.txt": "prior" }, gitHead: () => "head",
    workspaceManifest: (workspacePath, id, includeDirty) => {
      calls.push([workspacePath, id, includeDirty]);
      return { workspacePath };
    },
    fileDigest: () => "copied-digest", directoryHash: () => "change-hash",
    changePath: () => join(root, "openspec", "changes", "change"),
    packetManifest: (packet) => ({ packet })
  };
  const carried = sandboxCopyWorkspace(input);
  assert.equal(carried.baseHead, "head");
  assert.equal(carried.git, "carried");
  assert.deepEqual(carried.sandboxPreexisting, { "pre.txt": "copied-digest" });
  assert.equal(carried.changeSourceHash, "change-hash");
  assert.equal(calls.length, 2);
  const absent = sandboxCopyWorkspace({ ...input, carriesGit: false, preexisting: {} });
  assert.equal(absent.baseHead, null);
  assert.equal(absent.git, "absent");
});

function copyRuntimeFixture(t, {
  carriesGit = false, setup = false, status = 0,
  statusOutput = "?? outside.txt\0", worktreeAddStatus = 0
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec", "changes", "change");
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "tasks.md"), "- [ ] task\n");
  writeFileSync(join(root, "source.txt"), "source\n");
  if (carriesGit) {
    mkdirSync(join(root, ".git", "worktrees", "outside"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  }
  const state = { status: "change", workspace: {
    mode: "current", path: root, preexisting: { "source.txt": "old" }
  } };
  const saved = [];
  const gitCalls = [];
  const git = (args) => {
    gitCalls.push(args);
    if (args[0] === "status")
      return { status, stdout: statusOutput, stderr: "status failed" };
    if (args[0] === "worktree" && args[1] === "add") {
      if (worktreeAddStatus === 0) mkdirSync(args[3], { recursive: true });
      return { status: worktreeAddStatus, stdout: "", stderr: "add failed" };
    }
    if (args.includes("--others")) return { status: 0, stdout: "ignored/\0" };
    if (args[0] === "ls-files")
      return { status: 0, stdout: ".git/HEAD\0openspec/changes/change/tasks.md\0source.txt\0" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const runtime = createSandboxRuntime({
    root,
    policy: () => ({ sandbox: setup ? { setupCommand: "true", setupTimeoutMs: 1000 } : {} }),
    excludedWorkspaceDirs: new Set([".git", "node_modules", "ignored"]),
    sandboxCopyExcludedDirs: new Set(["node_modules", "ignored"]),
    hostAttestation: { createChallenge: () => ({}) },
    loadRuntime: () => state, saveRuntime: (value) => saved.push(structuredClone(value)),
    canonicalPath: (value) => value,
    workspaceManifest: (value) => ({ root: value }),
    directoryHash: () => "change-hash",
    fileDigest: (value) => `digest:${readFileSync(value, "utf8").length}`,
    changePath: () => packet,
    gitHead: () => carriesGit ? "head" : null,
    git, gitBuffer: () => ({ status: 0 }),
    porcelainStatusRecords: () => statusOutput
      ? [{ status: "??", path: "outside.txt" }]
      : [],
    selectedRepositories: () => [], cleanupRepositorySandboxes: () => {},
    cleanupAppliedSandbox: () => {}, repositoryCatalog: () => ({ drift: [] }),
    clearSnapshotCache: () => {}, validate: () => {},
    repositorySelectionIdsAt: () => [], contractFingerprint: () => "contract",
    executionFingerprint: () => "execution", taskBlocks: () => [],
    proofPath: () => join(root, "proof.json"), relevantHash: () => "hash",
    now: () => "now", fail
  });
  return { root, state, saved, gitCalls, runtime };
}

test("createSingle records isolated copies with and without carried Git metadata", (t) => {
  const noGit = copyRuntimeFixture(t);
  const first = captureConsole("log", () => noGit.runtime.createSingle("change"));
  assert.equal(noGit.state.workspace.mode, "copy");
  assert.equal(noGit.state.workspace.git, "absent");
  assert.equal(noGit.state.status, "building");
  assert.match(first.rows[0], /git: absent/);
  assert.equal(noGit.saved.length, 1);
  assert.throws(() => noGit.runtime.createSingle("change"), /sandbox already exists/);

  const carried = copyRuntimeFixture(t, { carriesGit: true, setup: true });
  const second = captureConsole("log", () => carried.runtime.createSingle("change"));
  assert.equal(carried.state.workspace.git, "carried");
  assert.equal(carried.state.workspace.baseHead, "head");
  assert.equal(existsSync(join(carried.state.workspace.path, ".git", "worktrees")), false);
  assert.equal(carried.saved.length, 2);
  assert.match(second.rows[0], /setup: ok/);
});

test("createSingle rejects archived changes and Git inspection failures", (t) => {
  const archived = copyRuntimeFixture(t);
  archived.state.status = "archived";
  assert.throws(() => archived.runtime.createSingle("change"), /already archived/);

  const failed = copyRuntimeFixture(t, { carriesGit: true, status: 128 });
  assert.throws(() => failed.runtime.createSingle("change"),
    /cannot inspect target workspace: status failed/);
});

test("createSingle creates clean worktrees and reports add failures", (t) => {
  const failed = copyRuntimeFixture(t, {
    carriesGit: true, statusOutput: "", worktreeAddStatus: 1
  });
  assert.throws(() => failed.runtime.createSingle("change"),
    /cannot create sandbox: add failed/);
  assert.equal(failed.gitCalls.some((args) => args[1] === "prune"), true);

  const clean = copyRuntimeFixture(t, { carriesGit: true, statusOutput: "" });
  const output = captureConsole("log", () => clean.runtime.createSingle("change"));
  assert.equal(clean.state.workspace.mode, "worktree");
  assert.equal(clean.state.workspace.baseHead, "head");
  assert.equal(clean.state.status, "building");
  assert.equal(readFileSync(join(clean.state.workspace.path,
    "openspec", "changes", "change", "tasks.md"), "utf8"), "- [ ] task\n");
  assert.equal(clean.saved.length, 1);
  assert.match(output.rows[0], /SANDBOX change/);
});

// Three consumer Builds started in a worktree without node_modules and spent
// their first turns linking the checkout's install — which the guard refuses —
// before finding `npm ci`. Sandbox creation names that route up front.
test("sandbox creation names sandbox.setupCommand when a lockfile has no setup", () => {
  const present = (files) => (path) => files.some((file) => path.endsWith(`/${file}`));
  const advisory = missingDependencySetupAdvisory({
    root: "/proj", workspace: "/proj/.foundation/sandboxes/x", setupCommand: null,
    pathExists: present(["package-lock.json", "node_modules"])
  });
  assert.match(advisory, /^NOTE: the workspace has no installed dependencies: package-lock\.json is at \/proj and node_modules is installed there/);
  assert.match(advisory, /"sandbox":\{"setupCommand":"npm ci"\}/);
  assert.match(advisory, /`cd \/proj\/\.foundation\/sandboxes\/x && npm ci` once/);
  assert.match(advisory, /linking or copying the checkout's node_modules into the workspace is refused/);
  // The advice follows the lockfile the project pins, quoted the way the
  // guard's own anchor accepts it.
  assert.match(missingDependencySetupAdvisory({
    root: "/proj", workspace: "/my ws/sb", setupCommand: null,
    pathExists: present(["pnpm-lock.yaml"])
  }), /`cd '\/my ws\/sb' && pnpm install --frozen-lockfile` once/);
  // A declared setup command or a project without a lockfile has nothing to add.
  assert.equal(missingDependencySetupAdvisory({
    root: "/proj", workspace: "/proj/sb", setupCommand: "npm ci",
    pathExists: present(["package-lock.json"])
  }), null);
  assert.equal(missingDependencySetupAdvisory({
    root: "/proj", workspace: "/proj/sb", setupCommand: null, pathExists: () => false
  }), null);
});
