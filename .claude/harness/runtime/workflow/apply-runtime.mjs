import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { predictSpecSync, verifySpecSync } from "./spec-sync-verify.mjs";
import {
  projectionCounts, targetHeadMovedDecision, undeclaredDeletions
} from "./apply-recovery.mjs";
import {
  isInvestigationPath, nestedRepositoryPathMatcher, sandboxCodePathspec
} from "../core/workspace-surface.mjs";
import { transitionLifecycleState } from "../core/lifecycle-reducer.mjs";
import { compositeRepositorySelection } from "../core/repository-binding.mjs";
import {
  copyBaselineState, createRepositoryDeliverySaga, RepositoryDeliveryError, targetOverwrites
} from "./repository-delivery-saga.mjs";
import { deliveryTreeEntries, assertDeliveryEntries } from "./delivery-integrity.mjs";
import { approvalMatches } from "../core/user-decisions.mjs";
import { emitSignal } from "../core/signals.mjs";
import { legacyRepositoryLandTransaction } from "./land-runtime.mjs";
import { DEPENDENCY_LOCKFILES, rejectedPaths, workspaceSetupPlan } from "./sandbox-runtime.mjs";

// The root files whose change means the target's installed dependencies no
// longer match: the manifest and every lockfile the sandbox setup knows.
export const DEPENDENCY_FILES = Object.freeze(["package.json", ...DEPENDENCY_LOCKFILES.map(([file]) => file)]);

export function dependencySnapshot(workspace, identity) {
  return Object.fromEntries(DEPENDENCY_FILES.map((file) => {
    try { return [file, identity(join(workspace, file)) ?? null]; } catch { return [file, null]; }
  }));
}

// After Land wrote the target, a changed manifest or lockfile leaves the user's
// checkout without the dependencies the sandbox installed. Install them with
// the same command the sandbox setup used. A failure never rolls Land back; it
// is recorded with the exact command to run.
export function postLandInstall({ before, after, sandbox = {}, workspace, pathExists, run }) {
  if (DEPENDENCY_FILES.every((file) => (before?.[file] ?? null) === (after?.[file] ?? null))) return null;
  const plan = workspaceSetupPlan({ sandbox, workspace, pathExists });
  if (!plan) return null;
  const result = run(plan.command, workspace) || {};
  return {
    command: plan.command, source: plan.source, workspace,
    status: result.status === 0 ? "ok" : "failed",
    exitCode: result.status ?? null,
    ...(result.status === 0 ? {} : { detail: String(result.stderr || result.error?.message || "").trim().slice(-400) })
  };
}
import { writeSpecBefore } from "./land-undo.mjs";
import {
  captureCopyBase, copyBaseBytes, copyBaseExecutable, fileSource
} from "./copy-base.mjs";
import {
  ROOT_POINTER_MOVED, repositoryPointerStop, rootPointerMoves, rootPointerRepairMessage
} from "./land-verification.mjs";
import {
  carriedLandedExcludes, landedChangeSyncStop, landedTargetPaths, otherLandedOutput, parseRestoreTargetPaths,
  replayLandedEdit, restorableTargetPaths, targetConflictStop, targetEditCarried,
  targetEditSyncStop
} from "./target-edits.mjs";
import {
  complianceEnabledFromConfig, renderComplianceChangeRecord, renderReviewRecord,
  renderRolloutGates
} from "./validation/process-fields.mjs";
import { outlineRow, sectionHeading } from "./validation/outline-contract.mjs";

// Whether an empty root diff is an acceptable apply outcome rather than an
// error: true when the change selected any non-root repository, because the
// child apply path is then the delivery vehicle and the root may legitimately
// carry nothing — including when exactly one child repository holds the entire
// diff. Requiring a second repository here forced a manual apply for
// single-child changes.
export function emptyRootDiffPermitted(state) {
  return Object.keys(state?.repositories || {})
    .some((repositoryId) => repositoryId !== "root");
}

export function telemetryUsageSatisfied(telemetry) {
  return Boolean(telemetry && (
    ["measured", "no-usage"].includes(telemetry.classification) ||
    Object.values(telemetry.measuredDimensions || {}).some(Boolean)
  ));
}

export function assertLocalApply(initialState, options, fail) {
  if (emptyRootDiffPermitted(initialState) && !options.controlPlane)
    fail("multi-repository sandboxes do not apply as one local transaction; use land plan/record/resume");
}

export function projectionHash(stableHash, entries) {
  return stableHash(entries.map(({ path, after, afterMode }) =>
    ({ path, after, afterMode })));
}

export function reapplyProjection(context) {
  const { id, state, verifyAppliedProjection, buildReapplyEntries, stableHash, fail } = context;
  if (!state.workspace?.applied) return { prepared: null, resumed: false };
  const verification = verifyAppliedProjection(state);
  if (!verification.valid) fail(`applied projection is invalid: ${verification.reason}`);
  const prepared = buildReapplyEntries(id, state, verification.journal);
  const desired = projectionHash(stableHash, prepared);
  if (desired !== state.workspace.apply.projectionHash) {
    if (guardReapplyTargetEdits(context, id, state, prepared, verification.journal))
      return { prepared: buildReapplyEntries(id, state, verification.journal), resumed: false };
    return { prepared, resumed: false };
  }
  console.log(`APPLIED ${id}\n  resumed: ${state.workspace.apply.transactionId}`);
  return { prepared, resumed: true };
}

export function projectionMismatch(entries, {
  safeRootPath,
  pathIdentity,
  pathMode
}, phase) {
  const identityField = phase === "before" ? "before" : "after";
  const modeField = phase === "before" ? "beforeMode" : "afterMode";
  return entries.find((entry) =>
    pathIdentity(safeRootPath(entry.path)) !== entry[identityField] ||
    pathMode(safeRootPath(entry.path)) !== entry[modeField]);
}

export function beginApplyJournal({
  id,
  journal,
  safeRootPath,
  pathIdentity,
  pathMode,
  saveApplyJournal,
  now,
  fail
}) {
  const changed = projectionMismatch(journal.entries, {
    safeRootPath, pathIdentity, pathMode
  }, "before");
  if (changed) {
    journal.status = "aborted";
    journal.failure = `target changed before apply at '${changed.path}'`;
    journal.abortedAt = now();
    saveApplyJournal(journal);
    fail(journal.failure);
  }
  journal.status = "applying";
  saveApplyJournal(journal);
  const counts = projectionCounts(journal.entries);
  console.log(`PROJECTION ${id}\n  update: ${counts.update}; create: ${
    counts.create}; delete: ${counts.delete}`);
}

export function appliedRuntimeState(state, root, journal) {
  state.workspace = {
    ...state.workspace,
    applied: true,
    sandboxPath: state.workspace.path,
    targetPath: root,
    apply: {
      transactionId: journal.transactionId,
      status: "verified",
      projectionHash: journal.projectionHash,
      touchedPaths: journal.entries.map((entry) => entry.path)
    }
  };
  transitionLifecycleState(state, "applied", "projection-verified");
  return state;
}

export function executeApplyJournal({
  id,
  journal,
  root,
  loadRuntime,
  saveRuntime,
  safeRootPath,
  pathIdentity,
  pathMode,
  applyTransactionEntry,
  rollbackApplyTransaction,
  saveApplyJournal,
  now,
  fail
}) {
  const priorTransactionMarker = process.env.FOUNDATION_LAND_TRANSACTION;
  process.env.FOUNDATION_LAND_TRANSACTION = "1";
  try {
    journal.entries.forEach((entry, index) =>
      applyTransactionEntry(journal, entry, index));
    const mismatch = projectionMismatch(journal.entries, {
      safeRootPath, pathIdentity, pathMode
    }, "after");
    if (mismatch) throw new Error(`post-apply projection mismatch at '${mismatch.path}'`);
    const state = appliedRuntimeState(loadRuntime(id), root, journal);
    saveRuntime(state);
    journal.status = "verified";
    journal.verifiedAt = now();
    saveApplyJournal(journal);
    console.log(`APPLIED ${id}\n  mode: ${state.workspace.mode}\n  projection: ${journal.projectionHash}`);
  } catch (error) {
    try {
      rollbackApplyTransaction(journal, error);
    } catch (rollbackError) {
      fail(`${error.message}; ${rollbackError.message}`);
    }
    fail(`${error.message}; transaction rolled back`);
  } finally {
    if (priorTransactionMarker === undefined) delete process.env.FOUNDATION_LAND_TRANSACTION;
    else process.env.FOUNDATION_LAND_TRANSACTION = priorTransactionMarker;
  }
}

// `checkedReadiness` is archive's own landCheck from the same Land pass. That
// check already refused any pending apply, and only the evidence breadcrumb
// was written since, so it is reused instead of recomputed. It is a separate
// positional argument so no CLI flag can ever supply it.
export function applySandboxOperation(context, id, options = {}, checkedReadiness = null) {
  const initialState = context.loadRuntime(id);
  assertLocalApply(initialState, options, context.fail);
  if (initialState.workspace?.applied && options.refresh)
    context.refreshAppliedProjection(initialState);
  context.recoverPendingApply(id, initialState);
  if ((checkedReadiness || context.landCheck(id)).archived) return;
  const state = context.loadRuntime(id);
  const reapply = reapplyProjection({ ...context, id, state });
  if (reapply.resumed) return;
  const journal = context.prepareApplyTransaction(id, state, reapply.prepared);
  beginApplyJournal({ ...context, id, journal });
  executeApplyJournal({ ...context, id, journal });
}

