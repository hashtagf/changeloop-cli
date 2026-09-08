import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lifecycleOutcome, lifecycleUserProjection
} from "../runtime/core/lifecycle-outcome.mjs";
import {
  coordinatorAction, createAdvanceRuntime
} from "../runtime/workflow/advance-runtime.mjs";
import { diagnosticExport } from "../runtime/observability/diagnostic-export.mjs";
import { createFeedbackRuntime, readinessProjection } from "../runtime/observability/feedback-runtime.mjs";
import { archivedResumeSource, resumePacketValue } from "../runtime/workflow/resume-packet.mjs";
import { createPacketRuntime } from "../runtime/workflow/packet-runtime.mjs";
import { createReceiptValidity } from "../runtime/evidence/receipt-validity.mjs";
import { reviewEvidenceRecovery } from "../runtime/evidence/proof-readiness.mjs";

const stableHash = (value) => JSON.stringify(value);

test("consumer inspection preserves lifecycle files and resumes amended current context", { timeout: 120_000 }, () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "foundation-resume-inspect-")));
  const project = join(temp, "consumer");
  const env = { ...process.env, CLAUDE_FOUNDATION_PROJECT: project,
    FOUNDATION_TELEMETRY: "0", OPENSPEC_TELEMETRY: "0" };
  const command = (program, args, cwd = project) => execFileSync(program, args, {
    cwd, env, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"]
  });
  const runtime = (...args) => command(process.execPath,
    [join(project, ".claude/harness/foundation.mjs"), ...args]);
  const protectedFiles = () => {
    const rows = [];
    const visit = (path) => {
      let entries;
      try { entries = readdirSync(path, { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile()) rows.push([file,
          createHash("sha256").update(readFileSync(file)).digest("hex")]);
      }
    };
    for (const name of ["runtime", "leases", "receipts", "evidence", "snapshots",
      "instruction-manifests", "authority", "handoffs", "transactions", "plans"])
      visit(join(project, ".foundation", name));
    return rows;
  };
  try {
    mkdirSync(project);
    command("bash", [join(root, "install.sh"), project, "--source", root, "--yes"], root);
    command("git", ["init", "-q"]);
    command("git", ["config", "user.name", "Inspection Test"]);
    command("git", ["config", "user.email", "inspection@example.invalid"]);
    command("git", ["add", "."]);
    command("git", ["commit", "-qm", "fixture"]);
    const requirement = { key: "behavior", capability: "inspection", operation: "added",
      scenario: "When the task runs", outcome: "The local output is verified." };
    const task = { key: "implement", outcome: "Write verified local output.",
      covers: ["behavior"], paths: ["output.txt"], verify: "node -e 'process.exit(0)'" };
    writeFileSync(join(project, ".foundation/draft.json"), JSON.stringify({
      version: 3, id: "inspect-resume", intent: "Verify inspection", why: "Regression fixture",
      impact: "low", coupling: "isolated", size: "s", acceptance: { required: false },
      requirements: [requirement], tasks: [task],
      evidence: { behavior: { capabilities: ["test"] } },
      execution: { version: 1, providers: { test: {
        adapter: "test-discovery", command: ["node", "-e", "process.exit(0)"],
        minimum: 1, reportFormat: "tap", claims: "declared"
      } }, services: {} }
    }));
    runtime("start", join(project, ".foundation/draft.json"));
    runtime("advance", "inspect-resume", "--through", "build");
    const before = protectedFiles();
    const action = JSON.parse(runtime("advance", "inspect-resume", "--inspect"));
    assert.equal(action.action, "EDIT");
    const resumeOutput = runtime("packet", "inspect-resume", "--resume");
    assert.ok(resumeOutput.endsWith("\n"), "resume JSON remains line-oriented");
    const resume = JSON.parse(resumeOutput);
    const feedback = JSON.parse(runtime("feedback", "inspect-resume"));
    const diagnostics = JSON.parse(runtime("feedback", "inspect-resume", "--diagnostics"));
    assert.equal(resume.nextAction.action, action.action);
    assert.equal(resume.frontier.preview[0].id, "T001");
    assert.equal(feedback.readiness.availability, "available");
    assert.equal(diagnostics.privacy, "allowlisted-metadata-only");
    assert.deepEqual(protectedFiles(), before);
    assert.throws(() => runtime("advance", "inspect-resume", "--inspect", "--host-result", "missing.json"),
      /cannot be combined/);
    assert.throws(() => runtime("packet", "inspect-resume", "--resume", "--phase", "build"),
      /cannot be combined/);
    assert.deepEqual(protectedFiles(), before);
    const amendment = {
      version: 1, reason: "New requirement after interruption",
      addRequirements: [{ ...requirement, key: "after-resume" }],
      addTasks: [{ ...task, key: "after-resume", covers: ["after-resume"],
        paths: ["second.txt"], dependsOn: ["implement"] }],
      evidence: { "after-resume": { capabilities: ["test"] } }
    };
    writeFileSync(join(project, ".foundation/amendment.json"), JSON.stringify(amendment));
    runtime("amend", "inspect-resume", join(project, ".foundation/amendment.json"));
    runtime("sandbox", "sync", "inspect-resume");
    const after = JSON.parse(runtime("packet", "inspect-resume", "--resume"));
    assert.equal(after.pendingTaskCount, 2);
    assert.equal(after.frontier.count, 1);
    assert.notEqual(after.sourcePacketDigest, resume.sourcePacketDigest);
    assert.notEqual(after.references["tasks.md"].sha256, resume.references["tasks.md"].sha256);
    assert.equal(after.nextAction.action,
      JSON.parse(runtime("advance", "inspect-resume", "--inspect")).action);
    runtime("agent-acquire", "inspect-resume", "T001", "--owner", "worker-a");
    const leasedBefore = protectedFiles();
    const leasedResume = JSON.parse(runtime("packet", "inspect-resume", "--resume"));
    assert.equal(leasedResume.leases.count, 1);
    assert.equal(leasedResume.nextAction.action, "WAIT");
    assert.equal(leasedResume.nextAction.owner, "harness");
    runtime("feedback", "inspect-resume", "--diagnostics");
    assert.deepEqual(protectedFiles(), leasedBefore);
    runtime("agent-release", "inspect-resume", "T001", "--owner", "worker-a",
      "--lease-id", leasedResume.leases.preview[0].leaseId);
    const current = JSON.parse(runtime("packet", "inspect-resume", "--resume"));
    const workspace = current.workspacePath;
    writeFileSync(join(workspace, "output.txt"), "changed after restart");
    const changed = JSON.parse(runtime("packet", "inspect-resume", "--resume"));
    assert.notEqual(changed.workspaceHash, current.workspaceHash);
    const executionPath = join(workspace, "openspec/changes/inspect-resume/execution.yaml");
    const execution = JSON.parse(readFileSync(executionPath, "utf8"));
    execution.providers.test.minimum = 2;
    writeFileSync(executionPath, JSON.stringify(execution));
    const rewired = JSON.parse(runtime("packet", "inspect-resume", "--resume"));
    assert.notEqual(rewired.references["execution.yaml"].sha256,
      changed.references["execution.yaml"].sha256);
    assert.notEqual(rewired.sourcePacketDigest, changed.sourcePacketDigest);
    command("git", ["commit", "--allow-empty", "-qm", "base moved"]);
    assert.equal(JSON.parse(runtime("packet", "inspect-resume", "--resume")).nextAction.action,
      JSON.parse(runtime("advance", "inspect-resume", "--inspect")).action);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("archived inspection reads the retained packet without accessing a removed workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-archived-packet-"));
  try {
    const archive = join(root, "openspec/changes/archive/change-a");
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "tasks.md"), "- [x] done");
    const runtime = createPacketRuntime({
      ROOT: root, PACKET_SCHEMA_VERSION: 11,
      loadRuntime: () => ({ status: "archived", workspace: { path: "/removed" } }),
      activeChangePath: () => archive,
      taskBlocks: () => [{ id: "T001", done: true }], taskMetadata: (task) => task,
      relevantSnapshot: assert.fail, singleRelevantSnapshot: assert.fail,
      fileDigest: (path) => createHash("sha256").update(readFileSync(path)).digest("hex"),
      stableHash, handoffReadiness: () => ({ status: "COMPLETE" })
    });
    const packet = runtime.inspectionPacketValue("change-a");
    assert.equal(packet.workspaceHash, null);
    assert.equal(packet.pendingTaskCount, 0);
    assert.match(packet.references["tasks.md"].path, /archive/);
    const readiness = readinessProjection(packet);
    assert.equal(readiness.delivered, true);
    assert.equal(readiness.basis, "retained-archive");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("archived resume uses retained references after sandbox cleanup, never fresh workspace claims", () => {
  const packet = archivedResumeSource({
    id: "change-a", version: 11, root: "/project",
    state: { status: "archived", revision: 3, preArchiveWorkspaceHash: "old-hash",
      workspace: { path: "/removed-sandbox", cleanup: { status: "removed" } } },
    tasks: [{ id: "T001", done: true }],
    references: { "tasks.md": { path: "openspec/changes/archive/change-a/tasks.md", sha256: "tasks" } },
    externalOperations: { status: "COMPLETE" }, stableHash
  });
  const value = resumePacketValue({
    packet, action: { action: "DONE", reached: "archived", userState: "DELIVERED" },
    tasks: [{ id: "T001", done: true }], leases: [], stableHash, limit: 16_384
  });
  assert.equal(value.workspaceHash, null);
  assert.equal(value.workspacePath, null);
  assert.equal(value.historicalWorkspaceHash, "old-hash");
  assert.equal(value.evidenceAvailability, "retained-archive");
  assert.equal(value.evidenceReference, "claude-foundation proof audit change-a");
  assert.equal(value.frontier.count, 0);
  assert.equal(value.nextAction.reached, "archived");
  assert.equal(JSON.stringify(value).includes("/removed-sandbox"), false);
});

