import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { headOfRepository } from "../runtime/workflow/sandbox-runtime.mjs";

const lower = "0123456789abcdef0123456789abcdef01234567";
const upper = lower.toUpperCase();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "foundation-head-"));
  return {
    root,
    write(path, value) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, value);
    },
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test("repository head returns null without usable Git metadata", () => {
  const box = fixture();
  try {
    assert.equal(headOfRepository(box.root), null);
    box.write(".git", "not a gitdir pointer\n");
    assert.equal(headOfRepository(box.root), null);
    rmSync(join(box.root, ".git"));
    mkdirSync(join(box.root, ".git", "HEAD"), { recursive: true });
    assert.equal(headOfRepository(box.root), null);
  } finally { box.cleanup(); }
});

test("repository head reads detached lowercase and uppercase commits", () => {
  const box = fixture();
  try {
    box.write(".git/HEAD", `${lower}\n`);
    assert.equal(headOfRepository(box.root), lower);
    box.write(".git/HEAD", `${upper}\n`);
    assert.equal(headOfRepository(box.root), upper);
    box.write(".git/HEAD", "not-a-commit\n");
    assert.equal(headOfRepository(box.root), null);
  } finally { box.cleanup(); }
});

test("repository head follows relative gitdir pointers and loose refs", () => {
  const box = fixture();
  try {
    box.write(".git", "gitdir: metadata/worktree\n");
    box.write("metadata/worktree/HEAD", "ref: refs/heads/main\n");
    box.write("metadata/worktree/refs/heads/main", `${upper}\n`);
    assert.equal(headOfRepository(box.root), upper);
    box.write("metadata/worktree/refs/heads/main", "short\n");
    assert.equal(headOfRepository(box.root), null);
  } finally { box.cleanup(); }
});

test("repository head resolves exact packed refs and ignores malformed rows", () => {
  const box = fixture();
  try {
    box.write(".git/HEAD", "ref: refs/heads/main\n");
    assert.equal(headOfRepository(box.root), null);
    box.write(".git/packed-refs", [
      "# pack-refs with: peeled fully-peeled sorted",
      `${lower} refs/heads/other`,
      `^${lower}`,
      `not-a-sha refs/heads/main`,
      `${lower} refs/heads/main   `,
      ""
    ].join("\n"));
    assert.equal(headOfRepository(box.root), lower);
    box.write(".git/HEAD", "ref: refs/heads/missing\n");
    assert.equal(headOfRepository(box.root), null);
  } finally { box.cleanup(); }
});