export function sandboxDiffNamesOperation(context, id, sandboxPath, state,
  paths = context.applyPathspec(id, state)) {
  if (!paths.length) return [];
  const tracked = context.git(["diff", "--name-only", "-z", context.sandboxBase(state), "--",
    ...paths], sandboxPath);
  if (tracked.status !== 0)
    context.fail(`cannot inspect sandbox paths: ${tracked.stderr.trim()}`);
  // Read untracked names directly. `git add -N .` used to make them visible to
  // diff, but it also mutated the sandbox index during Land and changed the
  // forced workspace snapshot after a passing proof.
  const untracked = context.git([
    "ls-files", "--others", "--exclude-standard", "-z", "--", ...paths
  ], sandboxPath);
  if (untracked.status !== 0)
    context.fail(`cannot inspect untracked sandbox paths: ${untracked.stderr.trim()}`);
  return [...new Set([
    ...tracked.stdout.split("\0"), ...untracked.stdout.split("\0")
  ].filter(Boolean))].sort();
}

// A recorded `--restore-target` returns those target files to the sandbox
// base inside Land, only while each still holds the exact bytes the
// restore was recorded against; a later edit is a new question. `inspect`
// (the read-only Land preflight) names the paths Land would restore and
// writes nothing.
export function restoreAuthorizedTargetPaths(context, state, names, { inspect = false } = {}) {
  const restore = state.targetRestore;
  if (!restore?.identities) return [];
  const restored = [];
  for (const path of names) {
    if (!Object.hasOwn(restore.identities, path)) continue;
    const target = join(context.root, path);
    if (context.pathIdentity(target) !== restore.identities[path]) continue;
    if (inspect) {
      restored.push(path);
      continue;
    }
    if (restoreTargetBase(context, state, path)) restored.push(path);
  }
  return restored;
}

// Writes the base of `path` back into the target: its base bytes, or no file
// when the base has none. A base that cannot be proven is never guessed.
function restoreTargetBase(context, state, path) {
  const bytes = targetBaseBytes(context, state, path);
  if (bytes === undefined) return false;
  if (bytes === null) context.removePath(join(context.root, path));
  else context.writeFile(join(context.root, path), bytes);
  return true;
}

function targetSnapshot(state) {
  return state.workspace?.targetDirty || state.workspace?.preexisting || {};
}

// A conflict made only of regenerable artifacts that were clean at isolation
// is a test run in the main checkout, not user work. Land returns them to the
// sandbox base itself, once, instead of handing a restore command back.
function restoreRegenerableConflicts(context, state, paths, { inspect = false } = {}) {
  if (!paths.length || !context.writeFile || !context.removePath ||
      restorableTargetPaths(paths, targetSnapshot(state)).length !== paths.length ||
      Object.keys(context.landedBy?.(state.id, paths) || {}).length) return false;
  if (paths.some((path) => targetBaseBytes(context, state, path) === undefined)) return false;
  if (inspect) return true;
  for (const path of paths) restoreTargetBase(context, state, path);
  return true;
}

function baseBlob(context, state, path) {
  const shown = context.gitBuffer(["show", `${context.sandboxBase(state)}:${path}`], context.root);
  return shown.status === 0 ? shown.stdout : null;
}

// The sandbox base bytes of `path`: a worktree's base commit blob, or an
// isolated copy's captured base (undefined when it cannot be proven).
function targetBaseBytes(context, state, path) {
  return state.workspace?.mode === "copy"
    ? copyReapplyBase(context, state).bytes(path) : baseBlob(context, state, path);
}

// Whether the sandbox replay already wrote the current sandbox bytes for every
// landed path and Land still finds them not carried: another automatic sync
// would change nothing, so the agent reconciles instead of the harness looping.
function landedReplayExhausted(context, state, landedPaths) {
  const replayed = state.workspace?.landedReplay || {};
  return landedPaths.every((path) => Object.hasOwn(replayed, path) &&
    replayed[path] === context.pathIdentity(join(state.workspace.path, path)));
}

// The user's uncommitted target edits that touch other lines than the change
// (a clean 3-way merge into the sandbox copy) are carried by the harness: the
// paths and the exact target bytes are recorded here, the automatic sandbox
// sync merges them into the sandbox copies, and Prove runs again before Land
// applies. The target is never written here. A path whose recorded merge Land
// still does not find carried, or whose edit rewrote the same lines, falls
// through to the target-edit conflict decision.
// `inspect` reports the same stop without recording the carry; Land itself
// records it when it reaches the same point.
function carryTargetEdits(context, id, state, paths, landedBy, { inspect = false } = {}) {
  if (!["worktree", "copy"].includes(state.workspace?.mode) || !context.blockWithDecision ||
      !context.saveRuntime) return;
  const sandboxPath = state.workspace.path;
  const replay = context.replayTargetEdit || replayLandedEdit;
  const previous = state.workspace.targetCarried || {};
  const carry = {};
  const conflicts = [];
  for (const path of paths.filter((candidate) => !Object.hasOwn(landedBy, candidate))) {
    const target = context.pathIdentity(join(context.root, path));
    const sandbox = context.pathIdentity(join(sandboxPath, path));
    const exhausted = previous[path]?.target === target && previous[path]?.sandbox === sandbox;
    const result = exhausted ? { status: "conflict" } : replay({
      root: context.root, sandboxPath, path, baseBytes: targetBaseBytes(context, state, path) });
    if (result.status === "merged") carry[path] = target;
    else conflicts.push(path);
  }
  const carried = Object.keys(carry);
  if (!carried.length) return;
  if (!inspect) {
    state.workspace.targetCarry = carry;
    context.saveRuntime(state);
  }
  const stop = targetEditSyncStop({ changeId: id, paths: carried, conflicts });
  context.blockWithDecision(id, stop.code, stop.decision);
}

function stopForTargetConflict(context, id, state, paths, cause, options = {}) {
  const snapshot = targetSnapshot(state);
  // Bytes an earlier change landed are part of the target: the harness first
  // replays the sandbox onto them through its own sync, then proves again.
  // That replay never runs over an applied projection, so there the agent
  // carries the landed bytes instead (target-edit-conflict, landed work kept).
  const landedBy = context.landedBy?.(id, paths) || {};
  const landed = Object.keys(landedBy);
  if (landed.length && context.blockWithDecision && state.workspace?.mode === "worktree" &&
      !state.workspace.applied && !landedReplayExhausted(context, state, landed)) {
    const stop = landedChangeSyncStop({ changeId: id, landedBy });
    return context.blockWithDecision(id, stop.code, stop.decision);
  }
  carryTargetEdits(context, id, state, paths, landedBy, options);
  const stop = targetConflictStop({ changeId: id, paths, snapshot, cause, landedBy });
  if (stop.decision && context.blockWithDecision)
    return context.blockWithDecision(id, stop.code, stop.decision);
  if (stop.decision) return context.fail(stop.decision.summary);
  return context.fail(stop.message, 1, stop.details);
}

// A target mode is carried when the sandbox already has it or the target
// still has the base's executable bit (`baseExecutable`, null when unknown);
// a user `chmod` is not.
function targetModeCarried(context, sandboxPath, path, baseExecutable) {
  const target = context.pathMode(join(context.root, path));
  if (target === context.pathMode(join(sandboxPath, path))) return true;
  if (baseExecutable === null || target === null) return false;
  return Boolean(target & 0o111) === baseExecutable;
}

function gitBaseExecutable(context, state, path) {
  const listed = context.gitBuffer(["ls-tree", context.sandboxBase(state), "--", path],
    context.root);
  const base = listed.status === 0 ? String(listed.stdout).split(" ")[0] : "";
  return ["100644", "100755"].includes(base) ? base === "100755" : null;
}

// The base an isolated copy re-applies against is its baseline manifest. Its
// bytes come from the copy base store, captured now from any source that still
// hashes to the baseline row (target, sandbox copy, or the base commit when the
// copy carried Git). Without them no edit counts as carried (fail closed).
function copyReapplyBase(context, state) {
  const workspace = state.workspace;
  const baseline = workspace.baseline || {};
  return {
    baseState: copyBaselineState(context, baseline),
    executable: (path) => copyBaseExecutable(baseline, path),
    bytes: (path) => {
      captureCopyBase({ root: context.root, baseline, path, sources: [
        fileSource(join(context.root, path)), fileSource(join(workspace.path, path)),
        ...(workspace.baseHead && context.gitBuffer ? [() => baseBlob(context, state, path)] : [])
      ] });
      return copyBaseBytes({ root: context.root, baseline: workspace.baseline, path });
    }
  };
}

// The recorded base of the re-apply guard: a worktree's base commit, or an
// isolated copy's baseline. Null when the sandbox has neither.
function reapplyBase(context, state) {
  const workspace = state.workspace;
  if (workspace?.mode === "copy") return copyReapplyBase(context, state);
  if (workspace?.mode !== "worktree" || !workspace.baseHead || !context.git) return null;
  return {
    baseState: null,
    executable: (path) => gitBaseExecutable(context, state, path),
    bytes: (path) => baseBlob(context, state, path)
  };
}

