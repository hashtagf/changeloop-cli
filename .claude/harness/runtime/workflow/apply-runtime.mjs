import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { verifySpecSync } from "./spec-sync-verify.mjs";
import {
  projectionCounts, targetHeadMovedDecision, undeclaredDeletions
} from "./apply-recovery.mjs";
import { sandboxCodePathspec } from "../core/workspace-surface.mjs";

export function createApplyRuntime({
  root,
  transactions,
  loadRuntime,
  saveRuntime,
  selectedRepositories,
  workspaceManifest,
  declaredSurfaceMatcher,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  directoryHash,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  stableHash,
  syncClaudeTelemetry,
  modelUsageRecorded,
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
  blockWithDecision,
  fail
}) {
  function applyPathspec(id, state) {
    return sandboxCodePathspec(id, selectedRepositories(id, state)
      .filter((repository) => repository.type === "submodule")
      .map((repository) => repository.relativePath));
  }

  // Against the base the sandbox branched from, not its HEAD: an agent that
  // commits inside the sandbox moves HEAD, and a HEAD-relative diff would
  // silently omit every committed change while proof — which hashes the
  // sandbox index — still counts it. That lands a partial change as a success.
  function sandboxBase(state) {
    return state.workspace?.baseHead || "HEAD";
  }

  function sandboxDiffNames(id, sandboxPath, state) {
    const names = git(["diff", "--name-only", "-z", sandboxBase(state), "--",
      ...applyPathspec(id, state)], sandboxPath);
    if (names.status !== 0) fail(`cannot inspect sandbox paths: ${names.stderr.trim()}`);
    return names.stdout.split("\0").filter(Boolean).sort();
  }

  function gitApplyInputs(id, sandboxPath) {
    git(["add", "-N", "."], sandboxPath);
    const state = loadRuntime(id);
    const pathspec = applyPathspec(id, state);
    // gitBuffer, not git: a UTF-8 decode of the binary diff corrupts non-UTF-8
    // content and makes `apply --check` report phantom conflicts.
    const diff = gitBuffer(["diff", "--binary", sandboxBase(state), "--", ...pathspec], sandboxPath);
    if (diff.status !== 0) fail("cannot inspect sandbox diff");
    if (!diff.stdout.length) {
      if (state.repositories && Object.keys(state.repositories).length > 1) return [];
      fail("sandbox has no applicable diff");
    }
    const check = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
      cwd: root, input: diff.stdout, encoding: "utf8"
    });
    if (check.status !== 0)
      fail(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
    const names = sandboxDiffNames(id, sandboxPath, state);
    // `apply --check` validates the patch textually, but application copies
    // whole files — so a target file carrying uncommitted edits the sandbox
    // never saw would be silently overwritten. Two changes landed sequentially
    // over the same file lost the first one's work exactly this way. Refuse
    // and name the paths, as the isolated-copy path already does.
    const base = sandboxBase(state);
    // Read like a git blob: a symlink's blob is its link target, not the
    // linked file's content — following the link makes every unchanged
    // symlink read as a conflict.
    const workingBlob = (path) => {
      const stats = lstatSync(path, { throwIfNoEntry: false });
      if (!stats) return null;
      return stats.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    };
    const clobbered = names.filter((path) => {
      const target = workingBlob(join(root, path));
      if (target === null) return false;
      const sandboxContent = workingBlob(join(sandboxPath, path));
      if (sandboxContent !== null && target.equals(sandboxContent)) return false;
      const shown = gitBuffer(["show", `${base}:${path}`], root);
      return shown.status !== 0 || !target.equals(shown.stdout);
    });
    if (clobbered.length) {
      const listed = clobbered.slice(0, 10).join(", ") +
        (clobbered.length > 10 ? ", ..." : "");
      fail(`apply would overwrite uncommitted target edits at: ${listed} — commit or reconcile the landed work first, then sync the sandbox and prove again`);
    }
    return names;
  }

  function assertTargetHeadUnmoved(id, state) {
    const currentHead = gitHead(root);
    if (currentHead === state.workspace.baseHead) return;
    blockWithDecision(id, "control-head-moved", targetHeadMovedDecision({
      changeId: id,
      recordedBase: state.workspace.baseHead,
      currentHead,
      multiRepository: Object.keys(state.repositories || {}).length > 1,
      action: "Applying"
    }));
  }

  function buildApplyEntries(id, state) {
    const sandboxPath = state.workspace.path;
    let codePaths;
    if (state.workspace.mode === "copy") {
      const baseline = state.workspace.baseline || {};
      const sandbox = workspaceManifest(sandboxPath, id, true);
      const target = workspaceManifest(root, id, true);
      codePaths = [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
        .filter((path) => baseline[path] !== sandbox[path]).sort();
      for (const path of codePaths)
        if ((target[path] ?? null) !== (baseline[path] ?? null))
          fail(`isolated-copy conflict at '${path}'`);
    } else if (state.workspace.mode === "worktree") {
      assertTargetHeadUnmoved(id, state);
      codePaths = gitApplyInputs(id, sandboxPath);
    } else {
      fail("change has no isolated sandbox");
    }
    const entries = codePaths.map((rel) => {
      const source = resolve(sandboxPath, rel);
      const target = safeRootPath(rel);
      return {
        path: rel,
        role: "code",
        before: pathIdentity(target),
        after: pathIdentity(source)
      };
    });
    const changeRel = currentChangeRelativePath(id);
    entries.push({
      path: changeRel,
      role: "change-artifacts",
      before: pathIdentity(changePath(id)),
      after: pathIdentity(join(sandboxPath, changeRel))
    });
    return entries;
  }

  // Paths the sandbox still wants to project once the target already carries a
  // prior projection. The virgin-target conflict guards in buildApplyEntries
  // cannot run here: after a first apply the target legitimately differs from
  // the baseline. Divergence is caught instead by matching each entry's
  // 'before' against what the previous transaction actually projected.
  function reapplyCodePaths(id, state) {
    const sandboxPath = state.workspace.path;
    if (state.workspace.mode === "copy") {
      const baseline = state.workspace.baseline || {};
      const sandbox = workspaceManifest(sandboxPath, id, true);
      return [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
        .filter((path) => baseline[path] !== sandbox[path]).sort();
    }
    if (state.workspace.mode !== "worktree") fail("change has no isolated sandbox");
    assertTargetHeadUnmoved(id, state);
    git(["add", "-N", "."], sandboxPath);
    return sandboxDiffNames(id, sandboxPath, state);
  }

  // The full projection, not just the delta, so verifyAppliedProjection keeps
  // covering every path the change owns.
  function buildReapplyEntries(id, state, priorJournal) {
    const sandboxPath = state.workspace.path;
    const projected = new Map((priorJournal.entries || [])
      .map((entry) => [entry.path, entry]));
    const changeRel = currentChangeRelativePath(id);
    const paths = [...new Set([
      ...projected.keys(), ...reapplyCodePaths(id, state), changeRel
    ])].sort();
    return paths.map((rel) => {
      const prior = projected.get(rel);
      return {
        path: rel,
        role: prior?.role || (rel === changeRel ? "change-artifacts" : "code"),
        before: prior ? prior.after : pathIdentity(safeRootPath(rel)),
        after: pathIdentity(resolve(sandboxPath, rel))
      };
    });
  }

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

  function prepareApplyTransaction(id, state, prepared = null) {
    // The recorded baseline only describes a sandbox that has not been
    // projected yet. Once it has, the control-plane change directory *is* the
    // projection, and verifyAppliedProjection — already run to build `prepared`
    // — is what guards it against an edit outside the sandbox.
    if (!prepared &&
        directoryHash(changePath(id)) !== state.workspace.changeSourceHash)
      fail("active change was edited after the last sandbox sync");
    const entries = prepared || buildApplyEntries(id, state);
    assertDeletionsAreDeclared(id, state, entries);
    const transactionId = `apply-${Date.now()}-${process.pid}`;
    const transactionRoot = applyTransactionRoot(id, transactionId);
    mkdirSync(transactionRoot, { recursive: true });
    entries.forEach((entry, index) => {
      entry.backup = `backup/${index}`;
      if (entry.before !== null)
        copyPath(safeRootPath(entry.path), join(transactionRoot, entry.backup));
    });
    const proof = readJson(proofPath(id));
    const journal = {
      version: 1,
      changeId: id,
      transactionId,
      proofRunId: proof.proofRunId,
      mode: state.workspace.mode,
      status: "prepared",
      sandboxPath: state.workspace.path,
      targetPath: root,
      projectionHash: stableHash(entries.map(({ path, after }) => ({ path, after }))),
      entries,
      appliedPaths: [],
      inFlightPaths: [],
      createdAt: now()
    };
    saveApplyJournal(journal);
    return journal;
  }

  function refreshAppliedProjection(state) {
    const transactionId = state.workspace?.apply?.transactionId;
    const journalPath = transactionJournalPath(state.id, transactionId);
    if (!transactionId || !existsSync(journalPath))
      fail("cannot refresh an applied projection without its transaction journal");
    const journal = readJson(journalPath);
    for (const entry of journal.entries) {
      const source = resolve(state.workspace.path, entry.path);
      const expected = pathIdentity(source);
      const current = pathIdentity(safeRootPath(entry.path));
      if (current !== expected)
        fail(`cannot refresh diverged applied path '${entry.path}'`);
      entry.after = expected;
    }
    journal.projectionHash = stableHash(
      journal.entries.map(({ path, after }) => ({ path, after }))
    );
    journal.proofRunId = readJson(proofPath(state.id)).proofRunId;
    journal.status = "verified";
    journal.refreshedAt = now();
    saveApplyJournal(journal);
    state.workspace.apply.projectionHash = journal.projectionHash;
    state.workspace.apply.status = "verified";
    saveRuntime(state);
  }

  function applySandbox(id, options = {}) {
    const initialState = loadRuntime(id);
    if (initialState.repositories && Object.keys(initialState.repositories).length > 1 &&
        !options.controlPlane)
      fail("multi-repository sandboxes do not apply as one local transaction; use land plan/record/resume");
    if (initialState.workspace?.applied && options.refresh)
      refreshAppliedProjection(initialState);
    // Before `landCheck`, not after: an apply is the authorized place to settle
    // an interrupted apply, and `landCheck` now refuses while one is pending
    // rather than quietly settling it itself.
    recoverPendingApply(id, initialState);
    const readiness = landCheck(id);
    if (readiness.archived) return;
    let state = loadRuntime(id);
    let prepared = null;
    if (state.workspace?.applied) {
      const verification = verifyAppliedProjection(state);
      if (!verification.valid) fail(`applied projection is invalid: ${verification.reason}`);
      prepared = buildReapplyEntries(id, state, verification.journal);
      const desired = stableHash(prepared.map(({ path, after }) => ({ path, after })));
      if (desired === state.workspace.apply.projectionHash) {
        console.log(`APPLIED ${id}\n  resumed: ${state.workspace.apply.transactionId}`);
        return;
      }
    }
    const journal = prepareApplyTransaction(id, state, prepared);
    journal.status = "applying";
    saveApplyJournal(journal);
    // Before the first path moves, not after the last one. A projection that
    // does not match the change is only cheap to notice here.
    const counts = projectionCounts(journal.entries);
    console.log(`PROJECTION ${id}\n  update: ${counts.update}; create: ${
      counts.create}; delete: ${counts.delete}`);
    // The marker the phase guard documents as the Land carve-out. Nothing set
    // it before, so the carve-out was unreachable and any child this
    // transaction spawns looked like an unaudited Land mutation.
    const priorTransactionMarker = process.env.FOUNDATION_LAND_TRANSACTION;
    process.env.FOUNDATION_LAND_TRANSACTION = "1";
    try {
      journal.entries.forEach((entry, index) =>
        applyTransactionEntry(journal, entry, index));
      const mismatch = journal.entries.find((entry) =>
        pathIdentity(safeRootPath(entry.path)) !== entry.after);
      if (mismatch) throw new Error(`post-apply projection mismatch at '${mismatch.path}'`);
      state = loadRuntime(id);
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
      state.status = "applied";
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
    if (!state.specSyncViolations?.length) return [];
    const captured = state.specSyncInputs;
    return Array.isArray(captured) && captured.length
      ? verifyArchivedSpecs(captured) : state.specSyncViolations;
  }

  function assertRecoveredArchiveReady(id, state, archivedPath) {
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`recovered archive has invalid proof: ${audit.reason}`);
    assertMultiRepositoryArchiveReady(id, state);
    if (["worktree", "copy"].includes(state.workspace?.mode)) {
      // Specs moved but no code did. Calling that archived would report a land
      // that never happened and then delete the sandbox holding the work.
      if (!state.workspace.applied)
        fail(`the interrupted archive never projected the sandbox into the target; ` +
          `restore 'openspec/changes/${id}' from '${archivedPath}' and land again`);
      const verification = verifyAppliedProjection(state);
      if (!verification.valid)
        fail(`recovered archive has an invalid applied projection: ${verification.reason}`);
    }
    const pending = pendingTasks(id, resolve(root, archivedPath));
    if (pending.length)
      fail(`${pending.length} implementation task(s) remain unchecked`);
  }

  function archive(id) {
    const initial = loadRuntime(id);
    if (initial.status === "archived") {
      const outstanding = outstandingSpecSync(initial);
      if (outstanding.length) failSpecSync(outstanding);
      if (initial.specSyncViolations) {
        delete initial.specSyncViolations;
        delete initial.specSyncInputs;
        saveRuntime(initial);
      }
      const audit = proofAudit(id, true);
      if (!audit.valid) fail(`archived proof audit failed: ${audit.reason}`);
      let resumed = false;
      if (initial.workspace &&
          !["removed", "not-needed"].includes(initial.workspace.cleanup?.status)) {
        initial.workspace.cleanup = cleanupAppliedSandbox(id, initial);
        initial.land = {
          ...(initial.land || {}),
          status: initial.workspace.cleanup.status === "removed"
            ? "sandbox-cleaned" : "archive-audited",
          resumedAt: now()
        };
        resumed = true;
      }
      if (initial.workspace?.apply &&
          initial.workspace.apply.cleanup?.status !== "committed") {
        initial.workspace.apply.cleanup = cleanupApplyTransaction(initial);
        resumed = true;
      }
      if (initial.repositories && !initial.repositoryCleanup) {
        initial.repositoryCleanup = cleanupRepositorySandboxes(id, initial);
        resumed = true;
      }
      if (resumed) saveRuntime(initial);
      console.log(`ALREADY ARCHIVED ${id}\n  archived: ${initial.archivedAt || "unknown"}`);
      return;
    }
    const recoveredArchive = initial.status !== "archived" &&
      !existsSync(changePath(id)) && archivedChangeRelativePath(id);
    if (recoveredArchive) {
      // Recovery cannot tell "succeeded then crashed" from "moved then failed",
      // so it is not an exemption from the Land guards. Everything still
      // checkable once the change directory has moved is checked here, before
      // any state is written: a refusal has to leave the change recoverable.
      assertRecoveredArchiveReady(id, initial, recoveredArchive);
      initial.status = "archived";
      initial.archivedAt ||= now();
      initial.archivedChangePath = recoveredArchive;
      initial.land = {
        ...(initial.land || {}),
        status: "archive-audited",
        recoveredAt: now()
      };
      initial.workspace.cleanup = cleanupAppliedSandbox(id, initial);
      if (initial.repositories)
        initial.repositoryCleanup = cleanupRepositorySandboxes(id, initial);
      if (initial.workspace.apply)
        initial.workspace.apply.cleanup = cleanupApplyTransaction(initial);
      delete initial.workspace.baseline;
      saveRuntime(initial);
      // The merge already ran and the pre-merge spec text died with the
      // interrupted transaction, so spec sync cannot be checked here: without
      // 'before', a removal and a preserved requirement are indistinguishable
      // from a bad merge. Say so rather than let the silence read as verified.
      console.error(
        `WARNING: spec sync was not verified for ${id}; the interrupted archive left no pre-merge specs to compare against`);
      console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
      return;
    }
    let readiness = landCheck(id);
    if (readiness.archived) return;
    assertMultiRepositoryArchiveReady(id, readiness.state);
    let journal = loadRuntime(id);
    journal.land = {
      ...(journal.land || {}),
      status: "evidence-snapshotted",
      proofRunId: readJson(proofPath(id)).proofRunId,
      updatedAt: now()
    };
    saveRuntime(journal);
    // Unconditional, including when the sandbox is already applied: work done
    // after the first projection is proven and would otherwise archive as a
    // success while the target still holds the earlier code. applySandbox
    // returns early by itself when the projection is already current.
    if (["worktree", "copy"].includes(readiness.state.workspace?.mode)) {
      applySandbox(id, { controlPlane: true });
      journal = loadRuntime(id);
      journal.land = { ...(journal.land || {}), status: "code-applied", updatedAt: now() };
      saveRuntime(journal);
      readiness = landCheck(id);
    }
    // Re-read rather than reuse readiness.state: on the no-sandbox path that
    // object predates the journal write above, and saving it below would
    // silently erase land.proofRunId from the record.
    const state = loadRuntime(id);
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    // One quiet telemetry drain while usage is still attributable to an active
    // change. An absent transcript already returns imported 0; anything that
    // throws degrades to the same, because telemetry never costs an archive.
    try { syncClaudeTelemetry(id, { quiet: true }); } catch { /* warned below */ }
    const preArchiveWorkspaceHash = readiness.hash;
    // 'openspec archive' moves the change out of openspec/changes and rewrites
    // openspec/specs in one step, so the delta and the pre-merge spec text can
    // only be read now.
    const specSyncInputs = captureSpecSyncInputs(id);
    // landCheck already gated this; repeated here because it is the last point
    // before the destructive step and the CLI can disappear in between.
    assertOpenSpecCli(root, fail);
    const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: root, encoding: "utf8" });
    if (cli.status !== 0) fail(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
    state.status = "archived";
    state.archivedAt = now();
    state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
    state.archivedChangePath = archivedChangeRelativePath(id);
    // `land.status` is a breadcrumb, not the saga's position. Resume branches on
    // `workspace.cleanup?.status` and `repositoryCleanup` — never on this — so
    // reading it to work out where a Land stopped will give a confident wrong
    // answer. Named here because it reads exactly like a checkpoint.
    state.land = { ...(state.land || {}), status: "specs-archived", updatedAt: now() };
    saveRuntime(state);
    // A merge that silently drops or rewrites a requirement still exits 0, and
    // openspec/specs is durable, so the exit code is not evidence.
    const specViolations = verifyArchivedSpecs(specSyncInputs);
    if (specViolations.length) {
      state.specSyncViolations = specViolations;
      // Only retained on failure: the retry guard needs the pre-merge text to
      // re-verify, and carrying it on the happy path would bloat every state file.
      state.specSyncInputs = specSyncInputs;
      saveRuntime(state);
      failSpecSync(specViolations);
    }
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`post-archive proof audit failed: ${audit.reason}`);
    state.land = { ...(state.land || {}), status: "archive-audited", updatedAt: now() };
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    cleanupChangeLeases(id);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    delete state.workspace.baseline;
    state.land.status = "sandbox-cleaned";
    saveRuntime(state);
    if (!state.archivedChangePath)
      console.error("WARNING: OpenSpec reported success but the archived change directory was not found");
    if (["failed", "refused"].includes(state.workspace.cleanup.status))
      console.error(`WARNING: sandbox cleanup ${state.workspace.cleanup.status}: ${state.workspace.cleanup.reason}`);
    if (!modelUsageRecorded(id))
      console.error(`WARNING: no model usage was imported for this change; cost and token columns stay empty — claude-foundation telemetry sync ${id} [transcript.jsonl]`);
    console.log(cli.stdout.trim());
    console.log(`ARCHIVED ${id}`);
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
