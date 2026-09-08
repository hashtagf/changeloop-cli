import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createApplyRuntime } from "../runtime/workflow/apply-runtime.mjs";

const timestamp = "2026-08-26T00:00:00.000Z";
const fail = (message) => { throw new Error(message); };
const quiet = (fn) => {
  const priorLog = console.log;
  const priorError = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return fn(); } finally {
    console.log = priorLog;
    console.error = priorError;
  }
};

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function archiveRuntime(root, state, overrides = {}) {
  return createApplyRuntime({
    root,
    loadRuntime: () => state,
    saveRuntime: () => {},
    changePath: (id) => join(root, "openspec", "changes", id),
    proofPath: (id) => join(root, ".foundation", "proof", `${id}.json`),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    syncClaudeTelemetry: () => {},
    modelUsageRecorded: () => true,
    foundationPolicy: () => ({ telemetry: { requireUsage: false } }),
    verifyAppliedProjection: () => ({ valid: true }),
    cleanupApplyTransaction: () => ({ status: "committed" }),
    cleanupAppliedSandbox: () => ({ status: "removed" }),
    cleanupRepositorySandboxes: () => ({ status: "removed" }),
    recoverPendingApply: () => {},
    landCheck: () => ({ archived: false, state, hash: "workspace-hash" }),
    assertMultiRepositoryArchiveReady: () => {},
    archivedChangeRelativePath: (id) => {
      const relative = join("openspec", "changes", "archive", `2026-08-26-${id}`);
      return existsSync(join(root, relative)) ? relative : null;
    },
    pendingTasks: () => [],
    assertOpenSpecCli: () => {},
    proofAudit: () => ({ valid: true }),
    cleanupChangeLeases: () => {},
    now: () => timestamp,
    fail,
    ...overrides
  });
}

function activeArchiveFixture(id, options = {}) {
  const root = mkdtempSync(join(tmpdir(), `apply-archive-${id}-`));
  const change = join(root, "openspec", "changes", id);
  mkdirSync(change, { recursive: true });
  if (options.delta) write(join(change, "specs", "sample", "spec.md"), options.delta);
  write(join(root, ".foundation", "proof", `${id}.json`),
    JSON.stringify({ proofRunId: "proof-run" }));
  const bin = join(root, "bin");
  const openspec = join(bin, "openspec");
  write(openspec, options.cliFailure ? [
    "#!/bin/sh",
    options.cliFailure === "stdout" ? "echo archive failed" : "echo archive failed >&2",
    "exit 1"
  ].join("\n") : [
    "#!/bin/sh",
    "mkdir -p openspec/changes/archive",
    "mv \"openspec/changes/$2\" \"openspec/changes/archive/2026-08-26-$2\"",
    "echo \"archived $2\""
  ].join("\n"));
  chmodSync(openspec, 0o755);
  const state = {
    status: "proven",
    workspace: {
      mode: options.mode || "direct", baseline: { "app.txt": "before" },
      ...(options.apply ? { apply: { cleanup: { status: "pending" } } } : {})
    },
    ...(options.repositories ? {
      repositories: { root: {} }, repositoryCleanup: null
    } : {})
  };
  let landChecks = 0;
  const runtime = archiveRuntime(root, state, {
    telemetryReadiness: options.telemetry ? () => options.telemetry : null,
    foundationPolicy: () => options.policy || { telemetry: { requireUsage: false } },
    modelUsageRecorded: () => options.modelUsage ?? true,
    proofAudit: () => options.invalidAudit
      ? { valid: false, reason: "audit failed" } : { valid: true },
    cleanupAppliedSandbox: () => options.cleanup || { status: "removed" },
    archiveCheckpoint: options.archiveCheckpoint,
    ...(options.missingArchivePath ? {
      archivedChangeRelativePath: () => null
    } : {}),
    landCheck: () => {
      landChecks += 1;
      if (options.mode === "worktree" && landChecks === 2)
        return { archived: true, state, hash: "workspace-hash" };
      return { archived: false, state, hash: "workspace-hash" };
    }
  });
  return {
    root,
    state,
    run() {
      const priorPath = process.env.PATH;
      process.env.PATH = `${bin}:${priorPath}`;
      try { return quiet(() => runtime.archive(id)); }
      finally { process.env.PATH = priorPath; }
    }
  };
}

