import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  advanceLandOperation, createLandRuntime
} from "../runtime/workflow/land-runtime.mjs";

const HASH = "workspacehash0000000000000000000000000000000000000000000000000000";

test("land advance handles single repositories and multi-repository resume states", async () => {
  const calls = [];
  const dependencies = (states, plan = {}, selected = [{ id: "root" }]) => ({
    loadRuntime: () => states.shift(),
    selectedRepositories: () => selected,
    landCheck: (id) => calls.push(["check", id]),
    archive: (id) => calls.push(["archive", id]),
    resumeLand: (id) => calls.push(["resume", id]),
    landPlanValue: (id) => { calls.push(["plan", id]); return plan; }
  });

  await advanceLandOperation(dependencies([{ repositories: {} }]), "single");
  assert.deepEqual(calls.splice(0), [["check", "single"], ["archive", "single"]]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }, { status: "building" }
  ], {}, [{ id: "root" }, { id: "api" }]), "building");
  assert.deepEqual(calls.splice(0), [["plan", "building"], ["resume", "building"]]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }, { status: "proven" }
  ], { readyToArchive: false }, [{ id: "root" }, { id: "api" }]), "waiting");
  assert.deepEqual(calls.splice(0), [
    ["plan", "waiting"], ["resume", "waiting"], ["plan", "waiting"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }, { status: "proven" }
  ], { readyToArchive: true }, [{ id: "root" }, { id: "api" }]), "ready");
  assert.deepEqual(calls.splice(0), [
    ["plan", "ready"], ["resume", "ready"], ["plan", "ready"],
    ["archive", "ready"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { api: {} } }, { status: "proven" }
  ], { readyToArchive: true }, [{ id: "api" }]), "single-child");
  assert.deepEqual(calls.slice(-4), [
    ["plan", "single-child"], ["resume", "single-child"],
    ["plan", "single-child"], ["archive", "single-child"]
  ]);

  await advanceLandOperation(dependencies([
    { repositories: { root: {}, api: {} } }
  ], { strategy: "workspace-uncommitted" }, [
    { id: "root" }, { id: "api" }
  ]), "local-saga");
  assert.deepEqual(calls.slice(-2), [
    ["plan", "local-saga"], ["archive", "local-saga"]
  ]);
});

