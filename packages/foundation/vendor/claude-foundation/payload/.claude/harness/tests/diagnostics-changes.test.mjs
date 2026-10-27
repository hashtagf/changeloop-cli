import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  changeListingRow,
  changeReadiness,
  createDiagnosticsRuntime
} from "../runtime/core/diagnostics-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-diagnostics-changes-"));
const runtimePath = (id) => join(root, `${id}.json`);
const proofPath = (id) => join(root, `${id}.proof.json`);
const states = new Map();
const proofs = new Map();
let ids = [];
let orphans = [];
let output = "";
const priorLog = console.log;

for (const id of ["invalid", "missing", "ready", "stale", "change", "fault"])
  writeFileSync(runtimePath(id), "{}\n");
writeFileSync(proofPath("ready"), "{}\n");
writeFileSync(proofPath("stale"), "{}\n");
states.set("invalid", null);
states.set("missing", { status: "build", schema: "2" });
states.set("ready", { status: "proven", schema: "2" });
states.set("stale", { status: "proven" });
states.set("change", { status: "change", schema: "2" });
states.set("fault", { status: "build", schema: "2" });
proofs.set("ready", { status: "pass", workspaceHash: "hash-ready" });
proofs.set("stale", { status: "pass", workspaceHash: "old-hash" });

const dependencies = {
  runtimePath,
  proofPath,
  readJson: (path, fallback) => proofs.get(path.split("/").pop().replace(".proof.json", "")) || fallback,
  readJsonOrNull: (path) => states.get(path.split("/").pop().replace(".json", "")),
  relevantHash: (id) => {
    if (id === "missing") {
      const error = new Error("workspace gone");
      error.code = "FOUNDATION_WORKSPACE_MISSING";
      throw error;
    }
    if (id === "fault") throw new Error("git failed");
    return `hash-${id}`;
  }
};

try {
  assert.equal(changeReadiness({ status: "proven" }, { status: "pass", workspaceHash: "h" }, "h"), "ready-to-land");
  assert.equal(changeReadiness({ status: "proven" }, null, "h"), "stale-proof");
  assert.equal(changeReadiness({ status: "build" }, null, "h"), "build");
  assert.match(changeListingRow("untracked", dependencies), /^untracked\tuntracked\tunknown\t/);
  assert.match(changeListingRow("invalid", dependencies), /invalid-runtime-json.*change abandon invalid/);
  assert.match(changeListingRow("missing", dependencies),
    /workspace-missing\t2.*sandbox create missing --all/);
  assert.match(changeListingRow("ready", dependencies), /ready-to-land\t2/);
  assert.match(changeListingRow("stale", dependencies), /stale-proof\tunknown/);
  assert.match(changeListingRow("change", dependencies), /change\t2/);
  assert.throws(() => changeListingRow("fault", dependencies), /git failed/);

  const runtime = createDiagnosticsRuntime({
    ...dependencies,
    activeChanges: () => ids,
    orphanRuntimeChanges: () => orphans
  });
  console.log = (message) => { output += `${message}\n`; };
  runtime.showChanges();
  assert.equal(output, "No active changes.\n");

  output = "";
  ids = ["untracked", "invalid", "missing", "ready", "stale", "change"];
  orphans = [{ id: "orphan", schema: "1", reason: "packet missing" }];
  runtime.showChanges();
  assert.match(output, /untracked\tuntracked/);
  assert.match(output, /invalid\tinvalid-runtime-json/);
  assert.match(output, /missing\tworkspace-missing/);
  assert.match(output, /ready\tready-to-land/);
  assert.match(output, /stale\tstale-proof/);
  assert.match(output, /change\tchange/);
  assert.match(output, /orphan\torphan-runtime\t1\tpacket missing/);
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
