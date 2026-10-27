import {
  appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, rmdirSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { deliveryProjectionEntry } from "./delivery-integrity.mjs";
import { retiredChangeStores } from "./retired-change-stores.mjs";

// Undo of an archived Land whose target diff is still uncommitted. Land never
// commits, so until the user commits, the projection it wrote is the only
// trace of the change in the target. Undo returns every path Land wrote (code,
// synchronized specs, archived packet) to its pre-Land bytes and retires the
// change, preserving the landed bytes and records under
// `.foundation/recovery/land-undone/<change>`. It refuses before writing
// anything when the target moved past Land: a commit (HEAD moved), a staged
// path, or any later edit of a path Land wrote is never clobbered.
//
// Undo retires the change rather than reopening it: its runtime state and its
// archived packet leave the live stores, so nothing can resume it. Its
// per-change bookkeeping (review requests and reports, instruction manifests,
// the open attestation challenge, delivery state) is therefore quarantined in
// the same step, exactly as abandon does; a delivery record is moved, never
// deleted.
export const SPEC_BEFORE_FILE = "spec-before.json";

const isCodeEntry = (entry) => Boolean(entry?.path) && entry.role !== "change-artifacts";

// Pure: classify every path Land wrote against what the target holds now.
// `observe(path)` returns { identity, mode } as the journal records them;
// `delivered(path)` returns the delivery entry (identity + Git mode).
export function landUndoPlan({
  state, journal, specBefore, headNow, staged = [], observe, delivered, sources
}) {
  const refusals = [];
  const changedAfterLand = [];
  const unavailable = [];
  if (state?.status !== "archived")
    refusals.push(`change '${state?.id}' is not archived; an unfinished Land is resumed or ` +
      `settled with 'claude-foundation advance ${state?.id} --through archived'`);
  if (Object.keys(state?.repositories || {}).some((repository) => repository !== "root"))
    refusals.push("Land undo covers a single-repository projection; this change landed into " +
      "several repositories");
  if (!["worktree", "copy"].includes(state?.workspace?.mode) || !journal)
    refusals.push("this change has no recorded Land projection to undo");
  if (!state?.workspace?.baseHead || headNow !== state.workspace.baseHead)
    refusals.push("the target HEAD moved since Land, so the landed diff may be committed; " +
      "Land undo only reverts an uncommitted projection");
  if (staged.length)
    refusals.push(`paths Land wrote are staged in the Git index: ${staged.join(", ")}`);
  if (refusals.length) return { refusals, code: [], specs: [], packet: null };

  const code = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (!isCodeEntry(entry)) continue;
    const current = observe(entry.path);
    const at = (side) => current.identity === entry[side] &&
      (entry[`${side}Mode`] === undefined || current.mode === entry[`${side}Mode`]);
    if (at("before")) continue;
    if (!at("after")) { changedAfterLand.push(entry.path); continue; }
    const source = entry.before === null ? "remove" : sources(entry, index);
    if (!source) unavailable.push(entry.path);
    else code.push({ entry, index, source });
  }

  const integrity = state.deliveryIntegrity?.entries;
  const archived = state.archivedChangePath || null;
  const specs = [];
  if (!Array.isArray(integrity) || !archived) unavailable.push("archive integrity record");
  else {
    for (const entry of integrity) {
      const observed = delivered(entry.path);
      if (observed.identity !== entry.identity || observed.mode !== entry.mode)
        changedAfterLand.push(entry.path);
    }
    for (const entry of integrity.filter((row) => row.path.startsWith("openspec/specs/"))) {
      const capability = entry.path.slice("openspec/specs/".length).replace(/\/spec\.md$/, "");
      if (!specBefore || !Object.hasOwn(specBefore, capability)) unavailable.push(entry.path);
      else specs.push({ path: entry.path, before: specBefore[capability] });
    }
  }
  if (changedAfterLand.length)
    refusals.push(`the target changed after Land at: ${[...new Set(changedAfterLand)].sort()
      .join(", ")}; those edits are kept, so Land is not undone`);
  if (unavailable.length)
    refusals.push(`the pre-Land bytes are not recorded for: ${unavailable.join(", ")}`);
  return { refusals, code, specs, packet: archived };
}

