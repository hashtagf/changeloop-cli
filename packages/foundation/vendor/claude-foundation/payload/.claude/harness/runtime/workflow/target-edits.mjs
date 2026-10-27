import {
  existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { shellDisplayArgument } from "../core/shell-mutation-policy.mjs";

// Shell mutations during Build are recorded rather than blocked, so the
// guarantee that Build never touches the target checkout moves here: Prove and
// Land compare the target's dirty files with the snapshot taken at isolation.
// Machine state and change packets are expected to change on the target.
const EXPECTED_PREFIXES = [".foundation/", "openspec/changes/", "openspec/investigations/"];

export function targetEditPaths(snapshot = {}, dirtyNow = {}, landOutput = {}) {
  return Object.keys(dirtyNow)
    .filter((path) => !EXPECTED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => snapshot[path] !== dirtyNow[path])
    .filter((path) => landOutput[path] !== dirtyNow[path])
    .sort();
}

const UNAPPLIED_JOURNAL_STATUSES = new Set(["aborted", "rolling-back", "rolled-back"]);

// Target bytes this change's own Land Apply wrote, keyed by path. A target
// file equal to one of them is Land output, not an edit made outside the
// sandbox; any other content still counts.
export function landAppliedOutput(journals = []) {
  const output = {};
  for (const journal of journals) {
    if (!journal || UNAPPLIED_JOURNAL_STATUSES.has(journal.status)) continue;
    for (const entry of journal.entries || [])
      if (entry?.path && typeof entry.after === "string" && !entry.after.includes(":"))
        output[entry.path] = entry.after;
  }
  return output;
}

// Rows the phase guard wrote for this change when it let a shell mutation run
// unverified. Both audit generations are read; a missing log is no rows.
export function shellAuditCount(root, changeId) {
  let count = 0;
  for (const name of ["guardrail-audit.jsonl.1", "guardrail-audit.jsonl"]) {
    const path = join(root, ".foundation", "logs", name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes("shell-audit")) continue;
      try {
        const row = JSON.parse(line);
        if (row.outcome === "shell-audit" && row.changeId === changeId) count += 1;
      } catch {}
    }
  }
  return count;
}

export function targetEditDigest(paths, dirtyNow) {
  return paths.map((path) => `${path}\0${dirtyNow[path]}`).join("\n");
}

// Blocking only when this change ran unverified shell mutations: then the
// edits are plausibly the agent's and it repairs them. Otherwise they are the
// operator's concurrent work and only reported. A user decision recorded for
// the exact same edits clears the stop.
// `projectionPaths` (a function returning the paths Land would apply, or null
// when unknown) narrows the stop to edits Land could overwrite or that the
// change plausibly owns; an edit anywhere else is reported, never blocking.
export function targetEditIssues({ root, state, dirtyNow, landOutput = {}, projectionPaths = null }) {
  if (!["worktree", "copy"].includes(state?.workspace?.mode)) return { issues: [], notices: [] };
  const snapshot = state.workspace.targetDirty || state.workspace.preexisting || {};
  const paths = targetEditPaths(snapshot, dirtyNow, landOutput);
  if (!paths.length) return { issues: [], notices: [] };
  const list = (values) => values.slice(0, 10).join(", ") + (values.length > 10 ? ", ..." : "");
  const accepted = state.targetEditsAccepted?.digest === targetEditDigest(paths, dirtyNow);
  const audited = shellAuditCount(root, state.id);
  if (accepted || !audited) return {
    issues: [],
    notices: [`target checkout changed outside the sandbox since isolation (${
      accepted ? "accepted by user decision" : "no unverified shell mutation recorded"}): ${list(paths)}`]
  };
  let projection = null;
  try { projection = projectionPaths ? projectionPaths() : null; } catch { projection = null; }
  // Unknown projection fails closed: every edited path still counts.
  const inside = projection ? paths.filter((path) => projection.has(path)) : paths;
  const outside = paths.filter((path) => !inside.includes(path));
  const notices = outside.length ? [`target checkout changed outside the sandbox and outside ` +
    `this change's Land projection (reported only): ${list(outside)}`] : [];
  if (!inside.length) return { issues: [], notices };
  return {
    issues: [`TARGET_EDITED_OUTSIDE_SANDBOX: ${audited} unverified shell mutation(s) ran during ` +
      `this change and the target checkout changed outside the sandbox at: ${list(inside)}. Move ` +
      `edits that belong to this change into ${state.workspace.path} and restore those target ` +
      "files, then rerun. If a listed file is the user's own work, ask the user and record it " +
      `with 'claude-foundation change resolve ${state.id} --accept-target-edits --decision-ref <user-decision>'`],
    notices
  };
}