// Re-apply after an earlier apply: a code path that apply never wrote must
// still be at the sandbox base or already hold the sandbox bytes, the same
// rule as root re-delivery of a composite change. A target edit the sandbox
// copy already carries is not overwritten work; any other edit takes the
// target-edit route (merged into the sandbox, or a decision), never the apply.
export function guardReapplyTargetEdits(context, id, state, entries, priorJournal) {
  const workspace = state.workspace;
  const base = reapplyBase(context, state);
  if (!base) return;
  const prior = new Map((priorJournal?.entries || []).map((entry) => [entry.path, entry]));
  const targetEdits = () => targetOverwrites({ git: context.git, files: context,
    baseState: base.baseState }, context.root, workspace.baseHead,
  entries.filter((entry) => entry.role === "code"), prior)
    .map(({ path }) => path)
    .filter((path) => !(targetModeCarried(context, workspace.path, path, base.executable(path)) &&
      targetEditCarried({ root: context.root, sandboxPath: workspace.path,
        path, baseBytes: base.bytes(path) })));
  let edits = targetEdits();
  // The same restores Land performs before a first apply: a recorded
  // `--restore-target`, or regenerable artifacts clean at isolation. True
  // tells the caller the target moved, so its entries' `before` is stale.
  const restored = Boolean(edits.length && context.writeFile && context.removePath &&
      (restoreAuthorizedTargetPaths(context, state, edits).length ||
        restoreRegenerableConflicts(context, state, edits)));
  if (restored) edits = targetEdits();
  if (!edits.length) return restored;
  stopForTargetConflict(context, id, state, edits,
    "re-apply would overwrite uncommitted target edits");
  context.fail(`re-apply would overwrite uncommitted target edits at: ${edits.join(", ")}`);
}

// `inspect` is the read-only Land preflight: every refusal and decision is
// the one Land raises at this point, but no target path is restored and no
// carry is recorded. A path Land would restore first counts as restored.
export function gitApplyInputsOperation(context, id, sandboxPath,
  { regenerated = false, inspect = false } = {}) {
  const state = context.loadRuntime(id);
  const names = context.sandboxDiffNames(id, sandboxPath, state);
  const restored = new Set(restoreAuthorizedTargetPaths(context, state, names, { inspect }));
  const pending = names.filter((path) => !(inspect && restored.has(path))).filter((path) =>
    context.pathIdentity(join(context.root, path)) !==
      context.pathIdentity(join(sandboxPath, path)) ||
    context.pathMode(join(context.root, path)) !== context.pathMode(join(sandboxPath, path)));
  if (!pending.length) return names;
  const directoryPaths = pending.filter((path) =>
    [join(context.root, path), join(sandboxPath, path)].some((candidate) =>
      context.lstat(candidate, { throwIfNoEntry: false })?.isDirectory()));
  if (directoryPaths.length)
    context.fail(`apply encountered nested repository or directory path(s): ${
      directoryPaths.join(", ")}; register nested repositories in openspec/repositories.yaml before creating the sandbox`);
  const diff = context.gitBuffer([
    "diff", "--binary", context.sandboxBase(state), "--", ...pending
  ], sandboxPath);
  if (diff.status !== 0) context.fail("cannot inspect sandbox diff");
  // A target edit the sandbox copy already carries is not overwritten work,
  // nor is landed work the agent merged by hand into these exact bytes after
  // the sandbox replay reported a same-line conflict.
  const resolvedLanded = (path) => {
    const row = state.workspace?.landedResolved?.[path];
    return Boolean(row) && row.target === context.pathIdentity(join(context.root, path)) &&
      row.sandbox === context.pathIdentity(join(sandboxPath, path));
  };
  const carried = (path) => resolvedLanded(path) || targetEditCarried({
    root: context.root, sandboxPath, path, baseBytes: baseBlob(context, state, path) });
  // An untracked-only or mode-only projection has no Git patch, but the
  // transaction below still copies it and binds its bytes/mode. Patch-check
  // only the tracked part; target-clobber checks still cover every path.
  if (diff.stdout.length) {
    const check = context.spawn("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
      cwd: context.root, input: diff.stdout, encoding: "utf8"
    });
    if (check.status !== 0) {
      const rejected = rejectedPaths(check.stderr);
      if (!rejected.length)
        context.fail(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
      const conflicts = rejected.filter((path) => !carried(path) &&
        !(inspect && restored.has(path)));
      if (conflicts.length && !regenerated &&
          restoreRegenerableConflicts(context, state, conflicts, { inspect })) {
        if (!inspect)
          return gitApplyInputsOperation(context, id, sandboxPath, { regenerated: true });
        // Land restores these and checks again, once; the rest is checked below.
        for (const path of conflicts) restored.add(path);
        regenerated = true;
      } else if (conflicts.length) {
        stopForTargetConflict(context, id, state, conflicts,
          "sandbox diff conflicts with target", { inspect });
      }
    }
  }
  const base = context.sandboxBase(state);
  const workingBlob = (path) => {
    const stats = context.lstat(path, { throwIfNoEntry: false });
    if (!stats) return null;
    return stats.isSymbolicLink()
      ? Buffer.from(context.readlink(path)) : context.readFile(path);
  };
  const clobbered = pending.filter((path) => !(inspect && restored.has(path))).filter((path) => {
    const target = workingBlob(join(context.root, path));
    if (target === null) return false;
    const sandboxContent = workingBlob(join(sandboxPath, path));
    if (sandboxContent !== null && target.equals(sandboxContent)) return false;
    const shown = context.gitBuffer(["show", `${base}:${path}`], context.root);
    return (shown.status !== 0 || !target.equals(shown.stdout)) && !carried(path);
  });
  if (clobbered.length && !regenerated &&
      restoreRegenerableConflicts(context, state, clobbered, { inspect }))
    return inspect ? names
      : gitApplyInputsOperation(context, id, sandboxPath, { regenerated: true });
  if (clobbered.length)
    stopForTargetConflict(context, id, state, clobbered,
      "apply would overwrite uncommitted target edits", { inspect });
  return names;
}

export function copyApplyCodePaths(context, id, state, sandboxPath) {
  const baseline = state.workspace.baseline || {};
  const target = context.workspaceManifest(context.root, id, true);
  const sandbox = context.workspaceManifest(sandboxPath, id, true);
  const codePaths = context.copyCodePaths(id, state);
  for (const path of codePaths) {
    if ((target[path] ?? null) !== (baseline[path] ?? null) &&
        ((target[path] ?? null) !== (sandbox[path] ?? null) ||
         context.pathMode(join(context.root, path)) !==
           context.pathMode(join(sandboxPath, path))))
      context.fail(`isolated-copy conflict at '${path}'`);
  }
  return codePaths;
}

export function applyCodePaths(context, id, state, sandboxPath, options = {}) {
  if (state.workspace.mode === "copy")
    return copyApplyCodePaths(context, id, state, sandboxPath);
  if (state.workspace.mode === "worktree") {
    context.assertTargetHeadUnmoved(id, state);
    return context.gitApplyInputs(id, sandboxPath, options);
  }
  context.fail("change has no isolated sandbox");
}

export function applyCodeEntry(context, sandboxPath, rel) {
  const source = resolve(sandboxPath, rel);
  const target = context.safeRootPath(rel);
  return {
    path: rel,
    role: "code",
    before: context.pathIdentity(target),
    beforeMode: context.pathMode(target),
    after: context.pathIdentity(source),
    afterMode: context.pathMode(source),
    ...(context.pathIdentity(source)?.startsWith("directory:") ? {
      afterEntries: deliveryTreeEntries(sandboxPath, [rel], context.pathIdentity)
    } : {})
  };
}

// A composite Land without a writable root has no root projection, so the
// packet entry above never runs and Build's ticks stay in the sandbox. Merge
// only the ticks back into the root ledger before archive; the root packet
// stays the agreement source for every other line.
export function syncChildOnlyTaskProgress({ repositories, rootTasksPath, sandboxTasksPath,
  mergeTaskProgress, pathExists = existsSync }) {
  if (repositories.some((row) => row.id === "root" && row.mode === "write")) return false;
  if (!pathExists(rootTasksPath) || !pathExists(sandboxTasksPath)) return false;
  const current = readFileSync(rootTasksPath, "utf8");
  const merged = mergeTaskProgress(current, readFileSync(sandboxTasksPath, "utf8"));
  if (merged === current) return false;
  writeFileSync(rootTasksPath, merged);
  return true;
}

export function changeArtifactApplyEntry(context, id, sandboxPath) {
  const changeRel = context.currentChangeRelativePath(id);
  return {
    path: changeRel,
    role: "change-artifacts",
    before: context.pathIdentity(context.changePath(id)),
    beforeMode: context.pathMode(context.changePath(id)),
    after: context.pathIdentity(join(sandboxPath, changeRel)),
    afterMode: context.pathMode(join(sandboxPath, changeRel))
  };
}

