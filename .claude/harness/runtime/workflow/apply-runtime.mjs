import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { verifySpecSync } from "./spec-sync-verify.mjs";
import {
  projectionCounts, targetHeadMovedDecision, undeclaredDeletions
} from "./apply-recovery.mjs";
import {
  nestedRepositoryPathMatcher, sandboxCodePathspec
} from "../core/workspace-surface.mjs";
import { transitionLifecycleState } from "../core/lifecycle-reducer.mjs";
import { compositeRepositorySelection } from "../core/repository-binding.mjs";
import { createRepositoryDeliverySaga } from "./repository-delivery-saga.mjs";

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

export function telemetryLandIssue(policy, telemetry) {
  // Usage measurement is operational evidence, not product correctness or
  // delivery authority. Missing host telemetry stays explicit and recoverable
  // but can never strand a proven local delivery.
  return null;
}

export function assertLocalApply(initialState, options, fail) {
  if (emptyRootDiffPermitted(initialState) && !options.controlPlane)
    fail("multi-repository sandboxes do not apply as one local transaction; use land plan/record/resume");
}

export function projectionHash(stableHash, entries) {
  return stableHash(entries.map(({ path, after, afterMode }) =>
    ({ path, after, afterMode })));
}

export function reapplyProjection({
  id,
  state,
  verifyAppliedProjection,
  buildReapplyEntries,
  stableHash,
  fail
}) {
  if (!state.workspace?.applied) return { prepared: null, resumed: false };
  const verification = verifyAppliedProjection(state);
  if (!verification.valid) fail(`applied projection is invalid: ${verification.reason}`);
  const prepared = buildReapplyEntries(id, state, verification.journal);
  const desired = projectionHash(stableHash, prepared);
  if (desired !== state.workspace.apply.projectionHash)
    return { prepared, resumed: false };
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

export function applySandboxOperation(context, id, options = {}) {
  const initialState = context.loadRuntime(id);
  assertLocalApply(initialState, options, context.fail);
  if (initialState.workspace?.applied && options.refresh)
    context.refreshAppliedProjection(initialState);
  context.recoverPendingApply(id, initialState);
  if (context.landCheck(id).archived) return;
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

export function gitApplyInputsOperation(context, id, sandboxPath) {
  const state = context.loadRuntime(id);
  const names = context.sandboxDiffNames(id, sandboxPath, state);
  const pending = names.filter((path) =>
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
  // An untracked-only or mode-only projection has no Git patch, but the
  // transaction below still copies it and binds its bytes/mode. Patch-check
  // only the tracked part; target-clobber checks still cover every path.
  if (diff.stdout.length) {
    const check = context.spawn("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
      cwd: context.root, input: diff.stdout, encoding: "utf8"
    });
    if (check.status !== 0)
      context.fail(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
  }
  const base = context.sandboxBase(state);
  const workingBlob = (path) => {
    const stats = context.lstat(path, { throwIfNoEntry: false });
    if (!stats) return null;
    return stats.isSymbolicLink()
      ? Buffer.from(context.readlink(path)) : context.readFile(path);
  };
  const clobbered = pending.filter((path) => {
    const target = workingBlob(join(context.root, path));
    if (target === null) return false;
    const sandboxContent = workingBlob(join(sandboxPath, path));
    if (sandboxContent !== null && target.equals(sandboxContent)) return false;
    const shown = context.gitBuffer(["show", `${base}:${path}`], context.root);
    return shown.status !== 0 || !target.equals(shown.stdout);
  });
  if (clobbered.length) {
    const listed = clobbered.slice(0, 10).join(", ") +
      (clobbered.length > 10 ? ", ..." : "");
    context.fail(`apply would overwrite uncommitted target edits at: ${listed} — commit or reconcile the landed work first, then sync the sandbox and prove again`);
  }
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

export function applyCodePaths(context, id, state, sandboxPath) {
  if (state.workspace.mode === "copy")
    return copyApplyCodePaths(context, id, state, sandboxPath);
  if (state.workspace.mode === "worktree") {
    context.assertTargetHeadUnmoved(id, state);
    return context.gitApplyInputs(id, sandboxPath);
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
    afterMode: context.pathMode(source)
  };
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

export function buildApplyEntriesOperation(context, id, state) {
  const sandboxPath = state.workspace.path;
  const entries = [];
  for (const rel of applyCodePaths(context, id, state, sandboxPath))
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

export function prepareApplyTransactionOperation(context, id, state, prepared = null) {
  assertApplySourceUnchanged(context, id, state, prepared);
  const entries = prepared || context.buildApplyEntries(id, state);
  assertNoChildApplyEntries(context, id, state, entries);
  context.assertDeletionsAreDeclared(id, state, entries);
  const transactionId = `apply-${context.dateNow()}-${context.pid}`;
  const transactionRoot = context.applyTransactionRoot(id, transactionId);
  context.makeDirectory(transactionRoot, { recursive: true });
  backupApplyEntries(context, transactionRoot, entries);
  const proof = context.readJson(context.proofPath(id));
  const journal = {
    version: 1,
    changeId: id,
    transactionId,
    proofRunId: proof.proofRunId,
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
  journal.proofRunId = context.readJson(context.proofPath(state.id)).proofRunId;
  journal.status = "verified";
  journal.refreshedAt = context.now();
  context.saveApplyJournal(journal);
  state.workspace.apply.projectionHash = journal.projectionHash;
  state.workspace.apply.status = "verified";
  context.saveRuntime(state);
}

export function assertRecoveredProof(context, id) {
  const audit = context.proofAudit(id, true);
  if (!audit.valid) context.fail(`recovered archive has invalid proof: ${audit.reason}`);
}

export function assertRecoveredProjection(context, id, state, archivedPath) {
  if (!["worktree", "copy"].includes(state.workspace?.mode)) return;
  if (!state.workspace.applied)
    context.fail(`the interrupted archive never projected the sandbox into the target; ` +
      `restore 'openspec/changes/${id}' from '${archivedPath}' and land again`);
  const verification = context.verifyAppliedProjection(state);
  if (!verification.valid)
    context.fail(`recovered archive has an invalid applied projection: ${verification.reason}`);
}

export function assertRecoveredTasksComplete(context, id, archivedPath) {
  const pending = context.pendingTasks(id, resolve(context.root, archivedPath));
  if (pending.length)
    context.fail(`${pending.length} implementation task(s) remain unchecked`);
}

export function assertRecoveredArchiveReadyOperation(context, id, state, archivedPath) {
  assertRecoveredProof(context, id);
  context.assertMultiRepositoryArchiveReady(id, state);
  assertRecoveredProjection(context, id, state, archivedPath);
  assertRecoveredTasksComplete(context, id, archivedPath);
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
  assertLandGrant = () => {},
  consumeLandGrant = () => {},
  blockWithDecision,
  fail
}) {
  function nestedRepositoryPaths(id, state) {
    return selectedRepositories(id, state)
      .filter((repository) => repository.id !== "root" &&
        repository.relativePath && repository.relativePath !== "." &&
        !repository.relativePath.startsWith("../"))
      .map((repository) => repository.relativePath);
  }

  function applyPathspec(id, state) {
    return sandboxCodePathspec(id, nestedRepositoryPaths(id, state));
  }

  function copyCodePaths(id, state) {
    const baseline = state.workspace.baseline || {};
    if (state.workspace?.mode === "copy" && Object.values(baseline)
      .some((identity) => /^[0-9a-f]{64}$/i.test(String(identity))))
      fail(`copy sandbox '${id}' uses the legacy content-only identity format; recreate the sandbox and prove once before Land so executable modes and symlinks are bound safely`);
    const sandbox = workspaceManifest(state.workspace.path, id, true);
    const nested = nestedRepositoryPathMatcher(nestedRepositoryPaths(id, state));
    return [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
      .filter((path) => baseline[path] !== sandbox[path] && !nested(path)).sort();
  }

  // Against the base the sandbox branched from, not its HEAD: an agent that
  // commits inside the sandbox moves HEAD, and a HEAD-relative diff would
  // silently omit every committed change while proof — which hashes the
  // sandbox index — still counts it. That lands a partial change as a success.
  function sandboxBase(state) {
    return state.workspace?.baseHead || "HEAD";
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
    fail
  });

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
    const undeclared = undeclaredDeletions(entries, declaredSurfaceMatcher(id, state));
    if (!undeclared.length) return;
    const preview = undeclared.slice(0, 10).map((entry) => entry.path);
    fail(`apply would delete ${undeclared.length} path(s) no task declares: ${
      preview.join(", ")}${undeclared.length > preview.length ? ", ..." : ""
    }. A deletion has to come from a removal observed inside the sandbox, not ` +
      "from a path missing from its manifest; declare the path in tasks.md " +
      "`[paths:]` if the change really owns it.");
  }

  const prepareApplyTransaction = prepareApplyTransactionOperation.bind(null, {
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
  });

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

  const repositoryDelivery = createRepositoryDeliverySaga({
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
    cleanupRoot: cleanupApplyTransaction,
    fail
  });

  function currentSpecText(capability) {
    const path = join(root, "openspec", "specs", capability, "spec.md");
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  function captureSpecSyncInputs(id) {
    const dir = join(changePath(id), "specs");
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

  function verifyArchivedSpecs(captured) {
    return captured.flatMap(({ capability, delta, before }) =>
      verifySpecSync({ before, after: currentSpecText(capability), delta })
        .violations.map((violation) => ({ capability, ...violation })));
  }

  function failSpecSync(violations) {
    fail(`archived specs do not match the change delta:\n${violations
      .map((violation) => `  ${violation.capability}/${violation.requirement || "-"}: ${
        violation.detail}`).join("\n")}`);
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
    proofAudit,
    assertMultiRepositoryArchiveReady,
    verifyAppliedProjection,
    pendingTasks,
    fail
  });

  function resumeArchivedChange(id, state) {
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    if (state.specSyncViolations) {
      delete state.specSyncViolations;
      delete state.specSyncInputs;
      saveRuntime(state);
    }
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`archived proof audit failed: ${audit.reason}`);
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
    console.log(`ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`);
  }

  function recoverInterruptedArchive(id, state, archivedPath) {
    // Recovery cannot tell "succeeded then crashed" from "moved then failed",
    // so it is not an exemption from the Land guards. Everything still
    // checkable once the change directory has moved is checked here, before
    // any state is written: a refusal has to leave the change recoverable.
    assertRecoveredArchiveReady(id, state, archivedPath);
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
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    delete state.workspace.baseline;
    delete state.specSyncInputs;
    delete state.specSyncViolations;
    saveRuntime(state);
    console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
  }

  function snapshotArchiveEvidence(id) {
    const journal = loadRuntime(id);
    journal.land = {
      ...(journal.land || {}),
      status: "evidence-snapshotted",
      proofRunId: readJson(proofPath(id)).proofRunId,
      updatedAt: now()
    };
    saveRuntime(journal);
  }

  function applyArchiveWorkspace(id, readiness) {
    if (!["worktree", "copy"].includes(readiness.state.workspace?.mode))
      return readiness;
    if (compositeRepositorySelection(selectedRepositories(id, readiness.state)))
      repositoryDelivery.apply(id);
    else applySandbox(id, { controlPlane: true });
    const journal = loadRuntime(id);
    journal.land = { ...journal.land, status: "code-applied", updatedAt: now() };
    saveRuntime(journal);
    return landCheck(id);
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
      const telemetryIssue = telemetryLandIssue(foundationPolicy(), telemetry);
      console.error(telemetry.classification === "not-ingested"
        ? "WARNING: no model usage was imported for this change; cost and token columns stay empty — telemetry not-ingested"
        : telemetryUsageSatisfied(telemetry)
          ? `WARNING: telemetry ${telemetry.classification}; unavailable dimensions remain empty`
          : `WARNING: telemetry ${telemetry.classification}; cost and token columns may stay empty`);
      if (telemetryIssue) for (const action of telemetry.recoveryActions || [])
        console.error(`  recovery: ${action.command}`);
      if (telemetryIssue) fail(telemetryIssue);
    }
    return telemetry;
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
    state.land = { ...state.land, status: "archive-prepared", updatedAt: now() };
    saveRuntime(state);
    // landCheck already gated this; repeated here because it is the last point
    // before the destructive step and the CLI can disappear in between.
    assertOpenSpecCli(root, fail);
    archiveCheckpoint("before-archive-command", state);
    const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: root, encoding: "utf8" });
    if (cli.status !== 0) fail(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
    archiveCheckpoint("after-archive-command", state);
    transitionLifecycleState(state, "archived", "openspec-archive-complete");
    state.archivedAt = now();
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
    const specViolations = verifyArchivedSpecs(specSyncInputs);
    if (specViolations.length) {
      state.specSyncViolations = specViolations;
      // Only retained on failure: the retry guard needs the pre-merge text to
      // re-verify, and carrying it on the happy path would bloat every state file.
      state.specSyncInputs = specSyncInputs;
      saveRuntime(state);
      failSpecSync(specViolations);
    }
    delete state.specSyncInputs;
    delete state.specSyncViolations;
    archiveCheckpoint("after-spec-sync-verification", state);
    return cli;
  }

  function finalizeArchivedChange(id, state, telemetry, cli) {
    archiveCheckpoint("before-final-audit", state);
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`post-archive proof audit failed: ${audit.reason}`);
    archiveCheckpoint("after-final-audit", state);
    state.land = { ...state.land, status: "archive-audited", updatedAt: now() };
    archiveCheckpoint("before-cleanup", state);
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories &&
        compositeRepositorySelection(selectedRepositories(id, state)))
      repositoryDelivery.cleanup(id, state);
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
    console.log(`ARCHIVED ${id}`);
  }

  function archive(id) {
    const initial = loadRuntime(id);
    if (initial.status === "archived") {
      resumeArchivedChange(id, initial);
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
    let readiness = landCheck(id);
    if (readiness.archived) return;
    archiveCheckpoint("before-evidence-snapshot", readiness.state);
    snapshotArchiveEvidence(id);
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
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    const telemetry = recordArchiveTelemetry(id, state);
    const cli = runOpenSpecArchive(id, state, readiness);
    finalizeArchivedChange(id, state, telemetry, cli);
  }

  return {
    gitApplyInputs,
    buildApplyEntries,
    prepareApplyTransaction,
    refreshAppliedProjection,
    applySandbox,
    archive
  };
}