// Byproducts a build or test run regenerates. A tracked one changed on the
// target after isolation is a test run in the main checkout, not user work.
const GENERATED_ARTIFACT_PATTERNS = Object.freeze([
  /(^|\/)__pycache__\//, /\.py[co]$/, /\.class$/, /(^|\/)node_modules\/\.cache\//,
  /(^|\/)coverage\//, /(^|\/)\.pytest_cache\//, /(^|\/)\.nyc_output\//
]);

export function isGeneratedArtifactPath(path) {
  return GENERATED_ARTIFACT_PATTERNS.some((pattern) => pattern.test(String(path || "")));
}

// Restorable without a user decision only when the path is a generated
// artifact that was clean on the target when the sandbox was isolated.
export function restorableTargetPaths(paths, snapshot = {}) {
  return paths.filter((path) =>
    isGeneratedArtifactPath(path) && !Object.hasOwn(snapshot || {}, path));
}

export function parseRestoreTargetPaths(value) {
  return [...new Set(String(value ?? "").split(",").map((path) => path.trim())
    .filter(Boolean))].sort();
}

export function restoreTargetCommand(changeId, paths, decisionRef = null) {
  return `claude-foundation advance ${changeId} --through archived --restore-target ${
    shellDisplayArgument(paths.join(","))}${decisionRef ? ` --decision-ref ${decisionRef}` : ""}`;
}

// Land's stop for target edits its apply would overwrite. Regenerable
// artifacts get one harness-executed restore command; anything else is the
// user's call, with the same command offered only behind their decision.
const listPaths = (paths) => paths.slice(0, 10).join(", ") + (paths.length > 10 ? ", ..." : "");

// Land is always allowed for a change that branched before another change
// landed: the earlier landed diff is part of the target. The harness replays
// the sandbox onto it (3-way merge into the sandbox copy), proves again what
// that invalidated, and applies. Nobody is asked to commit.
export function landedChangeSyncStop({ changeId, landedBy }) {
  const paths = Object.keys(landedBy).sort();
  const owners = [...new Set(Object.values(landedBy))].sort();
  return {
    decision: {
      kind: "landed-change-sync",
      summary: `the target holds the landed, uncommitted work of ${owners.join(", ")} at: ${
        listPaths(paths)}; the sandbox of '${changeId}' is replayed onto it, keeping the landed ` +
        "content, and proved again before Land applies.",
      paths,
      landedBy,
      options: [
        { id: "sync", outcome: "Merge the landed content into the sandbox copies, prove what " +
          `changed, and continue Land: 'claude-foundation advance ${changeId} --through archived'.` },
        { id: "pause", outcome: "Change nothing and leave both workspaces as they are." }
      ],
      recommended: "sync",
      automaticRecovery: "sync"
    },
    code: "landed-change-sync"
  };
}

// A user's uncommitted target edit that touches other lines of a file this
// change also rewrote is merged by the harness, never handed back as a
// question: the 3-way merge goes into the sandbox copy, evidence that covers
// it runs again, and Land applies the merged file. The target is not written
// until that apply. Only same-line edits reach `targetConflictStop`.
export function targetEditSyncStop({ changeId, paths, conflicts = [] }) {
  const pending = conflicts.length ? ` Same-line edits at ${listPaths(conflicts)} are settled ` +
    "after the merge." : "";
  return {
    decision: {
      kind: "target-edit-sync",
      summary: `the target checkout holds uncommitted edits at: ${listPaths(paths)}; they touch ` +
        `other lines than '${changeId}', so the harness merges them into the sandbox copies, ` +
        "proves the merged files again, and lands them. The target edits are kept." + pending,
      paths,
      ...(conflicts.length ? { conflicts } : {}),
      options: [
        { id: "sync", outcome: "Merge the target edits into the sandbox copies, prove " +
          `what changed, and continue Land: 'claude-foundation advance ${changeId} --through archived'.` },
        { id: "pause", outcome: "Change nothing and leave both workspaces as they are." }
      ],
      recommended: "sync",
      automaticRecovery: "sync"
    },
    code: "target-edit-sync"
  };
}

