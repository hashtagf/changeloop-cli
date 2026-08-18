import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  ROOT_ONLY_EXCLUDED_DIRS, isExcludedPath, sandboxCodePathspec, trackedPathSet
} from "../core/workspace-surface.mjs";

// Which files `git apply` refused, so a replay that cannot proceed names the
// same thing the isolated-copy path names: the files, not the exit code.
//
// Merge conflicts are read first and exclusively. A three-way apply reports
// `patch failed:` for every hunk it could not place directly — including the
// ones it then merged successfully — so mixing the two vocabularies names files
// that are not in conflict at all. `git apply --3way` reports a genuine
// conflict as `U <path>`, not in `git merge`'s vocabulary.
function rejectedPaths(output) {
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

// `cpSync` resolves symlinks by default: a relative link is rewritten as an
// absolute path into the *source* tree. In a sandbox that is not a cosmetic
// difference — anything following the link writes into the real project while
// believing it is isolated, and git inside the copy reports the rewritten link
// as a modification the change never made. `land-journal.mjs` already carries
// these two options for the same reason on the way back out.
const VERBATIM_COPY = { dereference: false, verbatimSymlinks: true };

export function createSandboxRuntime({
  root, policy, excludedWorkspaceDirs, sandboxCopyExcludedDirs, hostAttestation,
  loadRuntime, saveRuntime,
  canonicalPath, workspaceManifest, directoryHash, fileDigest, changePath, gitHead, git,
  gitBuffer, porcelainStatusRecords,
  selectedRepositories, cleanupRepositorySandboxes, cleanupAppliedSandbox,
  clearSnapshotCache, validate, repositorySelectionIdsAt, contractFingerprint,
  executionFingerprint, taskBlocks, proofPath, relevantHash, fail,
  markBlocked = () => {}
}) {
  function sandboxRoot(id) {
    return join(root, ".foundation", "sandboxes", id);
  }

  // A freshly created sandbox has no installed dependencies: the copy path
  // excludes them by name and by gitignore, and a worktree is a bare checkout.
  // The setup command exists so the first proof run does not have to discover
  // that. Failure keeps the sandbox — the workspace itself is correct, and
  // destroying it over a flaky install would cost more than the one manual
  // rerun the warning asks for.
  function runSetupCommand(record, command, timeoutMs, cwd, label) {
    const result = spawnSync("sh", ["-c", command], {
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
      console.error(`WARNING: sandbox setup command failed${
        label ? ` for '${label}'` : ""} (${cause}): ${command}\n  workspace: ${cwd}\n  rerun it there manually before Prove${tail ? `\n    ${tail}` : ""}`);
    }
    return record.setup;
  }

  // Single-repository setup comes from foundation.json; a repository row in a
  // multi-repository change carries its own `setupCommand` because each
  // repository installs its own toolchain.
  function runWorkspaceSetup(state) {
    const configured = policy().sandbox || {};
    if (!configured.setupCommand) return null;
    return runSetupCommand(state.workspace, configured.setupCommand,
      configured.setupTimeoutMs, state.workspace.path, null);
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

  // A linked worktree or a submodule carries `.git` as a *file* pointing at a
  // gitdir somewhere else. Copying that file would hand the sandbox a pointer
  // straight back into the target's repository, so every commit, checkout, or
  // index write made in isolation would land in the very tree the sandbox
  // exists to leave alone. Only a real directory is safe to carry.
  function gitMetadataIsCarryable() {
    const gitPath = join(root, ".git");
    if (!existsSync(gitPath)) return false;
    try {
      return statSync(gitPath).isDirectory();
    } catch {
      return false;
    }
  }

  // Regenerable build output is pure cost to copy, and at real repository sizes
  // it is a fault rather than an inefficiency: a 79GB Rust `target/` exhausted
  // the disk mid-copy and left a 41GB tree the runtime had never recorded. A
  // fixed list of directory *names* cannot keep up with that — it knew
  // `node_modules` and `coverage` but not `target`, `dist`, `build`, `vendor`,
  // or `.venv`. Git already tracks the distinction the copy actually needs, so
  // ask it. `--others --ignored` never reports a tracked path, so committed
  // content stays carried no matter what it is named, and `--directory`
  // collapses a wholly-ignored tree to one entry the filter can refuse before
  // descending into it.
  function ignoredPathSet(carriesGit) {
    if (!carriesGit) return new Set();
    const listed = git(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], root);
    if (listed.status !== 0) return new Set();
    return new Set(listed.stdout.split("\0").filter(Boolean)
      .map((path) => (path.endsWith("/") ? path.slice(0, -1) : path)));
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
    const carriesGit = gitMetadataIsCarryable();
    const copyExcluded = carriesGit ? sandboxCopyExcludedDirs : excludedWorkspaceDirs;
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
    const listed = carriesGit ? git(["ls-files", "-z"], root) : { status: 1, stdout: "" };
    const tracked = trackedPathSet(
      listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : []);
    const ignored = ignoredPathSet(carriesGit);
    const excludes = (rel) =>
      ignored.has(rel) ||
      isExcludedPath(rel, { excluded: copyExcluded, tracked: tracked.has(rel) });
    const filter = (source) => !excludes(relative(root, source).replaceAll("\\", "/"));
    // A copy that dies partway leaves a directory the runtime never recorded:
    // `state.workspace` is still whatever it was, so nothing knows the tree
    // exists, while `sandbox path already occupied` blocks every retry. Filling
    // the disk is exactly how that happens, so the failure path has to remove
    // what it wrote before reporting.
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (excludes(entry.name)) continue;
        cpSync(join(root, entry.name), join(requestedPath, entry.name), {
          recursive: true,
          mode: fsConstants.COPYFILE_FICLONE,
          ...VERBATIM_COPY,
          filter
        });
      }
    } catch (error) {
      rmSync(requestedPath, { recursive: true, force: true });
      fail(`cannot create sandbox copy: ${error.message}; partial copy removed`);
    }
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
    for (const rel of listed.status === 0
      ? listed.stdout.split("\0").filter(Boolean) : []) {
      if (!ROOT_ONLY_EXCLUDED_DIRS.has(rel.split("/")[0])) continue;
      const source = join(root, rel);
      if (!existsSync(source)) continue;
      const destination = join(requestedPath, rel);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination, VERBATIM_COPY);
    }
    const path = canonicalPath(requestedPath);
    // The copied `.git/worktrees` still names the *target's* linked worktrees by
    // absolute path. Left in place, a `git worktree` command run inside the
    // sandbox would operate on directories outside it.
    if (carriesGit)
      rmSync(join(path, ".git", "worktrees"), { recursive: true, force: true });
    const carriedPreexisting = {};
    for (const rel of Object.keys(state.workspace?.preexisting || {})) {
      const copied = join(path, rel);
      try {
        if (existsSync(copied)) carriedPreexisting[rel] = fileDigest(copied);
      } catch {}
    }
    state.workspace = {
      // What the tree already carried at `change new` is still not this
      // change's surface once a sandbox exists; replacing the workspace record
      // wholesale would forget it and pull those paths back into the surface.
      preexisting: state.workspace?.preexisting || {},
      mode: "copy", path, applied: false, reason,
      // Recorded for the same reason the worktree mode records it: without a
      // base commit the changed surface cannot separate what this change did
      // from what the working tree already carried.
      baseHead: carriesGit ? gitHead(root) : null,
      git: carriesGit ? "carried" : "absent",
      baseline: workspaceManifest(root, id, true),
      // Snapshot the bytes that actually reached the copy. A dirty target file
      // can still be growing while the sandbox command is being redirected to
      // it; comparing only with the earlier control-tree digest makes that
      // carried file look like a write performed inside the sandbox.
      sandboxBaseline: workspaceManifest(path, id, true),
      sandboxPreexisting: carriedPreexisting,
      changeSourceHash: directoryHash(changePath(id)),
      packetSnapshot: packetManifest(join(path, "openspec", "changes", id))
    };
    state.status = "building";
    saveRuntime(state);
    const setup = runWorkspaceSetup(state);
    if (setup) saveRuntime(state);
    console.log(`SANDBOX ${id}\n  mode: isolated-copy\n  reason: ${reason}\n  git: ${
      carriesGit ? "carried" : "absent (target has no usable .git directory)"
    }\n  path: ${path}${setup ? `\n  setup: ${setup.status}` : ""}`);
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

  // A commit read, not executed.
  //
  // Isolation inspection is the diagnostic someone reaches for when the
  // environment is suspect, and the unattended preflight beside it decides
  // whether running anything is safe at all — so neither may resolve a program
  // through PATH. Shelling out to `git rev-parse` here would hand the decision
  // to whatever PATH happens to name. The ref files answer the same question.
  function headOfRepository(start) {
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

  function workspaceInspection(id, state = loadRuntime(id)) {
    const workspace = state.workspace || {};
    const kind = workspace.mode === "worktree" ? "git-worktree" :
      workspace.mode === "copy" ? "filesystem-copy" : "none";
    const identityValid = kind === "git-worktree" ? gitMetadataPresent(workspace.path) :
      kind === "filesystem-copy" ? directoryExists(workspace.path) : true;
    const status = kind === "none" ? "current" : identityValid ? "active" : "missing";
    const repositories = Object.entries(state.repositories || {}).map(([repositoryId, runtime]) => ({
      id: repositoryId,
      access: runtime.access || "write",
      kind: runtime.mode === "worktree" ? "git-worktree" :
        runtime.mode === "copy" ? "filesystem-copy" :
          runtime.mode === "reference" ? "reference" : "none",
      status: runtime.path && existsSync(runtime.path) ? "active" : "missing",
      path: runtime.path || null
    })).sort((left, right) => left.id.localeCompare(right.id));
    // The recorded base and the target's head, because the difference between
    // them decides whether a proven change can still land — and diagnosing it
    // used to mean reading `.foundation/` by hand. Only a worktree is pinned to
    // a commit; an isolated copy reconciles a moved target at sync, so it
    // reports no drift.
    const targetHead = headOfRepository(root);
    const baseHead = workspace.baseHead || null;
    const drift = kind === "git-worktree" && baseHead && targetHead &&
      baseHead !== targetHead ? "target-moved" : "none";
    return {
      kind, status, path: workspace.path || root,
      baseHead, targetHead, drift, repositories
    };
  }

  function inspect(id, flags = {}) {
    const workspaceIsolation = workspaceInspection(id);
    const preflight = hostAttestation.preflight(id, flags);
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

  function showInspection(id, flags = {}) {
    const result = inspect(id, flags);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`ISOLATION ${id}`);
      console.log(`  workspace isolation: ${result.workspaceIsolation.kind} (${result.workspaceIsolation.status})`);
      if (result.workspaceIsolation.drift === "target-moved")
        console.log(`  target drift: base ${
          String(result.workspaceIsolation.baseHead).slice(0, 8)} -> target ${
          String(result.workspaceIsolation.targetHead).slice(0, 8)}; run 'claude-foundation sandbox sync ${id}' to replay onto it`);
      console.log(`  security boundary: ${result.securityBoundary.kind} (${result.securityBoundary.status})`);
      console.log(`  safe for unattended: ${result.execution.safeForUnattended ? "yes" : "no"}`);
      for (const reason of result.execution.reasons) console.log(`  reason: ${reason}`);
    }
    // Refusing unattended execution on an unsafe boundary is the guard working,
    // not the command breaking.
    if (flags.unattended && !result.execution.safeForUnattended) {
      markBlocked();
      process.exitCode = 1;
    }
  }

  function createSingle(id) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    if (["worktree", "copy"].includes(state.workspace?.mode) && existsSync(state.workspace.path))
      fail(`sandbox already exists: ${state.workspace.path}`);
    if (!gitHead(root)) {
      createCopy(id, state, "no-git");
      return;
    }
    const dirty = git(["status", "--porcelain", "-z", "--untracked-files=all"], root);
    if (dirty.status !== 0) fail(`cannot inspect target workspace: ${dirty.stderr.trim()}`);
    const allowedPrefix = `openspec/changes/${id}/`;
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
    const harnessOwned = (path) =>
      path.startsWith(".foundation/") || path === ".foundation" ||
      path.startsWith("openspec/changes/") || path === "openspec/changes";
    // Dirt that was already there when the change began is not this change's
    // doing, and it should not cost the change its worktree. The surface
    // already ignores these paths; without the same test here a single stray
    // untracked file downgraded every sandbox to a whole-tree copy — lower
    // fidelity and, on a large repository, the expensive mode — for a file
    // nobody in this change had touched. Compared by digest, so a pre-existing
    // file the operator has since edited still counts as a dirty target.
    const preexisting = state.workspace?.preexisting || {};
    const carriedIn = (path) => {
      if (!Object.prototype.hasOwnProperty.call(preexisting, path)) return false;
      const absolute = join(root, path);
      try {
        return existsSync(absolute) && preexisting[path] === fileDigest(absolute);
      } catch {
        return false;
      }
    };
    const unrelated = porcelainStatusRecords(dirty.stdout).filter(({ path }) =>
      path !== `openspec/changes/${id}` && !path.startsWith(allowedPrefix) &&
        !harnessOwned(path) && !carriedIn(path));
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
    state.status = "building";
    saveRuntime(state);
    const setup = runWorkspaceSetup(state);
    if (setup) saveRuntime(state);
    console.log(`SANDBOX ${id}\n  path: ${path}${setup ? `\n  setup: ${setup.status}` : ""}`);
  }

  function create(id, flags = {}) {
    if (flags.unattended) {
      const preflight = hostAttestation.preflight(id, flags, true);
      if (!preflight.safeForUnattended)
        fail(`unattended sandbox creation requires a trusted host-owned security attestation; detected virtualization alone is insufficient: ${preflight.reasons.join("; ")}`);
    }
    const initial = loadRuntime(id);
    const repositories = selectedRepositories(id, initial);
    if (repositories.length === 1 && repositories[0].id === "root" && !flags.all) {
      createSingle(id);
      return;
    }
    createSingle(id);
    const state = loadRuntime(id);
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
        if (existsSync(requestedPath)) throw new Error(`repository sandbox already exists: ${requestedPath}`);
        mkdirSync(dirname(requestedPath), { recursive: true });
        // Same dead registration hazard as the single-repo path.
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
      cleanupRepositorySandboxes(id, state);
      cleanupAppliedSandbox(id, state);
      state.workspace = {
        // What the tree carried at `change new` survives the rollback; both
        // single-repo paths preserve it for the same reason — dropping it
        // pulls pre-existing dirt back into the changed surface.
        preexisting: state.workspace?.preexisting || {},
        mode: "current", path: root, baseHead: gitHead(root)
      };
      delete state.repositories;
      state.status = "change";
      saveRuntime(state);
      fail(`${error.message}; created sandboxes rolled back`);
    }
    // Per-repository setup runs only after every worktree exists: creation
    // failures roll everything back above, while a failed install keeps its
    // sandbox and is reported per repository.
    for (const repository of repositories) {
      const record = state.repositories[repository.id];
      if (!repository.setupCommand || !record || record.mode !== "worktree") continue;
      runSetupCommand(record, repository.setupCommand,
        policy().sandbox?.setupTimeoutMs, record.path, repository.id);
      if (record.access === "read") {
        const changed = git(["status", "--porcelain"], record.path);
        if (changed.status !== 0 || changed.stdout.trim()) {
          record.setup.status = "failed";
          record.setup.reason = "setup modified a read-only repository";
          console.error(`WARNING: sandbox setup modified read-only repository '${repository.id}': ${
            changed.stdout.trim() || changed.stderr.trim() || "git status failed"}`);
        }
      }
    }
    state.status = "building";
    saveRuntime(state);
    clearSnapshotCache(id);
    console.log(`MULTI-REPOSITORY SANDBOX ${id}`);
    for (const repository of selectedRepositories(id, state))
      console.log(`  ${repository.id}: ${repository.workspacePath}`);
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
  function replayCandidates(state) {
    if (!state.repositories || Object.keys(state.repositories).length === 0)
      return [{ repository: "root", record: state.workspace, targetPath: root }];
    return Object.entries(state.repositories)
      .filter(([, record]) => record.mode === "worktree")
      .map(([repository, record]) => ({
        repository, record,
        targetPath: record.targetPath || (repository === "root" ? root : null)
      }));
  }

  function prepareReplay(id, state, candidate) {
    const { repository, record, targetPath } = candidate;
    if (record.access === "read") {
      const dirty = git(["status", "--porcelain"], record.path);
      if (dirty.status !== 0 || dirty.stdout.trim())
        fail(`read-only repository '${repository}' changed inside its sandbox: ${
          dirty.stdout.trim() || dirty.stderr.trim() || "git status failed"}`);
    }
    const currentHead = targetPath ? gitHead(targetPath) : null;
    if (!targetPath || !currentHead || !record.baseHead ||
        currentHead === record.baseHead) return null;
    const movement = {
      repository, from: record.baseHead, to: currentHead,
      rebased: false, conflicts: []
    };
    const nested = repository === "root"
      ? selectedRepositories(id, state)
        .filter((entry) => entry.type === "submodule")
        .map((entry) => entry.relativePath)
      : [];
    const pathspec = sandboxCodePathspec(id, nested);
    if (record.access === "read") {
      const staging = `${record.path}.rebase`;
      const patch = `${record.path}.rebase.patch`;
      rmSync(staging, { recursive: true, force: true });
      git(["worktree", "prune"], targetPath);
      const staged = git(["worktree", "add", "--detach", staging, currentHead], targetPath);
      if (staged.status !== 0)
        fail(`cannot stage the '${repository}' read-only worktree refresh: ${staged.stderr.trim()}`);
      const discardStaging = () => {
        git(["worktree", "remove", "--force", staging], targetPath);
        rmSync(staging, { recursive: true, force: true });
      };
      return { movement, record, targetPath, staging, patch, discardStaging };
    }
    // A real `add`, not the intent-to-add the apply path uses: the three-way
    // fallback below needs the sandbox's blobs to exist in the object database
    // before it can merge against them. Staging is invisible downstream —
    // everything that reads this sandbox diffs the working tree against a
    // commit, which ignores the index.
    git(["add", "-A"], record.path);
    // gitBuffer, not git: the binary diff is bytes, and a UTF-8 decode
    // replaces invalid sequences with U+FFFD — corrupting the replayed patch
    // and surfacing phantom conflicts on files nobody double-edited.
    const diff = gitBuffer(["diff", "--binary", record.baseHead, "--", ...pathspec],
      record.path);
    if (diff.status !== 0)
      fail(`cannot read the '${repository}' sandbox diff to replay: ${
        String(diff.stderr).trim()}`);
    // Verified in a throwaway worktree before the real one is touched: a
    // rejected hunk has to leave the sandbox exactly as it was, because merging
    // the target's version is only possible there.
    const staging = `${record.path}.rebase`;
    const patch = `${record.path}.rebase.patch`;
    rmSync(staging, { recursive: true, force: true });
    // A worktree directory removed out from under git stays registered, and
    // `worktree add` then refuses the same path — dead-ending the retry.
    git(["worktree", "prune"], targetPath);
    const staged = git(["worktree", "add", "--detach", staging, currentHead], targetPath);
    if (staged.status !== 0)
      fail(`cannot stage the '${repository}' rebase worktree: ${staged.stderr.trim()}`);
    const discardStaging = () => {
      git(["worktree", "remove", "--force", staging], targetPath);
      rmSync(staging, { recursive: true, force: true });
      rmSync(patch, { force: true });
    };
    if (diff.stdout.length) {
      // Written before it is used, and kept until the swap completes: it is the
      // only copy of the sandbox's work between removing the old worktree and
      // moving the new one into its place.
      writeFileSync(patch, diff.stdout);
      // Three-way, not a straight apply. A straight apply matches the base's
      // context lines, so once the user merges the target's version into the
      // sandbox to clear a conflict, the very diff carrying that merge stops
      // applying — the fix would make the next sync fail for the same reason.
      // A three-way merge is what actually resolves a moved base.
      const replayed = git(
        ["apply", "--3way", "--binary", "--whitespace=nowarn", patch], staging);
      if (replayed.status !== 0) {
        // Both streams: `git apply --3way` writes its conflict summary to
        // stdout and its errors to stderr, and either one alone loses half the
        // vocabulary that names the file.
        movement.conflicts = rejectedPaths(
          `${replayed.stderr || ""}\n${replayed.stdout || ""}`);
        if (!movement.conflicts.length) movement.conflicts.push(".");
        return { movement, record, targetPath, staging, patch, discardStaging };
      }
    }
    return { movement, record, targetPath, staging, patch, discardStaging };
  }

  function commitReplay(id, state, prepared) {
    const { movement, record, targetPath, staging, patch } = prepared;
    const removed = git(["worktree", "remove", "--force", record.path], targetPath);
    if (removed.status !== 0)
      fail(`cannot replace the '${movement.repository}' sandbox worktree: ${
        removed.stderr.trim()}. Prepared replay remains at '${staging}' with patch '${patch}'.`);
    const moved = git(["worktree", "move", staging, record.path], targetPath);
    if (moved.status !== 0)
      fail(`the '${movement.repository}' sandbox worktree was removed and its replacement could not be moved into place: ${
        moved.stderr.trim()}. The replayed work is at '${staging}' and the patch at '${patch}'.`);
    record.baseHead = movement.to;
    if (movement.repository === "root") state.workspace.baseHead = movement.to;
    const repository = selectedRepositories(id, state)
      .find((entry) => entry.id === movement.repository);
    if (repository?.setupCommand && movement.repository !== "root") {
      runSetupCommand(record, repository.setupCommand,
        policy().sandbox?.setupTimeoutMs, record.path, repository.id);
      if (record.access === "read") {
        const changed = git(["status", "--porcelain"], record.path);
        if (changed.status !== 0 || changed.stdout.trim()) {
          record.setup.status = "failed";
          record.setup.reason = "setup modified a read-only repository";
        }
      }
    }
    movement.rebased = true;
  }

  function rebaseWorktree(id, state) {
    const candidates = replayCandidates(state)
      .filter((candidate) => candidate.record.mode === "worktree");
    if (!candidates.length) return null;
    const multiRepository = Object.keys(state.repositories || {}).length > 1;
    const prepared = [];
    try {
      for (const candidate of candidates) {
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
    if (!prepared.length) return null;
    prepared.forEach((entry) => commitReplay(id, state, entry));
    prepared.forEach((entry) => rmSync(entry.patch, { force: true }));
    const repositories = prepared.map((entry) => entry.movement);
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

  function sync(id, flags = {}) {
    validate(id, "root", { quiet: true });
    const state = loadRuntime(id);
    const workspace = state.workspace;
    if (!workspace || !["worktree", "copy"].includes(workspace.mode) ||
        !workspace.path || !existsSync(workspace.path))
      fail(`change '${id}' has no active sandbox`);
    const source = changePath(id);
    const destination = join(workspace.path, "openspec", "changes", id);
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
    const priorRepositories = repositorySelectionIdsAt(destination);
    const nextRepositories = repositorySelectionIdsAt(source);
    if (JSON.stringify(priorRepositories) !== JSON.stringify(nextRepositories))
      fail("repository scope changed during Build; finish or split the current repository work before creating a topology revision");
    const sourceTasks = readFileSync(join(source, "tasks.md"), "utf8");
    const sandboxTasks = existsSync(join(destination, "tasks.md"))
      ? readFileSync(join(destination, "tasks.md"), "utf8") : "";
    const priorContract = existsSync(destination) ? contractFingerprint(id, destination) : null;
    const priorExecution = existsSync(destination) ? executionFingerprint(id, destination) : null;
    const nextContract = contractFingerprint(id, source);
    const nextExecution = executionFingerprint(id, source);
    const mergedTasks = mergeTaskProgress(sourceTasks, sandboxTasks);
    // Before the packet is written, because a successful replay rebuilds the
    // worktree the packet is written into. Everything above reads the outgoing
    // sandbox and has already been captured.
    const movement = workspace.applied ? null : rebaseWorktree(id, state);
    if (existsSync(destination)) rmSync(destination, { recursive: true });
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, ...VERBATIM_COPY });
    writeFileSync(join(destination, "tasks.md"), mergedTasks);
    state.workspace.packetSnapshot = packetManifest(destination);
    // An isolated copy is a snapshot; the target keeps moving while it builds
    // (another change lands, a hook rewrites a file). Every target move the
    // sandbox did not also touch fast-forwards here, baseline included, so
    // only genuinely double-edited paths reach the apply guard - and those are
    // named now, at sync, not discovered at Land. `--resolve` is the explicit
    // way out: it declares the sandbox copy already carries the merged result,
    // so the baseline may advance without the harness guessing.
    let forwarded = 0;
    const conflicts = [];
    // Once projected, the baseline no longer describes the sandbox's relation
    // to the target - the apply transaction journal does. Reconciling here
    // would flag the change's own applied content as a conflict.
    if (workspace.mode === "copy" && !workspace.applied) {
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
      for (const rel of paths) {
        const base = baseline[rel] ?? null;
        const target = targetManifest[rel] ?? null;
        const sandboxEntry = sandboxManifest[rel] ?? null;
        const advance = () => {
          if (target === null) delete baseline[rel]; else baseline[rel] = target;
        };
        if (target === base) continue;
        if (sandboxEntry === target) { advance(); continue; }
        if (sandboxEntry === base) {
          const to = join(workspace.path, rel);
          rmSync(to, { force: true });
          if (target !== null) {
            mkdirSync(dirname(to), { recursive: true });
            cpSync(join(root, rel), to, VERBATIM_COPY);
          }
          advance();
          forwarded += 1;
          continue;
        }
        if (resolves.has(rel)) { usedResolves.add(rel); advance(); continue; }
        conflicts.push(rel);
      }
      const unusedResolves = [...resolves].filter((rel) => !usedResolves.has(rel));
      if (unusedResolves.length)
        fail(`--resolve names ${unusedResolves.map((rel) => `'${rel}'`).join(", ")
        }, which ${unusedResolves.length === 1 ? "is" : "are"} not in conflict; drop ${
          unusedResolves.length === 1 ? "it" : "them"} and sync again`);
      workspace.baseline = baseline;
    }
    state.workspace.changeSourceHash = directoryHash(source);
    delete state.workspace.recovery;
    state.status = "building";
    state.revision = Number(state.revision || 0) + 1;
    if (priorContract !== nextContract) state.contractRevision = Number(state.contractRevision || 0) + 1;
    if (priorExecution !== nextExecution) state.executionRevision = Number(state.executionRevision || 0) + 1;
    if (existsSync(proofPath(id))) rmSync(proofPath(id));
    clearSnapshotCache(id);
    saveRuntime(state);
    const shortHead = (value) => String(value || "").slice(0, 8);
    // Stated whether or not it could be resolved. A target that moved and a
    // sandbox that silently kept building against the old base is the failure
    // this line exists to make impossible.
    const movementLine = !movement ? ""
      : !movement.multiRepository && movement.repositories.length === 1
        ? movement.rebased
          ? `\n  rebased: ${shortHead(movement.from)} -> ${shortHead(movement.to)} (sandbox commits flattened into the replayed diff)`
          : `\n  target moved: ${shortHead(movement.repositories[0].from)} -> ${shortHead(movement.repositories[0].to)} (sandbox NOT rebased)`
        : movement.repositories.map((repository) => repository.rebased
          ? `\n  rebased ${repository.repository}: ${shortHead(repository.from)} -> ${shortHead(repository.to)} (sandbox commits flattened into the replayed diff)`
          : `\n  target moved ${repository.repository}: ${shortHead(repository.from)} -> ${shortHead(repository.to)} (sandbox NOT rebased)`).join("");
    console.log(`SYNCED ${id}\n  revision: ${state.revision}\n  workspace: ${relevantHash(id)}${
      movementLine}${
      forwarded ? `\n  fast-forwarded: ${forwarded} file(s) the target moved and the sandbox left alone` : ""
    }`);
    for (const rel of conflicts)
      console.log(`CONFLICT ${rel}: the target and the sandbox both changed this file since the baseline; merge the target's version into the sandbox copy, then rerun sandbox sync with --resolve ${rel} (comma-separate several paths). Land stays blocked until every conflict is resolved.`);
    for (const conflict of movement?.conflicts || [])
      console.log(`CONFLICT ${movement.multiRepository ? `${conflict.repository}:` : ""}${conflict.path}: the sandbox diff no longer applies to the moved target; merge the target's version into the named repository sandbox worktree, then rerun sandbox sync. Land stays blocked until every repository sandbox replays onto its current commit.`);
    if (movement && !movement.rebased && !movement.conflicts.length)
      console.log(`TARGET MOVED ${id}: rerun 'claude-foundation sandbox sync ${id}' after repairing the named repository replay.`);
  }

  return {
    createChallenge, workspaceInspection, inspect, showInspection,
    createSingle, create, mergeTaskProgress, sync
  };
}
