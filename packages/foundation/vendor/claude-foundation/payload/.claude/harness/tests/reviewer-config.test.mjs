import assert from "node:assert/strict";
import test from "node:test";

import {
  reviewerConfigValue,
  validReviewerConfig
} from "../runtime/evidence/configured-reviewer.mjs";

const valid = {
  adapter: "codex-cli",
  executable: "codex",
  modelId: "gpt-5.6",
  providerFamily: "openai",
  modelFamily: "gpt-5",
  reasoningEffort: "high",
  sandbox: "read-only",
  ephemeral: true
};

function context(review) {
  return {
    foundationPolicy: () => ({ review }),
    fail: (message) => { throw new Error(message); }
  };
}

test("reviewer config resolves the default and an explicit reviewer", () => {
  const review = {
    defaultReviewer: "codex",
    reviewers: { codex: valid, claude: { ...valid, adapter: "claude-cli" } }
  };
  assert.deepEqual(reviewerConfigValue(context(review)),
    { identity: "codex", ...valid });
  assert.equal(reviewerConfigValue(context(review), "claude").identity, "claude");
});

test("reviewer config rejects missing review policy and unknown identities", () => {
  assert.throws(() => reviewerConfigValue(context(undefined)),
    /unknown configured reviewer ''/);
  assert.throws(() => reviewerConfigValue(context({
    defaultReviewer: "missing", reviewers: {}
  })), /unknown configured reviewer 'missing'/);
});

test("reviewer config validation checks every pinned execution property", () => {
  assert.equal(validReviewerConfig(valid), true);
  const invalid = [
    ["adapter", "external"],
    ["executable", ""],
    ["modelId", ""],
    ["providerFamily", ""],
    ["modelFamily", ""],
    ["reasoningEffort", "medium"],
    ["sandbox", "workspace-write"],
    ["ephemeral", false]
  ];
  for (const [field, value] of invalid) {
    const config = { ...valid, [field]: value };
    assert.equal(validReviewerConfig(config), false, field);
    assert.throws(() => reviewerConfigValue(context({
      defaultReviewer: "bad", reviewers: { bad: config }
    })), /must pin codex-cli\|claude-cli/);
  }
});