function fixture({ status = "building", proofCursor = {}, runProof, runLand } = {}) {
  const state = {
    status,
    revision: 1,
    workspace: { path: "/sandbox", mode: "worktree", baseHead: "base" },
    repositories: {}
  };
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    authorityNext: () => [],
    readJson: () => proofCursor,
    proofAdvancePath: () => "/proof.json",
    stableHash,
    proofReadinessValue: () => ({ status: "READY", workspaceHash: "workspace-a" }),
    hasLandGrant: () => Boolean(runLand),
    runProof,
    runLand,
    capture: (operation) => operation(),
    captureAsync: (operation) => operation()
  });
  return { runtime, state };
}

test("resume during partial Land preserves the current route without applying again", () => {
  let calls = 0;
  const { runtime, state } = fixture({
    status: "landing", proofCursor: { status: "PASS", workspaceHash: "workspace-a" },
    runLand: async () => { calls += 1; }
  });
  state.land = { status: "prepared" };
  const action = runtime.advanceValue("change-a", { inspect: true });
  const value = resumePacketValue({
    packet: { version: 11, changeId: "change-a", status: "landing",
      workspaceHash: "workspace-a", pendingTaskCount: 0, providers: [] },
    action, tasks: [], leases: [], stableHash, limit: 16_384
  });
  assert.equal(value.nextAction.action, runtime.advanceValue("change-a", { inspect: true }).action);
  assert.equal(value.nextAction.resume, action.resume || action.next || null);
  assert.notEqual(value.nextAction.userState, "DELIVERED");
  assert.equal(calls, 0);
  assert.equal(state.land.status, "prepared");
});