export function createLandUndo({
  root, paths, loadRuntime, saveRuntime, readJson, writeJson, now, gitHead, git, gitBuffer,
  pathIdentity, pathMode, safeRootPath, copyPath, transactionRoot, journalPath,
  cleanupChangeLeases, fail
}) {
  function recoveryRoot(id) {
    return join(paths.recovery, "land-undone", id);
  }

  function stagedPaths(candidates) {
    if (!candidates.length) return [];
    const result = git(["diff", "--cached", "--name-only", "-z", "--", ...candidates], root);
    if (result.status !== 0) return candidates;
    return result.stdout.split("\0").filter(Boolean).sort();
  }

  // Pre-Land bytes: the transaction backup when it was retained, otherwise
  // the sandbox base blob, accepted only when it is exactly the recorded bytes.
  function stageBefore(state, journal, entry, index, stage) {
    const backup = join(transactionRoot(state.id, journal.transactionId), entry.backup || "-");
    if (entry.backup && existsSync(backup)) {
      copyPath(backup, stage);
    } else {
      const shown = gitBuffer(["show", `${state.workspace.baseHead}:${entry.path}`], root);
      if (shown.status !== 0) return false;
      mkdirSync(dirname(stage), { recursive: true });
      writeFileSync(stage, shown.stdout);
      if (Number.isInteger(entry.beforeMode)) chmodSync(stage, entry.beforeMode & 0o7777);
    }
    const ok = pathIdentity(stage) === entry.before &&
      (entry.beforeMode === undefined || pathMode(stage) === entry.beforeMode);
    if (!ok) rmSync(stage, { recursive: true, force: true });
    return ok;
  }

  // An earlier undo of the same id is evidence too: set its record aside
  // instead of deleting it (the rule abandonment uses).
  function setAside(destination) {
    if (existsSync(destination))
      renameSync(destination, `${destination}.previous-${
        String(now()).replace(/[^0-9A-Za-z]/g, "-")}`);
  }

  function quarantine(id, target) {
    const moved = [];
    for (const [name, source] of [
      ["runtime.json", join(paths.runtime, `${id}.json`)],
      ["receipts", join(paths.receipts, id)],
      ["evidence", join(paths.evidenceVault, id)],
      ["transactions", join(paths.transactions, id)],
      ["plans", join(paths.plans, id)],
      ["handoffs", join(paths.handoffs, id)],
      // The change is retired, so nothing it owned stays live for a later
      // change reusing the id; see retired-change-stores.mjs.
      ...retiredChangeStores(paths, id),
      ...(paths.previews ? [["previews", join(paths.previews, id)]] : []),
      ...(paths.packages ? [["package.html", join(paths.packages, `${id}.html`)]] : []),
      ["logs", join(paths.logs, id)],
      ["snapshot.json", join(paths.snapshots, `${id}.json`)]
    ]) {
      if (!source || !existsSync(source)) continue;
      const destination = join(target, name);
      mkdirSync(dirname(destination), { recursive: true });
      setAside(destination);
      renameSync(source, destination);
      moved.push(name);
    }
    return moved;
  }

  function undoLand(id, decisionRef) {
    const ref = String(decisionRef || "").trim();
    if (!ref)
      fail("advance --undo-land discards the landed, uncommitted diff of this change; ask the " +
        "user, then pass --decision-ref <user-decision>");
    const state = loadRuntime(id);
    const transactionId = state.workspace?.apply?.transactionId;
    const journalFile = transactionId ? journalPath(id, transactionId) : null;
    const journal = journalFile && existsSync(journalFile) ? readJson(journalFile, null) : null;
    const specFile = transactionId ? join(transactionRoot(id, transactionId), SPEC_BEFORE_FILE) : null;
    const specBefore = specFile && existsSync(specFile) ? readJson(specFile, null) : null;
    const touched = [...(journal?.entries || []).filter(isCodeEntry).map((entry) => entry.path),
      ...(state.deliveryIntegrity?.entries || []).map((entry) => entry.path)];
    const stage = join(recoveryRoot(id), "stage");
    const plan = landUndoPlan({
      state, journal, specBefore,
      headNow: state.workspace?.baseHead ? gitHead(root) : null,
      staged: stagedPaths(touched),
      observe: (path) => ({ identity: pathIdentity(safeRootPath(path)),
        mode: pathMode(safeRootPath(path)) }),
      delivered: (path) => deliveryProjectionEntry(root, path, pathIdentity),
      sources: (entry, index) => stageBefore(state, journal, entry, index,
        join(stage, String(index))) ? "staged" : null
    });
    if (plan.refusals.length) {
      rmSync(stage, { recursive: true, force: true });
      try { rmdirSync(recoveryRoot(id)); } catch {}
      fail(`Land undo refused for '${id}': ${plan.refusals.join("; ")}. Nothing was changed.`);
    }
    const target = recoveryRoot(id);
    const landed = join(target, "landed");
    state.landUndo = { status: "reverting", decisionRef: ref, startedAt: now() };
    saveRuntime(state);
    // Every landed byte is preserved before anything is restored.
    setAside(landed);
    for (const { entry } of plan.code)
      copyPath(safeRootPath(entry.path), join(landed, entry.path));
    for (const spec of plan.specs)
      if (existsSync(join(root, spec.path))) copyPath(join(root, spec.path), join(landed, spec.path));
    for (const { entry, index, source } of plan.code) {
      const path = safeRootPath(entry.path);
      rmSync(path, { recursive: true, force: true });
      if (source === "staged") {
        mkdirSync(dirname(path), { recursive: true });
        renameSync(join(stage, String(index)), path);
      }
    }
    for (const spec of plan.specs) {
      const path = join(root, spec.path);
      if (spec.before === null) {
        rmSync(path, { force: true });
        try { rmdirSync(dirname(path)); } catch {}
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, spec.before);
      }
    }
    if (plan.packet && existsSync(join(root, plan.packet))) {
      setAside(join(target, "change"));
      renameSync(join(root, plan.packet), join(target, "change"));
    }
    rmSync(stage, { recursive: true, force: true });
    cleanupChangeLeases(id);
    const record = {
      version: 1, changeId: id, decisionRef: ref, transactionId,
      restoredPaths: [...plan.code.map(({ entry }) => entry.path), ...plan.specs.map(({ path }) => path)],
      archivedChangePath: plan.packet,
      actor: process.env.USER || process.env.LOGNAME || "operator",
      undoneAt: now()
    };
    state.landUndo = { ...state.landUndo, status: "undone", undoneAt: record.undoneAt };
    saveRuntime(state);
    record.quarantined = quarantine(id, target);
    setAside(join(target, "undo.json"));
    writeJson(join(target, "undo.json"), record);
    mkdirSync(paths.logs, { recursive: true });
    appendFileSync(join(paths.logs, "land-undone.jsonl"), `${JSON.stringify(record)}\n`);
    const relative = target.slice(root.length + 1);
    console.log(`LAND UNDONE ${id}\n  restored: ${record.restoredPaths.length} path(s) to their ` +
      `pre-Land bytes\n  preserved: ${relative}`);
    // Undo never touches Git or a provider; say where a delivery record went.
    if (record.quarantined.includes("deliveries"))
      console.error(`WARNING: delivery record preserved at ${relative}/deliveries; ` +
        "Land undo does not close or update any pull request it opened");
    return record;
  }

  return { undoLand, recoveryRoot };
}

// Read by the archive step: the spec text OpenSpec is about to rewrite,
// retained beside the Land journal so an undo can restore it.
export function writeSpecBefore(directory, inputs, writeJson) {
  writeJson(join(directory, SPEC_BEFORE_FILE), Object.fromEntries(
    inputs.map(({ capability, before }) => [capability, before ?? null])));
}
