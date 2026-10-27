import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { EXCLUDED_WORKSPACE_DIRS } from "../core/workspace-policy.mjs";
import { withoutGitIgnored } from "../core/git-ignore.mjs";
import { sandboxCodePathspec } from "../core/workspace-surface.mjs";

// A sandbox is the only copy of work that has not landed: commits made inside
// it live in a detached worktree (or a copied object store) that no branch in
// the target references, and uncommitted edits live nowhere else at all. So
// nothing may delete a sandbox on the strength of a status field. This module
// compares sandbox bytes with target bytes, and writes a recoverable backup of
// anything the target does not hold before a sandbox is removed.

export const SANDBOX_BACKUP_VERSION = 1;

function runGit(args, cwd, env = null) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env
  });
  return {
    status: result.error ? 1 : result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || result.error?.message || "")
  };
}

function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

// Bytes, symlink target, and executable bit: what a Land projection carries.
export function contentIdentity(path) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
  if (stat.isDirectory()) return "directory";
  if (!stat.isFile()) return `other:${stat.mode}`;
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  return `file:${stat.mode & 0o111 ? "x" : "-"}:${digest}`;
}

function nulList(stdout) {
  return String(stdout || "").split("\0").filter(Boolean);
}

// Every path a sandbox changed relative to the base it was isolated from:
// committed work, uncommitted tracked edits, and untracked files. Against the
// base rather than HEAD, because a commit inside the sandbox moves HEAD.
export function sandboxChangedPaths({ sandboxPath, baseHead, pathspec = ["."] }) {
  if (!sandboxPath || !existsSync(sandboxPath))
    return { ok: false, error: "sandbox path does not exist", paths: [] };
  if (!baseHead) return { ok: false, error: "sandbox has no recorded base commit", paths: [] };
  const tracked = runGit(["diff", "--name-only", "--no-renames", "-z", baseHead, "--",
    ...pathspec], sandboxPath);
  if (tracked.status !== 0)
    return { ok: false, error: tracked.stderr.trim() || "git diff failed", paths: [] };
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z", "--",
    ...pathspec], sandboxPath);
  if (untracked.status !== 0)
    return { ok: false, error: untracked.stderr.trim() || "git ls-files failed", paths: [] };
  return {
    ok: true,
    paths: [...new Set([...nulList(tracked.stdout), ...nulList(untracked.stdout)])].sort()
  };
}

export function unlandedPaths({ sandboxPath, targetPath, paths }) {
  return paths.filter((path) => {
    const sandbox = contentIdentity(join(sandboxPath, path));
    const target = contentIdentity(join(targetPath, path));
    if (sandbox === "directory" && target === "directory") return false;
    return sandbox !== target;
  });
}

// Commits the sandbox made that the target repository cannot reach from its
// HEAD. A copy sandbox carries its own object store, so an unknown commit in
// the target is unreachable by definition.
export function unreachableCommits({ sandboxPath, targetPath, baseHead }) {
  const head = runGit(["rev-parse", "HEAD"], sandboxPath);
  if (head.status !== 0) return { ok: false, error: head.stderr.trim(), count: 0, head: null };
  const sandboxHead = head.stdout.trim();
  if (!baseHead || sandboxHead === baseHead) return { ok: true, count: 0, head: sandboxHead };
  const counted = runGit(["rev-list", "--count", `${baseHead}..${sandboxHead}`], sandboxPath);
  if (counted.status !== 0)
    return { ok: false, error: counted.stderr.trim(), count: 0, head: sandboxHead };
  const count = Number(counted.stdout.trim()) || 0;
  if (!count) return { ok: true, count: 0, head: sandboxHead };
  const reachable = targetPath && existsSync(targetPath)
    ? runGit(["merge-base", "--is-ancestor", sandboxHead, "HEAD"], targetPath) : { status: 1 };
  return { ok: true, count: reachable.status === 0 ? 0 : count, head: sandboxHead };
}

function walkFiles(base, relativeRoot, output) {
  const directory = join(base, relativeRoot);
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch { return output; }
  for (const entry of entries) {
    const path = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_WORKSPACE_DIRS.has(entry.name)) continue;
      walkFiles(base, path, output);
    } else if (entry.name !== ".git") output.push(path);
  }
  return output;
}

