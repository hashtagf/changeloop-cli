import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ENVIRONMENT_LOCKFILES,
  environmentDescriptorOperation,
  environmentLockfiles,
  environmentWorkspace
} from "../runtime/evidence/evidence-contract.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-environment-descriptor-"));
const runtimeWorkspace = join(root, "runtime-workspace");
const repositoryWorkspace = join(root, "repository-workspace");
mkdirSync(runtimeWorkspace);
mkdirSync(repositoryWorkspace);
writeFileSync(join(root, "package-lock.json"), "root-lock\n");
writeFileSync(join(runtimeWorkspace, "pnpm-lock.yaml"), "runtime-lock\n");
writeFileSync(join(repositoryWorkspace, "Cargo.lock"), "repo-lock\n");

const fileDigest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stableHash = (value) => JSON.stringify(value);
const context = {
  root,
  repositoryById: (_id, repository) => {
    assert.equal(repository, "api");
    return { workspacePath: repositoryWorkspace };
  },
  loadRuntime: () => ({ workspace: { path: runtimeWorkspace } }),
  fileDigest,
  stableHash
};

try {
  assert.equal(ENVIRONMENT_LOCKFILES.includes("package-lock.json"), true);
  assert.equal(environmentWorkspace(context, null, null), root);
  assert.equal(environmentWorkspace(context, {}, "c"), runtimeWorkspace);
  assert.equal(environmentWorkspace({
    ...context,
    loadRuntime: () => ({ workspace: {} })
  }, {}, "c"), root);
  assert.equal(environmentWorkspace(context, { repository: "api" }, "c"), repositoryWorkspace);

  assert.deepEqual(environmentLockfiles(root, fileDigest), [{
    path: "package-lock.json",
    sha256: fileDigest(join(root, "package-lock.json"))
  }]);
  assert.deepEqual(environmentLockfiles(join(root, "empty"), fileDigest), []);

  const rootDescriptor = environmentDescriptorOperation(context);
  assert.equal(rootDescriptor.platform, process.platform);
  assert.equal(rootDescriptor.arch, process.arch);
  assert.equal(rootDescriptor.node, process.versions.node);
  assert.equal(rootDescriptor.declared, null);
  assert.deepEqual(rootDescriptor.lockfiles.map((row) => row.path), ["package-lock.json"]);
  assert.equal(rootDescriptor.envFingerprint,
    JSON.stringify({ literals: {}, inheritedNames: [] }));

  const runtimeDescriptor = environmentDescriptorOperation(context, {
    environment: "node-test",
    env: { NODE_ENV: "test" },
    envFrom: ["PATH"]
  }, "c");
  assert.equal(runtimeDescriptor.declared, "node-test");
  assert.deepEqual(runtimeDescriptor.lockfiles.map((row) => row.path), ["pnpm-lock.yaml"]);
  assert.equal(runtimeDescriptor.envFingerprint, JSON.stringify({
    literals: { NODE_ENV: "test" }, inheritedNames: ["PATH"]
  }));

  const repositoryDescriptor = environmentDescriptorOperation(
    context, { repository: "api" }, "c");
  assert.deepEqual(repositoryDescriptor.lockfiles.map((row) => row.path), ["Cargo.lock"]);
} finally {
  rmSync(root, { recursive: true, force: true });
}