test("lifecycle outcomes preserve actor compatibility and enforce ownership", () => {
  const value = lifecycleOutcome({ action: "EDIT", actor: "agent" });
  assert.equal(value.owner, "agent");
  assert.equal(value.actor, "agent");
  assert.throws(() => lifecycleOutcome({ action: "EDIT", actor: "harness" }),
    /belong to the agent/);
  assert.throws(() => lifecycleOutcome({
    action: "ASK_USER", actor: "user", boundary: "user-authority",
    decision: { kind: "host-permission" }
  }), /must not be delegated to the user/);
});

test("target completion is not delivery and never runs beyond the requested target", async () => {
  let proofCalls = 0, landCalls = 0;
  for (const target of ["build", "proven", "archived"]) {
    const { runtime } = fixture({
      status: target === "build" ? "building" : target,
      runProof: async () => { proofCalls++; },
      runLand: async () => { landCalls++; }
    });
    const result = await runtime.advanceThrough("change-a", target);
    assert.equal(result.action, "DONE");
    assert.equal(result.completed, true);
    assert.equal(result.reached, target);
    assert.equal(result.userState, target === "archived" ? "DELIVERED" : "TARGET_REACHED");
    assert.equal(result.user.delivered, target === "archived");
    assert.equal(result.user.reached, target);
    assert.equal(result.next, target === "archived" ? null :
      `claude-foundation advance change-a --through ${target === "build" ? "proven" : "archived"}`);
  }
  assert.equal(proofCalls, 0);
  assert.equal(landCalls, 0);
  assert.notEqual(lifecycleUserProjection({ action: "DONE" }).state, "DELIVERED",
    "legacy completion without a verified reached target cannot claim delivery");
});

