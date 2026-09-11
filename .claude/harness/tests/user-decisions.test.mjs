import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agreementIdentity, assertSpecApproval, REVIEW_WINDOW_MS,
  reviewWindowRemaining, reviewWindowError, currentWaivers } from "../runtime/core/user-decisions.mjs";
import { advanceFailureAction, createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import { workspaceCapabilityValue } from "../runtime/core/execution-contract.mjs";

test("spec approval binds semantics and revision, not task completion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "spec-consent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec/changes/demo");
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "proposal.md"), "Change the greeting");
  writeFileSync(join(packet, "tasks.md"), "- [ ] Implement greeting\n");
  const state = { status: "change", specApproval: { required: true } };
  assert.throws(() => assertSpecApproval(root, "demo", state), { code: "SPEC_APPROVAL_REQUIRED" });
  state.specApproval = { required: true, identity: agreementIdentity(root, "demo"), revision: 0 };
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  writeFileSync(join(packet, "tasks.md"), "- [x] Implement greeting\n");
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  writeFileSync(join(packet, "proposal.md"), "Delete the greeting");
  assert.throws(() => assertSpecApproval(root, "demo", state), { code: "SPEC_APPROVAL_REQUIRED" });
  state.status = "building";
  state.contractRevision = 1;
  assert.equal(workspaceCapabilityValue("demo", state).mode, "agreement-only");
});

test("legacy in-flight state needs no invented approval", () => {
  assert.doesNotThrow(() => assertSpecApproval("/missing", "legacy", { status: "building" }));
});

test("one deadline survives retry, fallback, and process resume", () => {
  const start = Date.parse("2026-09-09T00:00:00Z");
  const state = { reviewWindow: { startedAt: new Date(start).toISOString(),
    deadline: new Date(start + REVIEW_WINDOW_MS).toISOString() } };
  assert.equal(reviewWindowRemaining(state, start), 1_800_000);
  assert.equal(reviewWindowRemaining(JSON.parse(JSON.stringify(state)), start + 1_200_000), 600_000);
  assert.equal(reviewWindowRemaining(state, start + 1_800_000), 0);
  assert.equal(reviewWindowRemaining({ reviewWindow: { deadline: "corrupt" } }, start), 0);
  const action = advanceFailureAction("demo", reviewWindowError("demo"), { stage: "prove", through: "archived" });
  assert.equal(action.action, "ASK_USER");
  assert.deepEqual(action.decision.options.map((row) => row.id), ["continue", "land", "pause"]);
});

test("waivers expire on changed product or agreement without rewriting findings", () => {
  const waiver = { capability: "review", reason: "User accepts unreviewed scope",
    binding: { workspaceHash: "a", contractRevision: 2 } };
  const state = { contractRevision: 2, waivers: [waiver] };
  assert.deepEqual(currentWaivers(state, "a"), [waiver]);
  assert.deepEqual(currentWaivers(state, "b"), []);
  assert.deepEqual(currentWaivers({ ...state, contractRevision: 3 }, "a"), []);
  assert.deepEqual(state.waivers, [waiver]);
});

test("resuming an expired review returns a user decision without dispatching work", () => {
  const state = { status: "building", reviewWindow: { deadline: "2026-09-09T00:30:00Z" } };
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    nowMs: () => Date.parse("2026-09-09T00:31:00Z"),
    agentDispatchValue: () => ({ action: "build-complete" }),
    authorityStatusValue: () => ({ requests: [{ type: "review", status: "requested" }] }),
    relevantHash: assert.fail, deliveredAiAttempts: assert.fail,
    readJson: assert.fail, proofAdvancePath: assert.fail, stableHash: assert.fail
  });
  for (let i = 0; i < 2; i++) {
    const action = runtime.advanceValue("demo");
    assert.equal(action.action, "ASK_USER");
    assert.equal(action.boundary, "review-time-exhausted");
  }
  assert.equal(state.reviewWindow.deadline, "2026-09-09T00:30:00Z");
});
