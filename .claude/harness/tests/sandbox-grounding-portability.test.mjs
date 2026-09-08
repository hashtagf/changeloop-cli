import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  gitBaseCheckoutPaths, gitBaseCheckoutStatus, groundingPortabilityFindings,
  isPacketLocalSource, plannedGroundingPortabilityStatus
} from
  "../runtime/workflow/sandbox-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-grounding-portability-"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
try {
  execFileSync("git", ["init", "-q", "-b", "work"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Foundation Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "foundation@example.invalid"], { cwd: root });
  writeFileSync(join(root, "clean.md"), "base\n");
  writeFileSync(join(root, "tracked.md"), "base\n");
  writeFileSync(join(root, "target.md"), "symlink target\n");
  symlinkSync("target.md", join(root, "linked.md"));
  const chain = Array.from({ length: 20 }, (unused, index) =>
    `chain-${String(index).padStart(2, "0")}.md`);
  chain.forEach((name, index) => symlinkSync(
    chain[index + 1] || "chain-terminal.md", join(root, name)));
  execFileSync("git", [
    "add", "clean.md", "tracked.md", "target.md", "linked.md", ...chain
  ], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root, encoding: "utf8"
  }).trim();

  writeFileSync(join(root, "tracked.md"), "dirty working bytes\n");
  writeFileSync(join(root, "staged.md"), "staged new bytes\n");
  execFileSync("git", ["add", "staged.md"], { cwd: root });
  writeFileSync(join(root, "requirements.md"), "plain");
  writeFileSync(join(root, "chain-terminal.md"), "untracked chain target\n");
  mkdirSync(join(root, "openspec", "changes", "portable", "notes"), {
    recursive: true
  });
  writeFileSync(join(root, "openspec", "changes", "portable", "notes", "decision.md"),
    "packet decision\n");
  writeFileSync(join(root, "untracked.md"), "outside packet\n");
  symlinkSync("../../../../untracked.md", join(root, "openspec", "changes",
    "portable", "notes", "escaped.md"));
  symlinkSync("cycle-b.md", join(root, "cycle-a.md"));
  symlinkSync("cycle-a.md", join(root, "cycle-b.md"));
  symlinkSync("../outside.md", join(root, "outside-link.md"));
  const deep = Array.from({ length: 65 }, (unused, index) =>
    `deep-${String(index).padStart(2, "0")}.md`);
  deep.forEach((name, index) => symlinkSync(
    deep[index + 1] || "deep-terminal.md", join(root, name)));

  const repositories = [
    { id: "root", path: root, baseHead },
    { id: "plain", path: root, baseHead: null }
  ];
  const grounding = { readSet: [
    { repository: "root", path: "clean.md", sha256: digest("base\n") },
    { repository: "root", path: "linked.md", sha256: digest("symlink target\n") },
    {
      repository: "root", path: "chain-00.md",
      sha256: digest("untracked chain target\n")
    },
    {
      repository: "root", path: "tracked.md",
      sha256: digest(readFileSync(join(root, "tracked.md")))
    },
    {
      repository: "root", path: "staged.md",
      sha256: digest(readFileSync(join(root, "staged.md")))
    },
    {
      repository: "root",
      path: "openspec/changes/portable/notes/decision.md",
      sha256: digest("packet decision\n")
    },
    {
      repository: "root",
      path: "openspec/changes/portable/../../../untracked.md",
      sha256: digest("outside packet\n")
    },
    {
      repository: "root",
      path: "openspec/changes/portable/notes/escaped.md",
      sha256: digest("outside packet\n")
    },
    {
      repository: "root", path: "src/new-app.js", role: "production-path",
      sha256: "planned"
    },
    { repository: "plain", path: "requirements.md", sha256: digest("plain") }
  ] };
  const gitBuffer = (args, cwd) => spawnSync("git", args, { cwd });

  assert.deepEqual(gitBaseCheckoutPaths(repositories[0], "linked.md"), {
    paths: ["linked.md", "target.md"], error: null
  });
  assert.equal(gitBaseCheckoutStatus(repositories[0], "cycle-a.md", gitBuffer),
    "symlink-cycle");
  assert.equal(gitBaseCheckoutStatus(repositories[0], "outside-link.md", gitBuffer),
    "symlink-target-outside-repository");
  assert.equal(gitBaseCheckoutStatus(repositories[0], "deep-00.md", gitBuffer),
    "symlink-depth-exceeded");
  assert.equal(gitBaseCheckoutStatus(repositories[1], "requirements.md", gitBuffer), null);

  const findings = groundingPortabilityFindings(
    grounding,
    repositories,
    (repository, source) => {
      const planned = plannedGroundingPortabilityStatus(source, false);
      if (planned !== undefined) return planned;
      if (digest(readFileSync(join(repository.path, source.path))) !== source.sha256)
        return "working-tree-digest-mismatch";
      if (repository.id === "root" && isPacketLocalSource(
        join(root, "openspec", "changes", "portable"),
        join(repository.path, source.path)
      )) return null;
      return gitBaseCheckoutStatus(repository, source.path, gitBuffer);
    }
  );

  assert.deepEqual(findings, [
    { repository: "root", path: "chain-00.md", reason: "missing-from-base" },
    { repository: "root", path: "tracked.md", reason: "differs-from-base" },
    { repository: "root", path: "staged.md", reason: "missing-from-base" },
    {
      repository: "root",
      path: "openspec/changes/portable/../../../untracked.md",
      reason: "missing-from-base"
    },
    {
      repository: "root",
      path: "openspec/changes/portable/notes/escaped.md",
      reason: "missing-from-base"
    }
  ]);
  assert.equal(plannedGroundingPortabilityStatus({
    role: "production-path", sha256: "planned"
  }, false), null, "an absent validated greenfield path is sandbox-portable");
  assert.equal(plannedGroundingPortabilityStatus({
    role: "production-path", sha256: "planned"
  }, true), "planned-path-exists",
  "a control-tree path must not masquerade as an absent planned path");
  assert.equal(plannedGroundingPortabilityStatus({
    role: "requirement", sha256: "planned"
  }, false), "invalid-planned-role",
  "immutable sources cannot use planned portability");
  assert.equal(plannedGroundingPortabilityStatus({
    role: "dependency-source", sha256: "planned"
  }, false), "invalid-planned-role",
  "dependency evidence cannot become writable through planned portability");
  assert.equal(plannedGroundingPortabilityStatus({
    role: "requirement", sha256: digest("base")
  }, false), undefined, "ordinary digests retain the full portability check");
  assert.deepEqual(groundingPortabilityFindings({}, repositories, () => null), []);
  process.stdout.write("sandbox grounding portability tests: PASS\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