test("active Build workers and preflight work remain internal waits", () => {
  const base = {
    id: "change-a", state: { status: "building" }, workspaceHash: "workspace-a", stableHash
  };
  for (const input of [
    { dispatch: { action: "wait", activeWorkers: [{ taskId: "T001", leaseId: "live" }] } },
    { dispatch: { action: "build-complete" },
      proofPreflight: { status: "BLOCKED_BY_ACTIVE_WORK", next: [] } }
  ]) {
    const result = coordinatorAction({ ...base, ...input });
    assert.equal(result.action, "WAIT");
    assert.equal(result.owner, "harness");
    assert.equal(result.userState, "WORKING");
  }
  const external = coordinatorAction({ ...base, dispatch: { action: "build-complete" },
    authorityRequests: [{ type: "acceptance", status: "pending", requestId: "A1" }] });
  assert.equal(external.owner, "external");
  assert.equal(external.userState, "WAITING_EXTERNAL");
});

test("review preparation stays internal and preserves actual preflight decisions", async () => {
  const review = reviewEvidenceRecovery("change-a", "review");
  const preflight = { status: "NEEDS_USER_DECISION", workspaceHash: "current", next: [review] };
  const base = { id: "change-a", state: { status: "building" },
    dispatch: { action: "build-complete" }, workspaceHash: "current", stableHash };
  assert.equal(coordinatorAction({ ...base, proofPreflight: preflight }).legacyAction, "RUN_PROOF");
  const decision = { kind: "human-acceptance", summary: "Inspect the result",
    options: [{ id: "accept", outcome: "Accept the result" }, { id: "revise", outcome: "Revise" }] };
  for (const actual of [
    { ...preflight, next: [review, { decision }] },
    { ...preflight, authorityPreflight: { status: "BLOCKED", decision } }
  ]) {
    const action = coordinatorAction({ ...base, proofPreflight: actual });
    assert.equal(action.action, "ASK_USER");
    assert.equal(action.owner, "user");
    assert.deepEqual(action.decision, decision);
  }
  let runs = 0;
  const requests = [];
  const command = "claude-foundation authority run change-a --request review-1";
  const runtime = createAdvanceRuntime({
    loadRuntime: () => base.state,
    agentDispatchValue: () => base.dispatch,
    proofReadinessValue: () => preflight,
    relevantHash: () => "current", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests }),
    authorityNext: () => [{ requestId: "review-1", command }],
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    runProof: async () => {
      runs++;
      requests.push({ requestId: "review-1", type: "review", status: "requested" });
      return { status: "WAITING_EXTERNAL", requests, next: [{ requestId: "review-1", command }] };
    }
  });
  assert.equal((await runtime.advanceThrough("change-a", "build")).reached, "build");
  assert.equal(runs, 0, "partial Build target cannot begin proof or review");
  const prepared = await runtime.advanceThrough("change-a", "proven");
  assert.equal(prepared.legacyAction, "RUN_CONFIGURED_REVIEW");
  assert.equal(prepared.owner, "harness");
  assert.equal(prepared.command, command);
  assert.equal(runs, 1);
  assert.equal((await runtime.advanceThrough("change-a", "proven")).command, command);
  assert.equal(runs, 1, "resume reuses the prepared review request");
});

