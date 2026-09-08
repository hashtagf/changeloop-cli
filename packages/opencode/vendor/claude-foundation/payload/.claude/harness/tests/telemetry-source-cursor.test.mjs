import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceCursorIdentityComplete,
  sourceCursorIdentityMatches,
  sourceReadOffsetOperation,
  validSourceOffset
} from "../runtime/observability/telemetry-runtime.mjs";

const identity = {
  device: "10",
  inode: "20",
  anchorStart: 4,
  anchorHash: "anchor-hash"
};

test("source offset accepts safe in-range integers and normalizes empty values", () => {
  assert.equal(validSourceOffset({ offset: 0 }, 10), 0);
  assert.equal(validSourceOffset({ offset: 10 }, 10), 10);
  assert.equal(validSourceOffset({ offset: "7" }, 10), 7);
  assert.equal(validSourceOffset({}, 10), 0);
  assert.equal(validSourceOffset(null, 10), 0);
  for (const offset of [-1, 11, 1.5, Number.MAX_SAFE_INTEGER + 1, "invalid"])
    assert.equal(validSourceOffset({ offset }, 10), null);
});

test("cursor identity requires device, inode, anchor start, and non-empty hash", () => {
  assert.equal(sourceCursorIdentityComplete(identity), true);
  for (const key of ["device", "inode", "anchorStart", "anchorHash"]) {
    const incomplete = { ...identity };
    delete incomplete[key];
    assert.equal(sourceCursorIdentityComplete(incomplete), false);
  }
  assert.equal(sourceCursorIdentityComplete(null), false);
});

test("cursor identity comparison normalizes persisted numeric fields", () => {
  assert.equal(sourceCursorIdentityMatches(identity, {
    device: 10, inode: 20, anchorStart: "4", anchorHash: "anchor-hash"
  }), true);
  for (const key of ["device", "inode", "anchorStart", "anchorHash"])
    assert.equal(sourceCursorIdentityMatches(identity, {
      ...identity,
      [key]: key === "anchorHash" ? "different" : 99
    }), false);
});

test("valid matching cursor resumes at its persisted offset", () => {
  const calls = [];
  assert.equal(sourceReadOffsetOperation({
    stat: (path) => { calls.push(["stat", path]); return { size: 20 }; },
    cursorIdentity: (path, offset) => {
      calls.push(["identity", path, offset]);
      return identity;
    }
  }, "/transcript.jsonl", { ...identity, offset: 8 }), 8);
  assert.deepEqual(calls, [
    ["stat", "/transcript.jsonl"],
    ["identity", "/transcript.jsonl", 8]
  ]);
});

test("legacy, truncated, and rotated cursors rescan from the beginning", () => {
  const noIdentity = {
    stat: () => ({ size: 20 }),
    cursorIdentity: assert.fail
  };
  assert.equal(sourceReadOffsetOperation(noIdentity, "/transcript", { offset: 8 }), 0);
  assert.equal(sourceReadOffsetOperation(noIdentity, "/transcript", {
    ...identity, offset: 21
  }), 0);
  assert.equal(sourceReadOffsetOperation({
    stat: () => ({ size: 20 }),
    cursorIdentity: () => ({ ...identity, inode: "rotated" })
  }, "/transcript", { ...identity, offset: 8 }), 0);
});