export function targetConflictStop({ changeId, paths, snapshot = {}, cause, landedBy = {} }) {
  const listed = listPaths(paths);
  const restorable = restorableTargetPaths(paths, snapshot);
  // Bytes an earlier change landed are never restored over: the later change
  // merges them. Only the remaining paths keep the user's restore option.
  const discardable = paths.filter((path) => !Object.hasOwn(landedBy, path));
  if (discardable.length === paths.length && restorable.length === paths.length) return {
    message: `${cause} at generated artifact(s) changed in the main checkout after isolation: ${
      listed}. Tests and checks run only in the sandbox. Restore them to the recorded base ` +
      `inside Land with '${restoreTargetCommand(changeId, paths)}'`,
    details: { owner: "agent", boundary: "target-conflict", code: "TARGET_ARTIFACT_CONFLICT" }
  };
  // Keeping the target edits destroys nothing, so it is the automatic route:
  // the agent carries each edit into the sandbox copy and Land applies the
  // merged file once it provably contains the edit. Land never commits.
  const owners = [...new Set(Object.values(landedBy))].sort();
  return {
    decision: {
      kind: "target-edit-conflict",
      summary: `${cause} at: ${listed} — the target edits are kept and carried into the sandbox ` +
        "before Land applies those paths." + (owners.length ? ` Landed work of ${
          owners.join(", ")} is preserved; ask the user only if the two changes' intents ` +
          "contradict." : ""),
      paths,
      ...(owners.length ? { landedBy } : {}),
      options: [
        { id: "keep-target", outcome: "Keep the target edits: the agent merges each one into the " +
          "sandbox copy of the same path, then " +
          `'claude-foundation advance ${changeId} --through archived' proves the merged files and lands them.` },
        ...(discardable.length ? [{ id: "restore-target", outcome: "Discard the target edits at " +
          `${discardable.length === paths.length ? "the listed paths" : listPaths(discardable)} ` +
          `and land the proven projection: '${restoreTargetCommand(changeId, discardable,
            "<user-decision>")}'.` }] : []),
        { id: "pause", outcome: "Change nothing and leave both workspaces as they are." }
      ],
      recommended: "keep-target",
      automaticRecovery: "keep-target"
    },
    code: "target-edit-conflict"
  };
}

function workingBytes(path) {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats) return null;
  return stats.isFile() ? readFileSync(path) : undefined;
}

