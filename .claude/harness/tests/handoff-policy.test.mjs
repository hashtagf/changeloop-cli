import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { createHandoffRuntime } from "../runtime/workflow/handoff-runtime.mjs";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const fixture = mkdtempSync(join(tmpdir(), "foundation-handoff-"));
const changeId = "external-operation";
const change = join(fixture, "changes", changeId);
const archivedChange = join(fixture, "changes", "archive", `2026-08-14-${changeId}`);
const state = {
  id: changeId, status: "building", contractRevision: 1,
  workspace: { mode: "current", path: fixture }
};
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (fallback !== undefined) return fallback; throw error; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };
const operation = (overrides = {}) => ({
  id: "H001",
  owner: "devops-platform",
  environment: "dev",
  authority: "AWS role with Secrets Manager write",
  operation: "Populate nova/service/config and activate the deployment",
  timing: "post-land",
  activation: "safe-before-activation",
  evidence: ["tracking-reference", "secret-reference", "deployment-health"],
  runbook: "docs/runbooks/service.md#activate",
  rollback: "Disable the deployment flag and restore the previous secret version",
  claimIds: ["activation-safe"],
  taskIds: ["T001"],
  activationProof: {
    claimId: "activation-safe",
    condition: "The merged deployment remains disabled until DevOps enables it"
  },
  ...overrides
});

try {
  mkdirSync(change, { recursive: true });
  const runtime = createHandoffRuntime({
    root: fixture,
    handoffsRoot: join(fixture, ".foundation", "handoffs"),
    activeChangePath: (_id, current = state) =>
      current.status === "archived" ? archivedChange : change,
    loadRuntime: () => state,
    readJson,
    writeJson,
    stableHash,
    defaultOwner: () => "devops-team",
    now: () => "2026-08-14T12:00:00.000Z",
    fail
  });

  writeJson(join(change, "handoffs.yaml"), { version: 1, operations: [operation()] });
  const validated = runtime.handoffContract(changeId, {
    claimIds: new Set(["activation-safe"]), taskIds: new Set(["T001"])
  });
  assert.equal(validated.operations.length, 1);
  assert.deepEqual(runtime.handoffReadiness(changeId).blocking, ["H001"]);

  writeJson(join(change, "handoffs.yaml"), {
    version: 1, operations: [operation({ owner: undefined })]
  });
  assert.equal(runtime.handoffContract(changeId).operations[0].owner, "devops-team",
    "an omitted owner defaults to the configured team identity");
  writeJson(join(change, "handoffs.yaml"), { version: 1, operations: [operation()] });

  const lockPath = join(fixture, ".foundation", "handoffs", changeId,
    ".mutation.lock");
  writeJson(lockPath, {
    version: 1, pid: process.pid, token: "live-owner",
    acquiredAt: "2026-08-14T00:00:00.000Z"
  });
  const oldLock = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lockPath, oldLock, oldLock);
  assert.throws(() => runtime.recordHandoff(changeId, {
    id: "H001", status: "accepted", actor: "Nok SRE", reference: "OPS-1842"
  }), /handoff mutation already active/,
  "a live owner is never evicted merely because its lock is old");
  rmSync(lockPath, { force: true });

  const priorLog = console.log;
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "accepted", actor: "Nok SRE",
      reference: "OPS-1842"
    });
  } finally { console.log = priorLog; }
  const accepted = runtime.handoffReadiness(changeId);
  assert.equal(accepted.status, "READY_WITH_TRACKED_HANDOFF");
  assert.equal(accepted.operations[0].landBlocking, false);
  assert.equal(accepted.operations[0].landDisposition, "tracked-post-land");

  mkdirSync(archivedChange, { recursive: true });
  writeJson(join(archivedChange, "handoffs.yaml"), {
    version: 1, operations: [operation()]
  });
  state.status = "archived";
  assert.equal(runtime.handoffReadiness(changeId).status,
    "READY_WITH_TRACKED_HANDOFF",
    "the content-bound operator record remains usable after OpenSpec archives the contract");
  state.status = "building";

  writeJson(join(change, "handoffs.yaml"), {
    version: 1, operations: [operation({ owner: "devops-cloud" })]
  });
  const stale = runtime.handoffReadiness(changeId);
  assert.equal(stale.operations[0].validity, "stale");
  assert.equal(stale.operations[0].landBlocking, true);

  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({
      owner: "devops-cloud",
      timing: "pre-land",
      activation: "activation-coupled",
      activationProof: null
    })]
  });
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "accepted", actor: "Mek DevOps",
      reference: "OPS-1843"
    });
  } finally { console.log = priorLog; }
  assert.equal(runtime.handoffReadiness(changeId).operations[0].landBlocking, true,
    "accepted activation-coupled work remains a Land blocker");
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "completed", actor: "Mek DevOps",
      reference: "OPS-1843", evidence: "terraform-run-991,deploy-health-991"
    });
  } finally { console.log = priorLog; }
  assert.equal(runtime.handoffReadiness(changeId).status, "COMPLETE");

  writeFileSync(join(fixture, ".foundation", "handoffs", changeId, "H001.json"),
    "{not-json");
  assert.equal(runtime.handoffReadiness(changeId).operations[0].validity, "invalid",
    "a torn operator record becomes a typed invalid state instead of crashing readiness");

  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({ privateKey: "should-never-be-stored" })]
  });
  assert.throws(() => runtime.handoffContract(changeId), /secret-valued field/);

  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({ runbook: "https://user:password@example.test/runbook" })]
  });
  assert.throws(() => runtime.handoffContract(changeId), /credential material/);

  console.log("handoff policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