test("every archive checkpoint resumes without repeating the destructive move", async (t) => {
  const checkpoints = [
    "before-telemetry-drain", "after-telemetry-drain",
    "before-evidence-snapshot", "after-evidence-snapshot",
    "before-code-apply", "after-code-apply",
    "before-archive-command", "after-archive-command",
    "before-spec-sync-verification", "after-spec-sync-verification",
    "before-final-audit", "after-final-audit", "before-cleanup", "after-cleanup"
  ];
  for (const checkpoint of checkpoints) await t.test(checkpoint, () => {
    let injected = false;
    const id = `fault-${checkpoint}`;
    const fixture = activeArchiveFixture(id, {
      archiveCheckpoint: (observed) => {
        if (!injected && observed === checkpoint) {
          injected = true;
          throw new Error(`injected archive interruption at ${checkpoint}`);
        }
      }
    });
    try {
      assert.throws(() => fixture.run(), new RegExp(checkpoint));
      assert.equal(injected, true);
      fixture.run();
      assert.equal(fixture.state.status, "archived");
      assert.equal(existsSync(join(fixture.root, "openspec", "changes", id)), false);
      assert.equal(existsSync(join(fixture.root, "openspec", "changes", "archive",
        `2026-08-26-${id}`)), true);
      fixture.run();
      assert.equal(fixture.state.status, "archived");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("a crash after archive cannot bypass deferred spec-sync verification", () => {
  let injected = false;
  const delta = `## MODIFIED Requirements\n\n### Requirement: Stable output\nThe system SHALL return the new output.\n\n#### Scenario: New output\n- **WHEN** it runs\n- **THEN** the new output is returned\n`;
  const fixture = activeArchiveFixture("fault-spec-sync", {
    delta,
    archiveCheckpoint: (observed) => {
      if (!injected && observed === "before-spec-sync-verification") {
        injected = true;
        throw new Error("injected before spec verification");
      }
    }
  });
  try {
    write(join(fixture.root, "openspec", "specs", "sample", "spec.md"),
      `# Sample\n\n## Requirements\n\n### Requirement: Stable output\nThe system SHALL return the old output.\n\n#### Scenario: Old output\n- **WHEN** it runs\n- **THEN** the old output is returned\n`);
    assert.throws(() => fixture.run(), /injected before spec verification/);
    assert.equal(fixture.state.status, "archived");
    assert.ok(Array.isArray(fixture.state.specSyncInputs));
    assert.throws(() => fixture.run(), /archived specs do not match the change delta/);
    assert.ok(fixture.state.specSyncViolations.length > 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an archived change resumes every unfinished cleanup exactly once", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-resume-"));
  const state = {
    status: "archived",
    archivedAt: timestamp,
    specSyncViolations: [],
    specSyncInputs: [],
    workspace: {
      mode: "worktree", cleanup: { status: "pending" },
      apply: { cleanup: { status: "pending" } }
    },
    repositories: { root: {} },
    land: {}
  };
  let saves = 0;
  const runtime = archiveRuntime(root, state, {
    saveRuntime: () => { saves += 1; }
  });

  quiet(() => runtime.archive("resume"));

  assert.equal(state.workspace.cleanup.status, "removed");
  assert.equal(state.workspace.apply.cleanup.status, "committed");
  assert.equal(state.repositoryCleanup.status, "removed");
  assert.equal(state.land.status, "sandbox-cleaned");
  assert.equal("specSyncViolations" in state, false);
  assert.equal(saves, 2);
  rmSync(root, { recursive: true, force: true });
});

test("an already-clean archive is a no-op and reports an unknown timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-clean-"));
  const state = { status: "archived", workspace: null };
  let saves = 0;

  quiet(() => archiveRuntime(root, state, {
    saveRuntime: () => { saves += 1; }
  }).archive("clean"));

  assert.equal(saves, 0);
  rmSync(root, { recursive: true, force: true });
});

test("an unresolved archived spec-sync violation still fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-spec-block-"));
  const state = {
    status: "archived", workspace: null,
    specSyncViolations: [{ capability: "sample", requirement: "R", detail: "missing" }]
  };

  assert.throws(() => quiet(() => archiveRuntime(root, state).archive("blocked")),
    /archived specs do not match/);
  rmSync(root, { recursive: true, force: true });
});