export function buildApplyEntriesOperation(context, id, state, options = {}) {
  const sandboxPath = state.workspace.path;
  const entries = [];
  for (const rel of applyCodePaths(context, id, state, sandboxPath, options))
    entries.push(applyCodeEntry(context, sandboxPath, rel));
  entries.push(changeArtifactApplyEntry(context, id, sandboxPath));
  return entries;
}

export function buildReapplyEntriesOperation(context, id, state, priorJournal) {
  const sandboxPath = state.workspace.path;
  const projected = new Map((priorJournal.entries || [])
    .map((entry) => [entry.path, entry]));
  const changeRel = context.currentChangeRelativePath(id);
  const paths = [...new Set([
    ...projected.keys(), ...context.reapplyCodePaths(id, state), changeRel
  ])].sort();
  return paths.map((rel) => {
    const prior = projected.get(rel);
    return {
      path: rel,
      role: prior?.role || (rel === changeRel ? "change-artifacts" : "code"),
      before: prior ? prior.after : context.pathIdentity(context.safeRootPath(rel)),
      beforeMode: prior && Object.prototype.hasOwnProperty.call(prior, "afterMode")
        ? prior.afterMode : context.pathMode(context.safeRootPath(rel)),
      after: context.pathIdentity(resolve(sandboxPath, rel)),
      afterMode: context.pathMode(resolve(sandboxPath, rel))
    };
  });
}

export function assertApplySourceUnchanged(context, id, state, prepared) {
  if (!prepared && context.directoryHash(context.changePath(id)) !==
      state.workspace.changeSourceHash)
    context.fail("active change was edited after the last sandbox sync");
}

export function assertNoChildApplyEntries(context, id, state, entries) {
  const nested = context.nestedRepositoryPathMatcher(context.nestedRepositoryPaths(id, state));
  for (const entry of entries) {
    if (entry.role === "code" && nested(entry.path))
      context.fail(`apply entry '${entry.path}' crosses into a child repository`);
  }
}

export function backupApplyEntries(context, transactionRoot, entries) {
  for (const [index, entry] of entries.entries()) {
    entry.backup = `backup/${index}`;
    if (entry.before !== null)
      context.copyPath(context.safeRootPath(entry.path),
        join(transactionRoot, entry.backup));
  }
}

// Every refusal Apply raises before its first write. Land runs it inside the
// transaction below; the read-only Land preflight (`land check`) runs the same
// function with `inspect`, so both report the same stop.
export function planApplyEntriesOperation(context, id, state, prepared = null, options = {}) {
  assertApplySourceUnchanged(context, id, state, prepared);
  const entries = prepared || context.buildApplyEntries(id, state, options);
  assertNoChildApplyEntries(context, id, state, entries);
  context.assertDeletionsAreDeclared(id, state, entries);
  return entries;
}

export function prepareApplyTransactionOperation(context, id, state, prepared = null) {
  const entries = planApplyEntriesOperation(context, id, state, prepared);
  const transactionId = `apply-${context.dateNow()}-${context.pid}`;
  const transactionRoot = context.applyTransactionRoot(id, transactionId);
  context.makeDirectory(transactionRoot, { recursive: true });
  backupApplyEntries(context, transactionRoot, entries);
  const proof = context.readJson(context.proofPath(id), {});
  const journal = {
    version: 1,
    changeId: id,
    transactionId,
    proofRunId: proof.proofRunId || null,
    mode: state.workspace.mode,
    status: "prepared",
    sandboxPath: state.workspace.path,
    targetPath: context.root,
    projectionHash: projectionHash(context.stableHash, entries),
    entries,
    appliedPaths: [],
    inFlightPaths: [],
    createdAt: context.now()
  };
  context.saveApplyJournal(journal);
  return journal;
}

export function refreshProjectionEntry(context, state, entry) {
  const source = resolve(state.workspace.path, entry.path);
  const expected = context.pathIdentity(source);
  const expectedMode = context.pathMode(source);
  const current = context.pathIdentity(context.safeRootPath(entry.path));
  const currentMode = context.pathMode(context.safeRootPath(entry.path));
  if (current !== expected || currentMode !== expectedMode)
    context.fail(`cannot refresh diverged applied path '${entry.path}'`);
  entry.after = expected;
  entry.afterMode = expectedMode;
}

export function refreshAppliedProjectionOperation(context, state) {
  const transactionId = state.workspace?.apply?.transactionId;
  const journalPath = context.transactionJournalPath(state.id, transactionId);
  if (!transactionId || !context.pathExists(journalPath))
    context.fail("cannot refresh an applied projection without its transaction journal");
  const journal = context.readJson(journalPath);
  for (const entry of journal.entries) refreshProjectionEntry(context, state, entry);
  journal.projectionHash = projectionHash(context.stableHash, journal.entries);
  journal.proofRunId = context.readJson(context.proofPath(state.id), {}).proofRunId || null;
  journal.status = "verified";
  journal.refreshedAt = context.now();
  context.saveApplyJournal(journal);
  state.workspace.apply.projectionHash = journal.projectionHash;
  state.workspace.apply.status = "verified";
  context.saveRuntime(state);
}

export function assertRecoveredProjection(context, id, state, archivedPath) {
  if (!["worktree", "copy"].includes(state.workspace?.mode)) return;
  if (!state.workspace.applied)
    context.fail(`the interrupted archive never projected the sandbox into the target; ` +
      `restore 'openspec/changes/${id}' from '${archivedPath}' and land again`);
  const verification = context.verifyAppliedProjection(state, { archivedChangePath: archivedPath });
  if (!verification.valid)
    context.fail(`recovered archive has an invalid applied projection: ${verification.reason}`);
}

export function assertRecoveredArchiveReadyOperation(context, id, state, archivedPath) {
  context.assertMultiRepositoryArchiveReady(id, state);
  assertRecoveredProjection(context, id, state, archivedPath);
}

const ROLLOUT_GATES_HEADING = Object.freeze({
  en: "Appendix: Rollout gates", th: "ภาคผนวก: gate ของ rollout"
});

function appendixLanguage(value) {
  return /^th\b/i.test(String(value || "")) ? "th" : "en";
}

// The archive-only proposal appendices, rendered from records the runtime
// already holds: the review attempts, the compiled-from draft's compliance
// data (only when openspec/config.yaml enables it) with the spec-approval
// decision, and the deferred post-release rollout gates. "" when none apply.
export function archiveAppendixMarkdown({
  language, reviewAttempts = [], complianceEnabled = false, compliance = null,
  approvalRef = null, rolloutGates = []
} = {}) {
  const lang = appendixLanguage(language);
  const heading = (key) => sectionHeading(outlineRow("proposal", key), lang);
  const sections = [];
  const review = renderReviewRecord(reviewAttempts, { language: lang });
  if (review) sections.push(`## ${heading("reviewRecord")}\n\n${review}`);
  if (complianceEnabled) {
    const record = renderComplianceChangeRecord(compliance, { language: lang, approvalRef });
    if (record) sections.push(`## ${heading("complianceRecord")}\n\n${record}`);
  }
  const gates = renderRolloutGates(rolloutGates, { language: lang });
  if (gates) sections.push(`## ${ROLLOUT_GATES_HEADING[lang]}\n\n${gates}`);
  return sections.join("\n\n");
}

