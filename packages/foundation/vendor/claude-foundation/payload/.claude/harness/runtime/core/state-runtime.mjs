import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, renameSync,
  statSync
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  declaredPathMatcher, isChangePacketPath, isExcludedPath, mergeSurfaceAdditions,
  surfaceAdditionEntries, surfaceAdditionPaths, trackedPathSet
} from "./workspace-surface.mjs";
import { gitRepositoryAbsent, resolveGitHead } from "./git-head.mjs";
import { withoutGitIgnored } from "./git-ignore.mjs";
import { taskBlocks, taskMetadata } from "../contracts/change-artifacts.mjs";
import { normalizeLifecycleState } from "./lifecycle-reducer.mjs";

// Read-only git subcommands that need a repository to answer at all.
const NO_REPOSITORY_QUERIES = new Set([
  "ls-files", "status", "rev-parse", "ls-tree", "check-ignore", "show"
]);

// A file untouched for longer than this when read is safe to identify by
// metadata; anything younger is re-read until it settles.
const RACY_WINDOW_MS = 2000;
// The state file is replaced atomically (new inode) on every save, so it needs
// only to outlast a few filesystem timestamp ticks (4-10 ms on Linux).
const RUNTIME_RACY_WINDOW_MS = 30;

function statIdentity(path) {
  try {
    const stat = statSync(path, { bigint: true });
    if (!stat.isFile()) return null;
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch { return null; }
}

function statSettled(path, windowMs = RACY_WINDOW_MS) {
  try {
    const stat = statSync(path);
    return Date.now() - Math.max(stat.mtimeMs, stat.ctimeMs) > windowMs;
  } catch { return false; }
}

export function createStateRuntime({
  root,
  runtime,
  changes,
  receipts,
  evidenceVault,
  snapshots,
  excludedWorkspaceDirs,
  readJson,
  writeJson,
  canonicalPath,
  now,
  fail
}) {
  function runtimePath(id) { return join(runtime, `${id}.json`); }
  // The last state that parsed, kept beside the live file so an unreadable
  // state is a harness repair rather than a reason to throw the work away.
  function previousRuntimePath(id) { return `${runtimePath(id)}.prev`; }
  function changePath(id) { return join(changes, id); }
  function receiptPath(id, provider) { return join(receipts, id, `${provider}.json`); }
  function proofPath(id) { return join(receipts, id, "proof.json"); }
  function proofRunRoot(id, proofRunId) { return join(evidenceVault, id, proofRunId); }
  function snapshotPath(id) { return join(snapshots, `${id}.json`); }
  function currentChangeRelativePath(id) { return `openspec/changes/${id}`; }

  function isCurrentChangePath(rel, id) {
    return isChangePacketPath(rel, id);
  }

  // Only reads the status and workspace location, so it may borrow the shared
  // parse instead of paying for a private copy on every one of its many calls.
  function activeChangePath(id, state = loadRuntime(id, { shared: true })) {
    if (state.status === "archived" && state.archivedChangePath) {
      const archived = join(root, state.archivedChangePath);
      if (existsSync(archived)) return archived;
    }
    const workspace = state.workspace;
    if (workspace && ["worktree", "copy"].includes(workspace.mode) &&
        workspace.path && existsSync(workspace.path)) {
      const candidate = join(workspace.path, "openspec", "changes", id);
      if (existsSync(candidate)) return candidate;
    }
    return changePath(id);
  }

  function archivedChangeRelativePath(id) {
    const archiveRoot = join(changes, "archive");
    if (!existsSync(archiveRoot)) return null;
    // OpenSpec prefixes the archived directory with a date, so the suffix is
    // how the change is found. Anchor it to that prefix: a bare `-${id}` also
    // matches an unrelated archived change whose own id merely ends this way
    // (`quick-fix-login` for `fix-login`), which both widens the recovered-
    // archive trigger and can record the wrong archivedChangePath.
    const datePrefixed = new RegExp(`^\\d{4}-\\d{2}-\\d{2}(-\\d+)?-${
      id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const candidates = readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() &&
        (entry.name === id || datePrefixed.test(entry.name)))
      .map((entry) => entry.name).sort();
    return candidates.length ? `openspec/changes/archive/${candidates.at(-1)}` : null;
  }

  function slugify(value) {
    return value.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 64)
      .replace(/-+$/, "") || "change";
  }

  // A lifecycle command reads the same state file thousands of times and the
  // file carries the whole sandbox baseline, so each read-and-parse is real
  // time. A parse is reused only while the file's identity (inode, size, and
  // nanosecond mtime/ctime) is unchanged AND the file was already older than
  // RUNTIME_RACY_WINDOW_MS when it was read: a rewrite inside one timestamp tick could
  // otherwise keep the identity. Every caller still gets its own copy to mutate.
  const runtimeParses = new Map();
  function readRuntimeValue(path, shared = false) {
    const identity = statIdentity(path);
    const hit = identity ? runtimeParses.get(path) : null;
    if (hit && hit.identity === identity) return shared ? hit.value : structuredClone(hit.value);
    // Legacy statuses are read in their current form; the file is rewritten
    // only by the next ordinary save.
    const value = JSON.parse(readFileSync(path, "utf8"));
    normalizeLifecycleState(value);
    if (identity && identity === statIdentity(path) && statSettled(path, RUNTIME_RACY_WINDOW_MS))
      runtimeParses.set(path, { identity, value: structuredClone(value) });
    else runtimeParses.delete(path);
    return value;
  }

  // `recoverable` is for the one caller that must work precisely when the
  // state file is gone or unreadable: `change abandon` is the designed exit
  // from a broken change, and gating it on loadRuntime made it the dead end it
  // exists to resolve. A minimal placeholder is enough for abandon to
  // quarantine what is on disk.
  function loadRuntime(id, { recoverable = false, shared = false } = {}) {
    const path = runtimePath(id);
    const present = existsSync(path);
    if (!present && !recoverable) fail(`unknown change '${id}'`);
    if (!present && !existsSync(changePath(id)))
      fail(`unknown change '${id}'`);
    if (!present)
      return { version: 2, id, status: "unknown", schema: null, recoveredState: "missing" };
    try {
      return readRuntimeValue(path, shared);
    } catch (error) {
      const restored = restorePreviousRuntime(id, error);
      if (restored) return restored;
      if (!recoverable)
        fail(`invalid JSON: ${runtimeRelativePath(id)} (${error.message}); ` +
          `retire it with 'claude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>'`);
      return { version: 2, id, status: "unknown", schema: null, recoveredState: "corrupt" };
    }
  }

  function runtimeRelativePath(id) {
    return relative(root, runtimePath(id));
  }

  // Quarantine the unreadable file and reinstate the last state that parsed.
  // Proof freshness is recomputed from content, so a state one save behind
  // cannot pass stale evidence; it only replays the latest transition.
  function restorePreviousRuntime(id, error) {
    const path = runtimePath(id);
    const previous = previousRuntimePath(id);
    if (!existsSync(previous)) return null;
    let state;
    try { state = JSON.parse(readFileSync(previous, "utf8")); }
    catch { return null; }
    if (state?.id !== id) return null;
    normalizeLifecycleState(state);
    renameSync(path, `${path}.corrupt-${Date.now()}`);
    copyFileSync(previous, path);
    console.error(`RECOVERED: ${runtimeRelativePath(id)} was unreadable (${error.message}); ` +
      "restored the last valid state and kept the unreadable copy beside it");
    return state;
  }

  function saveRuntime(state) {
    // `surfaceAdditions` only grows. A caller holding a state loaded before
    // readiness recorded an addition must not drop it, or Land's hash would
    // diverge from the proven one.
    const path = runtimePath(state.id);
    if (existsSync(path)) {
      try {
        const stored = JSON.parse(readFileSync(path, "utf8"));
        copyFileSync(path, previousRuntimePath(state.id));
        const additions = stored.surfaceAdditions || [];
        if (additions.length || state.surfaceAdditions?.length) state.surfaceAdditions =
          mergeSurfaceAdditions(state.surfaceAdditions, additions);
      } catch {}
    }
    state.updatedAt = now();
    writeJson(path, state);
  }

  function activeChanges() {
    return readdirSync(changes, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "archive")
      .map((entry) => entry.name).sort();
  }

  function orphanRuntimeChanges() {
    if (!existsSync(runtime)) return [];
    const active = new Set(activeChanges());
    return readdirSync(runtime, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const id = entry.name.slice(0, -5);
        try {
          const state = JSON.parse(readFileSync(join(runtime, entry.name), "utf8"));
          if (state.status === "archived" || active.has(id)) return null;
          return { id, schema: state.schema || "unknown", reason: "missing-active-change" };
        } catch {
          return { id, schema: "unknown", reason: "invalid-runtime-json" };
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function walk(dir, callback) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, callback);
      else if (entry.isFile() || entry.isSymbolicLink()) callback(path);
    }
  }

  // Content digest, reused while the file's identity is unchanged and settled
  // (see readRuntimeValue); a file rewritten since is always re-read.
  const fileDigests = new Map();
  function fileDigest(path) {
    const identity = statIdentity(path);
    const hit = identity ? fileDigests.get(path) : null;
    if (hit && hit.identity === identity) return hit.digest;
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (identity && identity === statIdentity(path) && statSettled(path))
      fileDigests.set(path, { identity, digest });
    else fileDigests.delete(path);
    return digest;
  }

  function filesystemEntryIdentity(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
    // Content alone is not a complete executable identity. In particular a
    // chmod-only edit changes what a provider can execute and what Land must
    // project. Keep only the portable executable bit rather than the complete
    // host mode, whose group/owner bits vary across filesystems.
    if (stat.isFile())
      return `file:${stat.mode & 0o111 ? "executable" : "regular"}:${fileDigest(path)}`;
    return `unsupported:${stat.mode}`;
  }

  function codepointOrder(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function directoryHash(dir) {
    const hash = createHash("sha256");
    const files = [];
    walk(dir, (path) => files.push(path));
    // Codepoint order, not localeCompare: ICU collation varies by locale, so
    // the same tree hashed differently on two machines — a hash that must be
    // reproducible cannot depend on the environment's collation tables.
    files.sort((a, b) => codepointOrder(relative(dir, a), relative(dir, b)));
    for (const path of files) {
      hash.update(relative(dir, path).replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(filesystemEntryIdentity(path));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  function stableHash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  function serializedJson(value, pretty = false) {
    return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
  }

  function compactList(values, limit = 20, project = (value) => value) {
    const projected = values.map(project);
    if (projected.length <= limit) return projected;
    return {
      count: projected.length,
      preview: projected.slice(0, limit),
      digest: stableHash(projected)
    };
  }

  function compactStrings(values, limit = 20) {
    return compactList(values, limit, (value) => String(value));
  }

  // `compactList` returns an array under the limit and `{count, preview, digest}`
  // over it, so every reader has to accept both shapes. Most do, by testing
  // `Array.isArray` at the point of use; `authority status --template` did not,
  // and called `.map` on the compact object — so emitting the response template
  // threw for any review carrying more than twelve claims, at exactly the moment
  // a responder needed the shape. Read compacted fields through this instead of
  // re-deriving the check: it is the half of the pair that was missing.
  //
  // A compacted list is deliberately lossy, so a caller that must not silently
  // work from a prefix should compare `expandList(value).length` against
  // `listCount(value)` and say so.
  function expandList(value) {
    if (Array.isArray(value)) return value;
    return Array.isArray(value?.preview) ? value.preview : [];
  }

  function listCount(value) {
    if (Array.isArray(value)) return value.length;
    return Number.isInteger(value?.count) ? value.count : 0;
  }

  const snapshotCache = new Map();
  let snapshotInspectionDepth = 0;
  function inspectSnapshots(operation) {
    snapshotInspectionDepth += 1;
    try { return operation(); }
    finally { snapshotInspectionDepth -= 1; }
  }

  function writeSnapshot(path, value) {
    if (!snapshotInspectionDepth) writeJson(path, value);
  }
  // The policy cache lives in change-policy; it registers its clearer here so
  // one invalidation covers both. A local Map that nothing populated used to
  // stand in for it, so the real cache was never invalidated.
  const policyCacheClearers = [];
  function registerPolicyCacheClearer(clear) { policyCacheClearers.push(clear); }

  // One definition of "this change's surface", read by the proof hash and by
  // the apply projection alike. They used to derive it separately — the hash
  // from git plus every untracked path, the projection from a filesystem walk —
  // and a tree present to one and absent from the other became 6,509 deletions
  // of files no task ever named.
  //
  // Declared means the resolved `--surface` globs plus every task's `[paths:]`,
  // so a file the change creates is surface as soon as the ledger says the
  // change owns that path.
  // Which selected repository a workspace (sandbox or target checkout) belongs
  // to. Anything not recorded as a child repository is the root workspace.
  function workspaceRepositoryId(state = {}, workspace = null) {
    if (!workspace) return "root";
    const target = canonicalPath(workspace);
    for (const [repositoryId, runtime] of Object.entries(state.repositories || {})) {
      if (repositoryId === "root" || !runtime) continue;
      for (const candidate of [runtime.path, runtime.targetPath])
        if (candidate && canonicalPath(candidate) === target) return repositoryId;
    }
    return "root";
  }

  // The target whose Git view governs a sandbox that has no checkout of its
  // own: a copy sandbox of a target whose `.git` is a file cannot carry it.
  // Such a sandbox sits inside the target's tree, so Git run there answers for
  // the enclosing repository, under which the whole sandbox is ignored: the
  // proof hash then ignored code edits and stale evidence passed, and a
  // rewritten ignored file entered the copy-mode Land projection. Null for the
  // target itself and for any workspace with its own `.git`.
  function borrowedGitTarget(state, workspace) {
    const current = canonicalPath(workspace);
    if (current === canonicalPath(root) || existsSync(join(workspace, ".git"))) return null;
    if (state.workspace?.path && canonicalPath(state.workspace.path) === current) return root;
    for (const [repositoryId, record] of Object.entries(state.repositories || {}))
      if (repositoryId !== "root" && record?.path && record.targetPath &&
          canonicalPath(record.path) === current) return record.targetPath;
    return null;
  }

  // The sandbox's own files, judged by its target: what the target tracks is
  // content, and what the target's rules ignore is no change's work. Null when
  // the workspace answers for itself or the target is no repository.
  function borrowedGitView(state, workspace) {
    const target = borrowedGitTarget(state, workspace);
    if (!target || !existsSync(target)) return null;
    const listed = git(["ls-files", "-z"], target);
    if (listed.status !== 0) return null;
    return {
      target,
      tracked: trackedPathSet(listed.stdout.split("\0").filter(Boolean)),
      withoutIgnored: (paths) => withoutGitIgnored(target, paths)
    };
  }

  // What Land must present before it applies: recorded additions Prove did
  // not refuse but flagged. `protected` paths are control-plane, CI, or secret
  // paths; `deleted` paths are exact removals the sandbox's own change surface
  // reported. Paths only — never file contents, so a secret is never printed.
  function surfaceAdditionReport(state = {}, repositoryId = null) {
    const entries = surfaceAdditionEntries(state.surfaceAdditions)
      .filter((entry) => !repositoryId || entry.repositoryId === repositoryId);
    return {
      entries,
      protected: entries.filter((entry) => entry.protected),
      deleted: entries.filter((entry) => entry.deleted),
      requiresPresentation: entries.some((entry) => entry.protected || entry.deleted)
    };
  }

  function declaredSurfaceMatcher(id, state = {}, repositoryId = "root") {
    // `surfaceAdditions` are exact sandbox paths Prove found outside every
    // task's `[paths:]` and recorded instead of refusing; the hash and the Land
    // projection must carry them or a created file would silently not land.
    // Only this repository's additions apply: another repository's path must
    // not widen this repository's manifest, hash, or deletion guard.
    const globs = [...(state.declaredSurface || []),
      ...surfaceAdditionPaths(state.surfaceAdditions, repositoryId)];
    // The active packet owns `[paths:]`: Build widens it in the sandbox, and
    // Land later projects that packet onto the target. Reading the target copy
    // left the widened paths out of the proven hash, then Land's own packet
    // projection changed the hash and staled its grant and proof.
    const tasks = join(activeChangePath(id, state), "tasks.md");
    if (existsSync(tasks))
      for (const task of taskBlocks(readFileSync(tasks, "utf8")).map(taskMetadata))
        globs.push(...(task.paths || []));
    // Declaring nothing confines nothing. A change that has not said which
    // paths it owns keeps the old, unconfined surface: narrowing it on silence
    // would drop the untracked files such a change legitimately creates, which
    // is a worse failure than the one being fixed. Confinement is what
    // declaring a surface buys.
    if (!globs.length) return () => true;
    return declaredPathMatcher(globs);
  }

  function git(args, cwd = root) {
    // The default 1MB maxBuffer silently truncates `ls-files`/`status` on
    // large repositories, and a failed listing here degrades into a wrong
    // surface rather than an error.
    // Outside any repository these read-only queries can only fail with
    // exit 128; answering that here spares a process per query, and a copy
    // sandbox of a plain directory asks a few hundred of them.
    if (NO_REPOSITORY_QUERIES.has(args[0]) && gitRepositoryAbsent(cwd))
      return { status: 128, signal: null, stdout: "", stderr: "fatal: not a git repository\n",
        output: [null, "", "fatal: not a git repository\n"], pid: 0 };
    return spawnSync("git", args, {
      cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
    });
  }

  // No encoding: `diff --binary` output is bytes, and decoding it through
  // UTF-8 replaces any invalid sequence with U+FFFD — silently corrupting the
  // very patch `apply` is later asked to replay. stdout/stderr are Buffers.
  function gitBuffer(args, cwd = root) {
    return spawnSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  }

  // Porcelain v1 `-z` records: `XY <path>` NUL-terminated, a rename/copy
  // carrying its source path as the NEXT NUL record. One parser for every
  // status listing: the by-hand line parsers broke on quoted paths, because
  // core.quotepath C-quotes any non-ASCII name in the non-`-z` format.
  function porcelainStatusRecords(stdout) {
    const records = String(stdout).split("\0").filter(Boolean);
    const rows = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const status = record.slice(0, 2);
      const path = record.slice(3);
      const origPath = /[RC]/.test(status) && records[index + 1] ? records[++index] : null;
      rows.push({ status, path, origPath });
    }
    return rows;
  }

  function gitHead(cwd) {
    const direct = resolveGitHead(cwd);
    if (direct !== undefined) return direct;
    const result = git(["rev-parse", "HEAD"], cwd);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  function snapshotContext(id, workspaceOverride, ignoredPaths) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    const workspace = canonicalPath(workspaceOverride || state.workspace?.path || root);
    if (!existsSync(workspace)) {
      const error = new Error(`workspace '${workspace}' for change '${id}' no longer exists; ` +
        `recreate or repair it with 'claude-foundation sandbox create ${id} --all' or run ` +
        `'claude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>'`);
      error.code = "FOUNDATION_WORKSPACE_MISSING";
      throw error;
    }
    const contractRevision = Number(state.contractRevision ?? 0);
    const ignored = new Set(ignoredPaths.map((value) =>
      String(value).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")));
    const cacheKey = `${id}\0${workspace}\0${contractRevision}\0${
      [...ignored].sort().join("\0")}`;
    return { state, workspace, contractRevision, ignored, cacheKey };
  }

  function snapshotDigests() {
    return {
      hash: createHash("sha256"),
      codeHash: createHash("sha256"),
      reviewHash: createHash("sha256"),
      packetReviewHash: createHash("sha256")
    };
  }

  function foldSnapshotEntry(digests, id, workspace, rel, contentIdentity) {
    const reviewVolatile = new Set(["execution.yaml", "handoffs.yaml"]);
    for (const [name, digest] of Object.entries(digests)) {
      if (name === "codeHash" && isChangePacketPath(rel, id)) continue;
      if (name === "packetReviewHash" && !isChangePacketPath(rel, id)) continue;
      if (["reviewHash", "packetReviewHash"].includes(name) &&
          isChangePacketPath(rel, id) &&
          reviewVolatile.has(rel.slice(currentChangeRelativePath(id).length + 1)))
        continue;
      let identity = contentIdentity;
      if (["reviewHash", "packetReviewHash"].includes(name) &&
          rel === `${currentChangeRelativePath(id)}/tasks.md`) {
        const path = join(workspace, rel);
        if (existsSync(path)) {
          const normalized = readFileSync(path, "utf8")
            .replace(/^(\s*-\s*)\[[ xX]\]/gm, "$1[ ]");
          identity = createHash("sha256").update(normalized).digest("hex");
        }
      }
      digest.update(rel);
      digest.update("\0");
      digest.update(identity);
      digest.update("\0");
    }
  }

  function snapshotPathPolicy(id, ignored, declared) {
    return (rel, { gitAware = false, tracked = false } = {}) => {
      if ([...ignored].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`)))
        return false;
      if (isExcludedPath(rel, { excluded: excludedWorkspaceDirs, tracked })) return false;
      if (gitAware && !tracked && !isCurrentChangePath(rel, id) && !declared(rel)) return false;
      if (rel.startsWith("openspec/changes/archive/")) return false;
      if (rel.startsWith("openspec/changes/") && !isCurrentChangePath(rel, id)) return false;
      return rel !== `${currentChangeRelativePath(id)}/execution.yaml`;
    };
  }

  // `view`: the target's Git view of a sandbox without its own checkout. A
  // file is then judged as Git would judge it (tracked, declared, or the
  // packet); a directory only by name, so a declared file below is reached.
  function collectFilesystemSnapshot(workspace, allowed, view = null) {
    const files = [];
    function collect(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const rel = relative(workspace, path).replaceAll("\\", "/");
        if (!allowed(rel, view ? {
          gitAware: !entry.isDirectory(), tracked: view.tracked.has(rel)
        } : {})) continue;
        if (entry.isDirectory()) collect(path);
        else if (entry.isFile() || entry.isSymbolicLink()) files.push([rel, path]);
      }
    }
    collect(workspace);
    return files.sort(([a], [b]) => codepointOrder(a, b));
  }

  function collectGitSnapshot(workspace, allowed) {
    const gitIndex = git(["ls-files", "-s", "-z"], workspace);
    const gitStatus = git([
      "status", "--porcelain=v1", "-z", "--untracked-files=all"
    ], workspace);
    if (gitIndex.status !== 0 || gitStatus.status !== 0) return null;
    const indexed = new Map();
    for (const line of gitIndex.stdout.split("\0").filter(Boolean)) {
      const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/);
      if (match) indexed.set(match[3], { mode: match[1], oid: match[2] });
    }
    const dirty = new Set();
    for (const row of porcelainStatusRecords(gitStatus.stdout)) {
      dirty.add(row.path);
      if (row.origPath) dirty.add(row.origPath);
    }
    return [...new Set([...indexed.keys(), ...dirty])]
      .filter((rel) => allowed(rel, { gitAware: true, tracked: indexed.has(rel) }))
      .sort()
      .map((rel) => {
        const path = join(workspace, rel);
        const indexedEntry = indexed.get(rel);
        const entryExists = Boolean(lstatSync(path, { throwIfNoEntry: false }));
        const identity = indexedEntry?.mode === "160000"
          ? `gitlink:${indexedEntry.oid}`
          : (entryExists ? filesystemEntryIdentity(path) : "deleted");
        return [rel, path, identity || "missing"];
      });
  }

  function snapshotValue(id, workspace, contractRevision, files, digests) {
    const revisionMarker = `foundation-contract-revision:${contractRevision}`;
    for (const digest of Object.values(digests)) digest.update(revisionMarker);
    const workspaceHash = digests.hash.digest("hex");
    return {
      version: 2,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace,
      workspaceHash,
      codeHash: digests.codeHash.digest("hex"),
      reviewHash: digests.reviewHash.digest("hex"),
      packetReviewHash: digests.packetReviewHash.digest("hex"),
      revision: contractRevision,
      fileCount: files.length,
      createdAt: now()
    };
  }

  function singleRelevantSnapshot(id, workspaceOverride = null, force = false,
      ignoredPaths = []) {
    const { state, workspace, contractRevision, ignored, cacheKey } =
      snapshotContext(id, workspaceOverride, ignoredPaths);
    // A recorded workspace that no longer exists used to surface as a raw
    // ENOENT from the directory walk — a stack trace where the operator needs
    // the exit instruction. Typed so callers that degrade per row (`changes`)
    // can recognize exactly this case and rethrow everything else.
    // `state.revision` counts sandbox syncs and must not feed the marker: a
    // sync that changed no contract text would shift every snapshot hash and
    // expire the review receipt — which, unlike code-bound receipts, has no
    // declared-inputs rebind and whose re-dispatch the wave cap refuses.
    // `contractRevision` is bumped by sync exactly when the contract changed.
    if (!force && snapshotCache.has(cacheKey)) return snapshotCache.get(cacheKey);
    const digests = snapshotDigests();
    // The same walk, folded twice. `hash` is every path the change surface
    // admits; `codeHash` is that minus the change packet, which no test or lint
    // command reads. An executable provider binds the second, so a note added
    // to `design.md` after proving no longer expires evidence that ran against
    // code nobody touched. Review and acceptance still bind the first — a
    // reviewer read the proposal, and editing it must expire their verdict.
    // Review identity includes code and semantic contract, but excludes
    // controller progress and delivery tracking. Checking a task box or
    // accepting a post-Land handoff must not summon a fresh reviewer for code
    // and requirements they already inspected.
    // The packet half of review identity on its own. A review verdict covers
    // the diff plus the packet the reviewer read; binding it to reviewHash
    // (every tracked byte) expires it on upstream commits the change never
    // touched. Paired with the sandbox diff identity, this is the narrow
    // binding that lets an unchanged verdict survive a moved base.
    const declared = declaredSurfaceMatcher(id, state,
      workspaceRepositoryId(state, workspace));
    const allowed = snapshotPathPolicy(id, ignored, declared);
    const view = borrowedGitView(state, workspace);
    let files = view ? null : collectGitSnapshot(workspace, allowed);
    if (files === null) {
      const walked = collectFilesystemSnapshot(workspace, allowed, view);
      const kept = new Set(view ? view.withoutIgnored(walked.map(([rel]) => rel))
        : walked.map(([rel]) => rel));
      files = walked.filter(([rel]) => kept.has(rel))
        .map(([rel, path]) => [rel, path, filesystemEntryIdentity(path)]);
    }
    for (const [rel, , identity] of files)
      foldSnapshotEntry(digests, id, workspace, rel, identity);
    const value = snapshotValue(id, workspace, contractRevision, files, digests);
    snapshotCache.set(cacheKey, value);
    if (workspace === resolve(state.workspace?.path || root)) writeSnapshot(snapshotPath(id), value);
    return value;
  }

  function clearSnapshotCache(id = null) {
    for (const key of snapshotCache.keys())
      if (!id || key.startsWith(`${id}\0`)) snapshotCache.delete(key);
    for (const clear of policyCacheClearers) clear(id);
  }

  // Git-ignored output is regenerable, so it belongs in no baseline. Walking it
  // is not a small waste: this repository's gitignored `target/` put 906,814 of
  // 909,041 entries into one manifest, cost ~250s of hashing to build, and grew
  // the runtime state file to 156MB — which every later command then had to
  // parse, taking `changes` from 0.09s to 1.96s and `packet` from 0.22s to 9.3s.
  // The copy sandbox already refuses these paths, so including them here would
  // also describe files the sandbox does not have.
  function ignoredPathSet(workspace) {
    const listed = git(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      workspace);
    if (listed.status !== 0) return new Set();
    return new Set(listed.stdout.split("\0").filter(Boolean)
      .map((path) => (path.endsWith("/") ? path.slice(0, -1) : path)));
  }

  // What the working tree already carried when a change began.
  //
  // The changed surface is derived from `git status`, which cannot tell a file
  // this change wrote from a file that was simply sitting there. A stray
  // untracked `theme.css` therefore counted as change surface and pulled the
  // `accessibility` policy trigger onto a one-line rapid change that had not
  // touched a stylesheet — evidence the author could not honestly produce.
  //
  // Digests, not just paths: a pre-existing file the change later edits is real
  // surface again, and dropping it by name would silently lose it.
  function preexistingDirty(workspace = root) {
    const dirty = git(["status", "--porcelain", "-z", "--untracked-files=all"], workspace);
    if (dirty.status !== 0) return {};
    const result = {};
    for (const { path: rel } of porcelainStatusRecords(dirty.stdout)) {
      if (!rel) continue;
      const path = join(workspace, rel);
      try {
        if (!existsSync(path) || !lstatSync(path).isFile()) continue;
        result[rel] = fileDigest(path);
      } catch {
        // A path that cannot be read now cannot be compared later either.
      }
    }
    return result;
  }

  function workspaceManifest(workspace, id, excludeChange = false) {
    const result = {};
    const manifestState = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    // A sandbox without its own checkout reads its files through its target's
    // Git view, exactly as its proof hash does.
    const view = borrowedGitView(manifestState, workspace);
    const ignored = view ? new Set() : ignoredPathSet(workspace);
    // Tracked-aware, like the snapshot and the copy filter: both admit a
    // committed file under an excluded-named directory, so the manifests whose
    // diff decides what apply projects must admit it too — a name-only
    // exclusion here dropped exactly those edits at Land, silently, while
    // proof (whose hash includes them) reported pass.
    const listed = view ? { status: 0 } : git(["ls-files", "-z"], workspace);
    const gitAware = listed.status === 0;
    const tracked = view ? view.tracked : gitAware
      ? trackedPathSet(listed.stdout.split("\0").filter(Boolean))
      : new Set();
    // The same predicate the proof hash uses. Two manifests are diffed to decide
    // what apply projects, so a path either manifest admits and the other does
    // not becomes a create or a delete; confining both to one surface is what
    // keeps an unrelated tree out of that diff.
    const declared = declaredSurfaceMatcher(id, manifestState,
      workspaceRepositoryId(manifestState, workspace));
    function collect(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const rel = relative(workspace, path).replaceAll("\\", "/");
        if (isExcludedPath(rel, {
          excluded: excludedWorkspaceDirs, tracked: tracked.has(rel)
        })) continue;
        if (ignored.has(rel)) continue;
        if (rel.startsWith("openspec/changes/archive/")) continue;
        if (rel.startsWith("openspec/changes/") &&
            (excludeChange || !isCurrentChangePath(rel, id))) continue;
        if (entry.isDirectory()) { collect(path); continue; }
        if (gitAware && !tracked.has(rel) && !isCurrentChangePath(rel, id) &&
            !declared(rel)) continue;
        if (entry.isFile() || entry.isSymbolicLink())
          result[rel] = filesystemEntryIdentity(path);
      }
    }
    collect(workspace);
    if (!view) return result;
    const kept = new Set(view.withoutIgnored(Object.keys(result)));
    return Object.fromEntries(Object.entries(result).filter(([rel]) => kept.has(rel)));
  }

  return {
    runtimePath,
    changePath,
    receiptPath,
    proofPath,
    proofRunRoot,
    snapshotPath,
    currentChangeRelativePath,
    isCurrentChangePath,
    activeChangePath,
    archivedChangeRelativePath,
    slugify,
    loadRuntime,
    saveRuntime,
    activeChanges,
    orphanRuntimeChanges,
    walk,
    filesystemEntryIdentity,
    codepointOrder,
    directoryHash,
    stableHash,
    serializedJson,
    compactList,
    compactStrings,
    expandList,
    listCount,
    fileDigest,
    singleRelevantSnapshot,
    inspectSnapshots,
    writeSnapshot,
    declaredSurfaceMatcher,
    surfaceAdditionReport,
    workspaceRepositoryId,
    clearSnapshotCache,
    registerPolicyCacheClearer,
    workspaceManifest,
    preexistingDirty,
    porcelainStatusRecords,
    git,
    gitBuffer,
    gitHead
  };
}
