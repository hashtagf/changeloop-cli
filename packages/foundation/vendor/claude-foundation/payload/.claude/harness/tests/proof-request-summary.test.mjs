import assert from "node:assert/strict";
import test from "node:test";
import { requestSummary } from "../runtime/evidence/proof-execution-runtime.mjs";

test("proof request summary preserves null and normalizes every absent field", () => {
  assert.equal(requestSummary("change", null), null);
  assert.deepEqual(requestSummary("change", {}), {
    requestId: null,
    type: null,
    provider: null,
    status: null,
    workspaceHash: null,
    expiresAt: null,
    packetDigest: null,
    attemptDigest: null,
    scopeMode: null,
    packetCommand: null,
    statusCommand: null
  });
});

test("proof request summary retains durable identity and emits recovery commands", () => {
  assert.deepEqual(requestSummary("change-a", {
    requestId: "review-123",
    type: "review",
    provider: "reviewer",
    status: "dispatched",
    workspaceHash: "workspace",
    expiresAt: "2026-08-27T00:00:00.000Z",
    packetDigest: "packet",
    dispatch: {
      attemptDigest: "attempt",
      scope: { mode: "delta" }
    }
  }), {
    requestId: "review-123",
    type: "review",
    provider: "reviewer",
    status: "dispatched",
    workspaceHash: "workspace",
    expiresAt: "2026-08-27T00:00:00.000Z",
    packetDigest: "packet",
    attemptDigest: "attempt",
    scopeMode: "delta",
    packetCommand: "claude-foundation authority status change-a --request review-123",
    statusCommand: "claude-foundation authority status change-a --request review-123 --template"
  });
});

test("proof request summary handles dispatch without a scope", () => {
  assert.equal(requestSummary("change", {
    requestId: "request", dispatch: { attemptDigest: "attempt" }
  }).scopeMode, null);
});