test("an interrupted OpenSpec move is recovered without rerunning archive", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-recover-"));
  const id = "recover";
  const archivedRelative = join("openspec", "changes", "archive",
    `2026-08-26-${id}`);
  mkdirSync(join(root, archivedRelative), { recursive: true });
  const state = {
    status: "proven",
    workspace: {
      mode: "direct", applied: true, baseline: { "app.txt": "before" },
      apply: { cleanup: { status: "pending" } }
    },
    repositories: { root: {} },
    land: {}
  };

  quiet(() => archiveRuntime(root, state).archive(id));

  assert.equal(state.status, "archived");
  assert.equal(state.archivedChangePath, archivedRelative);
  assert.equal(state.land.status, "archive-audited");
  assert.equal(state.workspace.cleanup.status, "removed");
  assert.equal(state.workspace.apply.cleanup.status, "committed");
  assert.equal("baseline" in state.workspace, false);
  rmSync(root, { recursive: true, force: true });
});

test("an advisory telemetry sync failure cannot block an archived readiness", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-sync-advisory-"));
  const id = "sync-advisory";
  mkdirSync(join(root, "openspec", "changes", id), { recursive: true });
  const state = { status: "proven", workspace: { mode: "direct" } };

  quiet(() => archiveRuntime(root, state, {
    syncClaudeTelemetry: () => { throw new Error("unreadable transcript"); },
    landCheck: () => ({ archived: true, state, hash: "workspace-hash" })
  }).archive(id));

  assert.equal(state.status, "proven");
  rmSync(root, { recursive: true, force: true });
});

test("interrupted recovery also supports a direct change without repositories", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-recover-simple-"));
  const id = "recover-simple";
  mkdirSync(join(root, "openspec", "changes", "archive", `2026-08-26-${id}`),
    { recursive: true });
  const state = {
    status: "proven", workspace: { mode: "direct", applied: true, baseline: {} }
  };

  quiet(() => archiveRuntime(root, state).archive(id));

  assert.equal(state.status, "archived");
  assert.equal(state.repositoryCleanup, undefined);
  rmSync(root, { recursive: true, force: true });
});