test("land check phases preserve every refusal and ready route", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-land-check-phases-"));
  const bin = join(root, "bin");
  const proofs = join(root, "proofs");
  const receipts = join(root, "receipts");
  mkdirSync(bin, { recursive: true });
  mkdirSync(proofs, { recursive: true });
  mkdirSync(receipts, { recursive: true });
  writeFileSync(join(bin, "openspec"), "#!/bin/sh\nprintf '1.7.0\\n'\n");
  chmodSync(join(bin, "openspec"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  let sequence = 0;

  const make = (options = {}) => {
    sequence += 1;
    const id = `land-${sequence}`;
    const providers = options.providers || [];
    const state = {
      id,
      status: "proven",
      impact: "low",
      repositories: {},
      waivers: [],
      ...options.state
    };
    const proof = {
      status: "pass",
      proofRunId: `${id}-proof`,
      workspaceHash: options.hash || HASH,
      receipts: providers.map((provider) => ({ provider, sha256: "digest" })),
      ...options.proof
    };
    const proofFile = join(proofs, `${id}.json`);
    if (!options.proofMissing)
      writeFileSync(proofFile, `${JSON.stringify(proof)}\n`);
    for (const provider of providers)
      writeFileSync(join(receipts, `${id}-${provider}.json`), `${JSON.stringify({
        provenance: { source: options.signedCi ? "signed-ci:test" : "harness-test" }
      })}\n`);
    const written = [];
    const decisions = [];
    const runtime = createLandRuntime({
      root,
      transactions: join(root, "transactions"),
      loadRuntime: () => state,
      saveRuntime: () => {},
      pendingApplyTransactions: () => options.pending || [],
      recoverPendingApply: () => {},
      assertNoDroppedScenarios: () => {},
      blockingDrift: () => options.drift || [],
      proofAudit: () => options.audit || { valid: true },
      proofPath: () => proofFile,
      readJson: (path, fallback = null) => {
        try { return JSON.parse(readFileSync(path, "utf8")); }
        catch { return fallback; }
      },
      writeJson: (path, value) => written.push({ path, value }),
      clearSnapshotCache: () => {},
      relevantHash: () => options.currentHash || HASH,
      requiredProviders: () => providers,
      receiptValidity: (_id, provider) => ({
        validity: options.validity?.[provider] || "valid"
      }),
      fileDigest: () => options.receiptDigest || "digest",
      receiptPath: (_id, provider) => join(receipts, `${id}-${provider}.json`),
      handoffReadiness: () => options.handoffs || {
        operations: [], blocking: [], tracked: [], status: "COMPLETE"
      },
      telemetryReadiness: options.telemetry ? () => options.telemetry : null,
      verifyAppliedProjection: () => options.applied || { valid: true },
      selectedRepositories: () => options.selected || [],
      repositoryById: () => null,
      git: (args) => {
        if (args[0] === "status") return options.dirty || { status: 0, stdout: "", stderr: "" };
        if (args[0] === "rev-parse")
          return options.branch
            ? { status: 0, stdout: `${options.branch}\n`, stderr: "" }
            : { status: 1, stdout: "", stderr: "" };
        return { status: 1, stdout: "", stderr: "" };
      },
      gitHead: (path) => path === root
        ? (options.rootHead || state.workspace?.baseHead || "root-head")
        : (options.targetHead || "dependency-head"),
      ciEvidenceProtocolVersion: 1,
      stableHash: (value) => JSON.stringify(value),
      agentPlanValue: options.graph ? () => ({ graph: options.graph }) : null,
      executionContract: options.executionContract
        ? () => options.executionContract : null,
      now: () => "2026-08-26T00:00:00Z",
      blockWithDecision: (_id, code, decision) => {
        decisions.push({ code, decision });
        throw new Error(`decision:${code}`);
      },
      deliveryObservation: () => options.deliveryObservation || {
        observed: false, paths: [], reason: "target-does-not-match-change-projection"
      },
      fail: (message) => { throw new Error(message); }
    });
    return { id, runtime, state, proof, written, decisions };
  };

  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(String(message));
  try {
    const base = make();
    assert.equal(base.runtime.landCheck(base.id).archived, false);

    const archived = make({ state: { status: "archived", archivedAt: "today" } });
    assert.equal(archived.runtime.landCheck(archived.id).archived, true);
    const archivedBad = make({
      state: { status: "archived" }, audit: { valid: false, reason: "tampered" }
    });
    assert.throws(() => archivedBad.runtime.landCheck(archivedBad.id), /archived proof audit/);

    const recovery = make({ state: { workspace: { recovery: { requiresSync: true } } } });
    assert.throws(() => recovery.runtime.landCheck(recovery.id), /sandbox sync/);
    const pending = make({ pending: [{
      transactionId: "tx-1", status: "applying", appliedPaths: ["a"],
      counts: { update: 1, create: 2, delete: 3 }
    }] });
    assert.throws(() => pending.runtime.landCheck(pending.id), /decision:apply-pending-recovery/);
    const moved = make({
      state: { workspace: { mode: "worktree", applied: false, baseHead: "base" } },
      rootHead: "moved"
    });
    assert.throws(() => moved.runtime.landCheck(moved.id), /decision:control-head-moved/);
    assert.equal(moved.decisions[0].decision.kind, "control-head-moved");
    const delivered = make({
      state: { workspace: { mode: "worktree", applied: false, baseHead: "base" } },
      rootHead: "moved",
      deliveryObservation: { observed: true, paths: ["changed.js"], expectedPathCount: 1 }
    });
    assert.throws(() => delivered.runtime.landCheck(delivered.id), /decision:control-head-moved/);
    assert.equal(delivered.decisions[0].decision.kind, "out-of-band-delivery-drift");
    assert.equal(delivered.decisions[0].decision.authoritative, false);
    assert.equal(delivered.decisions[0].decision.lifecycleStatus, "proven");
    assert.equal(delivered.decisions[0].decision.proofStatus, "unchanged");
    assert.match(delivered.decisions[0].decision.recoveryCommand,
      /sandbox sync land-/);
    const stableWorktree = make({
      state: { workspace: { mode: "worktree", applied: false, baseHead: "base" } },
      rootHead: "base"
    });
    assert.equal(stableWorktree.runtime.landCheck(stableWorktree.id).archived, false);

    const writeDependency = make({ selected: [{ id: "write", mode: "write" }] });
    assert.equal(writeDependency.runtime.landCheck(writeDependency.id).archived, false);
    const unisolated = make({
      state: { repositories: { dep: { mode: "copy", path: "/sandbox" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => unisolated.runtime.landCheck(unisolated.id), /not isolated/);
    const dirty = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }],
      dirty: { status: 0, stdout: " M changed", stderr: "" }
    });
    assert.throws(() => dirty.runtime.landCheck(dirty.id), /changed inside its sandbox/);
    const statusFailed = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }],
      dirty: { status: 1, stdout: "", stderr: "status failed" }
    });
    assert.throws(() => statusFailed.runtime.landCheck(statusFailed.id), /status failed/);
    const statusFailedWithoutDetail = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }],
      dirty: { status: 1, stdout: "", stderr: "" }
    });
    assert.throws(() => statusFailedWithoutDetail.runtime.landCheck(statusFailedWithoutDetail.id),
      /git status failed/);
    const dependencyMoved = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "old-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => dependencyMoved.runtime.landCheck(dependencyMoved.id), /moved after sandbox/);
    const dependencyWithoutRuntime = make({
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => dependencyWithoutRuntime.runtime.landCheck(dependencyWithoutRuntime.id),
      /not isolated/);
    const dependencyWithoutBase = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.throws(() => dependencyWithoutBase.runtime.landCheck(dependencyWithoutBase.id),
      /moved after sandbox/);
    const cleanDependency = make({
      state: { repositories: { dep: { mode: "worktree", path: "/sandbox", baseHead: "dependency-head" } } },
      selected: [{ id: "dep", mode: "read", path: "/target" }]
    });
    assert.equal(cleanDependency.runtime.landCheck(cleanDependency.id).archived, false);

    const missingProof = make({ proofMissing: true });
    assert.throws(() => missingProof.runtime.landCheck(missingProof.id), /no passing proof/);
    const badAudit = make({ audit: { valid: false, reason: "bad audit" } });
    assert.throws(() => badAudit.runtime.landCheck(badAudit.id), /proof audit failed/);
    const stale = make({ currentHash: "different-hash" });
    assert.throws(() => stale.runtime.landCheck(stale.id), /proof is stale/);

    const graph = { identity: "graph-a", revision: "r1" };
    const graphMissing = make({ graph });
    assert.throws(() => graphMissing.runtime.landCheck(graphMissing.id), /graph proof is missing/);
    const graphStale = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "other", graphRevision: "r1", workspaceHash: HASH
    } } });
    assert.throws(() => graphStale.runtime.landCheck(graphStale.id), /graph proof is stale/);
    const graphIncomplete = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredNodes: ["a"], coveredNodes: [], requiredEdges: ["a>b"], coveredEdges: []
    } } });
    assert.throws(() => graphIncomplete.runtime.landCheck(graphIncomplete.id), /graph proof is incomplete/);
    const graphNodesOnly = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredNodes: ["a"], coveredNodes: []
    } } });
    assert.throws(() => graphNodesOnly.runtime.landCheck(graphNodesOnly.id),
      /edges none/);
    const graphEdgesOnly = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredEdges: ["a>b"], coveredEdges: []
    } } });
    assert.throws(() => graphEdgesOnly.runtime.landCheck(graphEdgesOnly.id),
      /nodes none/);
    const graphWithoutCoverageLists = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH
    } } });
    assert.equal(graphWithoutCoverageLists.runtime.landCheck(graphWithoutCoverageLists.id).archived,
      false);
    const graphComplete = make({ graph, proof: { aggregateGraphProof: {
      status: "pass", graphIdentity: "graph-a", graphRevision: "r1", workspaceHash: HASH,
      requiredNodes: ["a"], coveredNodes: ["a"], requiredEdges: ["a>b"], coveredEdges: ["a>b"]
    } } });
    assert.equal(graphComplete.runtime.landCheck(graphComplete.id).archived, false);

    const invalidReceipt = make({ providers: ["test"], validity: { test: "stale" } });
    assert.throws(() => invalidReceipt.runtime.landCheck(invalidReceipt.id), /test evidence is stale/);
    const changedReceipt = make({ providers: ["test"], receiptDigest: "changed" });
    assert.throws(() => changedReceipt.runtime.landCheck(changedReceipt.id), /live receipt differs/);
    const compiled = make({
      providers: ["test"], executionContract: {
        evidence: { providers: ["test"] }, land: { signedCiRequired: false }
      }
    });
    assert.equal(compiled.runtime.landCheck(compiled.id).archived, false);
    const contractProviderMismatch = make({
      providers: ["test"], executionContract: {
        evidence: { providers: ["other"] }, land: { signedCiRequired: false }
      }
    });
    assert.throws(() => contractProviderMismatch.runtime.landCheck(contractProviderMismatch.id),
      /execution contract provider projection disagrees/);
    const signedCi = make({
      providers: ["ci"], signedCi: true,
      state: { riskBasedCiRequired: true, impact: "high" }
    });
    assert.equal(signedCi.runtime.landCheck(signedCi.id).archived, false);
    const missingCi = make({
      providers: ["test"], state: { riskBasedCiRequired: true, impact: "high" }
    });
    assert.throws(() => missingCi.runtime.landCheck(missingCi.id), /requires signed CI/);

    const blockedHandoff = make({ handoffs: {
      blocking: ["op"], tracked: [], status: "WAITING_EXTERNAL",
      operations: [{ id: "op", owner: "ops", environment: "prod", operation: "switch",
        validity: "valid", status: "pending", timing: "post-land", activation: "manual",
        landBlocking: true }]
    } });
    assert.throws(() => blockedHandoff.runtime.landCheck(blockedHandoff.id), /WAITING_EXTERNAL/);
    const invalidApplied = make({
      state: { workspace: { applied: true } }, applied: { valid: false, reason: "projection drift" }
    });
    assert.throws(() => invalidApplied.runtime.landCheck(invalidApplied.id), /projection drift/);
    const validApplied = make({ state: { workspace: { applied: true } } });
    assert.equal(validApplied.runtime.landCheck(validApplied.id).archived, false);
    const drifted = make({ drift: [{
      taskId: "T001", taskKind: "security", requestedTier: "deep",
      actualModel: "fast", reason: "downgrade"
    }] });
    assert.throws(() => drifted.runtime.landCheck(drifted.id), /model tier downgrade/);
    const fallbackDrift = make({ drift: [
      { blockingTasks: ["T002"], requestedTier: "deep", reason: "downgrade" },
      { blockingTasks: [], requestedTier: "standard", reason: "unknown actor" }
    ] });
    assert.throws(() => fallbackDrift.runtime.landCheck(fallbackDrift.id), /T002/);

    const rich = make({
      branch: "main",
      state: { waivers: [{ capability: "review", authority: { reference: "DEC-1" } }] },
      handoffs: { blocking: [], tracked: [], status: "COMPLETE", operations: [{
        id: "post", owner: "ops", reference: "ticket-1",
        landDisposition: "tracked-post-land"
      }] },
      telemetry: {
        classification: "complete",
        recoveryActions: [{ command: "claude-foundation telemetry sync" }]
      }
    });
    assert.equal(rich.runtime.landCheck(rich.id).telemetry.classification, "complete");
    assert.ok(output.some((message) => message.includes("tracked post-Land handoff")));
    assert.ok(output.some((message) => message.includes("branch: main")));
    assert.ok(output.some((message) => message.includes("telemetry: complete")));

    const multi = make({
      state: { repositories: { a: {}, b: {} } },
      selected: [{ id: "a" }, { id: "b" }]
    });
    assert.equal(multi.runtime.landCheck(multi.id).archived, false);
    assert.equal(multi.written.length, 1);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }
});
