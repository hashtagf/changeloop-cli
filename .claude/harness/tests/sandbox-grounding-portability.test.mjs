import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  gitBaseCheckoutStatus, groundingPortabilityFindings, isPacketLocalSource
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
    { repository: "plain", path: "requirements.md", sha256: digest("plain") }
  ] };
  const gitBuffer = (args, cwd) => spawnSync("git", args, { cwd });

  const findings = groundingPortabilityFindings(
    grounding,
    repositories,
    (repository, source) => {
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
  assert.deepEqual(groundingPortabilityFindings({}, repositories, () => null), []);
  process.stdout.write("sandbox grounding portability tests: PASS\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