test("a ready direct workspace archives specs and completes cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-archive-happy-"));
  const id = "happy";
  const change = join(root, "openspec", "changes", id);
  mkdirSync(change, { recursive: true });
  write(join(root, ".foundation", "proof", `${id}.json`),
    JSON.stringify({ proofRunId: "proof-run" }));
  const bin = join(root, "bin");
  const openspec = join(bin, "openspec");
  write(openspec, [
    "#!/bin/sh",
    "mkdir -p openspec/changes/archive",
    "mv \"openspec/changes/$2\" \"openspec/changes/archive/2026-08-26-$2\"",
    "echo \"archived $2\""
  ].join("\n"));
  chmodSync(openspec, 0o755);
  const state = {
    status: "proven",
    workspace: { mode: "direct", baseline: { "app.txt": "before" } }
  };
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}:${priorPath}`;
  try {
    quiet(() => archiveRuntime(root, state).archive(id));
  } finally {
    process.env.PATH = priorPath;
  }

  assert.equal(state.status, "archived");
  assert.equal(state.preArchiveWorkspaceHash, "workspace-hash");
  assert.equal(state.land.proofRunId, "proof-run");
  assert.equal(state.land.status, "sandbox-cleaned");
  assert.equal(state.workspace.cleanup.status, "removed");
  assert.equal("baseline" in state.workspace, false);
  assert.equal(existsSync(join(root, state.archivedChangePath)), true);
  rmSync(root, { recursive: true, force: true });
});

test("a worktree archive reapplies before recording advisory telemetry", () => {
  const fixture = activeArchiveFixture("worktree", {
    mode: "worktree",
    telemetry: {
      classification: "not-ingested", reason: "missing", correlatedHosts: [],
      recoveryActions: [{ command: "telemetry import" }]
    }
  });

  fixture.run();

  assert.equal(fixture.state.status, "archived");
  assert.equal(fixture.state.land.telemetry.classification, "not-ingested");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("required incomplete telemetry remains advisory during delivery", () => {
  const fixture = activeArchiveFixture("telemetry-required", {
    telemetry: { classification: "partial", reason: "missing rows" },
    policy: { telemetry: { requireUsage: true } }
  });

  fixture.run();
  assert.equal(fixture.state.status, "archived");
  assert.equal(fixture.state.land.telemetry.classification, "partial");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("required telemetry accepts complete token measurement when cost is unavailable", () => {
  const fixture = activeArchiveFixture("telemetry-token-measured", {
    telemetry: {
      classification: "partial-measurement",
      reason: "partial-measurement",
      measuredDimensions: { tokens: true, cost: false }
    },
    policy: { telemetry: { requireUsage: true } }
  });

  fixture.run();

  assert.equal(fixture.state.status, "archived");
  assert.deepEqual(fixture.state.land.telemetry.measuredDimensions,
    { tokens: true, cost: false });
  rmSync(fixture.root, { recursive: true, force: true });
});

test("a failing OpenSpec command leaves runtime unarchived", () => {
  const fixture = activeArchiveFixture("cli-failure", { cliFailure: true });

  assert.throws(() => fixture.run(), /OpenSpec archive failed/);
  assert.equal(fixture.state.status, "proven");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("an OpenSpec failure reported on stdout is preserved", () => {
  const fixture = activeArchiveFixture("cli-stdout-failure", {
    cliFailure: "stdout"
  });

  assert.throws(() => fixture.run(), /archive failed/);
  assert.equal(fixture.state.status, "proven");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("a successful archive still refuses a failed post-archive proof audit", () => {
  const fixture = activeArchiveFixture("audit-failure", { invalidAudit: true });

  assert.throws(() => fixture.run(), /post-archive proof audit failed/);
  assert.equal(fixture.state.status, "archived");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("finalization records repository and apply cleanup warnings", () => {
  const fixture = activeArchiveFixture("cleanup-warning", {
    repositories: true,
    apply: true,
    missingArchivePath: true,
    cleanup: { status: "failed", reason: "sandbox busy" },
    modelUsage: false
  });

  fixture.run();

  assert.equal(fixture.state.repositoryCleanup.status, "removed");
  assert.equal(fixture.state.workspace.apply.cleanup.status, "committed");
  assert.equal(fixture.state.archivedChangePath, null);
  assert.equal(fixture.state.workspace.cleanup.status, "failed");
  rmSync(fixture.root, { recursive: true, force: true });
});

test("a spec delta that OpenSpec failed to merge is retained for retry", () => {
  const fixture = activeArchiveFixture("spec-failure", { delta: [
    "## ADDED Requirements",
    "### Requirement: Archive contract",
    "The archive MUST preserve the contract.",
    "#### Scenario: Archive runs",
    "- **WHEN** archive runs",
    "- **THEN** the contract remains",
    ""
  ].join("\n") });

  assert.throws(() => fixture.run(), /archived specs do not match/);
  assert.ok(fixture.state.specSyncViolations.length > 0);
  assert.equal(fixture.state.specSyncInputs.length, 1);
  rmSync(fixture.root, { recursive: true, force: true });
});