test("diagnostics retain actual receipt invalidation and reuse reasons", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-diagnostic-validity-"));
  const receipt = join(root, "receipt.json");
  writeFileSync(receipt, "{}");
  const valid = { status: "pass", providerProtocolVersion: "13",
    contractFingerprint: "contract", workspaceHash: "current",
    providerFingerprint: "adapter", inputIdentity: { mode: "declared", fingerprint: "inputs" },
    claims: ["claim"], execution: "harness", artifacts: [{ type: "command-log" }] };
  let value = valid;
  const { receiptValidity } = createReceiptValidity({
    receiptPath: () => receipt, readJson: () => value, providerProtocolVersion: "13",
    receiptPrototypeEvidence: () => false, contractFingerprint: () => "contract",
    providerConfig: () => ({}), providerCapability: () => "test",
    providerWorkspaceHash: () => "current",
    providerInputIdentity: () => ({ mode: "declared", fingerprint: "inputs" }),
    adapterFingerprint: () => "adapter", claimsForProvider: () => [{ id: "claim" }],
    validateArtifact: () => true, relevantHash: () => "current", stableHash
  });
  try {
    for (const [patch, expected] of [
      [{}, "valid"],
      [{ contractFingerprint: "old" }, "contract-stale"],
      [{ providerProtocolVersion: "12" }, "provider-version-stale"],
      [{ providerFingerprint: "old" }, "provider-fingerprint-stale"],
      [{ inputIdentity: { fingerprint: "old" } }, "provider-inputs-stale"],
      [{ workspaceHash: "old" }, "reusable-inputs"],
      [{ claims: [] }, "incomplete-claims"],
      [{ status: "fail" }, "fail"],
      [{ status: "error" }, "error"],
      [{ status: "inconclusive" }, "inconclusive"]
    ]) {
      value = { ...valid, ...patch };
      const row = receiptValidity("change-a", "test");
      assert.equal(row.validity, expected);
      const exported = diagnosticExport({ readiness: { providers: [row] } });
      assert.equal(exported.evidence.providers[0].validity, expected);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("diagnostic export allowlists nested metadata and never exports user-controlled text", () => {
  const secret = "/Users/private person@example.com sk-sensitive";
  const result = diagnosticExport({
    changeId: secret,
    sourceCohort: { runtimeVersion: "3.5.9", contentDigest: "sha256:" + "a".repeat(64),
      scope: secret, protocolBundle: { advanceProtocol: "5", runtimeApi: secret, [secret]: secret } },
    nextAction: { action: "REPAIR", owner: "harness", boundary: secret,
      reason: secret, command: secret, recovery: { type: "RECONFIGURE", alternatives: [secret] } },
    timing: { activeTimeMs: 0, humanWaitMs: null, wallTimeMs: secret },
    readiness: { providers: [{ provider: secret, status: "error", validity: secret }] },
    usageAvailability: { classification: "partial-measurement", recoveryActions: [secret] }
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.sourceCohort.protocolBundle.advanceProtocol, "5");
  assert.equal(result.sourceCohort.protocolBundle.runtimeApi, null);
  assert.equal(result.lifecycle.boundary, null);
  assert.equal(result.timing.activeTimeMs, 0);
  assert.equal(result.timing.humanWaitMs, null);
  assert.equal(result.timing.wallTimeMs, null);
  assert.deepEqual(result.evidence.providers, [{ alias: "provider-1", status: "error", validity: null }]);
});

test("feedback uses current packet validity and unavailable reads stay unavailable", () => {
  let available = true;
  const runtime = createFeedbackRuntime({
    logs: "/missing", evidenceVault: "/missing",
    readJson: () => null, readJsonLines: () => [],
    metricsValue: () => ({}), nextAction: () => ({ action: "REPAIR", owner: "harness" }),
    packetValue: () => {
      if (!available) throw new Error("private error");
      return { status: "building", workspaceHash: "new-code", providers: [
        { provider: "test", status: "pass", validity: "stale" }
      ] };
    },
    output: () => {}
  });
  assert.equal(runtime.feedbackValue("change-a").readiness.providers[0].validity, "stale");
  available = false;
  const result = runtime.showFeedback("change-a", { diagnostics: true });
  assert.equal(JSON.stringify(result).includes("private error"), false);
  assert.equal(result.timing.wallTimeMs, null);
});

test("resume projects current revisions, dependency frontier and live ownership within bounds", () => {
  const input = {
    packet: { version: 11, changeId: "change-a", revision: 2, contractRevision: 3,
      executionRevision: 4, workspaceHash: "after-base-move", packetDigest: "current",
      pendingTaskCount: 2, references: { "design.md": { path: "design.md", sha256: "new" } },
      providers: [{ provider: "test", validity: "stale" }] },
    action: { action: "WAIT", owner: "harness", resume: "advance change-a" },
    tasks: [{ id: "T1", done: true }, { id: "T2", dependsOn: ["T1"] },
      { id: "T3", dependsOn: ["T2"] }],
    leases: [{ taskId: "T2", leaseId: "current-lease", fencingGeneration: 4 }],
    stableHash, limit: 16384
  };
  const resumed = resumePacketValue(input);
  assert.deepEqual(resumed.frontier.preview.map((row) => row.id), ["T2"]);
  assert.equal(resumed.leases.preview[0].fencingGeneration, 4);
  assert.equal(resumed.nextAction.action, "WAIT");
  assert.equal(resumed.workspaceHash, "after-base-move");
  assert.equal(resumed.contractRevision, 3);
  assert.equal(resumed.evidence[0].validity, "stale");
  assert.deepEqual(resumePacketValue(input), resumed, "resume does not invent a new execution");
  input.packet.contractRevision = 4;
  assert.notEqual(resumePacketValue(input).packetDigest, resumed.packetDigest);
  input.packet.repairContext = { findings: [{ message: "long ".repeat(10000) }], attemptDigest: "a" };
  const bounded = resumePacketValue(input);
  assert.equal(bounded.findings.truncated, true);
  assert(Buffer.byteLength(JSON.stringify(bounded)) <= input.limit);
});

test("inspection propagates to dispatch and readiness without running lifecycle work", async () => {
  let actions = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building" }),
    agentDispatchValue: (_id, options) => {
      assert.equal(options.inspect, true);
      return { action: "build-complete" };
    },
    proofReadinessValue: (_id, _stage, options) => {
      assert.equal(options.inspect, true);
      return { status: "READY", workspaceHash: "current" };
    },
    relevantHash: () => "current", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }), readJson: () => ({}),
    proofAdvancePath: () => "/unused", stableHash, output: () => {},
    runProof: () => { actions++; }, runLand: () => { actions++; },
    prepareBuild: () => { actions++; }, recordPhase: () => { actions++; }
  });
  const result = await runtime.showAdvance("change-a", { inspect: true });
  assert.equal(result.action, "RUN_EXTERNAL");
  assert.equal(actions, 0);
  await assert.rejects(runtime.showAdvance("change-a", { inspect: true, through: "proven" }),
    /cannot execute/);
  assert.equal(actions, 0);
});

