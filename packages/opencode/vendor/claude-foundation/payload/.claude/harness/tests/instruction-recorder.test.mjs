import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInstructionRecorder } from "../runtime/core/instruction-recorder.mjs";

test("instruction recorder validates phases and records content-addressed manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-instruction-recorder-"));
  const writes = [];
  const recorder = createInstructionRecorder({
    root,
    foundationVersion: "test-version",
    instructionManifests: join(root, "manifests"),
    writeJson: (path, value) => writes.push({ path, value })
  });

  try {
    assert.equal(recorder.recordInstructionManifest("change-1", "unknown"), null);
    assert.equal(recorder.recordInstructionManifest("change-1", "change"), null);
    assert.deepEqual(writes, []);

    mkdirSync(join(root, ".claude", "commands"), { recursive: true });
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(join(root, ".claude", "commands", "prove.md"), "prove instructions\n");
    writeFileSync(join(root, ".claude", "commands", "change.md"), "change instructions\n");
    writeFileSync(join(root, ".claude", "orchestrator.md"), "orchestrator instructions\n");
    writeFileSync(join(root, ".claude", "rules", "fundamentals.md"), "fundamental rules\n");

    const reviewManifest = recorder.recordInstructionManifest("change-1", "review", {
      requestedModel: "test-model",
      scope: "repo/api one"
    });
    assert.equal(reviewManifest.dispatch.command, "prove");
    assert.equal(reviewManifest.execution.requestedModel, "test-model");
    assert.match(reviewManifest.manifestDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(writes[0].path, join(root, "manifests", "change-1", "prove-repo-api-one.json"));
    assert.equal(writes[0].value, reviewManifest);

    const changeManifest = recorder.recordInstructionManifest("change-2", "change");
    assert.equal(changeManifest.dispatch.command, "change");
    assert.equal(changeManifest.execution.requestedModel, null);
    assert.equal(writes[1].path, join(root, "manifests", "change-2", "change-global.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
