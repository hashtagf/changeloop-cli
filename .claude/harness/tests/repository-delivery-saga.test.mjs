import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createRepositoryDeliverySaga, repositoryDeliveryOrder
} from "../runtime/workflow/repository-delivery-saga.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const stableHash = (value) => digest(JSON.stringify(value));
const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

function createRepository(base, id) {
  const target = join(base, id);
  const sandbox = join(base, `${id}-sandbox`);
  mkdirSync(target, { recursive: true });
  git(["init", "-q"], target);
  git(["config", "user.email", "test@example.test"], target);
  git(["config", "user.name", "Test"], target);
  writeFileSync(join(target, "app.txt"), `${id}:base\n`);
  git(["add", "app.txt"], target);
  git(["commit", "-q", "-m", "base"], target);
  const head = git(["rev-parse", "HEAD"], target).stdout.trim();
  git(["worktree", "add", "--detach", sandbox, head], target);
  writeFileSync(join(sandbox, "app.txt"), `${id}:delivered\n`);
  writeFileSync(join(sandbox, "new.txt"), `${id}:new\n`);
  return { id, target, sandbox, head };
}

function fileDigest(path) {
  const stat = lstatSync(path);
  return stat.isSymbolicLink()
    ? digest(readlinkSync(path)) : digest(readFileSync(path));
}

function directoryHash(path) {
  return stableHash(path);
}

function fixture(repositoryCount = 1, options = {}) {
  const base = mkdtempSync(join(tmpdir(), "repository-delivery-"));
  const repositories = Array.from({ length: repositoryCount }, (_, index) =>
    createRepository(base, `repo-${index + 1}`));
  const state = {
    id: "change-a", status: "proven", repositories: Object.fromEntries(
      repositories.map((repository) => [repository.id, {
        mode: "worktree", access: "write", path: repository.sandbox,
        targetPath: repository.target, baseHead: repository.head
      }]))
  };
  const selected = repositories.map((repository, index) => ({
    id: repository.id,
    type: "git",
    mode: "write",
    path: repository.target,
    dependsOn: index === 0 ? [] : [repositories[index - 1].id]
  }));
  let runtimeState = structuredClone(state);
  const proofPath = join(base, "proof.json");
  writeFileSync(proofPath, JSON.stringify({ proofRunId: "proof-a" }));
  const readJson = (path, fallback) => {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch { return fallback; }
  };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  const saga = createRepositoryDeliverySaga({
    root: base,
    transactions: join(base, "transactions"),
    loadRuntime: () => structuredClone(runtimeState),
    saveRuntime: (value) => { runtimeState = structuredClone(value); },
    selectedRepositories: () => selected,
    git,
    gitHead: (path) => git(["rev-parse", "HEAD"], path).stdout.trim(),
    fileDigest,
    directoryHash,
    pathInside: (root, path) => {
      const rel = relative(root, path);
      return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." &&
        !isAbsolute(rel));
    },
    readJson,
    writeJson,
    stableHash,
    proofPath: () => proofPath,
    now: () => "2026-09-05T00:00:00.000Z",
    prepareRoot: () => assert.fail("root is not selected"),
    executeRoot: () => assert.fail("root is not selected"),
    verifyRoot: () => ({ valid: true }),
    cleanupRoot: () => {},
    fail: (message) => { throw new Error(message); },
    checkpoint: options.checkpoint
  });
  return {
    base, repositories, selected, saga,
    state: () => structuredClone(runtimeState),
    cleanup: () => {
      for (const repository of repositories)
        git(["worktree", "remove", "--force", repository.sandbox], repository.target);
      rmSync(base, { recursive: true, force: true });
    }
  };
}

test("repository delivery order honors dependencies", () => {
  assert.deepEqual(repositoryDeliveryOrder([
    { id: "consumer", dependsOn: ["producer"] },
    { id: "producer", dependsOn: [] }
  ]).map((row) => row.id), ["producer", "consumer"]);
});

test("one selected non-root repository lands as an uncommitted workspace diff", () => {
  const value = fixture();
  try {
    const repository = value.repositories[0];
    const head = repository.head;
    const indexBefore = git(["diff", "--cached", "--binary"], repository.target).stdout;
    const result = value.saga.apply("change-a");
    assert.equal(result.status, "PASS");
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      `${repository.id}:delivered\n`);
    assert.equal(readFileSync(join(repository.target, "new.txt"), "utf8"),
      `${repository.id}:new\n`);
    assert.equal(git(["rev-parse", "HEAD"], repository.target).stdout.trim(), head);
    assert.equal(git(["diff", "--cached", "--binary"], repository.target).stdout,
      indexBefore);
    assert.match(git(["status", "--short"], repository.target).stdout, /app\.txt/);
    assert.equal(value.state().repositories[repository.id].delivery.status,
      "applied-uncommitted");
    assert.equal(value.saga.apply("change-a").status, "PASS",
      "a completed repository node is verified and not applied twice");
  } finally { value.cleanup(); }
});

test("overlapping target work is preserved as a typed conflict", () => {
  const value = fixture();
  try {
    const repository = value.repositories[0];
    writeFileSync(join(repository.target, "app.txt"), "user edit\n");
    assert.throws(() => value.saga.apply("change-a"),
      /overwrite an uncommitted target edit/);
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      "user edit\n");
  } finally { value.cleanup(); }
});

test("read-only dependencies have no mutation node", () => {
  const value = fixture(2);
  try {
    value.selected[1].mode = "read";
    const readRepository = value.repositories[1];
    const indexBefore = git(["diff", "--cached", "--binary"],
      readRepository.target).stdout;
    const result = value.saga.apply("change-a");
    assert.deepEqual(result.repositories.map((row) => row.id), ["repo-1"]);
    assert.equal(readFileSync(join(readRepository.target, "app.txt"), "utf8"),
      "repo-2:base\n");
    assert.equal(git(["rev-parse", "HEAD"], readRepository.target).stdout.trim(),
      readRepository.head);
    assert.equal(git(["diff", "--cached", "--binary"],
      readRepository.target).stdout, indexBefore);
  } finally { value.cleanup(); }
});

test("writable submodule targets receive bytes without a child commit", () => {
  const value = fixture();
  try {
    value.selected[0].type = "submodule";
    const repository = value.repositories[0];
    value.saga.apply("change-a");
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      `${repository.id}:delivered\n`);
    assert.equal(git(["rev-parse", "HEAD"], repository.target).stdout.trim(),
      repository.head);
    assert.equal(git(["diff", "--cached", "--quiet"], repository.target).status, 0);
  } finally { value.cleanup(); }
});

test("a crash between repositories resumes without reapplying the completed node", () => {
  let checkpoints = 0;
  const value = fixture(2, {
    checkpoint: () => {
      checkpoints += 1;
      if (checkpoints === 1) throw new Error("simulated process stop");
    }
  });
  try {
    assert.throws(() => value.saga.apply("change-a"), /simulated process stop/);
    const first = value.repositories[0];
    const second = value.repositories[1];
    assert.equal(readFileSync(join(first.target, "app.txt"), "utf8"),
      `${first.id}:delivered\n`);
    assert.equal(readFileSync(join(second.target, "app.txt"), "utf8"),
      `${second.id}:base\n`);
    assert.equal(value.saga.apply("change-a").status, "PASS");
    assert.equal(readFileSync(join(second.target, "app.txt"), "utf8"),
      `${second.id}:delivered\n`);
    assert.equal(value.state().repositories[first.id].delivery.status,
      "applied-uncommitted");
  } finally { value.cleanup(); }
});