test("advance consumes a proof repair outcome without rerunning proof", async () => {
  let calls = 0;
  const { runtime } = fixture({
    runProof: async () => {
      calls += 1;
      return {
        status: "ACTION_REQUIRED",
        route: "AUTO_REPAIR",
        next: [{ reason: "fix the current finding" }],
        repairPlan: { digest: "repair-a", tasks: [{ id: "R1" }] }
      };
    }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(calls, 1);
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "agent");
  assert.equal(value.repairPlan.digest, "repair-a");
  assert.equal(value.reason, "fix the current finding");
  assert.equal("command" in value.user, false);
  assert.equal("resume" in value.user, false);
  assert.equal("repairPlan" in value.user, false);
});

test("advance preserves a proof decision returned by a quiet operation", async () => {
  const decision = {
    kind: "repair-no-progress",
    summary: "The same product finding remains",
    options: [
      { id: "revise", outcome: "revise the product contract" },
      { id: "pause", outcome: "preserve the current state" }
    ]
  };
  const { runtime } = fixture({
    runProof: async () => ({
      status: "NEEDS_USER_DECISION", route: "NO_PROGRESS_DECISION", decision
    })
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.owner, "user");
  assert.deepEqual(value.decision, decision);
  assert.deepEqual(value.user.decision.options, decision.options);
});

test("an active proof lock becomes harness-owned working state", async () => {
  let calls = 0;
  const { runtime } = fixture({
    runProof: async () => {
      calls += 1;
      return { status: "IN_PROGRESS", owner: { pid: 42 } };
    }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(calls, 1);
  assert.equal(value.action, "WORKING");
  assert.equal(value.owner, "harness");
  assert.equal(value.userState, "WORKING");
});

test("advance consumes a structured Land decision", async () => {
  const decision = {
    kind: "target-conflict",
    summary: "A delivered path also has a user edit",
    options: [
      { id: "resolve", outcome: "choose the intended merged behavior" },
      { id: "pause", outcome: "leave every target recoverable" }
    ]
  };
  const { runtime } = fixture({
    status: "proven",
    proofCursor: { status: "PASS", workspaceHash: "workspace-a" },
    runLand: async () => ({ status: "BLOCKED", decision })
  });
  const value = await runtime.advanceThrough("change-a", "archived");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.owner, "user");
  assert.deepEqual(value.decision, decision);
});

test("Build never emits an empty edit packet", () => {
  const value = coordinatorAction({
    id: "change-a",
    state: { status: "building", workspace: { path: "/sandbox" } },
    dispatch: { action: "run-in-session", reason: "ready" },
    workspaceHash: "workspace-a",
    stableHash
  });
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "harness");
  assert.equal(value.legacyAction, "REPAIR_BUILD_PLAN");
});

test("model budget decisions reach the coordinator before Build dispatch", () => {
  const decision = {
    kind: "budget-exhausted",
    summary: "The active model budget is exhausted",
    options: [
      { id: "continue", outcome: "authorize another bounded window" },
      { id: "pause", outcome: "preserve the current state" }
    ]
  };
  const value = coordinatorAction({
    id: "change-a",
    state: { status: "building", workspace: { path: "/sandbox" } },
    dispatch: { action: "run-in-session", reason: "ready" },
    workspaceHash: "workspace-a",
    budget: { status: "NEEDS_USER_DECISION", decision },
    stableHash
  });
  assert.equal(value.action, "ASK_USER");
  assert.deepEqual(value.decision, decision);
});

test("Build preparation is re-entered after a setup repair boundary", async () => {
  let preparations = 0;
  const { runtime } = fixture();
  const state = {
    status: "building", revision: 1,
    workspace: { path: "/sandbox", mode: "worktree", baseHead: "base" },
    repositories: {}
  };
  const retrying = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "run-in-session", tasks: ["T1"],
      allowedPaths: ["src/**"] }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    prepareBuild: async () => { preparations += 1; },
    capture: (operation) => operation(),
    captureAsync: (operation) => operation()
  });
  await retrying.advanceThrough("change-a", "build");
  assert.equal(preparations, 1);
  // Keep the original fixture referenced so this test also exercises factory
  // construction with the default optional preparation callback.
  assert(runtime);
});
