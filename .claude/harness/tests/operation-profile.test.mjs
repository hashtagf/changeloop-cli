import assert from "node:assert/strict";
import test from "node:test";

import {
  commandProfile, operationInputFingerprint, operationPhaseRows, sanitizedCommandArgs
} from "../runtime/observability/operation-profile.mjs";

test("v4 phase intervals preserve invocation counts and legacy/corrupt rows remain readable", () => {
  const row = {
    version: 4, operation: "advance", phase: "meta", status: "blocked", durationMs: 500,
    startedAt: "2026-09-07T00:00:00.000Z", finishedAt: "2026-09-07T00:00:00.500Z",
    phaseSpans: [
      { phase: "build", status: "completed", durationMs: 100,
        startedAt: "2026-09-07T00:00:00.000Z", finishedAt: "2026-09-07T00:00:00.100Z" },
      { phase: "prove", status: "blocked", durationMs: 400,
        startedAt: "2026-09-07T00:00:00.100Z", finishedAt: "2026-09-07T00:00:00.500Z" }
    ]
  };
  assert.deepEqual(operationPhaseRows(row), row.phaseSpans);
  assert.equal(commandProfile([row]).totalInvocations, 1);
  assert.equal(commandProfile([row]).observedActiveUnionMs, 500);
  for (const legacy of [{ ...row, version: 3 }, { ...row, phaseSpans: undefined }])
    assert.deepEqual(operationPhaseRows(legacy), [legacy]);
  const corrupt = { ...row, phaseSpans: [null] };
  assert.deepEqual(operationPhaseRows(corrupt), [corrupt]);
  for (const patch of [{ durationMs: null }, { durationMs: 999 },
    { phase: "unknown" }, { startedAt: row.startedAt }]) {
    const bad = { ...row, phaseSpans: [row.phaseSpans[0], { ...row.phaseSpans[1], ...patch }] };
    assert.deepEqual(operationPhaseRows(bad), [bad], "invalid child timing must not replace measured parent timing");
  }
});

test("operation fingerprints are stable while sensitive values are excluded", () => {
  assert.deepEqual(sanitizedCommandArgs([
    "change", "--reason", "customer secret", "--decision-ref", "user-1",
    "--token=secret-token", "--phase", "prove"
  ]), [
    "change", "--reason", "<redacted>", "--decision-ref", "<redacted>",
    "--token=<redacted>", "--phase", "prove"
  ]);
  const input = {
    operation: "proof-readiness",
    values: ["change", "--reason", "one"],
    state: { status: "building", contractRevision: 2 },
    changeDigest: "change-digest",
    foundationConfigDigest: "config",
    projectPolicyDigest: "policy"
  };
  assert.equal(operationInputFingerprint(input), operationInputFingerprint({
    ...input, values: ["change", "--reason", "another"]
  }), "redacted decision prose must not alter or enter the fingerprint");
  assert.notEqual(operationInputFingerprint(input), operationInputFingerprint({
    ...input, changeDigest: "changed"
  }));
  const fullState = {
    status: "proven", schema: "foundation-standard", contractRevision: 3,
    impact: "high", size: "l", coupling: "coupled",
    activeProofRun: { workspaceHash: "proof-hash" },
    workspace: { relevantHash: "workspace-hash" },
    budget: { window: { id: "window", extensionNumber: 2 } }
  };
  const full = operationInputFingerprint({ ...input, state: fullState });
  for (const [field, value] of Object.entries({
    status: "building", schema: "foundation-rapid", contractRevision: 4,
    impact: "low", size: "xs", coupling: "isolated"
  })) assert.notEqual(full, operationInputFingerprint({
    ...input, state: { ...fullState, [field]: value }
  }), field);
  assert.notEqual(full, operationInputFingerprint({
    ...input,
    state: {
      ...fullState, activeProofRun: null,
      workspace: { relevantHash: "workspace-hash" }
    }
  }), "workspace fallback participates in identity");
  assert.notEqual(full, operationInputFingerprint({
    ...input, state: { ...fullState, budget: null }
  }), "missing budget remains a distinct observed input");
  assert.equal(operationInputFingerprint({}), null);
});

test("command profile separates inspections and identifies same-input check candidates", () => {
  const lifecycle = [
    {
      operation: "validate", status: "completed", durationMs: 100,
      inputFingerprint: "same", startedAt: "2026-08-28T00:00:00.000Z",
      finishedAt: "2026-08-28T00:00:00.100Z"
    },
    {
      operation: "validate", status: "completed", durationMs: 80,
      inputFingerprint: "same", startedAt: "2026-08-28T00:00:00.050Z",
      finishedAt: "2026-08-28T00:00:00.130Z"
    },
    {
      operation: "proof-run", status: "completed", durationMs: 200,
      inputFingerprint: "proof", startedAt: "2026-08-28T00:00:01.000Z",
      finishedAt: "2026-08-28T00:00:01.200Z"
    },
    {
      operation: "proof-run", status: "completed", durationMs: 200,
      inputFingerprint: "proof", startedAt: "2026-08-28T00:00:02.000Z",
      finishedAt: "2026-08-28T00:00:02.200Z"
    }
  ];
  const inspections = [{
    operation: "packet", status: "completed", durationMs: 10,
    inputFingerprint: "packet", startedAt: "2026-08-28T00:00:03.000Z",
    finishedAt: "2026-08-28T00:00:03.010Z"
  }];
  const profile = commandProfile(lifecycle, inspections);
  assert.equal(profile.measurement, "measured");
  assert.equal(profile.totalInvocations, 5);
  assert.equal(profile.lifecycleInvocations, 4);
  assert.equal(profile.inspectionInvocations, 1);
  assert.equal(profile.sameInputCheckCandidates, 1);
  assert.equal(profile.candidateDurationMs, 80);
  assert.equal(profile.byCommand.validate.sameInputCheckCandidates, 1);
  assert.equal(profile.byCommand["proof-run"].sameInputCheckCandidates, 0,
    "executions are not called redundant merely because their input matched");
  assert.equal(profile.observedActiveUnionMs, 130 + 200 + 200 + 10);
  assert.equal(profile.topCommands[0].operation, "proof-run");
});

test("command profile keeps missing fingerprints visibly partial", () => {
  const profile = commandProfile([{
    operation: "validate", status: "blocked", durationMs: null
  }]);
  assert.equal(profile.measurement, "partial");
  assert.equal(profile.fingerprintCoverage, 0);
  assert.equal(profile.sameInputCheckCandidates, 0);
  assert.equal(commandProfile().measurement, "unavailable");
});