// Three-way merge of base→target into the sandbox bytes. `merged` is set only
// for a clean merge; a conflict, binary input, or failure leaves it null.
function mergeTargetInto({ sandbox, baseBytes, target, spawn, ours = false }) {
  const scratch = mkdtempSync(join(tmpdir(), "foundation-carried-"));
  try {
    const files = ["sandbox", "base", "target"].map((name) => join(scratch, name));
    writeFileSync(files[0], sandbox);
    writeFileSync(files[1], baseBytes || Buffer.alloc(0));
    writeFileSync(files[2], target);
    const merged = spawn("git", ["merge-file", "-p", ...(ours ? ["--ours"] : []), ...files], { maxBuffer: 64 * 1024 * 1024 });
    return merged.status === 0 && Buffer.isBuffer(merged.stdout) ? merged.stdout : null;
  } catch {
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Whether the sandbox copy already contains the target's uncommitted edit:
// merging base→target into the sandbox file is a clean no-op. Then applying
// the sandbox file over the target loses nothing the target holds. Anything
// else (binary, symlink, deletion, conflict) stays a conflict.
export function targetEditCarried({ root, sandboxPath, path, baseBytes, spawn = spawnSync }) {
  const target = workingBytes(join(root, path));
  const sandbox = workingBytes(join(sandboxPath, path));
  if (!target || !sandbox || baseBytes === undefined) return false;
  if (target.equals(sandbox)) return true;
  return mergeTargetInto({ sandbox, baseBytes, target, spawn })?.equals(sandbox) || false;
}

// Whether an agent's merge of a replay conflict still carries every landed
// edit that did not conflict. Merging base→target into the sandbox file with
// the sandbox winning the conflicting lines must change nothing; otherwise the
// merge dropped landed content and Land would overwrite it. A binary or
// unmergeable file cannot be checked and keeps the agent's word.
export function resolutionKeepsLanded({ root, sandboxPath, path, baseBytes, spawn = spawnSync }) {
  const target = workingBytes(join(root, path));
  const sandbox = workingBytes(join(sandboxPath, path));
  if (!target || !sandbox || baseBytes === undefined) return true;
  const merged = mergeTargetInto({ sandbox, baseBytes, target, spawn, ours: true });
  return merged ? merged.equals(sandbox) : true;
}

// Land leaves its projection uncommitted, so a change that branched before
// another change landed meets that landed diff in the target. These are the
// target bytes other changes' verified Land transactions wrote, keyed by path
// and newest last; the caller still compares them with the current target,
// because a later edit on top of landed bytes is somebody's work, not Land's.
const LANDED_JOURNAL_STATUSES = new Set(["verified", "committed"]);

export function otherLandedOutput({ transactions, changeId, readJson }) {
  const output = {};
  if (!transactions || !existsSync(transactions)) return output;
  const journals = [];
  for (const owner of readdirSync(transactions, { withFileTypes: true })) {
    if (!owner.isDirectory() || owner.name === changeId) continue;
    for (const run of readdirSync(join(transactions, owner.name), { withFileTypes: true })) {
      const path = join(transactions, owner.name, run.name, "journal.json");
      if (!run.isDirectory() || !existsSync(path)) continue;
      const journal = readJson(path, {});
      if (LANDED_JOURNAL_STATUSES.has(journal?.status))
        journals.push({ owner: journal.changeId || owner.name, journal });
    }
  }
  journals.sort((left, right) => String(left.journal.verifiedAt || left.journal.createdAt || "")
    .localeCompare(String(right.journal.verifiedAt || right.journal.createdAt || "")));
  for (const { owner, journal } of journals)
    for (const entry of journal.entries || [])
      if (entry?.path && entry.role !== "change-artifacts" &&
          typeof entry.after === "string" && !entry.after.includes(":"))
        output[entry.path] = { changeId: owner, after: entry.after };
  return output;
}

// The subset of `paths` whose target bytes are still exactly what an earlier
// change landed: path -> landing change id.
export function landedTargetPaths({ root, paths, landed, identity }) {
  const result = {};
  for (const path of paths) {
    const row = landed[path];
    if (!row) continue;
    let current = null;
    try { current = identity(join(root, path)); } catch { current = null; }
    if (current === row.after) result[path] = row.changeId;
  }
  return result;
}

// Paths another change landed and the sandbox still carries byte-for-byte are
// not this change's contribution: apply, replay, and the diff identity exclude
// them. A carried path this change has since edited counts again.
export function carriedLandedExcludes(workspace, identity) {
  const carried = workspace?.landedCarried || {};
  return Object.keys(carried).sort().filter((path) => {
    try { return identity(join(workspace.path, path)) === carried[path]?.digest; } catch { return false; }
  }).map((path) => `:(exclude,literal)${path}`);
}

// Replays an earlier change's landed edit into the sandbox copy of a path the
// sandbox also changed: the same 3-way merge Land's carried check uses. A
// clean merge returns the bytes to write into the sandbox; anything else is a
// conflict the agent resolves while preserving the landed content. The
// sandbox is never written here and the target is never touched.
export function replayLandedEdit({ root, sandboxPath, path, baseBytes, spawn = spawnSync }) {
  const target = workingBytes(join(root, path));
  const sandbox = workingBytes(join(sandboxPath, path));
  if (!target || !sandbox || baseBytes === undefined) return { status: "conflict" };
  if (target.equals(sandbox)) return { status: "carried" };
  const merged = mergeTargetInto({ sandbox, baseBytes, target, spawn });
  if (!merged) return { status: "conflict" };
  return merged.equals(sandbox) ? { status: "carried" } : { status: "merged", bytes: merged };
}
