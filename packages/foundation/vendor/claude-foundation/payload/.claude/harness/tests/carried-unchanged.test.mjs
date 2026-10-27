import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  carriedInUnchanged,
  unchangedManifestEntry
} from "../runtime/workflow/change-policy.mjs";

test("unchanged manifest entries require an existing matching digest", () => {
  const workspace = mkdtempSync(join(tmpdir(), "foundation-unchanged-"));
  try {
    writeFileSync(join(workspace, "same.txt"), "same");
    const digest = (path) => path.endsWith("same.txt") ? "digest-a" : "other";
    assert.equal(unchangedManifestEntry(
      digest, workspace, { "same.txt": "digest-a" }, "same.txt"), true);
    assert.equal(unchangedManifestEntry(
      digest, workspace, { "same.txt": "different" }, "same.txt"), false);
    assert.equal(unchangedManifestEntry(
      digest, workspace, { "missing.txt": "digest-a" }, "missing.txt"), false);
    assert.equal(unchangedManifestEntry(digest, workspace, null, "same.txt"), false);
    assert.equal(unchangedManifestEntry(digest, workspace, {}, "same.txt"), false);
    assert.equal(unchangedManifestEntry(
      () => { throw new Error("digest failed"); },
      workspace, { "same.txt": "digest-a" }, "same.txt"), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("copied sandbox metadata takes precedence and falls back to preexisting", () => {
  const workspace = mkdtempSync(join(tmpdir(), "foundation-carried-"));
  try {
    writeFileSync(join(workspace, "same.txt"), "same");
    const digest = () => "digest-a";
    assert.equal(carriedInUnchanged(digest, workspace,
      { "same.txt": "different" }, "same.txt", {
        workspace: { sandboxPreexisting: { "same.txt": "digest-a" } }
      }), true);
    assert.equal(carriedInUnchanged(digest, workspace,
      { "same.txt": "digest-a" }, "same.txt", {
        workspace: { sandboxPreexisting: { "same.txt": "different" } }
      }), true);
    assert.equal(carriedInUnchanged(digest, workspace,
      { "same.txt": "different" }, "same.txt"), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
