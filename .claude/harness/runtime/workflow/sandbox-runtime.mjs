import { assertSpecApproval, agreementIdentity } from "../core/user-decisions.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ROOT_ONLY_EXCLUDED_DIRS, isExcludedPath, sandboxCodePathspec, trackedPathSet
} from "../core/workspace-surface.mjs";
import { transitionLifecycleState } from "../core/lifecycle-reducer.mjs";
import {
  compositeRepositorySelection, isolatedRepositoryState, worktreeOwnedByTarget
} from "../core/repository-binding.mjs";
import { shellDisplayArgument } from "../core/shell-mutation-policy.mjs";

// A commit read, not executed. Inspection must not resolve a program through
// PATH, so ref files are the authority for both ordinary and linked worktrees.
export function headOfRepository(start) {
  let gitPath = join(start, ".git");
  if (!existsSync(gitPath)) return null;
  try {
    if (statSync(gitPath).isFile()) {
      const pointer = readFileSync(gitPath, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
      if (!pointer) return null;
      gitPath = resolve(start, pointer[1]);
    }
    const head = readFileSync(join(gitPath, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const ref = head.match(/^ref:\s*(.+)$/)?.[1]?.trim();
    if (!ref) return null;
    const loose = join(gitPath, ...ref.split("/"));
    if (existsSync(loose)) {
      const value = readFileSync(loose, "utf8").trim();
      return /^[0-9a-f]{40}$/i.test(value) ? value : null;
    }
    // A ref that has been packed away has no loose file, and a repository
    // that has ever been gc'd keeps most of its refs that way.
    const packed = join(gitPath, "packed-refs");
    if (!existsSync(packed)) return null;
    for (const line of readFileSync(packed, "utf8").split("\n")) {
      const match = line.match(/^([0-9a-f]{40})\s+(.+)$/);
      if (match && match[2].trim() === ref) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function workspaceIsolationKind(mode) {
  if (mode === "worktree") return "git-worktree";
  if (mode === "copy") return "filesystem-copy";
  return "none";
}

export function unusedCopyResolveMessage(paths) {
  return `--resolve names ${paths.map((path) => `'${path}'`).join(", ")
  }, which ${paths.length === 1 ? "is" : "are"} not in conflict; drop ${
    paths.length === 1 ? "it" : "them"} and sync again`;
}

export function workspaceIdentityValid(kind, path, { gitMetadataPresent, directoryExists }) {
  if (kind === "git-worktree") return gitMetadataPresent(path);
  if (kind === "filesystem-copy") return directoryExists(path);
  return true;
}

export function repositoryInspectionRows(repositories, selected = [], context = {}) {
  const records = repositories || {};
  const expected = new Set(selected.map((repository) => repository.id));
  const ids = new Set([...Object.keys(records), ...expected]);
  const directoryExists = context.directoryExists || existsSync;
  const gitMetadataPresent = context.gitMetadataPresent || directoryExists;
  const ownsWorktree = context.worktreeOwnedByTarget || worktreeOwnedByTarget;
  return [...ids].map((repositoryId) => {
    const runtime = records[repositoryId];
    const selectedRepository = selected.find((row) => row.id === repositoryId);
    if (!runtime) return {
      id: repositoryId, access: selectedRepository?.mode || null,
      kind: "none", status: "missing-record", path: null, baseHead: null, targetPath: null
    };
    const kind = runtime.mode === "worktree" ? "git-worktree" :
      runtime.mode === "copy" ? "filesystem-copy" :
        runtime.mode === "reference" ? "reference" : "none";
    const present = Boolean(runtime.path && directoryExists(runtime.path));
    const identityValid = present && (runtime.mode !== "worktree" ||
      gitMetadataPresent(runtime.path));
    const ownershipValid = identityValid && (runtime.mode !== "worktree" ||
      !selectedRepository?.path || ownsWorktree(runtime.path, selectedRepository.path));
    const unexpected = expected.size > 0 && !expected.has(repositoryId);
    return {
      id: repositoryId,
      access: runtime.access || "write",
      kind,
      status: unexpected ? "unexpected-record" :
        !present ? "missing" : !identityValid || !ownershipValid ? "invalid" : "active",
      path: runtime.path || null,
      baseHead: runtime.baseHead || null,
      targetPath: runtime.targetPath || null
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function workspaceTargetDrift(kind, baseHead, targetHead) {
  return kind === "git-worktree" && baseHead && targetHead && baseHead !== targetHead
    ? "target-moved"
    : "none";
}

export function workspaceInspectionValue({
  root,
  gitMetadataPresent,
  directoryExists,
  headOfRepository,
  worktreeOwnedByTarget
}, state, selected = []) {
  const workspace = state.workspace || {};
  const kind = workspaceIsolationKind(workspace.mode);
  const identityValid = workspaceIdentityValid(kind, workspace.path, {
    gitMetadataPresent,
    directoryExists
  });
  const status = kind === "none" ? "current" : identityValid ? "active" : "missing";
  const targetHead = headOfRepository(root);
  const baseHead = workspace.baseHead || null;
  return {
    kind,
    status,
    path: workspace.path || root,
    baseHead,
    targetHead,
    drift: workspaceTargetDrift(kind, baseHead, targetHead),
    repositories: repositoryInspectionRows(state.repositories, selected, {
      gitMetadataPresent, directoryExists, worktreeOwnedByTarget
    })
  };
}

export function workspaceInspectionFor(context) {
  return (id, state = context.loadRuntime(id)) => {
    let selected = [];
    let selectionError = null;
    try {
      selected = context.selectedRepositories?.(id, state,
        (message) => { throw new Error(message); },
        { useTargetPaths: true, withoutGit: true }) || [];
    } catch (error) {
      selectionError = error.message;
    }
    return {
      ...workspaceInspectionValue(context, state, selected),
      ...(selectionError ? { selectionError } : {})
    };
  };
}

export function inspectSandbox(context, id, flags = {}) {
  const workspaceIsolation = context.workspaceInspection(id);
  const preflight = context.hostAttestation.preflight(id, flags);
  return {
    version: 1,
    changeId: id,
    workspaceIsolation,
    securityBoundary: preflight.securityBoundary,
    attestation: preflight.attestation,
    execution: {
      mode: flags.unattended ? "unattended" : "interactive",
      boundaryDetected: preflight.boundaryDetected,
      safeForUnattended: preflight.safeForUnattended,
      decision: !flags.unattended || preflight.safeForUnattended ? "allow" : "block",
      reasons: preflight.reasons
    }
  };
}

export function showSandboxInspection(context, id, flags = {}) {
  const result = context.inspect(id, flags);
  if (flags.json) context.output.log(JSON.stringify(result, null, 2));
  else {
    context.output.log(`ISOLATION ${id}`);
    context.output.log(`  workspace isolation: ${result.workspaceIsolation.kind} (${result.workspaceIsolation.status})`);
    if (result.workspaceIsolation.drift === "target-moved")
      context.output.log(`  target drift: base ${
        String(result.workspaceIsolation.baseHead).slice(0, 8)} -> target ${
        String(result.workspaceIsolation.targetHead).slice(0, 8)}; run 'claude-foundation sandbox sync ${id}' to replay onto it`);
    if (result.workspaceIsolation.selectionError)
      context.output.log(`  repository selection: invalid (${result.workspaceIsolation.selectionError})`);
    for (const repository of result.workspaceIsolation.repositories || [])
      context.output.log(`  repository ${repository.id}: ${repository.kind} (${repository.status})${
        repository.path ? ` ${repository.path}` : ""}`);
    context.output.log(`  security boundary: ${result.securityBoundary.kind} (${result.securityBoundary.status})`);
    context.output.log(`  safe for unattended: ${result.execution.safeForUnattended ? "yes" : "no"}`);
    for (const reason of result.execution.reasons) context.output.log(`  reason: ${reason}`);
  }
  if (flags.unattended && !result.execution.safeForUnattended) {
    context.markBlocked();
    context.runtimeProcess.exitCode = 1;
  }
}

export function runSandboxSetupCommand(context, record, command, timeoutMs, cwd, label) {
  const result = context.spawn("sh", ["-c", command], {
    cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024
  });
  const failed = Boolean(result.error) || result.status !== 0;
  record.setup = {
    command, status: failed ? "failed" : "ok",
    exitCode: typeof result.status === "number" ? result.status : null
  };
  if (failed) {
    const cause = result.error
      ? String(result.error.code || result.error.message)
      : `exit ${result.status}`;
    const tail = `${result.stdout || ""}\n${result.stderr || ""}`
      .trim().split("\n").filter(Boolean).slice(-5).join("\n    ");
    context.output.error(`WARNING: sandbox setup command failed${
      label ? ` for '${label}'` : ""} (${cause}) in the isolated workspace. ` +
      `Harness preparation will repair or route this failure before Build.${
        tail ? `\n    ${tail}` : ""}`);
  }
  return record.setup;
}

export function runSandboxSetupBatch(records, maxParallel = 1) {
  const results = [];
  const capacity = Math.max(1, Number(maxParallel) || 1);
  const operationStartedAt = Date.now();
  const source = String.raw`
    import { execFile } from "node:child_process";
    import { readFileSync } from "node:fs";
    import { promisify } from "node:util";
    const execute = promisify(execFile);
    const outputTail = (value) => String(value || "").slice(-65536);
    const jobs = JSON.parse(readFileSync(0, "utf8") || "[]");
    const rows = await Promise.all(jobs.map(async (job) => {
      try {
        const value = await execute("sh", ["-c", job.command], {
          cwd: job.cwd, timeout: job.timeoutMs, maxBuffer: 16 * 1024 * 1024
        });
        return { status: 0, stdout: outputTail(value.stdout),
          stderr: outputTail(value.stderr), error: null };
      } catch (error) {
        return { status: Number.isInteger(error.code) ? error.code : null,
          stdout: outputTail(error.stdout), stderr: outputTail(error.stderr),
          error: String(error.code || error.message) };
      }
    }));
    process.stdout.write(JSON.stringify(rows));`;
  for (let index = 0; index < records.length; index += capacity) {
    const batch = records.slice(index, index + capacity);
    const queuedMs = Date.now() - operationStartedAt;
    const batchStartedAt = Date.now();
    const rows = executeSandboxSetupBatch({
      spawn: spawnSync, executable: process.execPath
    }, source, batch);
    const durationMs = Date.now() - batchStartedAt;
    for (let offset = 0; offset < batch.length; offset += 1)
      results.push(sandboxSetupResult(batch[offset], rows[offset], queuedMs,
        durationMs, Math.floor(index / capacity) + 1));
  }
  return results;
}

export function executeSandboxSetupBatch(context, source, batch) {
  const child = context.spawn(context.executable, ["--input-type=module", "-e", source], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    input: JSON.stringify(batch.map(sandboxSetupInput))
  });
  if (child.status !== 0)
    throw new Error(`parallel sandbox setup runner failed: ${child.stderr.trim()}`);
  return JSON.parse(child.stdout);
}

function sandboxSetupInput(row) {
  return { command: row.command, cwd: row.cwd, timeoutMs: row.timeoutMs };
}

function sandboxSetupResult(job, result, queuedMs, durationMs, wave) {
  return { ...job, result, queuedMs, durationMs, wave };
}

export function runMeasuredSandboxSetupBatch(context, records) {
  const capacity = context.policy().execution?.maxParallelSetups;
  const rows = runSandboxSetupBatch(records, capacity);
  for (const wave of [...new Set(rows.map((row) => row.wave))]) {
    const batch = rows.filter((row) => row.wave === wave);
    context.recordScheduler({
      scheduler: "setup", wave,
      readyNodes: records.length - rows.filter((row) => row.wave < wave).length,
      executedNodes: batch.length, reusedNodes: 0,
      queueingMs: batch.reduce((total, row) => total + row.queuedMs, 0),
      peakConcurrency: batch.length
    });
  }
  return rows;
}

// A worktree is a bare checkout and the copy path excludes installed
// dependencies, so a project that installs them at its root starts every Build
// without them. Three consumer Builds rediscovered that by linking the
// checkout's node_modules — which the phase guard refuses — before falling back
// to an install. Name the sanctioned route when the sandbox is created, so the
// first Build turn already knows it. Lockfile first: the advice must match the
// package manager the project actually pins.
const DEPENDENCY_LOCKFILES = [
  ["package-lock.json", "npm ci"],
  ["npm-shrinkwrap.json", "npm ci"],
  ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
  ["yarn.lock", "yarn install --frozen-lockfile"],
  ["bun.lock", "bun install --frozen-lockfile"],
  ["bun.lockb", "bun install --frozen-lockfile"]
];

export function missingDependencySetupAdvisory({ root, workspace, setupCommand, pathExists }) {
  if (setupCommand) return null;
  const lockfile = DEPENDENCY_LOCKFILES.find(([file]) => pathExists(join(root, file)));
  if (!lockfile) return null;
  const [file, install] = lockfile;
  const installed = pathExists(join(root, "node_modules"));
  return `NOTE: the workspace has no installed dependencies: ${file} is at ${root}` +
    `${installed ? " and node_modules is installed there" : ""}, but foundation.json ` +
    `declares no sandbox.setupCommand. Declare {"sandbox":{"setupCommand":"${install}"}} ` +
    "so the harness prepares every workspace, or run " +
    `\`cd ${shellDisplayArgument(workspace)} && ${install}\` once; linking or copying the ` +
    "checkout's node_modules into the workspace is refused.";
}

export function carrySandboxIgnoredArtifacts(context, sourcePath, stagingPath) {
  const listed = context.git(["ls-files", "-z", "--others", "--ignored",
    "--exclude-standard", "--directory"], sourcePath);
  if (listed.status !== 0) return;
  for (const entry of listed.stdout.split("\0").filter(Boolean)) {
    const to = join(stagingPath, entry);
    if (context.pathExists(to)) continue;
    try {
      context.makeDirectory(dirname(to), { recursive: true });
      context.rename(join(sourcePath, entry), to);
    } catch {
      // Best effort: an artifact that cannot move falls back to rebuilding it.
    }
  }
}

export function commitSandboxReplay(context, id, state, prepared) {
  const { movement, record, targetPath, staging, patch } = prepared;
  context.carryIgnoredArtifacts(record.path, staging);
  const removed = context.git(["worktree", "remove", "--force", record.path], targetPath);
  if (removed.status !== 0)
    context.fail(`cannot replace the '${movement.repository}' sandbox worktree: ${
      removed.stderr.trim()}. Prepared replay remains at '${staging}' with patch '${patch}'.`);
  const moved = context.git(["worktree", "move", staging, record.path], targetPath);
  if (moved.status !== 0)
    context.fail(`the '${movement.repository}' sandbox worktree was removed and its replacement could not be moved into place: ${
      moved.stderr.trim()}. The replayed work is at '${staging}' and the patch at '${patch}'.`);
  record.baseHead = movement.to;
  if (movement.repository === "root") state.workspace.baseHead = movement.to;
  const repository = context.selectedRepositories(id, state)
    .find((entry) => entry.id === movement.repository);
  if (repository?.setupCommand && movement.repository !== "root") {
    context.runSetupCommand(record, repository.setupCommand,
      context.policy().sandbox?.setupTimeoutMs, record.path, repository.id);
    if (record.access === "read") {
      const changed = context.git(["status", "--porcelain"], record.path);
      if (changed.status !== 0 || changed.stdout.trim()) {
        record.setup.status = "failed";
        record.setup.reason = "setup modified a read-only repository";
      }
    }
  }
  movement.rebased = true;
}

export function unrelatedSandboxTargetChanges(context, id, state, statusOutput) {
  const allowedPrefix = `openspec/changes/${id}/`;
  const preexisting = state.workspace?.preexisting || {};
  const unrelated = [];
  for (const row of context.porcelainStatusRecords(statusOutput)) {
    const path = row.path;
    if (path === `openspec/changes/${id}` || path.startsWith(allowedPrefix)) continue;
    if (path === ".foundation" || path.startsWith(".foundation/")) continue;
    if (path === "openspec/changes" || path.startsWith("openspec/changes/")) continue;
    if (Object.prototype.hasOwnProperty.call(preexisting, path)) {
      const absolute = join(context.root, path);
      try {
        if (context.pathExists(absolute) &&
            preexisting[path] === context.fileDigest(absolute)) continue;
      } catch {
        // An unreadable carried-in path is dirty because its identity is unknown.
      }
    }
    unrelated.push(row);
  }
  return unrelated;
}

export function assertSandboxGroundingPortable(context, id, state) {
  const groundingPath = join(context.changePath(id), "grounding.yaml");
  if (!state.groundingRequired || !context.pathExists(groundingPath)) return;
  let grounding;
  try { grounding = JSON.parse(context.readText(groundingPath, "utf8")); }
  catch { grounding = null; }
  const portability = groundingPortabilityFindings(
    grounding,
    context.selectedRepositories(id, state),
    (repository, source) => {
      const absolute = resolve(repository.path, source.path);
      const plannedStatus = plannedGroundingPortabilityStatus(
        source, context.pathExists(absolute));
      if (plannedStatus !== undefined) return plannedStatus;
      let matchesDigest = false;
      try {
        matchesDigest = context.fileDigest(absolute) ===
          String(source.sha256 || "").toLowerCase();
      } catch {}
      if (!matchesDigest) return "working-tree-digest-mismatch";
      if (repository.id === "root" &&
          isPacketLocalSource(context.changePath(id), absolute)) return null;
      return gitBaseCheckoutStatus(repository, source.path, context.gitBuffer);
    }
  );
  if (portability.length)
    context.fail(`grounding readSet is not sandbox-portable: ${
      portability.map((entry) => `${entry.repository}:${entry.path} (${entry.reason})`).join(", ")
    } — commit the source or move the required decision/evidence into the change packet before creating a sandbox`);
}

export function plannedGroundingPortabilityStatus(source, pathExists) {
  if (source?.sha256 !== "planned") return undefined;
  if (!["production-path", "runtime-path", "test-topology"]
    .includes(source?.role)) return "invalid-planned-role";
  return pathExists ? "planned-path-exists" : null;
}

// Which files `git apply` refused, so a replay that cannot proceed names the
// same thing the isolated-copy path names: the files, not the exit code.
//
// Merge conflicts are read first and exclusively. A three-way apply reports
// `patch failed:` for every hunk it could not place directly — including the
// ones it then merged successfully — so mixing the two vocabularies names files
// that are not in conflict at all. `git apply --3way` reports a genuine
// conflict as `U <path>`, not in `git merge`'s vocabulary.
export function rejectedPaths(output) {
  const text = String(output || "");
  const merged = new Set();
  for (const pattern of [
    /^U (.+)$/gm,
    /^Applied patch to '(.+)' with conflicts\.$/gm,
    /^CONFLICT \([^)]*\): Merge conflict in (.+)$/gm
  ])
    for (const match of text.matchAll(pattern)) merged.add(match[1]);
  if (merged.size) return [...merged].sort();
  const paths = new Set();
  const patterns = [
    /^error: patch failed: (.+?):\d+$/gm,
    /^error: (.+?): patch does not apply$/gm,
    /^error: (.+?): does not exist in index$/gm,
    /^error: (.+?): already exists in working directory$/gm
  ];
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) paths.add(match[1]);
  return [...paths].sort();
}

export function assertReadOnlyReplayClean(repository, record, git, fail) {
  if (record.access !== "read") return;
  const dirty = git(["status", "--porcelain"], record.path);
  if (dirty.status !== 0 || dirty.stdout.trim())
    fail(`read-only repository '${repository}' changed inside its sandbox: ${
      dirty.stdout.trim() || dirty.stderr.trim() || "git status failed"}`);
}

export function replayContext({
  id, state, candidate, gitHead, selectedRepositories
}) {
  const { repository, record, targetPath } = candidate;
  const currentHead = targetPath ? gitHead(targetPath) : null;
  if (!targetPath || !currentHead || !record.baseHead || currentHead === record.baseHead)
    return null;
  const nested = repository === "root"
    ? selectedRepositories(id, state)
      .filter((entry) => entry.type === "submodule")
      .map((entry) => entry.relativePath)
    : [];
  return {
    id, state, repository, record, targetPath, currentHead,
    movement: {
      repository, from: record.baseHead, to: currentHead,
      rebased: false, conflicts: []
    },
    pathspec: sandboxCodePathspec(id, nested),
    staging: `${record.path}.rebase`,
    patch: `${record.path}.rebase.patch`
  };
}

export function manuallyRebasedMovement(candidate, gitHead) {
  const { repository, record, targetPath } = candidate;
  const targetHead = targetPath ? gitHead(targetPath) : null;
  const sandboxHead = record.path ? gitHead(record.path) : null;
  if (!targetHead || !sandboxHead || !record.baseHead ||
      record.baseHead === targetHead || sandboxHead !== targetHead) return null;
  return {
    repository, from: record.baseHead, to: targetHead,
    rebased: true, conflicts: [], manuallyRebased: true
  };
}

export function stageReplayWorkspace(context, { git, remove = rmSync, fail }) {
  const { repository, record, targetPath, currentHead, staging } = context;
  remove(staging, { recursive: true, force: true });
  git(["worktree", "prune"], targetPath);
  const staged = git(["worktree", "add", "--detach", staging, currentHead], targetPath);
  if (staged.status !== 0) {
    const kind = record.access === "read" ? "read-only worktree refresh" : "rebase worktree";
    fail(`cannot stage the '${repository}' ${kind}: ${staged.stderr.trim()}`);
  }
}

export function replayStagingCleanup(context, { git, remove = rmSync }, removePatch = true) {
  return () => {
    git(["worktree", "remove", "--force", context.staging], context.targetPath);
    remove(context.staging, { recursive: true, force: true });
    if (removePatch) remove(context.patch, { force: true });
  };
}

export function preparedReplay(context, discardStaging) {
  const { movement, record, targetPath, staging, patch } = context;
  return { movement, record, targetPath, staging, patch, discardStaging };
}

export function prepareReadOnlyReplay(context, dependencies) {
  stageReplayWorkspace(context, dependencies);
  return preparedReplay(context, replayStagingCleanup(context, dependencies, false));
}

export function prepareWritableReplay(context, dependencies) {
  const { git, gitBuffer, write = writeFileSync, fail } = dependencies;
  const { repository, record, pathspec, patch, staging, movement } = context;
  git(["add", "-A"], record.path);
  const diff = gitBuffer(["diff", "--binary", record.baseHead, "--", ...pathspec],
    record.path);
  if (diff.status !== 0)
    fail(`cannot read the '${repository}' sandbox diff to replay: ${
      String(diff.stderr).trim()}`);
  stageReplayWorkspace(context, dependencies);
  const discardStaging = replayStagingCleanup(context, dependencies);
  if (diff.stdout.length) {
    write(patch, diff.stdout);
    const replayed = git(
      ["apply", "--3way", "--binary", "--whitespace=nowarn", patch], staging);
    if (replayed.status !== 0) {
      movement.conflicts = rejectedPaths(
        `${replayed.stderr || ""}\n${replayed.stdout || ""}`);
      if (!movement.conflicts.length) movement.conflicts.push(".");
    }
  }
  return preparedReplay(context, discardStaging);
}

export function prepareWorktreeReplay(
  options, id = options.id, state = options.state, candidate = options.candidate
) {
  const { git, gitHead, selectedRepositories, fail } = options;
  assertReadOnlyReplayClean(candidate.repository, candidate.record, git, fail);
  const context = replayContext({ id, state, candidate, gitHead, selectedRepositories });
  if (!context) return null;
  return candidate.record.access === "read"
    ? prepareReadOnlyReplay(context, options)
    : prepareWritableReplay(context, options);
}

// `cpSync` resolves symlinks by default: a relative link is rewritten as an
// absolute path into the *source* tree. In a sandbox that is not a cosmetic
// difference — anything following the link writes into the real project while
// believing it is isolated, and git inside the copy reports the rewritten link
// as a modification the change never made. `land-journal.mjs` already carries
// these two options for the same reason on the way back out.
const VERBATIM_COPY = { dereference: false, verbatimSymlinks: true };

export function carryableGitMetadata(root) {
  const gitPath = join(root, ".git");
  if (!existsSync(gitPath)) return false;
  try { return statSync(gitPath).isDirectory(); }
  catch { return false; }
}

export function ignoredSandboxPaths(carriesGit, root, git) {
  if (!carriesGit) return new Set();
  const listed = git(
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    root);
  if (listed.status !== 0) return new Set();
  return new Set(listed.stdout.split("\0").filter(Boolean)
    .map((path) => path.endsWith("/") ? path.slice(0, -1) : path));
}

export function sandboxCopyPlan({
  root, carriesGit, git, sandboxCopyExcludedDirs, excludedWorkspaceDirs
}) {
  const copyExcluded = carriesGit ? sandboxCopyExcludedDirs : excludedWorkspaceDirs;
  const listed = carriesGit ? git(["ls-files", "-z"], root) : { status: 1, stdout: "" };
  const listedPaths = listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : [];
  const tracked = trackedPathSet(listedPaths);
  const ignored = ignoredSandboxPaths(carriesGit, root, git);
  const excludes = (rel) => ignored.has(rel) ||
    isExcludedPath(rel, { excluded: copyExcluded, tracked: tracked.has(rel) });
  const filter = (source) =>
    !excludes(relative(root, source).replaceAll("\\", "/"));
  return { listed, listedPaths, excludes, filter };
}

export function copySandboxEntries({ root, requestedPath, plan, fail }) {
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (plan.excludes(entry.name)) continue;
      cpSync(join(root, entry.name), join(requestedPath, entry.name), {
        recursive: true,
        mode: fsConstants.COPYFILE_FICLONE,
        ...VERBATIM_COPY,
        filter: plan.filter
      });
    }
  } catch (error) {
    rmSync(requestedPath, { recursive: true, force: true });
    fail(`cannot create sandbox copy: ${error.message}; partial copy removed`);
  }
}

export function copyTrackedRootMetadata(root, requestedPath, listedPaths) {
  for (const rel of listedPaths) {
    if (!ROOT_ONLY_EXCLUDED_DIRS.has(rel.split("/")[0])) continue;
    const source = join(root, rel);
    if (!existsSync(source)) continue;
    const destination = join(requestedPath, rel);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, VERBATIM_COPY);
  }
}

export function copiedPreexistingDigests(path, preexisting, fileDigest) {
  const carried = {};
  for (const rel of Object.keys(preexisting || {})) {
    const copied = join(path, rel);
    try {
      if (existsSync(copied)) carried[rel] = fileDigest(copied);
    } catch {}
  }
  return carried;
}

export function sandboxCopyWorkspace({
  id, root, path, reason, carriesGit, preexisting, gitHead, workspaceManifest,
  fileDigest, directoryHash, changePath, packetManifest
}) {
  return {
    preexisting,
    mode: "copy", path, applied: false, reason,
    baseHead: carriesGit ? gitHead(root) : null,
    git: carriesGit ? "carried" : "absent",
    baseline: workspaceManifest(root, id, true),
    sandboxBaseline: workspaceManifest(path, id, true),
    sandboxPreexisting: copiedPreexistingDigests(path, preexisting, fileDigest),
    changeSourceHash: directoryHash(changePath(id)),
    packetSnapshot: packetManifest(join(path, "openspec", "changes", id))
  };
}

export function gitBaseCheckoutPaths(repository, path) {
  const paths = [path];
  let current = resolve(repository.path, path);
  const visited = new Set();
  for (;;) {
    if (visited.has(current)) return { paths, error: "symlink-cycle" };
    if (visited.size >= 64) return { paths, error: "symlink-depth-exceeded" };
    visited.add(current);
    let stat;
    try { stat = lstatSync(current); }
    catch { break; }
    if (!stat.isSymbolicLink()) break;
    current = resolve(dirname(current), readlinkSync(current));
    const target = relative(repository.path, current).replaceAll("\\", "/");
    if (!target || target === ".." || target.startsWith("../") || isAbsolute(target))
      return { paths, error: "symlink-target-outside-repository" };
    paths.push(target);
  }
  return { paths, error: null };
}

export function gitBaseCheckoutStatus(repository, path, gitBuffer) {
  if (!repository?.baseHead) return null;
  const checkout = gitBaseCheckoutPaths(repository, path);
  if (checkout.error) return checkout.error;
  for (const candidate of checkout.paths) {
    const exists = gitBuffer(
      ["cat-file", "-e", `${repository.baseHead}:${candidate}`], repository.path);
    if (exists.status !== 0) return "missing-from-base";
  }
  const diff = gitBuffer(
    ["diff", "--quiet", repository.baseHead, "--", ...checkout.paths], repository.path);
  return diff.status === 0 ? null : "differs-from-base";
}

export function isPacketLocalSource(packetPath, sourcePath) {
  const inside = (parent, child) => {
    const rel = relative(parent, child);
    return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) &&
      !isAbsolute(rel);
  };
  try {
    const packet = resolve(packetPath);
    const source = resolve(sourcePath);
    return inside(packet, source) && inside(realpathSync(packet), realpathSync(source));
  } catch {
    return false;
  }
}

export function groundingPortabilityFindings(grounding, repositories, portable) {
  if (!Array.isArray(grounding?.readSet)) return [];
  const selected = new Map(repositories.map((repository) =>
    [repository.id, repository]));
  return grounding.readSet.flatMap((source) => {
    const repository = selected.get(source.repository || "root");
    if (!repository || !source.path || !repository.baseHead) return [];
    const reason = portable(repository, source);
    return reason === null ? [] : [{
      repository: repository.id,
      path: source.path,
      reason
    }];
  });
}

export function sandboxMovementLine(movement) {
  const shortHead = (value) => String(value || "").slice(0, 8);
  if (!movement) return "";
  if (!movement.multiRepository && movement.repositories.length === 1) {
    return movement.rebased
      ? `\n  rebased: ${shortHead(movement.from)} -> ${shortHead(movement.to)} (sandbox commits flattened into the replayed diff)`
      : `\n  target moved: ${shortHead(movement.repositories[0].from)} -> ${shortHead(movement.repositories[0].to)} (sandbox NOT rebased)`;
  }
  return movement.repositories.map((repository) => repository.rebased
    ? `\n  rebased ${repository.repository}: ${shortHead(repository.from)} -> ${shortHead(repository.to)} (sandbox commits flattened into the replayed diff)`
    : `\n  target moved ${repository.repository}: ${shortHead(repository.from)} -> ${shortHead(repository.to)} (sandbox NOT rebased)`).join("");
}

export function recordSandboxBaseMove({ id, state, movement, preDiffIdentity,
  now, changeDiffIdentity }) {
  if (!movement?.rebased) return;
  const moved = movement.repositories.filter((entry) => entry.rebased);
  state.lastBaseMove = {
    at: now(),
    movementKey: moved.map((entry) => `${entry.repository}:${entry.to}`)
      .sort().join("|"),
    preDiffIdentity,
    postDiffIdentity: changeDiffIdentity(id, state),
    repositories: moved.map(({ repository, from, to }) =>
      ({ repository, from, to }))
  };
}

export function reportSandboxSync({ id, state, movement, forwarded, conflicts,
  relevantHash, log = console.log }) {
  const movementLine = sandboxMovementLine(movement);
  log(`SYNCED ${id}\n  revision: ${state.revision}\n  workspace: ${relevantHash(id)}${
    movementLine}${
    forwarded ? `\n  fast-forwarded: ${forwarded} file(s) the target moved and the sandbox left alone` : ""
  }`);
  for (const rel of conflicts)
    log(`CONFLICT ${rel}: the target and the sandbox both changed this file since the baseline; merge the target's version into the sandbox copy, then rerun sandbox sync with --resolve ${rel} (comma-separate several paths). Land stays blocked until every conflict is resolved.`);
  for (const conflict of movement?.conflicts || [])
    log(`CONFLICT ${movement.multiRepository ? `${conflict.repository}:` : ""}${conflict.path}: the sandbox diff no longer applies to the moved target; merge the target's version into the named repository sandbox worktree, then rerun sandbox sync. Land stays blocked until every repository sandbox replays onto its current commit.`);
  if (movement && !movement.rebased && !movement.conflicts.length)
    log(`TARGET MOVED ${id}: rerun 'claude-foundation sandbox sync ${id}' after repairing the named repository replay.`);
}

export function sandboxCreatePreflight(context, id, flags = {}) {
  const {
    hostAttestation, loadRuntime, repositoryCatalog, git, root,
    porcelainStatusRecords, selectedRepositories, fail
  } = context;
  if (flags.unattended) {
    const preflight = hostAttestation.preflight(id, flags, true);
    if (!preflight.safeForUnattended)
      fail(`unattended sandbox creation requires a trusted host-owned security attestation; detected virtualization alone is insufficient: ${preflight.reasons.join("; ")}`);
  }
  const initial = loadRuntime(id);
  assertSpecApproval(root, id, initial, { workspace: false });
  const topology = repositoryCatalog();
  if (topology.drift.length)
    fail(`sandbox preflight found unregistered submodule(s): ${
      topology.drift.map((repository) => repository.path).join(", ")}\n  register the complete set in openspec/repositories.yaml, select the repositories for '${id}', validate once, then create the sandbox`);
  const targetStatus = git([
    "status", "--porcelain=v1", "-z", "--untracked-files=all"
  ], root);
  const unownedInvestigations = targetStatus.status === 0
    ? porcelainStatusRecords(targetStatus.stdout).filter((row) =>
      row.status === "??" && row.path.startsWith("openspec/investigations/"))
    : [];
  if (unownedInvestigations.length)
    fail(`sandbox preflight found untracked investigation note(s): ${
      unownedInvestigations.map((row) => row.path).join(", ")}\n  commit the investigation record in the control repository before Build so sandbox apply cannot race another writer at archive`);
  return {
    initial,
    // Creation and repair resolve the agreement against live targets. Runtime
    // bindings may be precisely what is missing, so they cannot be required in
    // order to discover the repositories that need repair.
    repositories: selectedRepositories(id, initial, fail,
      { useTargetPaths: true, withoutGit: true })
  };
}

export function isolateSelectedRepositories(context, id, state, repositories) {
  const { root, gitHead, git, canonicalPath, fail } = context;
  state.repositories = {};
  try {
    for (const repository of repositories) {
      if (repository.id === "root") {
        state.repositories.root = {
          mode: state.workspace.mode, path: state.workspace.path, targetPath: root,
          baseHead: state.workspace.baseHead || gitHead(root), access: repository.mode
        };
        continue;
      }
      const baseHead = gitHead(repository.path);
      if (!baseHead)
        throw new Error(`repository '${repository.id}' cannot be isolated because it is not an initialized Git repository`);
      const requestedPath = join(root, ".foundation", "repository-sandboxes", id, repository.id);
      if (existsSync(requestedPath))
        throw new Error(`repository sandbox already exists: ${requestedPath}`);
      mkdirSync(dirname(requestedPath), { recursive: true });
      git(["worktree", "prune"], repository.path);
      const result = git(["worktree", "add", "--detach", requestedPath, baseHead], repository.path);
      if (result.status !== 0)
        throw new Error(`cannot create sandbox for '${repository.id}': ${result.stderr.trim()}`);
      const path = canonicalPath(requestedPath);
      state.repositories[repository.id] = {
        mode: "worktree", path, targetPath: repository.path,
        baseHead, access: repository.mode, applied: false
      };
    }
  } catch (error) {
    context.cleanupRepositorySandboxes(id, state);
    context.cleanupAppliedSandbox(id, state);
    state.workspace = {
      preexisting: state.workspace?.preexisting || {},
      mode: "current", path: root, baseHead: gitHead(root)
    };
    delete state.repositories;
    transitionLifecycleState(state, "change", "sandbox-creation-rolled-back");
    context.saveRuntime(state);
    fail(`${error.message}; created sandboxes rolled back`);
  }
}

function recoveredRepositoryBaseHead(context, repository, path) {
  const sandboxHead = context.gitHead(path);
  const targetHead = context.gitHead(repository.path);
  if (!sandboxHead || !targetHead)
    throw new Error(`repository '${repository.id}' cannot be recovered because its sandbox or target HEAD is unreadable`);
  if (sandboxHead === targetHead) return sandboxHead;
  const common = context.git(["merge-base", sandboxHead, targetHead], repository.path);
  const baseHead = String(common.stdout || "").trim();
  if (common.status !== 0 || !/^[0-9a-f]{40,64}$/i.test(baseHead))
    throw new Error(`repository '${repository.id}' sandbox does not share a recoverable base with its selected target`);
  return baseHead;
}

export function repairSelectedRepositories(context, id, state, repositories) {
  const ownsWorktree = context.worktreeOwnedByTarget || worktreeOwnedByTarget;
  const records = state.repositories || {};
  const created = [];
  const setupIds = new Set();
  state.repositories = records;
  records.root = {
    ...(records.root || {}),
    mode: state.workspace.mode,
    path: state.workspace.path,
    targetPath: context.root,
    baseHead: state.workspace.baseHead || context.gitHead(context.root),
    access: repositories.find((repository) => repository.id === "root")?.mode || "write"
  };
  try {
    for (const repository of repositories) {
      if (repository.id === "root") continue;
      const requestedPath = join(context.root, ".foundation",
        "repository-sandboxes", id, repository.id);
      const expectedPath = context.canonicalPath(requestedPath);
      const prior = records[repository.id];
      if (prior?.path && existsSync(prior.path) &&
          context.canonicalPath(prior.path) !== expectedPath)
        throw new Error(`repository '${repository.id}' has recoverable work at non-canonical path '${prior.path}'`);
      if (existsSync(expectedPath)) {
        if (!ownsWorktree(expectedPath, repository.path))
          throw new Error(`repository '${repository.id}' canonical sandbox path is not owned by its selected target`);
        if (!prior || prior.mode !== "worktree" || !prior.targetPath ||
            context.canonicalPath(prior.targetPath || repository.path) !==
              context.canonicalPath(repository.path) ||
            prior.access !== repository.mode || !prior.baseHead)
          setupIds.add(repository.id);
        records[repository.id] = {
          ...(prior || {}), mode: "worktree", path: expectedPath,
          targetPath: repository.path,
          baseHead: prior?.baseHead || recoveredRepositoryBaseHead(
            context, repository, expectedPath),
          access: repository.mode, applied: prior?.applied === true
        };
        continue;
      }
      const baseHead = context.gitHead(repository.path);
      if (!baseHead)
        throw new Error(`repository '${repository.id}' cannot be isolated because it is not an initialized Git repository`);
      mkdirSync(dirname(expectedPath), { recursive: true });
      context.git(["worktree", "prune"], repository.path);
      const result = context.git(
        ["worktree", "add", "--detach", expectedPath, baseHead], repository.path);
      if (result.status !== 0)
        throw new Error(`cannot create sandbox for '${repository.id}': ${result.stderr.trim()}`);
      created.push({ id: repository.id, path: expectedPath, targetPath: repository.path });
      setupIds.add(repository.id);
      records[repository.id] = {
        mode: "worktree", path: expectedPath, targetPath: repository.path,
        baseHead, access: repository.mode, applied: false
      };
    }
    return repositories.filter((repository) => setupIds.has(repository.id));
  } catch (error) {
    for (const record of created.reverse()) {
      context.git(["worktree", "remove", "--force", record.path], record.targetPath);
      rmSync(record.path, { recursive: true, force: true });
      delete records[record.id];
    }
    context.saveRuntime(state);
    context.fail(`${error.message}; existing work was preserved — inspect it with 'claude-foundation sandbox inspect ${id}', retry repair with 'claude-foundation sandbox create ${id} --all', or retire the change with 'claude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>'`);
  }
}

export function setupJob(repository, record, timeoutMs) {
  return {
    repository, record, command: repository.setupCommand,
    cwd: record.path, timeoutMs
  };
}

export function verifyReadOnlySetup(context, repository, record, warn = false) {
  if (record.access !== "read") return;
  const changed = context.git(["status", "--porcelain"], record.path);
  if (changed.status === 0 && !changed.stdout.trim()) return;
  record.setup.status = "failed";
  record.setup.reason = "setup modified a read-only repository";
  if (warn) (context.output || console).error(
    `WARNING: sandbox setup modified read-only repository '${repository.id}': ${
      changed.stdout.trim() || changed.stderr.trim() || "git status failed"}`);
}

export function applySetupResult(context, row, warn = false) {
  const { repository, record, command, result } = row;
  const failed = Boolean(result.error) || result.status !== 0;
  record.setup = {
    command, status: failed ? "failed" : "ok",
    exitCode: typeof result.status === "number" ? result.status : null
  };
  if (failed && warn) {
    const cause = typeof result.status === "number" ? `exit ${result.status}` : result.error;
    const tail = `${result.stdout || ""}\n${result.stderr || ""}`
      .trim().split("\n").filter(Boolean).slice(-5).join("\n    ");
    (context.output || console).error(`WARNING: sandbox setup command failed for '${repository.id}' (${
      cause}) in the isolated workspace. Harness preparation will repair or route this failure before Build.${
      tail ? `\n    ${tail}` : ""}`);
  }
  verifyReadOnlySetup(context, repository, record, warn);
}

export function setupSelectedRepositories(context, state, repositories) {
  const timeoutMs = context.policy().sandbox?.setupTimeoutMs;
  const eligible = repositories.flatMap((repository) => {
    const record = state.repositories[repository.id];
    return repository.setupCommand && record?.mode === "worktree"
      ? [setupJob(repository, record, timeoutMs)] : [];
  });
  if (!context.runSetupBatch) {
    for (const { repository, record, command } of eligible) {
      context.runSetupCommand(record, command, timeoutMs, record.path, repository.id);
      verifyReadOnlySetup(context, repository, record, true);
    }
    return;
  }
  for (const row of context.runSetupBatch(eligible)) applySetupResult(context, row, true);
}

// Setup is Harness-owned preparation. A transient package-manager or network
// failure must not turn into a command for the user, and a successful sibling
// must not be repeated. Retry only records that are still failed; callers can
// invoke this at every lifecycle resume without redoing valid work.
export function retryFailedSandboxSetups(context, id,
  state = context.loadRuntime(id)) {
  const selected = context.selectedRepositories(id, state);
  const attempted = [];
  const configured = context.policy().sandbox || {};
  const rootSelection = selected.find((repository) => repository.id === "root");
  const rootCommand = rootSelection?.setupCommand || configured.setupCommand;
  if (state.workspace?.setup?.status === "failed" && rootCommand &&
      state.workspace?.path) {
    context.runSetupCommand(state.workspace, rootCommand,
      configured.setupTimeoutMs, state.workspace.path, "root");
    attempted.push("root");
  }
  const jobs = [];
  for (const repository of selected) {
    if (repository.id === "root") continue;
    const record = state.repositories?.[repository.id];
    if (record?.setup?.status !== "failed" || !repository.setupCommand ||
        !record.path) continue;
    if (!context.runSetupBatch) {
      context.runSetupCommand(record, repository.setupCommand,
        configured.setupTimeoutMs, record.path, repository.id);
      verifyReadOnlySetup(context, repository, record);
      attempted.push(repository.id);
    } else jobs.push(setupJob(repository, record, configured.setupTimeoutMs));
  }
  for (const row of context.runSetupBatch ? context.runSetupBatch(jobs) : []) {
    applySetupResult(context, row);
    attempted.push(row.repository.id);
  }
  if (attempted.length) context.saveRuntime(state);
  return attempted;
}

export function reportMultiRepositorySandbox(context, id, state) {
  console.log(`MULTI-REPOSITORY SANDBOX ${id}`);
  for (const repository of context.selectedRepositories(id, state))
    console.log(`  ${repository.id}: ${repository.workspacePath}`);
}

export function createSandbox(context, id, flags = {}) {
  const { initial, repositories } = sandboxCreatePreflight(context, id, flags);
  if (repositories.length === 1 && repositories[0].id === "root" && !flags.all) {
    context.createSingle(id);
    return;
  }
  const expectedRepositoryPath = (repository) => context.canonicalPath(join(
    context.root, ".foundation", "repository-sandboxes", id, repository.id));
  const rootActive = isolatedRepositoryState(initial) &&
    Boolean(initial.workspace?.path && existsSync(initial.workspace.path));
  const repair = isolatedRepositoryState(initial) ||
    Object.keys(initial.repositories || {}).some((repository) => repository !== "root") ||
    repositories.some((repository) => repository.id !== "root" &&
      existsSync(expectedRepositoryPath(repository)));
  if (!rootActive) context.createSingle(id);
  const state = context.loadRuntime(id);
  const setupRepositories = repair
    ? repairSelectedRepositories(context, id, state, repositories)
    : (isolateSelectedRepositories(context, id, state, repositories), repositories);
  setupSelectedRepositories(context, state, setupRepositories);
  transitionLifecycleState(state, "building", "repository-sandboxes-created");
  context.saveRuntime(state);
  context.clearSnapshotCache(id);
  reportMultiRepositorySandbox(context, id, state);
}

export function prepareBuildSandbox(context, id) {
  const state = context.loadRuntime(id);
  if (context.root) assertSpecApproval(context.root, id, state, { workspace: false });
  if (state.status === "change") context.validate(id, "root", { quiet: true });
  const inspection = context.workspaceInspection(id, state);
  const repositoryRecordsExist = Object.keys(state.repositories || {}).length > 0;
  const repositoryIncomplete = inspection.repositories.some((repository) =>
    repository.status !== "active" &&
    (repository.id !== "root" || repositoryRecordsExist));
  const incomplete = state.status === "change" || inspection.status !== "active" ||
    repositoryIncomplete;
  if (incomplete) context.create(id, { quiet: true });
  context.synchronizeAgreement?.(id);
  context.retryFailedSetups(id);
  return { repaired: incomplete };
}

export function relocatedSandboxCandidate(context, id, workspace) {
  if (!["worktree", "copy"].includes(workspace.mode) ||
      !workspace.path || context.pathExists(workspace.path)) return null;
  const canonicalRoot = context.canonicalPath(
    join(context.root, ".foundation", "sandboxes"));
  const candidate = context.canonicalPath(context.sandboxRoot(id));
  if (!context.directoryExists(candidate) ||
      candidate === context.canonicalPath(workspace.path)) return null;
  if (relative(canonicalRoot, candidate).replaceAll("\\", "/") !== id)
    context.fail(`cannot rebind relocated sandbox '${candidate}': candidate escapes the canonical sandbox directory; recreate the sandbox`);
  return candidate;
}

export function assertRelocatedSandboxIdentity(context, id, workspace, candidate) {
  const packet = join(candidate, "openspec", "changes", id);
  const marker = join(packet, ".openspec.yaml");
  const expected = workspace.packetSnapshot?.[".openspec.yaml"];
  if (!context.directoryExists(packet) || !expected || !context.pathExists(marker) ||
      context.fileDigest(marker) !== expected)
    context.fail(`cannot rebind relocated sandbox '${candidate}': change identity does not match '${id}'`);
}

export function assertRelocatedSandboxLayout(context, workspace, candidate) {
  const required = [
    join(candidate, ".claude", "harness", "foundation.mjs"),
    join(candidate, "openspec", "config.yaml")
  ];
  if (required.some((path) => !context.pathExists(path)))
    context.fail(`cannot rebind relocated sandbox '${candidate}': sandbox layout is incomplete; recreate the sandbox`);
  if (workspace.mode === "worktree" && !context.gitMetadataPresent(candidate))
    context.fail(`cannot rebind relocated sandbox '${candidate}': recorded worktree metadata is not valid at the new project location; recreate the sandbox`);
  if (workspace.mode === "copy" && workspace.git === "carried" &&
      !context.gitMetadataPresent(candidate))
    context.fail(`cannot rebind relocated sandbox '${candidate}': recorded copied Git metadata is not valid at the new project location; recreate the sandbox`);
}

export function rebindRelocatedSandboxOperation(context, id, state) {
  const workspace = state.workspace || {};
  const candidate = relocatedSandboxCandidate(context, id, workspace);
  if (!candidate) return false;
  assertRelocatedSandboxIdentity(context, id, workspace, candidate);
  assertRelocatedSandboxLayout(context, workspace, candidate);
  workspace.relocatedFrom = context.canonicalPath(workspace.path);
  workspace.path = candidate;
  workspace.reboundAt = context.now();
  state.workspace = workspace;
  context.saveRuntime(state);
  context.clearSnapshotCache(id);
  context.output.log(`REBOUND ${id}\n  workspace: ${candidate}`);
  return true;
}

export function changeDiffCandidates(root, state) {
  if (!state.repositories || Object.keys(state.repositories).length === 0)
    return [{ repository: "root", record: state.workspace, targetPath: root }];
  return Object.entries(state.repositories)
    .map(([repository, record]) => ({
      repository, record,
      targetPath: record?.targetPath || (repository === "root" ? root : null)
    }));
}

export function normalizedDiffDigest(buffer) {
  const digest = createHash("sha256");
  // latin1 round-trips bytes 1:1, so `GIT binary patch` sections pass
  // through the line-level normalization untouched.
  for (const line of buffer.toString("latin1").split("\n")) {
    if (line.startsWith("index ")) continue;
    digest.update(line.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, "@@"));
    digest.update("\n");
  }
  return digest.digest("hex");
}

export function changeDiffCandidatePlan(context, id, state, candidate) {
  const { repository, record } = candidate;
  if (record?.access === "read")
    return { status: "skip" };
  if (!record || !["worktree", "copy"].includes(record.mode) ||
      !record.path || !context.pathExists(record.path))
    return { status: "invalid" };
  const nested = repository === "root"
    ? context.selectedRepositories(id, state)
      .filter((entry) => entry.type === "submodule")
      .map((entry) => entry.relativePath)
    : [];
  if (record.mode === "copy") {
    if (!record.baseline || typeof record.baseline !== "object" ||
        Array.isArray(record.baseline))
      return { status: "invalid" };
    return { status: "ready", repository, record, id, nested };
  }
  if (!record.baseHead) return { status: "invalid" };
  const indexFile = `${record.path}.diff-identity-index.${context.pid}`;
  return {
    status: "ready", repository, record,
    pathspec: context.codePathspec(id, nested),
    indexFile,
    env: { ...context.environment, GIT_INDEX_FILE: indexFile }
  };
}

// Copy baselines already carry the exact entry identities used by Apply.
// Hash only the contribution: forwarding an untouched target path advances
// both manifests equally. Whole-file before/after identities deliberately
// expire after same-file reconciliation, even if a smaller hunk looks equal.
export function copyDiffIdentity(baseline, current, nested = []) {
  const manifest = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!manifest(baseline) || !manifest(current)) return null;
  const rows = [];
  const validEntry = (value) => typeof value === "string" &&
    (/^(?:file:(?:regular|executable):)?[a-f0-9]{64}$/.test(value) ||
      value.startsWith("symlink:"));
  for (const path of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) {
    if (nested.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
    if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) return null;
    const before = baseline[path] ?? null;
    const after = current[path] ?? null;
    if ((before !== null && !validEntry(before)) || (after !== null && !validEntry(after)))
      return null;
    if (before !== after) rows.push([path, before, after]);
  }
  return createHash("sha256").update("foundation-copy-diff:1\0")
    .update(JSON.stringify(rows)).digest("hex");
}

export function changeDiffCandidateRow(context, plan) {
  const { repository, record, pathspec, indexFile, env } = plan;
  if (record.mode === "copy") {
    const identity = copyDiffIdentity(record.baseline,
      context.workspaceManifest(record.path, plan.id, true), plan.nested);
    return identity ? `${repository}\0copy:1:${identity}` : null;
  }
  try {
    // Keep the scratch index beside the worktree so it can never stage itself.
    context.remove(indexFile, { force: true });
    // Seed from the base before add -A: tracked-but-ignored files must remain
    // known to the index, while real deletions must still enter the patch.
    const seeded = context.spawn("git", ["read-tree", record.baseHead],
      { cwd: record.path, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (seeded.status !== 0) return null;
    const staged = context.spawn("git", ["-c", "core.quotepath=false", "add", "-A"],
      { cwd: record.path, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (staged.status !== 0) return null;
    // No encoding: binary patch bytes, same rationale as gitBuffer.
    const diff = context.spawn("git", [
      "-c", "diff.algorithm=myers", "-c", "core.quotepath=false",
      "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false",
      "-c", "diff.renames=true",
      "diff", "--binary", "--cached", record.baseHead, "--", ...pathspec
    ], { cwd: record.path, env, maxBuffer: 64 * 1024 * 1024 });
    if (diff.status !== 0) return null;
    return `${repository}\0${context.diffDigest(diff.stdout)}`;
  } finally {
    context.remove(indexFile, { force: true });
  }
}

export function combinedDiffIdentity(rows) {
  const digest = createHash("sha256");
  // :3 — the representation changed again (base-seeded index); a verdict
  // stamped under an earlier form must read as stale, never as
  // accidentally equal.
  digest.update("foundation-diff-identity:3\0");
  for (const row of [...rows].sort()) {
    digest.update(row);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function changeDiffIdentityOperation(context, id, state) {
  const rows = [];
  for (const candidate of context.candidates(state)) {
    const plan = context.plan(id, state, candidate);
    if (plan.status === "skip") continue;
    if (plan.status !== "ready") return null;
    const row = context.row(plan);
    if (!row) return null;
    rows.push(row);
  }
  return rows.length ? context.combine(rows) : null;
}

export function createSandboxRuntime({
  root, policy, excludedWorkspaceDirs, sandboxCopyExcludedDirs, hostAttestation,
  loadRuntime, saveRuntime,
  canonicalPath, workspaceManifest, directoryHash, fileDigest, changePath, gitHead, git,
  gitBuffer, porcelainStatusRecords,
  selectedRepositories, cleanupRepositorySandboxes, cleanupAppliedSandbox,
  repositoryCatalog,
  clearSnapshotCache, validate, repositorySelectionIdsAt, contractFingerprint,
  executionFingerprint, taskBlocks, proofPath, relevantHash, now, fail,
  markBlocked,
  recordScheduler
}) {
  function sandboxRoot(id) {
    return join(root, ".foundation", "sandboxes", id);
  }

  // A freshly created sandbox has no installed dependencies: the copy path
  // excludes them by name and by gitignore, and a worktree is a bare checkout.
  // The setup command exists so the first proof run does not have to discover
  // that. Failure keeps the sandbox — the workspace itself is correct, and
  // destroying it over a flaky install would discard valid isolation. The
  // lifecycle preparation step retries failed records internally on resume.
  const runSetupCommand = runSandboxSetupCommand.bind(null, {
    spawn: spawnSync, output: console
  });
  const runSetupBatch = runMeasuredSandboxSetupBatch.bind(null, {
    policy, recordScheduler
  });

  // Single-repository setup comes from foundation.json; a repository row in a
  // multi-repository change carries its own `setupCommand` because each
  // repository installs its own toolchain.
  function runWorkspaceSetup(state) {
    const configured = policy().sandbox || {};
    if (!configured.setupCommand) return null;
    return runSetupCommand(state.workspace, configured.setupCommand,
      configured.setupTimeoutMs, state.workspace.path, null);
  }

  function noteMissingDependencySetup(workspacePath) {
    const advisory = missingDependencySetupAdvisory({
      root, workspace: workspacePath, setupCommand: policy().sandbox?.setupCommand,
      pathExists: existsSync
    });
    if (advisory) console.log(advisory);
  }

  // Per-file digests of a packet directory. `sync` copies the target's packet
  // over the sandbox's wholesale; without a record of what the last copy wrote,
  // a packet edited in the sandbox is indistinguishable from one the copy wrote,
  // and the overwrite is silent.
  function packetManifest(dir) {
    const result = {};
    function collect(current) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) collect(path);
        else result[relative(dir, path).replaceAll("\\", "/")] = fileDigest(path);
      }
    }
    if (existsSync(dir)) collect(dir);
    return result;
  }

  function createCopy(id, state, reason) {
    const requestedPath = sandboxRoot(id);
    if (existsSync(requestedPath))
      fail(`sandbox path already occupied: ${requestedPath}`);
    // `.git` is excluded from every hash and every apply diff by name, so a
    // copy that carries it never projects it back and never hashes it. What it
    // does buy is that the copy stays a git repository: without it `gitHead`
    // returns null, the changed surface degrades from `git diff` to a walk of
    // the whole tree, and `singleRelevantSnapshot` loses its `.gitignore`
    // awareness — so running the evidence wrote build output into the workspace
    // hash and expired the evidence that had just been collected.
    const carriesGit = carryableGitMetadata(root);
    mkdirSync(requestedPath, { recursive: true });
    // The sandbox lives under `.foundation/`, which is inside the tree being
    // copied. `cpSync(root, dest)` rejects that outright — it checks for a
    // destination inside the source before it ever consults `filter`, so the
    // exclusion that makes the copy terminate is never seen. Copying each
    // top-level entry instead keeps the exclusion authoritative: `.foundation`
    // is dropped at the top level, so nothing recurses into the sandbox itself.
    // What git tracks is content, whatever it is named. Without this the copy
    // silently omitted committed fixtures whose directory name collided with a
    // build-output name, and git inside the sandbox then reported them deleted.
    const plan = sandboxCopyPlan({
      root, carriesGit, git, sandboxCopyExcludedDirs, excludedWorkspaceDirs
    });
    // A copy that dies partway leaves a directory the runtime never recorded:
    // `state.workspace` is still whatever it was, so nothing knows the tree
    // exists, while `sandbox path already occupied` blocks every retry. Filling
    // the disk is exactly how that happens, so the failure path has to remove
    // what it wrote before reporting.
    copySandboxEntries({ root, requestedPath, plan, fail });
    // `.foundation/` and `.workflow/` are excluded by name at the root because
    // they are machine state, and that exclusion must not weaken — the sandbox
    // itself lives under `.foundation/`. But the installer *ships* two tracked
    // files inside `.foundation/`, and it checks for one of them as a source
    // precondition: without them `run-installer-tests.sh` cannot run in any
    // sandbox, so Build could not verify the installer it was changing.
    //
    // Carry exactly what git tracks and nothing else. Untracked machine state —
    // including this sandbox — is never listed, so the recursion the name-based
    // exclusion prevents stays prevented.
    copyTrackedRootMetadata(root, requestedPath, plan.listedPaths);
    const path = canonicalPath(requestedPath);
    // The copied `.git/worktrees` still names the *target's* linked worktrees by
    // absolute path. Left in place, a `git worktree` command run inside the
    // sandbox would operate on directories outside it.
    if (carriesGit)
      rmSync(join(path, ".git", "worktrees"), { recursive: true, force: true });
    const preexisting = state.workspace?.preexisting || {};
    state.workspace = sandboxCopyWorkspace({
      id, root, path, reason, carriesGit, preexisting, gitHead, workspaceManifest,
      fileDigest, directoryHash, changePath, packetManifest
    });
    transitionLifecycleState(state, "building", "copy-sandbox-created");
    saveRuntime(state);
    const setup = runWorkspaceSetup(state);
    if (setup) saveRuntime(state);
    console.log(`SANDBOX ${id}\n  mode: isolated-copy\n  reason: ${reason}\n  git: ${
      carriesGit ? "carried" : "absent (target has no usable .git directory)"
    }\n  path: ${path}${setup ? `\n  setup: ${setup.status}` : ""}`);
    noteMissingDependencySetup(path);
  }

  function createChallenge(id) {
    const challenge = hostAttestation.createChallenge(id);
    console.log(JSON.stringify(challenge, null, 2));
    return challenge;
  }

  function directoryExists(path) {
    if (!path || !existsSync(path)) return false;
    try { return statSync(path).isDirectory(); }
    catch { return false; }
  }

  function gitMetadataPresent(workspacePath) {
    if (!directoryExists(workspacePath)) return false;
    const metadataPath = join(workspacePath, ".git");
    if (!existsSync(metadataPath)) return false;
    try {
      const metadata = statSync(metadataPath);
      if (metadata.isDirectory()) return true;
      if (!metadata.isFile() || metadata.size > 4096) return false;
      const match = readFileSync(metadataPath, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
      return Boolean(match && directoryExists(resolve(dirname(metadataPath), match[1])));
    } catch {
      return false;
    }
  }

  const rebindRelocatedSandbox = rebindRelocatedSandboxOperation.bind(null, {
    root,
    sandboxRoot,
    canonicalPath,
    pathExists: existsSync,
    directoryExists,
    fileDigest,
    gitMetadataPresent,
    saveRuntime,
    clearSnapshotCache,
    now,
    fail,
    output: console
  });

  const workspaceInspection = workspaceInspectionFor({
    root,
    loadRuntime,
    selectedRepositories,
    gitMetadataPresent,
    directoryExists,
    headOfRepository,
    worktreeOwnedByTarget
  });

  const inspect = inspectSandbox.bind(null, { workspaceInspection, hostAttestation });
  const showInspection = showSandboxInspection.bind(null, {
    inspect, markBlocked, output: console, runtimeProcess: process
  });
  const assertGroundingPortable = assertSandboxGroundingPortable.bind(null, {
    changePath,
    pathExists: existsSync,
    readText: readFileSync,
    selectedRepositories,
    fileDigest,
    gitBuffer,
    fail
  });

  function createSingle(id) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    if (rebindRelocatedSandbox(id, state)) return;
    if (["worktree", "copy"].includes(state.workspace?.mode) && existsSync(state.workspace.path))
      fail(`sandbox already exists: ${state.workspace.path}`);
    assertGroundingPortable(id, state);
    if (!gitHead(root)) {
      createCopy(id, state, "no-git");
      return;
    }
    const dirty = git(["status", "--porcelain", "-z", "--untracked-files=all"], root);
    if (dirty.status !== 0) fail(`cannot inspect target workspace: ${dirty.stderr.trim()}`);
    // Dirt the harness produced itself must not cost this change its worktree.
    // Landing a *previous* change moves its packet into `changes/archive/` and
    // leaves that move uncommitted, so the very next `sandbox create` saw a
    // dirty target and fell back to an isolated copy — a mode with strictly
    // lower fidelity — for a reason the operator had no part in. Neither path
    // is ever this change's surface: `.foundation/` is machine state, and
    // `allowed()` in the snapshot drops `changes/archive/` outright, so a
    // worktree taken from HEAD cannot lose work by ignoring them here.
    //
    // Every other change's draft belongs in that same category. The loop keeps
    // drafts uncommitted until Land by design, so a second active change made
    // every later `sandbox create` fall back to a copy — the expensive mode —
    // for state the operator was told to leave uncommitted. Nothing is lost by
    // ignoring it: `singleRelevantSnapshot` drops `openspec/changes/` that is
    // not this change, and the apply diff excludes this change's own directory.
    // Dirt that was already there when the change began is not this change's
    // doing, and it should not cost the change its worktree. The surface
    // already ignores these paths; without the same test here a single stray
    // untracked file downgraded every sandbox to a whole-tree copy — lower
    // fidelity and, on a large repository, the expensive mode — for a file
    // nobody in this change had touched. Compared by digest, so a pre-existing
    // file the operator has since edited still counts as a dirty target.
    const unrelated = unrelatedSandboxTargetChanges({
      root, pathExists: existsSync, fileDigest, porcelainStatusRecords
    }, id, state, dirty.stdout);
    if (unrelated.length) {
      createCopy(id, state, `dirty-target:${unrelated[0].status} ${unrelated[0].path}`);
      return;
    }
    const requestedPath = sandboxRoot(id);
    mkdirSync(dirname(requestedPath), { recursive: true });
    // A sandbox directory deleted out from under git stays registered, and
    // `worktree add` then refuses the same path — dead-ending the recovery
    // the missing-workspace error advertises. Prune only drops registrations
    // whose directories are gone, so it is safe unconditionally.
    git(["worktree", "prune"]);
    const result = git(["worktree", "add", "--detach", requestedPath, "HEAD"]);
    if (result.status !== 0) fail(`cannot create sandbox: ${result.stderr.trim()}`);
    const path = canonicalPath(requestedPath);
    cpSync(changePath(id), join(path, "openspec", "changes", id),
      { recursive: true, ...VERBATIM_COPY });
    state.workspace = {
      preexisting: state.workspace?.preexisting || {},
      mode: "worktree", path, baseHead: gitHead(root), applied: false,
      changeSourceHash: directoryHash(changePath(id)),
      packetSnapshot: packetManifest(join(path, "openspec", "changes", id))
    };
    transitionLifecycleState(state, "building", "worktree-sandbox-created");
    saveRuntime(state);
    const setup = runWorkspaceSetup(state);
    if (setup) saveRuntime(state);
    console.log(`SANDBOX ${id}\n  path: ${path}${setup ? `\n  setup: ${setup.status}` : ""}`);
    noteMissingDependencySetup(path);
  }

  function mergeTaskProgress(source, sandbox) {
    const completedIds = new Set(taskBlocks(sandbox)
      .filter((task) => task.done && task.id).map((task) => task.id));
    const completedText = new Set(taskBlocks(sandbox)
      .filter((task) => task.done)
      .map((task) => task.text.replace(/\s+/g, " ").trim()));
    return source.split("\n").map((line) => {
      if (!/^\s*-\s*\[\s\]/.test(line)) return line;
      const text = line.replace(/^\s*-\s*\[\s\]\s*/, "").trim();
      const taskId = text.match(/^\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]?.toUpperCase();
      return (taskId ? completedIds.has(taskId) : completedText.has(text))
        ? line.replace("[ ]", "[x]") : line;
    }).join("\n");
  }

  // A worktree sandbox is pinned to the commit it branched from and nothing
  // moved it. An isolated copy has always reconciled a moving target here; a
  // worktree did not, and said nothing either — so Build and Prove ran to
  // completion against a base the target no longer had, and the refusal only
  // arrived inside the apply transaction, after the evidence was spent.
  //
  // Replay, not `git rebase`: the sandbox's whole contribution is its diff from
  // `baseHead`, which is exactly what apply projects, and no contract downstream
  // reads sandbox commit history. Flattening it into working-tree changes costs
  // nothing that is ever consulted.
  const replayCandidates = changeDiffCandidates.bind(null, root);

  // The change's whole contribution is its diff from `baseHead` — the same
  // content replay projects and a reviewer reads. Hashing the raw patch would
  // still churn on a moved base: blob ids (`index` lines) and hunk offsets
  // (`@@` coordinates) shift under work nobody edited. With those volatile
  // coordinates removed, the identity survives a clean replay onto a moved
  // base and changes exactly when the diff's content changes — which is when
  // a review verdict genuinely needs renewing.
  // Copy sandboxes use their Apply manifests instead of a Git patch.
  // Read-only repositories contribute no diff and retain their independent
  // freshness/Land guards. Null means unavailable, never an empty contribution.
  //
  // One canonical representation, staged into a throwaway index. Splitting
  // "tracked changes as patch text" from "untracked files as raw digests"
  // made identity a function of index state, and sync changes index state:
  // replay's `add -A` plus `apply --3way` turn a file that was untracked at
  // verdict time into a staged one afterwards, expiring the verdict over a
  // representation flip with no content behind it. Staging everything into a
  // temporary GIT_INDEX_FILE folds new, edited, and deleted files through the
  // same `diff --cached` patch regardless of what the real index says — and
  // never mutates it, so no snapshot hash moves as a side effect of reading.
  // The diff drivers are pinned because patch text is the identity: a
  // machine-level `diff.algorithm` or prefix tweak must not expire verdicts.
  const changeDiffIdentityPlan = changeDiffCandidatePlan.bind(null, {
    pathExists: existsSync,
    selectedRepositories,
    codePathspec: sandboxCodePathspec,
    pid: process.pid,
    environment: process.env
  });
  const changeDiffIdentityRow = changeDiffCandidateRow.bind(null, {
    remove: rmSync,
    spawn: spawnSync,
    diffDigest: normalizedDiffDigest,
    workspaceManifest
  });
  const changeDiffIdentityForState = changeDiffIdentityOperation.bind(null, {
    candidates: replayCandidates,
    plan: changeDiffIdentityPlan,
    row: changeDiffIdentityRow,
    combine: combinedDiffIdentity
  });
  function changeDiffIdentity(id, state = loadRuntime(id)) {
    // Selection validation is the fail-closed boundary for an isolated
    // multi-repository runtime. Without it a missing child record turns this
    // into a root-only identity and can preserve evidence for the wrong tree.
    selectedRepositories(id, state);
    return changeDiffIdentityForState(id, state);
  }

  const prepareReplay = prepareWorktreeReplay.bind(null, {
    git, gitBuffer, gitHead, selectedRepositories, fail
  });

  // `worktree remove --force` destroys everything the checkout accumulated
  // beyond tracked content — node_modules, dist, build caches that take long
  // to rebuild. A land-time replay wiped a workspace's installed artifacts
  // exactly this way, forcing a full rebuild plus an extra review round to
  // prove the wipe was environmental rather than a regression. Carry ignored
  // artifacts into the replacement worktree instead: they are ignored, so
  // they cannot alter any tracked state the replay verified.
  const carryIgnoredArtifacts = carrySandboxIgnoredArtifacts.bind(null, {
    git, pathExists: existsSync, makeDirectory: mkdirSync, rename: renameSync
  });
  const commitReplay = commitSandboxReplay.bind(null, {
    carryIgnoredArtifacts, git, fail, selectedRepositories,
    runSetupCommand, policy
  });

  function rebaseWorktree(id, state) {
    const selection = selectedRepositories(id, state);
    const candidates = replayCandidates(state)
      .filter((candidate) => candidate.record.mode === "worktree");
    if (!candidates.length) return null;
    const multiRepository = compositeRepositorySelection(selection);
    const prepared = [];
    const manuallyRebased = [];
    try {
      for (const candidate of candidates) {
        const manualMovement = manuallyRebasedMovement(candidate, gitHead);
        if (manualMovement) {
          manuallyRebased.push({ candidate, movement: manualMovement });
          continue;
        }
        const replay = prepareReplay(id, state, candidate);
        if (!replay) continue;
        prepared.push(replay);
        if (replay.movement.conflicts.length) {
          prepared.forEach((entry) => entry.discardStaging());
          return {
            rebased: false, multiRepository,
            repositories: prepared.map((entry) => entry.movement),
            conflicts: prepared.flatMap((entry) =>
              entry.movement.conflicts.map((path) => ({
                repository: entry.movement.repository, path
              })))
          };
        }
      }
    } catch (error) {
      prepared.forEach((entry) => entry.discardStaging());
      throw error;
    }
    if (!prepared.length && !manuallyRebased.length) return null;
    prepared.forEach((entry) => commitReplay(id, state, entry));
    prepared.forEach((entry) => rmSync(entry.patch, { force: true }));
    for (const entry of manuallyRebased) {
      entry.candidate.record.baseHead = entry.movement.to;
      if (entry.candidate.repository === "root") state.workspace.baseHead = entry.movement.to;
    }
    const repositories = [
      ...prepared.map((entry) => entry.movement),
      ...manuallyRebased.map((entry) => entry.movement)
    ];
    const movement = {
      rebased: true, multiRepository, repositories, conflicts: []
    };
    if (repositories.length === 1)
      Object.assign(movement, {
        repository: repositories[0].repository,
        from: repositories[0].from,
        to: repositories[0].to
      });
    return movement;
  }

  function activeSandboxWorkspace(id, state) {
    const workspace = state.workspace;
    if (!workspace || !["worktree", "copy"].includes(workspace.mode) ||
        !workspace.path || !existsSync(workspace.path))
      fail(`change '${id}' has no active sandbox`);
    return workspace;
  }

  function assertSandboxPacketPreserved(id, workspace, source, destination) {
    // The packet's source of truth is the target copy; the sandbox copy is a
    // projection this sync overwrites. `tasks.md` is exempt because its ticks
    // merge back below. Anything else edited only in the sandbox would vanish
    // here without a trace, so refuse while the edit is still recoverable.
    if (workspace.packetSnapshot && existsSync(destination)) {
      const snapshot = workspace.packetSnapshot;
      const current = packetManifest(destination);
      const sourcePacket = packetManifest(source);
      const lost = [...new Set([...Object.keys(snapshot), ...Object.keys(current)])]
        .filter((rel) => rel !== "tasks.md")
        .filter((rel) => (current[rel] ?? null) !== (snapshot[rel] ?? null))
        .filter((rel) => (current[rel] ?? null) !== (sourcePacket[rel] ?? null))
        .sort();
      if (lost.length)
        fail(`sandbox packet edits would be lost at ${
          lost.map((rel) => `'openspec/changes/${id}/${rel}'`).join(", ")
        }; the packet's source of truth is 'openspec/changes/${id}/' in the target - port the edit there (or remove it from the sandbox copy), then sync again`);
    }
  }

  function assertSandboxRepositoryScope(source, destination) {
    const priorRepositories = repositorySelectionIdsAt(destination);
    const nextRepositories = repositorySelectionIdsAt(source);
    if (JSON.stringify(priorRepositories) !== JSON.stringify(nextRepositories))
      fail("repository scope changed during Build; finish or split the current repository work before creating a topology revision");
  }

  function sandboxSyncInputs(id, source, destination) {
    const sourceTasks = readFileSync(join(source, "tasks.md"), "utf8");
    const sandboxTasks = existsSync(join(destination, "tasks.md"))
      ? readFileSync(join(destination, "tasks.md"), "utf8") : "";
    const priorContract = existsSync(destination) ? contractFingerprint(id, destination) : null;
    const priorExecution = existsSync(destination) ? executionFingerprint(id, destination) : null;
    const nextContract = contractFingerprint(id, source);
    const nextExecution = executionFingerprint(id, source);
    const mergedTasks = mergeTaskProgress(sourceTasks, sandboxTasks);
    return {
      priorContract, priorExecution, nextContract, nextExecution, mergedTasks
    };
  }

  function replaceSandboxPacket(id, state, source, destination, mergedTasks) {
    if (existsSync(destination)) rmSync(destination, { recursive: true });
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, ...VERBATIM_COPY });
    writeFileSync(join(destination, "tasks.md"), mergedTasks);
    state.workspace.packetSnapshot = packetManifest(destination);
  }

  function advanceCopyBaseline(baseline, rel, target) {
    if (target === null) delete baseline[rel];
    else baseline[rel] = target;
  }

  function forwardCopyWorkspacePath(workspace, rel, target) {
    const destination = join(workspace.path, rel);
    rmSync(destination, { force: true });
    if (target === null) return;
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, rel), destination, VERBATIM_COPY);
  }

  function reconcileCopyWorkspacePath({
    rel, baseline, targetManifest, sandboxManifest, resolves, usedResolves, workspace
  }) {
    const base = baseline[rel] ?? null;
    const target = targetManifest[rel] ?? null;
    const sandboxEntry = sandboxManifest[rel] ?? null;
    if (target === base) return "unchanged";
    if (sandboxEntry === target) {
      advanceCopyBaseline(baseline, rel, target);
      return "settled";
    }
    if (sandboxEntry === base) {
      forwardCopyWorkspacePath(workspace, rel, target);
      advanceCopyBaseline(baseline, rel, target);
      return "forwarded";
    }
    if (resolves.has(rel)) {
      usedResolves.add(rel);
      advanceCopyBaseline(baseline, rel, target);
      return "settled";
    }
    return "conflict";
  }

  function reconcileCopyWorkspace(id, state, flags) {
    const workspace = state.workspace;
    if (workspace.mode !== "copy" || workspace.applied)
      return { forwarded: 0, conflicts: [] };
    const resolves = new Set(String(flags.resolve || "")
      .split(",").map((entry) => entry.trim()).filter(Boolean));
    const usedResolves = new Set();
    const baseline = { ...(workspace.baseline || {}) };
    const targetManifest = workspaceManifest(root, id, true);
    const sandboxManifest = workspaceManifest(workspace.path, id, true);
    const paths = [...new Set([
      ...Object.keys(baseline), ...Object.keys(targetManifest),
      ...Object.keys(sandboxManifest)
    ])].sort();
    let forwarded = 0;
    const conflicts = [];
    for (const rel of paths) {
      const outcome = reconcileCopyWorkspacePath({
        rel, baseline, targetManifest, sandboxManifest, resolves, usedResolves, workspace
      });
      if (outcome === "forwarded") forwarded += 1;
      else if (outcome === "conflict") conflicts.push(rel);
    }
    const unusedResolves = [...resolves].filter((rel) => !usedResolves.has(rel));
    if (unusedResolves.length) fail(unusedCopyResolveMessage(unusedResolves));
    workspace.baseline = baseline;
    return { forwarded, conflicts };
  }

  function updateSandboxSyncState(id, state, source, fingerprints, invalidated) {
    const approvedSource = state.specApproval?.identity &&
      state.specApproval.revision === Number(state.contractRevision || 0) &&
      state.specApproval.identity === agreementIdentity(root, id);
    state.workspace.changeSourceHash = directoryHash(source);
    delete state.workspace.recovery;
    if (invalidated)
      transitionLifecycleState(state, "building", "sandbox-contract-synchronized");
    state.revision = Number(state.revision || 0) + 1;
    if (fingerprints.priorContract !== fingerprints.nextContract)
      state.contractRevision = Number(state.contractRevision || 0) + 1;
    if (fingerprints.priorExecution !== fingerprints.nextExecution)
      state.executionRevision = Number(state.executionRevision || 0) + 1;
    // Sync projects the already-approved bytes; its bookkeeping revision is
    // not another product decision. Content changes still require approval.
    if (approvedSource) state.specApproval.revision = Number(state.contractRevision || 0);
    if (invalidated && existsSync(proofPath(id))) rmSync(proofPath(id));
  }

  function sync(id, flags = {}) {
    validate(id, "root", { quiet: true });
    const state = loadRuntime(id);
    const workspace = activeSandboxWorkspace(id, state);
    const source = changePath(id);
    const destination = join(workspace.path, "openspec", "changes", id);
    assertSandboxPacketPreserved(id, workspace, source, destination);
    assertSandboxRepositoryScope(source, destination);
    const fingerprints = sandboxSyncInputs(id, source, destination);
    clearSnapshotCache(id);
    // Without an aggregate proof there is nothing to preserve. Avoid two
    // extra full snapshots on the common pre-proof sync path.
    const priorHash = existsSync(proofPath(id)) ? relevantHash(id) : null;
    // Before the packet is written, because a successful replay rebuilds the
    // worktree the packet is written into. Everything above reads the outgoing
    // sandbox and has already been captured.
    //
    // The pre-replay diff identity is captured here for the same reason:
    // whether the sync itself altered the change's diff is what base-move
    // review accounting asks, and it is only observable across this boundary.
    const capturesBaseMove = !workspace.applied && replayCandidates(state)
      .some(({ record }) => record?.mode === "worktree");
    const preDiffIdentity = capturesBaseMove ? changeDiffIdentity(id, state) : null;
    const movement = workspace.applied ? null : rebaseWorktree(id, state);
    replaceSandboxPacket(id, state, source, destination, fingerprints.mergedTasks);
    // An isolated copy is a snapshot; the target keeps moving while it builds
    // (another change lands, a hook rewrites a file). Every target move the
    // sandbox did not also touch fast-forwards here, baseline included, so
    // only genuinely double-edited paths reach the apply guard - and those are
    // named now, at sync, not discovered at Land. `--resolve` is the explicit
    // way out: it declares the sandbox copy already carries the merged result,
    // so the baseline may advance without the harness guessing.
    const { forwarded, conflicts } = reconcileCopyWorkspace(id, state, flags);
    clearSnapshotCache(id);
    const invalidated = !priorHash || priorHash !== relevantHash(id) ||
      fingerprints.priorContract !== fingerprints.nextContract ||
      fingerprints.priorExecution !== fingerprints.nextExecution ||
      conflicts.length > 0 || (movement && !movement.rebased) ||
      Boolean(movement?.conflicts?.length);
    updateSandboxSyncState(id, state, source, fingerprints, invalidated);
    // The durable record of what this replay did to the change's own diff.
    // Identical identities mean the moved base never touched the change's
    // content — the fact that lets a review verdict rebind instead of
    // expiring. Differing identities mean the 3-way merge altered the diff,
    // and base-move review accounting reads this journal to tell that apart
    // from an author edit. Keyed by destination heads so one movement can
    // authorize at most one accounting reset.
    recordSandboxBaseMove({
      id, state, movement, preDiffIdentity, now, changeDiffIdentity
    });
    clearSnapshotCache(id);
    saveRuntime(state);
    // Stated whether or not it could be resolved. A target that moved and a
    // sandbox that silently kept building against the old base is the failure
    // this line exists to make impossible.
    reportSandboxSync({
      id, state, movement, forwarded, conflicts, relevantHash
    });
  }

  const create = createSandbox.bind(null, {
    root,
    policy,
    hostAttestation,
    loadRuntime,
    saveRuntime,
    canonicalPath,
    gitHead,
    git,
    porcelainStatusRecords,
    selectedRepositories,
    cleanupRepositorySandboxes,
    cleanupAppliedSandbox,
    repositoryCatalog,
    clearSnapshotCache,
    createSingle,
    runSetupCommand, runSetupBatch,
    output: console,
    fail
  });

  const retryFailedSetups = retryFailedSandboxSetups.bind(null, {
    loadRuntime, saveRuntime, selectedRepositories, policy, runSetupCommand,
    runSetupBatch, git
  });

  const prepareBuild = prepareBuildSandbox.bind(null, {
    root, loadRuntime, validate, workspaceInspection, create, retryFailedSetups,
    synchronizeAgreement: (id) => {
      const state = loadRuntime(id);
      if (state.workspace?.changeSourceHash &&
          state.workspace.changeSourceHash !== directoryHash(changePath(id)))
        sync(id);
    }
  });

  return {
    createChallenge, workspaceInspection, inspect, showInspection,
    createSingle, create, retryFailedSetups, prepareBuild, mergeTaskProgress, sync,
    changeDiffIdentity
  };
}
