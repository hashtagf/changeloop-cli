import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  realpathSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REVIEW_SCHEMA, createConfiguredReviewerRuntime } from
  "../runtime/evidence/configured-reviewer.mjs";
import { createRuntimeEnvironment } from
  "../runtime/core/runtime-environment.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-configured-reviewer-"));
const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });
const executable = join(root, "fake-claude.cjs");
writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
  if (process.env.FAKE_CLAUDE_AUTH_FAIL === "1") process.exit(1);
  process.stdout.write(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
if (args[0] === "--help") {
  process.stdout.write("--print --output-format --json-schema --model --effort --permission-mode --tools --safe-mode --session-id --no-session-persistence");
  process.exit(0);
}
const sessionId = args[args.indexOf("--session-id") + 1];
const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
fs.writeFileSync(path.join(process.cwd(), "claude-capture.json"), JSON.stringify({
  args, cwd: process.cwd(), changeId: process.env.FOUNDATION_CHANGE_ID,
  schemaRequired: schema.required, claudeCode: process.env.CLAUDECODE || null
}));
const review = process.env.FAKE_CLAUDE_INVALID === "1"
  ? { status: "pass" }
  : process.env.FAKE_CLAUDE_DUPLICATE === "1"
    ? { status: "pass", summary: "duplicate ids", findings: [], verifiedFindingIds: ["F1", " F1"] }
    : process.env.FAKE_CLAUDE_DUPLICATE_FINDINGS === "1"
      ? { status: "fail", summary: "duplicate finding ids", verifiedFindingIds: [], findings: [
          { id: "F2", severity: "minor", path: "a.mjs", line: 1, message: "one", claimIds: ["c"], verificationCaseIds: ["v"] },
          { id: " F2", severity: "minor", path: "a.mjs", line: 2, message: "two", claimIds: ["c"], verificationCaseIds: ["v"] }
        ] }
      : { status: "pass", summary: "same-family fresh review passed", findings: [], verifiedFindingIds: [] };
process.stdout.write(JSON.stringify({
  type: "result", subtype: "success", is_error: false,
  session_id: process.env.FAKE_CLAUDE_SESSION || sessionId,
  structured_output: review
}));
`);
chmodSync(executable, 0o755);

const reviewer = {
  adapter: "claude-cli", executable,
  providerFamily: "anthropic", modelFamily: "claude", modelId: "opus",
  reasoningEffort: "high", sandbox: "read-only", ephemeral: true,
  timeoutMs: 10_000
};
const policy = () => ({ review: {
  diversity: "single-model", independence: "required",
  defaultReviewer: "claude-opus", reviewers: { "claude-opus": reviewer }
} });
const runtime = createConfiguredReviewerRuntime({
  root, foundationPolicy: policy,
  commandExists: (command) => existsSync(command),
  now: () => "2026-08-14T00:00:00.000Z",
  uuid: () => "11111111-1111-4111-8111-111111111111",
  fail: (message) => { throw new Error(message); }
});

try {
  process.env.CLAUDECODE = "1";
  const result = runtime.runReview({
    changeId: "claude-only", workspace,
    packet: { schemaVersion: 4, reviewScope: { mode: "full" } },
    forbiddenSessionIds: ["implementation-session"]
  });
  const capture = JSON.parse(readFileSync(join(workspace,
    "claude-capture.json"), "utf8"));
  assert.equal(result.status, "pass");
  assert.equal(result.reviewer.sessionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(realpathSync(capture.cwd), realpathSync(workspace));
  assert.equal(capture.changeId, "claude-only");
  assert.equal(capture.claudeCode, null,
    "a Claude coding host must not leak its nesting marker into the fresh reviewer");
  assert.equal(capture.args[capture.args.indexOf("--permission-mode") + 1], "plan");
  assert.equal(capture.args[capture.args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert(capture.args.includes("--safe-mode"));
  assert(capture.args.includes("--no-session-persistence"));
  assert(!capture.args.join(" ").includes("Bash"));
  assert(!capture.args.join(" ").includes("Edit"));
  assert(!capture.args.join(" ").includes("Write"));
  assert.deepEqual(capture.schemaRequired,
    ["status", "summary", "findings", "verifiedFindingIds"]);

  process.env.FAKE_CLAUDE_SESSION = "implementation-session";
  const reused = runtime.runReview({
    changeId: "claude-same-session", workspace, packet: {},
    forbiddenSessionIds: ["implementation-session"]
  });
  delete process.env.FAKE_CLAUDE_SESSION;
  assert.equal(reused.status, "error");
  assert.match(reused.summary, /reused an implementation session/);

  process.env.FAKE_CLAUDE_INVALID = "1";
  const invalid = runtime.runReview({
    changeId: "claude-invalid-output", workspace, packet: {}
  });
  delete process.env.FAKE_CLAUDE_INVALID;
  assert.equal(invalid.status, "error");
  assert.match(invalid.summary, /outside the required schema/);

  // Portability: OpenAI structured output rejects `uniqueItems`, so its
  // presence anywhere in the request schema fails every dispatch as an
  // infrastructure error. Uniqueness stays enforced after parse.
  assert.ok(!JSON.stringify(REVIEW_SCHEMA).includes("uniqueItems"),
    "REVIEW_SCHEMA must not contain uniqueItems");
  process.env.FAKE_CLAUDE_DUPLICATE = "1";
  const duplicated = runtime.runReview({
    changeId: "claude-duplicate-ids", workspace, packet: {}
  });
  delete process.env.FAKE_CLAUDE_DUPLICATE;
  assert.equal(duplicated.status, "error");
  assert.match(duplicated.summary, /outside the required schema/);
  // Normalization-equivalent duplicate finding IDs ("F2" vs " F2") would trim
  // to the same value in the attempt store and throw after dispatch.
  process.env.FAKE_CLAUDE_DUPLICATE_FINDINGS = "1";
  const duplicatedFindings = runtime.runReview({
    changeId: "claude-duplicate-finding-ids", workspace, packet: {}
  });
  delete process.env.FAKE_CLAUDE_DUPLICATE_FINDINGS;
  assert.equal(duplicatedFindings.status, "error");
  assert.match(duplicatedFindings.summary, /outside the required schema/);

  process.env.FAKE_CLAUDE_AUTH_FAIL = "1";
  const auth = runtime.reviewerStatus();
  delete process.env.FAKE_CLAUDE_AUTH_FAIL;
  assert.equal(auth.ok, false);
  assert.equal(auth.check, "authentication");
  assert.match(auth.detail, /claude auth login/);

  const protocolPath = join(root, "protocol.json");
  const policyPath = join(root, "foundation.json");
  writeFileSync(protocolPath, JSON.stringify({ runtimeApi: "20" }));
  writeFileSync(policyPath, JSON.stringify({
    version: 1, review: {
      diversity: "single-model", independence: "required",
      defaultReviewer: "claude-opus", reviewers: { "claude-opus": reviewer }
    }
  }));
  const environment = createRuntimeEnvironment({
    root, protocolPath, policyPath, protocols: { runtimeApi: "20" },
    readJson: (sourcePath, fallback = undefined) => {
      try { return JSON.parse(readFileSync(sourcePath, "utf8")); }
      catch { return fallback; }
    },
    fail: (message) => { throw new Error(message); }
  });
  assert.equal(environment.foundationPolicy().review.reviewers["claude-opus"].adapter,
    "claude-cli");
  writeFileSync(policyPath, JSON.stringify({
    version: 1, review: {
      defaultReviewer: "bad", reviewers: { bad: {
        ...reviewer, providerFamily: "openai"
      } }
    }
  }));
  assert.throws(() => environment.foundationPolicy(),
    /providerFamily must be anthropic/);

  process.stdout.write("configured reviewer tests: PASS\n");
} finally {
  delete process.env.CLAUDECODE;
  delete process.env.FAKE_CLAUDE_AUTH_FAIL;
  delete process.env.FAKE_CLAUDE_INVALID;
  delete process.env.FAKE_CLAUDE_DUPLICATE;
  delete process.env.FAKE_CLAUDE_SESSION;
  rmSync(root, { recursive: true, force: true });
}