export function createApplyRuntime({
  root,
  transactions,
  loadRuntime,
  saveRuntime,
  selectedRepositories = (_id, state) => [{
    id: "root", type: "git", mode: "write", path: root,
    dependsOn: [], workspacePath: state?.workspace?.path || root
  }],
  workspaceManifest,
  declaredSurfaceMatcher,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  pathMode,
  directoryHash,
  fileDigest,
  pathInside,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  writeJson,
  stableHash,
  syncClaudeTelemetry,
  modelUsageRecorded,
  telemetryReadiness = null,
  foundationPolicy = () => ({ telemetry: { requireUsage: false } }),
  mergeTaskProgress = null,
  saveApplyJournal,
  transactionJournalPath,
  verifyAppliedProjection,
  rollbackApplyTransaction,
  applyTransactionEntry,
  cleanupApplyTransaction,
  git,
  gitBuffer,
  gitHead,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  recoverPendingApply,
  landCheck,
  assertMultiRepositoryArchiveReady,
  archivedChangeRelativePath,
  pendingTasks,
  assertOpenSpecCli,
  proofAudit,
  cleanupChangeLeases,
  now,
  archiveCheckpoint = () => {},
  measure = (_stage, operation) => operation(),
  assertLandGrant = () => {},
  consumeLandGrant = () => {},
  blockWithDecision,
  fail,
  // Archive appendix inputs. All optional: an unwired reader contributes no
  // rows. `reviewAttemptRecords(id)` must not migrate state;
  // `rolloutGates(id)` reads the active packet, so it runs before the move.
  reviewAttemptRecords = () => [],
  rolloutGates = () => [],
  // Every repository the topology declares under root, selected or not: its
  // gitlink is its own pointer, never root projection content.
  declaredRepositoryPaths = () => []
}) {
  function nestedRepositoryPaths(id, state) {
    return [...new Set([...selectedRepositories(id, state)
      .filter((repository) => repository.id !== "root" &&
        repository.relativePath && repository.relativePath !== "." &&
        !repository.relativePath.startsWith("../"))
      .map((repository) => repository.relativePath),
    ...declaredRepositoryPaths()])];
  }

  // Another change's landed bytes the sandbox carries unchanged are that
  // change's Land, not this one's: projecting them could overwrite a target
  // edit made after it.
  function applyPathspec(id, state) {
    return [...sandboxCodePathspec(id, nestedRepositoryPaths(id, state)),
      ...carriedLandedExcludes(state.workspace, pathIdentity)];
  }

  function copyCodePaths(id, state) {
    const baseline = state.workspace.baseline || {};
    if (state.workspace?.mode === "copy" && Object.values(baseline)
      .some((identity) => /^[0-9a-f]{64}$/i.test(String(identity))))
      fail(`copy sandbox '${id}' uses the legacy content-only identity format; recreate the sandbox and prove once before Land so executable modes and symlinks are bound safely`);
    const sandbox = workspaceManifest(state.workspace.path, id, true);
    const nested = nestedRepositoryPathMatcher(nestedRepositoryPaths(id, state));
    return [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
      .filter((path) => baseline[path] !== sandbox[path] && !nested(path) &&
        !isInvestigationPath(path)).sort();
  }

  // Against the base the sandbox branched from, not its HEAD: an agent that
  // commits inside the sandbox moves HEAD, and a HEAD-relative diff would
  // silently omit every committed change while proof — which hashes the
  // sandbox index — still counts it. That lands a partial change as a success.
  function sandboxBase(state) {
    return state.workspace?.baseHead || "HEAD";
  }

  // Paths whose target bytes are still another change's landed, uncommitted
  // projection: path -> landing change id.
  function landedBy(id, paths) {
    if (!paths.length || !transactions) return {};
    return landedTargetPaths({ root, paths, identity: pathIdentity,
      landed: otherLandedOutput({ transactions, changeId: id, readJson }) });
  }

  const sandboxDiffNames = sandboxDiffNamesOperation.bind(null, {
    applyPathspec,
    git,
    sandboxBase,
    fail
  });

  const gitApplyInputs = gitApplyInputsOperation.bind(null, {
    root,
    git,
    loadRuntime,
    sandboxDiffNames,
    pathIdentity,
    pathMode,
    lstat: lstatSync,
    gitBuffer,
    sandboxBase,
    spawn: spawnSync,
    readlink: readlinkSync,
    readFile: readFileSync,
    writeFile: writeFileSync,
    removePath: (path) => rmSync(path, { force: true }),
    landedBy,
    saveRuntime,
    blockWithDecision,
    fail
  });

  // Records the `--restore-target` authorization Land consumes. Regenerable
  // artifacts clean at isolation need none; any other path needs the user's
  // decision reference, because restoring discards target bytes.
  function recordTargetRestore(id, value, decisionRef = null) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    if (!["worktree", "copy"].includes(state.workspace?.mode))
      fail(`change '${id}' has no sandbox whose target files Land could restore`);
    const paths = parseRestoreTargetPaths(value);
    if (!paths.length) fail("--restore-target requires comma-separated target paths");
    for (const path of paths) {
      try { safeRootPath(path); } catch (error) { fail(error.message); }
    }
    const unprovable = state.workspace.mode === "copy" ? paths.filter((path) =>
      targetBaseBytes({ root, gitBuffer, sandboxBase }, state, path) === undefined) : [];
    if (unprovable.length)
      fail(`--restore-target has no recorded base bytes for the isolated copy at: ${
        unprovable.join(", ")}; Land cannot restore them. Merge the target edits into the ` +
        "sandbox copy instead (keep-target).");
    const landed = landedBy(id, paths);
    if (Object.keys(landed).length)
      fail(`--restore-target would discard the landed, uncommitted work of ${
        [...new Set(Object.values(landed))].sort().join(", ")} at: ${Object.keys(landed).sort()
        .join(", ")}; Land never overwrites an earlier landed change. Resume with ` +
        `'claude-foundation advance ${id} --through archived' and it merges that work instead.`);
    const snapshot = state.workspace.targetDirty || state.workspace.preexisting || {};
    const needsDecision = paths.filter((path) =>
      !restorableTargetPaths([path], snapshot).length);
    const ref = String(decisionRef || "").trim() || null;
    if (needsDecision.length && !ref)
      fail(`--restore-target would discard target edits that may be user work at: ${
        needsDecision.join(", ")}; ask the user, then pass --decision-ref <user-decision>`);
    state.targetRestore = {
      paths,
      identities: Object.fromEntries(paths.map((path) =>
        [path, pathIdentity(safeRootPath(path))])),
      decisionRef: ref,
      recordedAt: now()
    };
    saveRuntime(state);
    return state.targetRestore;
  }

  function assertTargetHeadUnmoved(id, state) {
    const currentHead = gitHead(root);
    if (currentHead === state.workspace.baseHead) return;
    blockWithDecision(id, "control-head-moved", targetHeadMovedDecision({
      changeId: id,
      recordedBase: state.workspace.baseHead,
      currentHead,
      multiRepository: compositeRepositorySelection(selectedRepositories(id, state)),
      action: "Applying"
    }));
  }

  const buildApplyEntries = buildApplyEntriesOperation.bind(null, {
    root,
    workspaceManifest,
    copyCodePaths,
    pathMode,
    assertTargetHeadUnmoved,
    gitApplyInputs,
    safeRootPath,
    pathIdentity,
    currentChangeRelativePath,
    changePath,
    fail
  });

  // Paths the sandbox still wants to project once the target already carries a
  // prior projection. The virgin-target conflict guards in buildApplyEntries
  // cannot run here: after a first apply the target legitimately differs from
  // the baseline. Divergence is caught instead by matching each entry's
  // 'before' against what the previous transaction actually projected.
  function reapplyCodePaths(id, state) {
    const sandboxPath = state.workspace.path;
    if (state.workspace.mode === "copy") {
      return copyCodePaths(id, state);
    }
    if (state.workspace.mode !== "worktree") fail("change has no isolated sandbox");
    assertTargetHeadUnmoved(id, state);
    return sandboxDiffNames(id, sandboxPath, state);
  }

  // The full projection, not just the delta, so verifyAppliedProjection keeps
  // covering every path the change owns.
  const buildReapplyEntries = buildReapplyEntriesOperation.bind(null, {
    currentChangeRelativePath,
    reapplyCodePaths,
    pathIdentity,
    safeRootPath,
    pathMode
  });

  function assertDeletionsAreDeclared(id, state, entries) {
    // Apply projects the root workspace; child repositories land by commit.
    const undeclared = undeclaredDeletions(entries,
      declaredSurfaceMatcher(id, state, "root"));
    if (!undeclared.length) return;
    const preview = undeclared.slice(0, 10).map((entry) => entry.path);
    fail(`apply would delete ${undeclared.length} path(s) no task declares: ${
      preview.join(", ")}${undeclared.length > preview.length ? ", ..." : ""
    }. A deletion has to come from a removal observed inside the sandbox, not ` +
      "from a path missing from its manifest; declare the path in tasks.md " +
      "`[paths:]` if the change really owns it.");
  }

  const prepareContext = {
    root,
    directoryHash,
    changePath,
    buildApplyEntries,
    nestedRepositoryPathMatcher,
    nestedRepositoryPaths,
    assertDeletionsAreDeclared,
    dateNow: Date.now,
    pid: process.pid,
    applyTransactionRoot,
    makeDirectory: mkdirSync,
    copyPath,
    safeRootPath,
    readJson,
    proofPath,
    stableHash,
    now,
    saveApplyJournal,
    fail
  };
  const prepareApplyTransaction = prepareApplyTransactionOperation.bind(null, prepareContext);
  const planApplyEntries = planApplyEntriesOperation.bind(null, prepareContext);

  const refreshAppliedProjection = refreshAppliedProjectionOperation.bind(null, {
    transactionJournalPath,
    pathExists: existsSync,
    readJson,
    pathIdentity,
    pathMode,
    safeRootPath,
    stableHash,
    proofPath,
    now,
    saveApplyJournal,
    saveRuntime,
    fail
  });

  const applySandbox = applySandboxOperation.bind(null, {
    root,
    git,
    gitBuffer,
    writeFile: writeFileSync,
    removePath: (path) => rmSync(path, { force: true }),
    sandboxBase,
    landedBy,
    blockWithDecision,
    loadRuntime,
    saveRuntime,
    refreshAppliedProjection,
    recoverPendingApply,
    landCheck,
    verifyAppliedProjection,
    buildReapplyEntries,
    stableHash,
    prepareApplyTransaction,
    safeRootPath,
    pathIdentity,
    pathMode,
    saveApplyJournal,
    applyTransactionEntry,
    rollbackApplyTransaction,
    now,
    fail
  });

  // The multi-repository delivery saga is only needed when a non-root
  // repository is selected; single-repository Apply never constructs it.
  let repositoryDeliverySaga = null;
  const repositoryDelivery = () => repositoryDeliverySaga ||= createRepositoryDeliverySaga({
    root,
    transactions,
    loadRuntime,
    saveRuntime,
    selectedRepositories,
    git,
    gitHead,
    fileDigest,
    directoryHash,
    pathInside,
    readJson,
    writeJson,
    stableHash,
    proofPath,
    now,
    prepareRoot: prepareApplyTransaction,
    planRoot: (id, state, options) => planApplyEntries(id, state, null, options),
    executeRoot: (id, journal) => {
      beginApplyJournal({
        id, journal, safeRootPath, pathIdentity, pathMode,
        saveApplyJournal, now, fail
      });
      executeApplyJournal({
        id, journal, root, loadRuntime, saveRuntime, safeRootPath,
        pathIdentity, pathMode, applyTransactionEntry,
        rollbackApplyTransaction, saveApplyJournal, now, fail
      });
    },
    verifyRoot: verifyAppliedProjection,
    // The single-repository reapply rule, for the root of a composite change:
    // the whole projection again, or null when the delivered one is current.
    reapplyRoot: (id, state, verification) => {
      const entries = buildReapplyEntries(id, state, verification.journal);
      return projectionHash(stableHash, entries) === state.workspace.apply.projectionHash
        ? null : entries;
    },
    cleanupRoot: cleanupApplyTransaction,
    fail
  });

  function currentSpecText(capability) {
    const path = join(root, "openspec", "specs", capability, "spec.md");
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  function captureSpecSyncInputs(id, packet = changePath(id)) {
    const dir = join(packet, "specs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() &&
        existsSync(join(dir, entry.name, "spec.md")))
      .map((entry) => ({
        capability: entry.name,
        delta: readFileSync(join(dir, entry.name, "spec.md"), "utf8"),
        before: currentSpecText(entry.name)
      }));
  }

  // `openspec archive` leaves the merged spec ending in a blank line, which
  // `git diff --check` reports after Land. Trim only the specs this change
  // wrote, before verification and the delivery-integrity record.
  function settleArchivedSpecEndings(captured) {
    for (const { capability } of captured) {
      const path = join(root, "openspec", "specs", capability, "spec.md");
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      const settled = text.replace(/\n+$/, "\n");
      if (settled !== text && settled.trim()) writeFileSync(path, settled);
    }
  }

  function verifyArchivedSpecs(captured) {
    return captured.flatMap(({ capability, delta, before }) =>
      verifySpecSync({ before, after: currentSpecText(capability), delta })
        .violations.map((violation) => ({ capability, ...violation })));
  }

  function recordDeliveryIntegrity(state, archivedPath, captured = [], modeBound = true) {
    if (typeof pathIdentity !== "function" || !archivedPath) return;
    const paths = [archivedPath, ...captured.map(({ capability }) =>
      `openspec/specs/${capability}/spec.md`)];
    state.deliveryIntegrity = {
      version: modeBound ? 2 : 1,
      createdAt: now(),
      entries: deliveryTreeEntries(root, [...new Set(paths)], pathIdentity)
    };
  }

  // Not a dead end: the inputs are retained, so after the agent repairs the
  // listed openspec/specs files, `advance --through archived` re-verifies the
  // merge from them and finishes the archive.
  function failSpecSync(violations) {
    fail(`archived specs do not match the change delta:\n${violations
      .map((violation) => `  ${violation.capability}/${violation.requirement || "-"}: ${
        violation.detail}`).join("\n")}\nRepair each listed openspec/specs/<capability>/spec.md so ` +
      "it carries the change delta; Land re-verifies the merge from the retained inputs.",
    1, { owner: "agent", boundary: "spec-sync", code: "SPEC_SYNC_VIOLATION" });
  }

  // The part of the spec-sync gate the pre-archive spec and the delta already
  // decide. The delta is read where archive will read it: the sandbox packet
  // Apply is about to project, or the active packet once it is applied.
  function assertSpecSyncPreflight(id, state) {
    const workspace = state.workspace;
    const packet = ["worktree", "copy"].includes(workspace?.mode) && workspace.path &&
      !workspace.applied ? join(workspace.path, currentChangeRelativePath(id)) : changePath(id);
    const violations = captureSpecSyncInputs(id, packet).flatMap(({ capability, delta, before }) =>
      predictSpecSync({ before, delta }).violations.map((violation) => ({ capability, ...violation })));
    if (!violations.length) return;
    fail(`archive would not carry the change delta into openspec/specs:\n${violations
      .map((violation) => `  ${violation.capability}/${violation.requirement || "-"}: ${
        violation.detail}`).join("\n")}\nRepair each listed delta in openspec/changes/${id}/specs ` +
      "against the current openspec/specs/<capability>/spec.md, prove again, and resume with " +
      `'claude-foundation advance ${id} --through archived'.`,
    1, { owner: "agent", boundary: "spec-sync", code: "SPEC_SYNC_VIOLATION" });
  }

  // Land's shared pre-mutation preflight: every refusal Apply, the repository
  // delivery saga, and the spec-sync gate can already decide before Land
  // writes anything. `land check` runs it with `inspect` (nothing restored,
  // recorded, or journaled); Land runs it with recording allowed, so a carry
  // the automatic sync needs is recorded exactly as Apply would record it.
  function landPreflight(id, state = loadRuntime(id), { inspect = true } = {}) {
    if (state.status === "archived" || specSyncPending(id, state)) return;
    if (["worktree", "copy"].includes(state.workspace?.mode)) {
      if (compositeRepositorySelection(selectedRepositories(id, state))) {
        if (!legacyRepositoryLandTransaction(state)) {
          // The saga's typed error, reported through the command boundary so
          // `land check` prints a refusal instead of an uncaught exception.
          try { repositoryDelivery().preflight(id, { inspect }); }
          catch (error) {
            if (!(error instanceof RepositoryDeliveryError)) throw error;
            fail(error.message, 1, { code: error.code, owner: error.owner,
              boundary: error.boundary, ...(error.decision ? { decision: error.decision } : {}) });
          }
        }
      } else if (!state.workspace.applied) {
        planApplyEntries(id, state, null, { inspect });
      }
    }
    assertSpecSyncPreflight(id, state);
  }

  // The gate can only fire once the change is already recorded archived, so a
  // retry would otherwise take the early return and land the corrupted specs.
  // Re-verifying from the inputs captured before the merge means a repaired spec
  // tree clears the block on its own, with no one hand-editing runtime state.
  function outstandingSpecSync(state) {
    const captured = state.specSyncInputs;
    return Array.isArray(captured) && captured.length
      ? verifyArchivedSpecs(captured) : state.specSyncViolations || [];
  }

  const assertRecoveredArchiveReady = assertRecoveredArchiveReadyOperation.bind(null, {
    root,
    assertMultiRepositoryArchiveReady,
    verifyAppliedProjection,
    fail
  });

  // OpenSpec already moved the packet and merged the specs, but the merge was
  // not yet verified (a crash, or a violation the user is repairing).
  function specSyncPending(id, state = loadRuntime(id)) {
    return state.status !== "archived" && state.land?.status === "specs-archived" &&
      !existsSync(changePath(id));
  }

  // The change becomes `archived` only here, once the merged specs verify;
  // cleanup then resumes exactly as for any archived change.
  function completeSpecSync(id, state) {
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    transitionLifecycleState(state, "archived", "openspec-archive-complete");
    state.archivedAt ||= now();
    state.archivedChangePath ||= archivedChangeRelativePath(id);
    saveRuntime(state);
    resumeArchivedChange(id, state);
  }

  function resumeArchivedChange(id, state) {
    // A Land interrupted after the archive command settles the merged specs
    // here; once delivery integrity is recorded the specs are never rewritten.
    if (!state.deliveryIntegrity && Array.isArray(state.specSyncInputs))
      settleArchivedSpecEndings(state.specSyncInputs);
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    if (!state.deliveryIntegrity && Array.isArray(state.specSyncInputs) &&
        typeof pathIdentity === "function") {
      const archivedPath = state.archivedChangePath || archivedChangeRelativePath(id);
      if (archivedPath) {
        stripArchiveAppendix(state, archivedPath);
        assertRetainedArchiveIntegrity(id, state, archivedPath);
        appendArchiveAppendix(state, archivedPath);
        recordDeliveryIntegrity(state, archivedPath, state.specSyncInputs,
          Array.isArray(state.land?.archivePacketEntries));
        saveRuntime(state);
      }
    }
    if (state.specSyncViolations || Array.isArray(state.specSyncInputs)) {
      delete state.specSyncViolations;
      delete state.specSyncInputs;
      saveRuntime(state);
    }
    let resumed = false;
    if (state.workspace &&
        !["removed", "not-needed"].includes(state.workspace.cleanup?.status)) {
      state.workspace.cleanup = cleanupAppliedSandbox(id, state);
      state.land = {
        ...(state.land || {}),
        status: state.workspace.cleanup.status === "removed"
          ? "sandbox-cleaned" : "archive-audited",
        resumedAt: now()
      };
      resumed = true;
    }
    if (state.workspace?.apply &&
        state.workspace.apply.cleanup?.status !== "committed") {
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
      resumed = true;
    }
    if (state.repositories && !state.repositoryCleanup) {
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
      resumed = true;
    }
    if (resumed) saveRuntime(state);
    cleanupChangeLeases(id);
    consumeLandGrant(id);
    // Quiet under `advance`, so the envelope carries it as a signal too.
    emitSignal("already-archived", `ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`,
      (line) => console.log(line));
  }

  function recoverInterruptedArchive(id, state, archivedPath) {
    // Recovery cannot tell "succeeded then crashed" from "moved then failed",
    // so it is not an exemption from the Land guards. Everything still
    // checkable once the change directory has moved is checked here, before
    // any state is written: a refusal has to leave the change recoverable.
    stripArchiveAppendix(state, archivedPath);
    assertRecoveredArchiveReady(id, state, archivedPath);
    assertRetainedArchiveIntegrity(id, state, archivedPath);
    // The move may have finished before the specs were settled; settle them
    // before verification and the integrity record, as an uninterrupted Land does.
    if (!state.deliveryIntegrity && Array.isArray(state.specSyncInputs))
      settleArchivedSpecEndings(state.specSyncInputs);
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    transitionLifecycleState(state, "archived", "interrupted-archive-recovered");
    state.archivedAt ||= now();
    state.archivedChangePath = archivedPath;
    state.land = {
      ...(state.land || {}),
      status: "archive-audited",
      recoveredAt: now()
    };
    appendArchiveAppendix(state, archivedPath);
    recordDeliveryIntegrity(state, archivedPath,
      Array.isArray(state.specSyncInputs) ? state.specSyncInputs : [],
      Array.isArray(state.land.archivePacketEntries));
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    cleanupChangeLeases(id);
    delete state.workspace.baseline;
    delete state.specSyncInputs;
    delete state.specSyncViolations;
    saveRuntime(state);
    consumeLandGrant(id);
    console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
  }

  function assertRetainedArchiveIntegrity(id, state, archivedPath) {
    if (state.specApproval?.required &&
        (state.specApproval.revision !== Number(state.contractRevision || 0) ||
        !approvalMatches(state.specApproval.identity, root,
          archivedPath.slice("openspec/changes/".length))))
      fail("interrupted archive no longer matches the approved agreement; preserve both versions and restore the approved packet before retrying Land");
    if (state.land?.archivePacketEntries) {
      const active = `openspec/changes/${id}`;
      assertDeliveryEntries(root, state.land.archivePacketEntries.map((entry) => ({
        ...entry, path: archivedPath + entry.path.slice(active.length)
      })), pathIdentity);
    }
  }

  function archiveRecoveryReady(id) {
    const state = loadRuntime(id);
    // Only verification remains; completeSpecSync re-checks it before archiving.
    if (specSyncPending(id, state)) return true;
    if (state.status === "archived" || state.land?.status !== "archive-prepared" ||
        existsSync(changePath(id))) return false;
    const archivedPath = archivedChangeRelativePath(id);
    if (!archivedPath) return false;
    assertRecoveredArchiveReady(id, state, archivedPath);
    assertRetainedArchiveIntegrity(id, state, archivedPath);
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) failSpecSync(outstanding);
    return true;
  }

  function recoverArchive(id, authorizeLand) {
    if (loadRuntime(id).status === "archived" || specSyncPending(id)) {
      archive(id);
      return true;
    }
    if (!archiveRecoveryReady(id)) return false;
    authorizeLand(id);
    archive(id);
    return true;
  }

  function snapshotArchiveEvidence(id, readiness) {
    const journal = loadRuntime(id);
    const proof = readJson(proofPath(id), {});
    journal.land = {
      ...(journal.land || {}),
      status: "evidence-snapshotted",
      proofRunId: proof.proofRunId || null,
      assurance: readiness.assurance,
      updatedAt: now()
    };
    saveRuntime(journal);
  }

  // A declared repository's pointer moved in the root sandbox is excluded from
  // the root projection; it becomes a decision before any target write instead
  // of a silent drop.
  function assertRootPointersUnmoved(id, state) {
    if (state.workspace?.mode !== "worktree" || !state.workspace.path ||
        legacyRepositoryLandTransaction(state)) return;
    const paths = nestedRepositoryPaths(id, state);
    if (!paths.length) return;
    const raw = git(["diff", "--cached", "--raw", "-z", "--no-abbrev", "--no-renames",
      sandboxBase(state), "--", ...paths], state.workspace.path);
    if (raw.status !== 0)
      fail(`cannot inspect repository pointers in the root sandbox: ${
        String(raw.stderr || "").trim()}`);
    const moves = rootPointerMoves(raw.stdout);
    if (!moves.length) return;
    const owners = new Map(selectedRepositories(id, state)
      .filter((repository) => repository.id !== "root" && repository.relativePath)
      .map((repository) => [repository.relativePath.replace(/\/+$/, ""), repository]));
    // Selecting another repository widens scope: only that is the user's call.
    const unselected = moves.filter((move) => !owners.has(move.path));
    if (unselected.length) {
      const stop = repositoryPointerStop({ changeId: id, moves: unselected });
      blockWithDecision(id, stop.code, stop.decision);
    }
    fail(rootPointerRepairMessage({
      changeId: id, rootSandbox: state.workspace.path,
      moves: moves.map((move) => {
        const repository = owners.get(move.path);
        return { ...move, repositoryId: repository.id,
          sandboxPath: state.repositories?.[repository.id]?.path || repository.workspacePath };
      })
    }), 1, { owner: "agent", boundary: "land-verification", code: ROOT_POINTER_MOVED });
  }

  function applyArchiveWorkspace(id, readiness) {
    if (!["worktree", "copy"].includes(readiness.state.workspace?.mode))
      return readiness;
    assertRootPointersUnmoved(id, readiness.state);
    const composite = compositeRepositorySelection(selectedRepositories(id, readiness.state));
    const installs = !composite && typeof pathIdentity === "function";
    const dependenciesBefore = installs ? dependencySnapshot(root, pathIdentity) : null;
    measure("land.apply", () => {
      if (composite) {
        // Legacy repository Land records already name commits applied by the
        // user. Their root gitlinks are staged by resumeLand; replaying the
        // workspace-uncommitted delivery saga would misclassify those expected
        // child HEADs as target drift.
        if (!legacyRepositoryLandTransaction(readiness.state)) repositoryDelivery().apply(id);
        if (typeof mergeTaskProgress === "function") syncChildOnlyTaskProgress({
          repositories: selectedRepositories(id, readiness.state), mergeTaskProgress,
          rootTasksPath: join(changePath(id), "tasks.md"),
          sandboxTasksPath: join(readiness.state.workspace.path, currentChangeRelativePath(id), "tasks.md")
        });
      }
      else applySandbox(id, { controlPlane: true }, readiness);
    });
    const install = !installs ? null : measure("land.install", () => postLandInstall({
      before: dependenciesBefore, after: dependencySnapshot(root, pathIdentity),
      sandbox: foundationPolicy().sandbox || {}, workspace: root, pathExists: existsSync,
      run: (command, cwd) => spawnSync("sh", ["-c", command], {
        cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        timeout: Number(foundationPolicy().sandbox?.setupTimeoutMs) || 600000
      })
    }));
    if (install?.status === "ok") console.log(`LAND ${id}: dependencies installed (${install.command})`);
    else if (install) console.error(`WARNING: Land applied the change but the dependency install failed ` +
      `(exit ${install.exitCode}); run \`${install.command}\` in ${install.workspace}`);
    const journal = loadRuntime(id);
    journal.land = { ...journal.land, status: "code-applied", ...(install ? { dependencyInstall: install } : {}),
      updatedAt: now() };
    saveRuntime(journal);
    // Post-apply readiness binds the hash recorded before the destructive
    // OpenSpec archive; it is never reused.
    return measure("land.check", () => landCheck(id));
  }

  function recordArchiveTelemetry(id, state) {
    const telemetry = telemetryReadiness?.(id) || null;
    state.land = {
      ...(state.land || {}),
      telemetry: telemetry ? {
        classification: telemetry.classification,
        reason: telemetry.reason,
        correlatedHosts: telemetry.correlatedHosts,
        measuredDimensions: telemetry.measuredDimensions
      } : null,
      updatedAt: now()
    };
    saveRuntime(state);
    if (telemetry && !["measured", "no-usage"].includes(telemetry.classification)) {
      console.error(telemetry.classification === "not-ingested"
        ? "WARNING: no model usage was imported for this change; cost and token columns stay empty — telemetry not-ingested"
        : telemetryUsageSatisfied(telemetry)
          ? `WARNING: telemetry ${telemetry.classification}; unavailable dimensions remain empty`
          : `WARNING: telemetry ${telemetry.classification}; cost and token columns may stay empty`);
    }
    return telemetry;
  }

  // Rendered while the active packet still exists (rollout gates read it) and
  // kept in the Land record, so a resumed Land appends the same text.
  function prepareArchiveAppendix(id, state) {
    const draft = state.draftSource?.draft || {};
    let configText = "";
    try { configText = readFileSync(join(root, "openspec", "config.yaml"), "utf8"); } catch {}
    const read = (reader) => { try { return reader(id, state) || []; } catch { return []; } };
    return {
      markdown: archiveAppendixMarkdown({
        language: draft.language || state.documentLanguage,
        reviewAttempts: read(reviewAttemptRecords),
        complianceEnabled: complianceEnabledFromConfig(configText),
        compliance: draft.compliance || null,
        approvalRef: state.specApproval?.decisionRef || null,
        rolloutGates: read(rolloutGates)
      })
    };
  }

  // Volatile records (review, compliance, rollout) are written only into the
  // archived proposal, after the merged specs verify and before the delivery
  // integrity record binds the archived tree. The pre-append byte length is
  // recorded first, so a resumed Land can restore the exact archived packet
  // (whose identity the approval and projection checks bind) and append again.
  function appendArchiveAppendix(state, archivedPath) {
    const appendix = state.land?.archiveAppendix;
    if (!appendix?.markdown || !archivedPath) return;
    const proposal = join(root, archivedPath, "proposal.md");
    if (!existsSync(proposal)) return;
    stripArchiveAppendix(state, archivedPath);
    const original = readFileSync(proposal);
    state.land.archiveAppendix = { ...appendix, offset: original.length };
    saveRuntime(state);
    const separator = original.length && !original.toString("utf8").endsWith("\n") ? "\n\n" : "\n";
    writeFileSync(proposal, Buffer.concat([original,
      Buffer.from(`${separator}${appendix.markdown}\n`, "utf8")]));
  }

  function stripArchiveAppendix(state, archivedPath) {
    const offset = state.land?.archiveAppendix?.offset;
    if (!Number.isInteger(offset) || !archivedPath) return;
    const proposal = join(root, archivedPath, "proposal.md");
    if (existsSync(proposal)) {
      const bytes = readFileSync(proposal);
      if (bytes.length > offset &&
          bytes.subarray(offset).toString("utf8").includes(state.land.archiveAppendix.markdown))
        writeFileSync(proposal, bytes.subarray(0, offset));
    }
    const { offset: _offset, ...rest } = state.land.archiveAppendix;
    state.land.archiveAppendix = rest;
    saveRuntime(state);
  }

  function runOpenSpecArchive(id, state, readiness) {
    const preArchiveWorkspaceHash = readiness.hash;
    // 'openspec archive' moves the change out of openspec/changes and rewrites
    // openspec/specs in one step, so the delta and the pre-merge spec text can
    // only be read now.
    const specSyncInputs = captureSpecSyncInputs(id);
    // This is the recovery record for the destructive OpenSpec move. Persist it
    // before the command so a crash after the move can still verify the merge.
    state.specSyncInputs = specSyncInputs;
    state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
    // The spec text OpenSpec rewrites is kept beside the Land journal, not in
    // the runtime record, so `advance --undo-land` can restore it later.
    if (state.workspace?.apply?.transactionId && applyTransactionRoot && writeJson)
      writeSpecBefore(applyTransactionRoot(id, state.workspace.apply.transactionId),
        specSyncInputs, writeJson);
    state.land = { ...state.land, status: "archive-prepared", updatedAt: now(),
      archiveAppendix: prepareArchiveAppendix(id, state),
      ...(typeof pathIdentity === "function" ? {
        archivePacketEntries: deliveryTreeEntries(root, [`openspec/changes/${id}`], pathIdentity)
      } : {}) };
    saveRuntime(state);
    // landCheck already gated this; repeated here because it is the last point
    // before the destructive step and the CLI can disappear in between.
    assertOpenSpecCli(root, fail);
    archiveCheckpoint("before-archive-command", state);
    const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: root, encoding: "utf8" });
    if (cli.status !== 0) fail(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
    archiveCheckpoint("after-archive-command", state);
    state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
    state.archivedChangePath = archivedChangeRelativePath(id);
    // `land.status` is a breadcrumb, not the saga's position. Resume branches on
    // `workspace.cleanup?.status` and `repositoryCleanup` — never on this — so
    // reading it to work out where a Land stopped will give a confident wrong
    // answer. Named here because it reads exactly like a checkpoint.
    state.land = { ...state.land, status: "specs-archived", updatedAt: now() };
    saveRuntime(state);
    // A merge that silently drops or rewrites a requirement still exits 0, and
    // openspec/specs is durable, so the exit code is not evidence.
    archiveCheckpoint("before-spec-sync-verification", state);
    settleArchivedSpecEndings(specSyncInputs);
    const specViolations = verifyArchivedSpecs(specSyncInputs);
    if (specViolations.length) {
      state.specSyncViolations = specViolations;
      // Only retained on failure: the retry guard needs the pre-merge text to
      // re-verify, and carrying it on the happy path would bloat every state file.
      state.specSyncInputs = specSyncInputs;
      saveRuntime(state);
      failSpecSync(specViolations);
    }
    appendArchiveAppendix(state, state.archivedChangePath);
    // `archived` is reported only once the merged specs verify; a crash or a
    // violation before this resumes through interrupted-archive recovery,
    // which re-verifies from the retained inputs.
    transitionLifecycleState(state, "archived", "openspec-archive-complete");
    state.archivedAt = now();
    recordDeliveryIntegrity(state, state.archivedChangePath, specSyncInputs);
    delete state.specSyncInputs;
    delete state.specSyncViolations;
    saveRuntime(state);
    archiveCheckpoint("after-spec-sync-verification", state);
    return cli;
  }

  function finalizeArchivedChange(id, state, telemetry, cli) {
    archiveCheckpoint("before-final-audit", state);
    archiveCheckpoint("after-final-audit", state);
    state.land = { ...state.land, status: "archive-audited", updatedAt: now() };
    archiveCheckpoint("before-cleanup", state);
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories &&
        compositeRepositorySelection(selectedRepositories(id, state)))
      repositoryDelivery().cleanup(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    cleanupChangeLeases(id);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    delete state.workspace.baseline;
    state.land.status = "sandbox-cleaned";
    saveRuntime(state);
    consumeLandGrant(id);
    archiveCheckpoint("after-cleanup", state);
    if (!state.archivedChangePath)
      console.error("WARNING: OpenSpec reported success but the archived change directory was not found");
    if (["failed", "refused"].includes(state.workspace.cleanup.status))
      console.error(`WARNING: sandbox cleanup ${state.workspace.cleanup.status}: ${state.workspace.cleanup.reason}`);
    if (!telemetry && !modelUsageRecorded(id))
      console.error(`WARNING: no model usage was imported for this change; cost and token columns stay empty — claude-foundation telemetry sync ${id} [transcript.jsonl]`);
    console.log(cli.stdout.trim());
    const assurance = state.land?.assurance?.status || "legacy-unknown";
    console.log(`LANDED ${id}\n  assurance: ${assurance}\n  lifecycle: archived`);
  }

  function archive(id) {
    const initial = loadRuntime(id);
    if (initial.status === "archived") {
      resumeArchivedChange(id, initial);
      return;
    }
    if (specSyncPending(id, initial)) {
      completeSpecSync(id, initial);
      return;
    }
    assertLandGrant(id);
    const recoveredArchive = !existsSync(changePath(id)) &&
      archivedChangeRelativePath(id);
    if (recoveredArchive) {
      recoverInterruptedArchive(id, initial, recoveredArchive);
      return;
    }
    // Drain before the first readiness report so archive cannot print
    // `telemetry: not-ingested` and then ingest the missing rows moments later.
    // Telemetry stays advisory: an absent or unreadable transcript never gates
    // Land.
    archiveCheckpoint("before-telemetry-drain", initial);
    try { syncClaudeTelemetry(id, { quiet: true }); } catch { /* warned below */ }
    archiveCheckpoint("after-telemetry-drain", initial);
    // Explicit Land authority may recover an interrupted mechanical apply.
    // Prepared/applying journals are rolled back safely; only a divergent
    // manual-recovery journal becomes a user work decision.
    recoverPendingApply(id, initial);
    let readiness = measure("land.check", () => landCheck(id, { preflight: "apply" }));
    if (readiness.archived) return;
    // Land never archives unproven work. landCheck already refuses it; this
    // repeats the gate at the last point before any target mutation.
    if (readiness.assurance?.status !== "passed")
      fail(`Land requires current passing proof for '${id}' (assurance: ${
        readiness.assurance?.status || "unknown"})\n  next: claude-foundation advance ${id} --through archived`);
    archiveCheckpoint("before-evidence-snapshot", readiness.state);
    snapshotArchiveEvidence(id, readiness);
    archiveCheckpoint("after-evidence-snapshot", readiness.state);
    // Unconditional, including when the sandbox is already applied: work done
    // after the first projection is proven and would otherwise archive as a
    // success while the target still holds the earlier code. applySandbox
    // returns early by itself when the projection is already current.
    archiveCheckpoint("before-code-apply", readiness.state);
    readiness = applyArchiveWorkspace(id, readiness);
    assertMultiRepositoryArchiveReady(id, readiness.state);
    archiveCheckpoint("after-code-apply", readiness.state);
    // Re-read rather than reuse readiness.state: on the no-sandbox path that
    // object predates the journal write above, and saving it below would
    // silently erase land.proofRunId from the record.
    const state = loadRuntime(id);
    const telemetry = recordArchiveTelemetry(id, state);
    const cli = measure("land.archive", () => runOpenSpecArchive(id, state, readiness));
    measure("land.cleanup", () => finalizeArchivedChange(id, state, telemetry, cli));
  }

  return {
    gitApplyInputs,
    recordTargetRestore,
    buildApplyEntries,
    prepareApplyTransaction,
    refreshAppliedProjection,
    applySandbox,
    archiveRecoveryReady,
    recoverArchive,
    archive,
    landPreflight
  };
}