// The shared sandbox holds each nested repository only as an empty gitlink
// placeholder. Anything written there belongs to no repository sandbox, is
// excluded from the root projection, and so would never land. A file the
// nested repository's own ignore rules exclude is no repository's work either:
// a tool run from the root that rewrites it is not unlanded content.
export function placeholderFiles({ sandboxPath, targetPath, nestedPaths = [] }) {
  const found = [];
  for (const nested of nestedPaths) {
    // The harness links a selected repository's sandbox here; its work is
    // assessed in that sandbox, never twice through the link.
    if (lstatSync(join(sandboxPath, nested), { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    const differing = walkFiles(sandboxPath, nested, []).filter((path) =>
      contentIdentity(join(sandboxPath, path)) !== contentIdentity(join(targetPath, path)));
    if (!differing.length) continue;
    const local = differing.map((path) => path.slice(nested.length + 1));
    const kept = new Set(targetPath ? withoutGitIgnored(join(targetPath, nested), local,
      { ownRepository: true }) : local);
    found.push(...differing.filter((_, index) => kept.has(local[index])));
  }
  return found.sort();
}

function nestedRelativePaths(root, state) {
  return Object.entries(state.repositories || {})
    .filter(([repositoryId, record]) => repositoryId !== "root" && record?.targetPath)
    .map(([, record]) => relative(canonical(root), canonical(record.targetPath)))
    .filter((path) => path && !path.startsWith("..") && !isAbsolute(path))
    .sort();
}

// One row per sandbox a change owns: the shared control-plane sandbox and each
// per-repository worktree. `label` names the backup directory.
export function sandboxDescriptors(root, id, state) {
  const rows = [];
  const workspacePath = state.workspace?.sandboxPath || state.workspace?.path;
  if (["worktree", "copy"].includes(state.workspace?.mode) && workspacePath &&
      canonical(workspacePath) !== canonical(root)) {
    const nested = nestedRelativePaths(root, state);
    rows.push({
      repositoryId: "root",
      label: "root",
      changeId: id,
      kind: "shared",
      mode: state.workspace.mode,
      access: state.repositories?.root?.access || "write",
      sandboxPath: workspacePath,
      targetPath: root,
      baseHead: state.workspace.baseHead || null,
      pathspec: sandboxCodePathspec(id, nested),
      nestedPaths: nested
    });
  }
  for (const [repositoryId, record] of Object.entries(state.repositories || {})) {
    if (repositoryId === "root" || !record?.path) continue;
    rows.push({
      repositoryId,
      label: `repository-${repositoryId.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      changeId: id,
      kind: "repository",
      mode: record.mode || "worktree",
      access: record.access || "write",
      sandboxPath: record.path,
      targetPath: record.targetPath || null,
      baseHead: record.baseHead || null,
      pathspec: ["."],
      nestedPaths: []
    });
  }
  return rows;
}

// A copy of a project that is not a Git checkout has no base to diff against:
// every file it holds is compared with the target directly — except what the
// target repository's ignore rules exclude, which is no change's work.
function assessPlainCopy(descriptor) {
  const { sandboxPath, targetPath, changeId } = descriptor;
  const owned = (path) => path === ".foundation" || path.startsWith(".foundation/") ||
    path.startsWith(`openspec/changes/${changeId}/`);
  const walked = walkFiles(sandboxPath, "", []).filter((path) => !owned(path)).sort();
  const changed = targetPath && existsSync(targetPath)
    ? withoutGitIgnored(targetPath, walked) : walked;
  return {
    inspected: true,
    absent: false,
    changed,
    unlanded: targetPath && existsSync(targetPath)
      ? unlandedPaths({ sandboxPath, targetPath, paths: changed }) : changed,
    placeholders: [],
    commits: 0,
    sandboxHead: null,
    plain: true
  };
}

export function assessSandbox(descriptor) {
  const { sandboxPath, targetPath, baseHead, pathspec, nestedPaths } = descriptor;
  if (!sandboxPath || !existsSync(sandboxPath))
    return { inspected: true, absent: true, changed: [], unlanded: [], placeholders: [], commits: 0 };
  if (!existsSync(join(sandboxPath, ".git"))) {
    if (descriptor.mode === "copy") return assessPlainCopy(descriptor);
    // Without its own .git a worktree's Git commands would answer for the
    // enclosing repository, so nothing about its content can be trusted.
    return { inspected: false, error: "the sandbox is not a Git checkout of its own" };
  }
  const changed = sandboxChangedPaths({ sandboxPath, baseHead, pathspec });
  if (!changed.ok) return { inspected: false, error: changed.error };
  const commits = unreachableCommits({ sandboxPath, targetPath, baseHead });
  if (!commits.ok) return { inspected: false, error: commits.error };
  const unlanded = targetPath && existsSync(targetPath)
    ? unlandedPaths({ sandboxPath, targetPath, paths: changed.paths }) : changed.paths;
  return {
    inspected: true,
    absent: false,
    changed: changed.paths,
    unlanded,
    placeholders: placeholderFiles({ sandboxPath, targetPath, nestedPaths }),
    commits: commits.count,
    sandboxHead: commits.head
  };
}

export function backupNeeded(assessment) {
  return Boolean(assessment?.inspected && !assessment.absent &&
    (assessment.commits > 0 || assessment.unlanded.length || assessment.placeholders.length));
}

function backupStamp(now) {
  return String(now()).replace(/[^0-9A-Za-z]/g, "-");
}

function copyIntoBackup(sandboxPath, directory, paths) {
  const copied = [];
  for (const path of paths) {
    const source = join(sandboxPath, path);
    if (contentIdentity(source) === null) continue;
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
    copied.push(path);
  }
  return copied;
}

// Writes, under .foundation/backups/<id>/<timestamp>/<label>/:
//   commits.bundle  every sandbox commit the target cannot reach (git fetch it)
//   changes.patch   the full sandbox delta from its base, untracked included
//   files/          verbatim copies of every path the target does not hold
//   placeholders/   files written into a nested repository's shared placeholder
//   manifest.json   what was found and how to restore it
// Throws when any part cannot be written, so the caller keeps the sandbox.
export function writeSandboxBackup({ root, id, descriptor, assessment, now, stamp = null }) {
  const directory = join(root, ".foundation", "backups", id,
    stamp || backupStamp(now), descriptor.label);
  mkdirSync(directory, { recursive: true });
  const { sandboxPath, baseHead, pathspec } = descriptor;
  const written = [];
  if (assessment.commits > 0) {
    const bundle = runGit(["bundle", "create", join(directory, "commits.bundle"),
      "HEAD", `^${baseHead}`], sandboxPath);
    if (bundle.status !== 0) throw new Error(`git bundle failed: ${bundle.stderr.trim()}`);
    written.push("commits.bundle");
  }
  // A plain copy has no Git base for a patch; its verbatim files/ are the backup.
  if (assessment.changed.length && !assessment.plain) {
    const index = join(directory, ".backup-index");
    const env = { GIT_INDEX_FILE: index };
    try {
      const read = runGit(["read-tree", "HEAD"], sandboxPath, env);
      const added = read.status === 0
        ? runGit(["add", "-A", "--", ...pathspec], sandboxPath, env) : read;
      const diff = added.status === 0
        ? runGit(["diff", "--cached", "--binary", baseHead, "--", ...pathspec], sandboxPath, env)
        : added;
      if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
      writeFileSync(join(directory, "changes.patch"), diff.stdout);
      written.push("changes.patch");
    } finally {
      rmSync(index, { force: true });
    }
  }
  const files = copyIntoBackup(sandboxPath, join(directory, "files"), assessment.unlanded);
  const placeholders = copyIntoBackup(sandboxPath, join(directory, "placeholders"),
    assessment.placeholders);
  const relativeDirectory = relative(root, directory);
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify({
    version: SANDBOX_BACKUP_VERSION,
    changeId: id,
    repositoryId: descriptor.repositoryId,
    sandboxPath,
    targetPath: descriptor.targetPath,
    baseHead,
    sandboxHead: assessment.sandboxHead || null,
    unreachableCommits: assessment.commits,
    unlandedPaths: assessment.unlanded,
    placeholderPaths: assessment.placeholders,
    written: [...written, ...(files.length ? ["files/"] : []),
      ...(placeholders.length ? ["placeholders/"] : [])],
    restore: [
      ...(written.includes("commits.bundle")
        ? [`git -C <target> fetch ${relativeDirectory}/commits.bundle HEAD && git -C <target> branch foundation-recovered-${id} FETCH_HEAD`]
        : []),
      ...(written.includes("changes.patch")
        ? [`git -C <target> apply --3way ${relativeDirectory}/changes.patch  (the patch is relative to baseHead)`]
        : [])
    ],
    createdAt: now()
  }, null, 2)}\n`);
  return { status: "written", path: relativeDirectory };
}

// The single rule every sandbox removal goes through. Returns whether removal
// may proceed and, when it may, the backup written first.
//   purpose "archive": the change claims its work landed, so a sandbox whose
//     bytes the target does not hold is evidence of a failed Land and is kept.
//   any other purpose (abandon, rollback): removal proceeds only after every
//     unlanded commit and byte is backed up.
// A sandbox that cannot be inspected is never removed.
export function guardSandboxRemoval({ root, id, descriptor, purpose, now, stamp = null }) {
  const assessment = assessSandbox(descriptor);
  if (!assessment.inspected)
    return {
      proceed: false,
      result: {
        status: "refused",
        path: descriptor.sandboxPath,
        reason: `cannot verify sandbox content before removal (${assessment.error}); the sandbox was kept`
      }
    };
  // A copy sandbox also carries the target's pre-existing dirty files, which
  // the user may keep editing in the target; its root projection is bound by
  // the apply journal instead, so its differences are backed up, not refused.
  const unverified = [
    ...(descriptor.kind === "shared" && descriptor.mode === "copy" ? [] : assessment.unlanded),
    ...assessment.placeholders
  ];
  if (purpose === "archive" && descriptor.access !== "read" && unverified.length)
    return {
      proceed: false,
      result: {
        status: "refused",
        path: descriptor.sandboxPath,
        reason: `the target does not hold ${unverified.length} sandbox path(s) (${
          unverified.slice(0, 10).join(", ")}${unverified.length > 10 ? ", ..." : ""}); the sandbox was kept`,
        unlandedPaths: unverified
      }
    };
  if (!backupNeeded(assessment)) return { proceed: true, backup: null };
  try {
    return {
      proceed: true,
      backup: writeSandboxBackup({ root, id, descriptor, assessment, now, stamp }).path
    };
  } catch (error) {
    return {
      proceed: false,
      result: {
        status: "refused",
        path: descriptor.sandboxPath,
        reason: `backup of unlanded sandbox work failed (${error.message}); the sandbox was kept`
      }
    };
  }
}
