import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readFileSync, readdirSync, readlinkSync
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  declaredPathMatcher, isChangePacketPath, isExcludedPath, trackedPathSet
} from "./workspace-surface.mjs";
import { taskBlocks, taskMetadata } from "../contracts/change-artifacts.mjs";

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
  function changePath(id) { return join(changes, id); }
  function receiptPath(id, provider) { return join(receipts, id, `${provider}.json`); }
  function proofPath(id) { return join(receipts, id, "proof.json"); }
  function proofRunRoot(id, proofRunId) { return join(evidenceVault, id, proofRunId); }
  function snapshotPath(id) { return join(snapshots, `${id}.json`); }
  function currentChangeRelativePath(id) { return `openspec/changes/${id}`; }

  function isCurrentChangePath(rel, id) {
    return isChangePacketPath(rel, id);
  }

  function activeChangePath(id, state = loadRuntime(id)) {
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
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "change";
  }

  // `recoverable` is for the one caller that must work precisely when the
  // state file is gone or unreadable: `change abandon` is the designed exit
  // from a broken change, and gating it on loadRuntime made it the dead end it
  // exists to resolve. A minimal placeholder is enough for abandon to
  // quarantine what is on disk.
  function loadRuntime(id, { recoverable = false } = {}) {
    const path = runtimePath(id);
    const present = existsSync(path);
    if (!present && !recoverable) fail(`unknown change '${id}'`);
    if (!present && !existsSync(changePath(id)))
      fail(`unknown change '${id}'`);
    if (!present)
      return { version: 2, id, status: "unknown", schema: null, recoveredState: "missing" };
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (!recoverable)
        fail(`invalid JSON: ${runtimeRelativePath(id)} (${error.message}); ` +
          `retire it with 'claude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>'`);
      return { version: 2, id, status: "unknown", schema: null, recoveredState: "corrupt" };
    }
  }

  function runtimeRelativePath(id) {
    return relative(root, runtimePath(id));
  }

  function saveRuntime(state) {
    state.updatedAt = now();
    writeJson(runtimePath(state.id), state);
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

  function fileDigest(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  }

  function filesystemEntryIdentity(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
    if (stat.isFile()) return fileDigest(path);
    return `unsupported:${stat.mode}`;
  }

  function directoryHash(dir) {
    const hash = createHash("sha256");
    const files = [];
    walk(dir, (path) => files.push(path));
    // Codepoint order, not localeCompare: ICU collation varies by locale, so
    // the same tree hashed differently on two machines — a hash that must be
    // reproducible cannot depend on the environment's collation tables.
    files.sort((a, b) => {
      const left = relative(dir, a);
      const right = relative(dir, b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
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
  function declaredSurfaceMatcher(id, state = {}) {
    const globs = [...(state.declaredSurface || [])];
    const tasks = join(changePath(id), "tasks.md");
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
    const result = git(["rev-parse", "HEAD"], cwd);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  function singleRelevantSnapshot(id, workspaceOverride = null, force = false) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    const workspace = canonicalPath(workspaceOverride || state.workspace?.path || root);
    // A recorded workspace that no longer exists used to surface as a raw
    // ENOENT from the directory walk — a stack trace where the operator needs
    // the exit instruction. Typed so callers that degrade per row (`changes`)
    // can recognize exactly this case and rethrow everything else.
    if (!existsSync(workspace)) {
      const error = new Error(`workspace '${workspace}' for change '${id}' no longer exists; ` +
        `recreate it with 'claude-foundation sandbox create ${id}' or run ` +
        `'claude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>'`);
      error.code = "FOUNDATION_WORKSPACE_MISSING";
      throw error;
    }
    const cacheKey = `${id}\0${workspace}\0${Number(state.contractRevision || state.revision || 0)}`;
    if (!force && snapshotCache.has(cacheKey)) return snapshotCache.get(cacheKey);
    const hash = createHash("sha256");
    // The same walk, folded twice. `hash` is every path the change surface
    // admits; `codeHash` is that minus the change packet, which no test or lint
    // command reads. An executable provider binds the second, so a note added
    // to `design.md` after proving no longer expires evidence that ran against
    // code nobody touched. Review and acceptance still bind the first — a
    // reviewer read the proposal, and editing it must expire their verdict.
    const codeHash = createHash("sha256");
    const files = [];
    const declared = declaredSurfaceMatcher(id, state);
    function fold(rel, contentIdentity) {
      for (const digest of [hash, codeHash]) {
        if (digest === codeHash && isChangePacketPath(rel, id)) continue;
        digest.update(rel);
        digest.update("\0");
        digest.update(contentIdentity);
        digest.update("\0");
      }
    }
    // Without git there is no tracked/untracked axis to confine by, and a walk
    // that guessed would drop content instead of noise.
    let gitAware = false;
    function allowed(rel, tracked = false) {
      if (isExcludedPath(rel, { excluded: excludedWorkspaceDirs, tracked }))
        return false;
      // Untracked and undeclared is somebody else's file sitting in the tree.
      if (gitAware && !tracked && !isCurrentChangePath(rel, id) && !declared(rel))
        return false;
      if (rel.startsWith("openspec/changes/archive/")) return false;
      if (rel.startsWith("openspec/changes/") && !isCurrentChangePath(rel, id))
        return false;
      if (rel === `${currentChangeRelativePath(id)}/execution.yaml`) return false;
      return true;
    }
    function collect(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const rel = relative(workspace, path).replaceAll("\\", "/");
        if (!allowed(rel)) continue;
        if (entry.isDirectory()) collect(path);
        else if (entry.isFile() || entry.isSymbolicLink()) files.push([rel, path]);
      }
    }
    const gitIndex = git(["ls-files", "-s", "-z"], workspace);
    const gitStatus = git([
      "status", "--porcelain=v1", "-z", "--untracked-files=all"
    ], workspace);
    if (gitIndex.status === 0 && gitStatus.status === 0) {
      gitAware = true;
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
      // Tracking is per path, so it has to be asked per path: a fixture
      // directory whose name collides with a build-output name is only
      // distinguishable from real build output by whether git carries it.
      const paths = [...new Set([...indexed.keys(), ...dirty])]
        .filter((rel) => allowed(rel, indexed.has(rel))).sort();
      for (const rel of paths) {
        const path = join(workspace, rel);
        const contentIdentity = dirty.has(rel)
          ? (indexed.get(rel)?.mode === "160000"
            ? `gitlink:${indexed.get(rel).oid}`
            : (existsSync(path) ? filesystemEntryIdentity(path) : "deleted"))
          : indexed.get(rel)?.oid;
        files.push([rel, path]);
        fold(rel, contentIdentity || "missing");
      }
    } else {
      collect(workspace);
      // Codepoint order for the same reason as directoryHash: the git-aware
      // branch above sorts by codepoint, and the two must agree.
      files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [rel, path] of files) fold(rel, filesystemEntryIdentity(path));
    }
    const revisionMarker = `foundation-contract-revision:${
      Number(state.contractRevision || state.revision || 0)}`;
    hash.update(revisionMarker);
    codeHash.update(revisionMarker);
    const workspaceHash = hash.digest("hex");
    const value = {
      version: 1,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace,
      workspaceHash,
      codeHash: codeHash.digest("hex"),
      revision: Number(state.contractRevision || state.revision || 0),
      fileCount: files.length,
      createdAt: now()
    };
    snapshotCache.set(cacheKey, value);
    if (workspace === resolve(state.workspace?.path || root)) writeJson(snapshotPath(id), value);
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
    const ignored = ignoredPathSet(workspace);
    // Tracked-aware, like the snapshot and the copy filter: both admit a
    // committed file under an excluded-named directory, so the manifests whose
    // diff decides what apply projects must admit it too — a name-only
    // exclusion here dropped exactly those edits at Land, silently, while
    // proof (whose hash includes them) reported pass.
    const listed = git(["ls-files", "-z"], workspace);
    const gitAware = listed.status === 0;
    const tracked = gitAware
      ? trackedPathSet(listed.stdout.split("\0").filter(Boolean))
      : new Set();
    // The same predicate the proof hash uses. Two manifests are diffed to decide
    // what apply projects, so a path either manifest admits and the other does
    // not becomes a create or a delete; confining both to one surface is what
    // keeps an unrelated tree out of that diff.
    const declared = declaredSurfaceMatcher(id,
      existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {});
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
    return result;
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
    directoryHash,
    stableHash,
    serializedJson,
    compactList,
    compactStrings,
    expandList,
    listCount,
    fileDigest,
    singleRelevantSnapshot,
    declaredSurfaceMatcher,
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
