import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_SCHEMA,
  claudeReviewerArguments,
  claudeReviewerEnvironment,
  claudeReviewerFailure,
  claudeStructuredReview,
  reviewerSessionIsForbidden,
  runClaudeReviewOperation
} from "../runtime/evidence/configured-reviewer.mjs";

const config = {
  executable: "claude", modelId: "opus", reasoningEffort: "high"
};
const review = {
  status: "pass", summary: "review passed", findings: [],
  verifiedFindingIds: []
};

function envelope(overrides = {}) {
  return JSON.stringify({
    type: "result", subtype: "success", is_error: false,
    session_id: "fresh-session", structured_output: review,
    ...overrides
  });
}

function fixture(result, overrides = {}) {
  const calls = { persisted: [], normalized: [], spawned: [] };
  const context = {
    env: { CLAUDECODE: "nested", KEEP: "yes" },
    uuid: () => "requested-session",
    spawn: (...args) => { calls.spawned.push(args); return result; },
    persist: (...args) => { calls.persisted.push(args); return args[3]; },
    normalizeReview: (...args) => {
      calls.normalized.push(args);
      return { status: "normalized", sessionId: args[4] };
    },
    ...overrides
  };
  return { calls, context };
}

test("Claude environment and arguments isolate the reviewer invocation", () => {
  const source = { CLAUDECODE: "nested", KEEP: "yes" };
  const environment = claudeReviewerEnvironment(source, "change-a");
  assert.deepEqual(environment, { KEEP: "yes", FOUNDATION_CHANGE_ID: "change-a" });
  assert.equal(source.CLAUDECODE, "nested");

  const args = claudeReviewerArguments(config, { schemaVersion: 4 }, "session-a");
  assert.equal(args[args.indexOf("--model") + 1], "opus");
  assert.equal(args[args.indexOf("--effort") + 1], "high");
  assert.equal(args[args.indexOf("--session-id") + 1], "session-a");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.deepEqual(JSON.parse(args[args.indexOf("--json-schema") + 1]),
    REVIEW_SCHEMA);
  assert.match(args.at(-1), /"schemaVersion":4/);
});

test("Claude failure classification preserves envelope and process diagnostics", () => {
  assert.deepEqual(claudeReviewerFailure({ status: 0 }, {
    envelopeError: "missing-result"
  }, ""), {
    status: "error", sessionId: null,
    summary: "Claude Code reviewer returned an invalid event envelope (missing-result)"
  });
  assert.equal(claudeReviewerFailure({ status: 0 }, {
    envelopeError: "conflict"
  }, "session-a").sessionId, "session-a");
  assert.match(claudeReviewerFailure({ status: 0, error: new Error("spawn") },
    null, null).summary, /spawn/);
  assert.match(claudeReviewerFailure({ status: 9, stderr: "denied" },
    null, "session-a").summary, /denied/);
  assert.match(claudeReviewerFailure({ status: 0 }, { is_error: true }, "").summary,
    /status 0/);
  assert.match(claudeReviewerFailure({ status: 0 }, { subtype: "failed" }, "").summary,
    /status 0/);
  assert.equal(claudeReviewerFailure({ status: 0 }, { subtype: "success" }, "x"),
    null);
  assert.equal(claudeReviewerFailure({ status: 0 }, {}, "x"), null);
});

test("Claude review helpers enforce independent sessions and parse all result forms", () => {
  assert.equal(reviewerSessionIsForbidden("", ["session-a"]), false);
  assert.equal(reviewerSessionIsForbidden("SESSION-A", [" session-a "]), true);
  assert.equal(reviewerSessionIsForbidden("session-b", ["session-a", 0]), false);
  assert.equal(claudeStructuredReview({ structured_output: review }), review);
  assert.deepEqual(claudeStructuredReview({ result: review }), review);
  assert.deepEqual(claudeStructuredReview({ result: JSON.stringify(review) }), review);
  assert.equal(claudeStructuredReview({ result: "not-json" }), null);
  assert.equal(claudeStructuredReview(null), null);
});

test("Claude operation persists invalid envelopes with the default timeout", () => {
  const { calls, context } = fixture({
    status: 0, stdout: JSON.stringify({ type: "system", session_id: "session-a" })
  });
  const result = runClaudeReviewOperation(
    context, config, "change-a", "/workspace", {}, []);
  assert.equal(result.status, "error");
  assert.match(result.summary, /missing-result/);
  assert.equal(calls.persisted.length, 1);
  assert.equal(calls.normalized.length, 0);
  const [executable, args, options] = calls.spawned[0];
  assert.equal(executable, "claude");
  assert.equal(args[args.indexOf("--session-id") + 1], "requested-session");
  assert.equal(options.timeout, 45 * 60 * 1000);
  assert.equal(options.cwd, "/workspace");
  assert.equal(options.env.CLAUDECODE, undefined);
});

test("Claude operation rejects reused and missing actual sessions", () => {
  const reused = fixture({ status: 0, stdout: envelope() });
  const reusedResult = runClaudeReviewOperation(
    reused.context, config, "change-a", "/workspace", {}, ["FRESH-SESSION"]);
  assert.match(reusedResult.summary, /reused an implementation session/);
  assert.equal(reused.calls.persisted[0][3].sessionId, "fresh-session");

  const missing = fixture({
    status: 0, stdout: envelope({ session_id: null })
  });
  const missingResult = runClaudeReviewOperation(
    missing.context, config, "change-a", "/workspace", {}, []);
  assert.match(missingResult.summary, /did not return an actual fresh session ID/);
  assert.equal(missing.calls.persisted[0][3].sessionId, null);
});

test("Claude operation normalizes a fresh structured review", () => {
  const custom = { ...config, timeoutMs: "2500" };
  const { calls, context } = fixture({ status: 0, stdout: envelope() });
  const result = runClaudeReviewOperation(
    context, custom, "change-a", "/workspace", { schemaVersion: 4 }, ["old"]);
  assert.deepEqual(result, { status: "normalized", sessionId: "fresh-session" });
  assert.equal(calls.persisted.length, 0);
  assert.equal(calls.spawned[0][2].timeout, 2500);
  assert.deepEqual(calls.normalized[0], [
    custom, "change-a", "/workspace", review, "fresh-session", ["old"],
    { schemaVersion: 4 }
  ]);
});
