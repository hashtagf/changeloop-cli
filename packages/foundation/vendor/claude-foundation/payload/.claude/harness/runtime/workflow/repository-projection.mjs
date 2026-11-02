import {
  existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, renameSync,
  rmSync, symlinkSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Root code and tests consume declared nested repositories (submodules and
// nested Git repositories) through their path under root. A root sandbox is a
// `git worktree` (or an isolated copy) in which those paths are empty gitlink
// placeholders, so a root check that requires one failed with nothing anyone
// could repair. The harness projects each one into the root sandbox:
//
// - selected, with a repository sandbox: a symlink to that sandbox. The
//   repository sandbox stays the single source of truth; an edit through
//   either path lands in it, and root checks see its uncommitted work live.
// - otherwise: a detached checkout of the recorded gitlink commit (the target
//   HEAD for a nested repository Git does not track), cloned with `--shared`
//   from local objects only. It is read-only in spirit: an edit or a moved
//   HEAD there would make root checks pass on bytes no Land ever delivers, so
//   it refuses until reverted.
//
// The root index keeps each gitlink at its recorded commit with
// `skip-worktree` set, so root status, proof, review, replay, and Land see the
// pointer, never the projection. The flag lives in the sandbox's own index.

export const PROJECTION_MARKER = "foundation.projection";
export const PROJECTION_COMMIT = "foundation.projectedCommit";

export function projectableRepositories(catalogRows = []) {
  const rows = catalogRows
    .filter((repository) => repository?.id && repository.id !== "root")
    .map((repository) => ({
      ...repository,
      relativePath: String(repository.relativePath || "")
        .replaceAll("\\", "/").replace(/\/+$/, "")
    }))
    .filter(({ relativePath }) => relativePath && relativePath !== "." &&
      relativePath !== ".." && !relativePath.startsWith("../") && !isAbsolute(relativePath))
    .sort((left, right) => left.relativePath.length - right.relativePath.length);
  // A repository nested inside another projected one is that one's content.
  return rows.filter((row, index) => !rows.slice(0, index).some((outer) =>
    row.relativePath.startsWith(`${outer.relativePath}/`)));
}

export function projectionWorkspace(state = {}) {
  const workspace = state.workspace;
  if (!workspace || !["worktree", "copy"].includes(workspace.mode) || !workspace.path ||
      workspace.applied || state.status === "archived" || !existsSync(workspace.path))
    return null;
  // A copy without Git has no gitlink to read and no index to keep quiet.
  if (workspace.mode === "copy" && workspace.git === "absent") return null;
  return workspace.path;
}

function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

function entryState(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return "missing";
  if (stat.isSymbolicLink()) return "link";
  if (!stat.isDirectory()) return "occupied";
  if (!readdirSync(path).length) return "empty";
  return lstatSync(join(path, ".git"), { throwIfNoEntry: false })?.isDirectory()
    ? "repository" : "occupied";
}

export function recordedGitlink(git, workspace, relativePath) {
  const listed = git(["ls-files", "-s", "-v", "-z", "--", relativePath], workspace);
  if (listed.status !== 0) return null;
  for (const row of String(listed.stdout || "").split("\0").filter(Boolean)) {
    const match = row.match(/^(\S)\s+(\d+)\s+([0-9a-f]{40,64})\s+\d+\t(.+)$/);
    if (match && match[4] === relativePath && match[2] === "160000")
      return { commit: match[3], skipWorktree: match[1] === "S" };
  }
  return null;
}

function gitDirectory(git, path) {
  if (!path || !existsSync(path)) return null;
  const result = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], path);
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function ownRepository(git, path) {
  if (!path || !existsSync(path)) return false;
  const top = git(["rev-parse", "--show-toplevel"], path);
  return top.status === 0 && canonical(String(top.stdout || "").trim()) === canonical(path);
}

function localUrlPaths(root, git, url) {
  const value = String(url || "").trim();
  if (!value) return [];
  if (value.startsWith("file://")) {
    try { return [fileURLToPath(value)]; } catch { return []; }
  }
  if (isAbsolute(value)) return [value];
  if (!value.startsWith("./") && !value.startsWith("../")) return [];
  // Git resolves a relative submodule URL against the superproject's remote,
  // or against the superproject itself when it has none.
  const bases = [root];
  const origin = git(["config", "--get", "remote.origin.url"], root);
  const remote = String(origin.stdout || "").trim();
  if (origin.status === 0 && remote) bases.unshift(...localUrlPaths(root, git,
    remote.startsWith(".") ? resolve(root, remote) : remote));
  return bases.map((base) => resolve(base, value));
}

// Local object stores that may hold the commit, most specific first. Never a
// network remote: an unavailable commit is reported, not fetched.
export function projectionObjectSources({ root, git }, repository) {
  const candidates = [];
  if (ownRepository(git, repository.path)) candidates.push(gitDirectory(git, repository.path));
  const rootGit = gitDirectory(git, root);
  if (rootGit) candidates.push(join(rootGit, "modules", repository.name || repository.relativePath));
  for (const path of localUrlPaths(root, git, repository.url))
    candidates.push(gitDirectory(git, path));
  return [...new Set(candidates.filter((path) => path && existsSync(path)))];
}

function preserve(context, id, workspace, relativePath) {
  const stamp = String(context.now()).replace(/[^0-9A-Za-z]/g, "-");
  const destination = join(context.root, ".foundation", "backups", id, stamp,
    "repository-projections", relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(join(workspace, relativePath), destination);
  context.log(`PRESERVED ${relativePath}: content found where the root sandbox projects repository '${
    relativePath}' was moved to ${relative(context.root, destination)}; it was never part of any repository's work`);
  return destination;
}

function link(path, target) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

function checkout(context, repository, path, commit) {
  const { git } = context;
  const source = projectionObjectSources(context, repository).find((candidate) =>
    git(["--git-dir", candidate, "cat-file", "-e", `${commit}^{commit}`], context.root)
      .status === 0);
  if (!source) return false;
  rmSync(path, { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  const cloned = git(["clone", "--quiet", "--shared", "--no-checkout", source, path],
    context.root);
  const ready = cloned.status === 0 &&
    git(["checkout", "--quiet", "--detach", commit], path).status === 0 &&
    git(["config", PROJECTION_MARKER, repository.id], path).status === 0 &&
    git(["config", PROJECTION_COMMIT, commit], path).status === 0;
  if (!ready) {
    rmSync(path, { recursive: true, force: true });
    mkdirSync(path, { recursive: true });
  }
  return ready;
}

function projectionDrift(git, path) {
  const projected = String(git(["config", "--get", PROJECTION_COMMIT], path).stdout || "").trim();
  const head = String(git(["rev-parse", "HEAD"], path).stdout || "").trim();
  const status = git(["status", "--porcelain"], path);
  const dirty = status.status !== 0 || Boolean(String(status.stdout || "").trim());
  return { projected, drifted: !projected || head !== projected || dirty };
}

function ours(git, path, repositoryId) {
  return String(git(["config", "--get", PROJECTION_MARKER], path).stdout || "").trim() ===
    repositoryId;
}

function driftRefusal(id, repository, path, commit) {
  return `repository '${repository.id}' is not selected by change '${id}', so its copy at '${
    path}' in the root sandbox is read-only: it holds the recorded commit ${
    String(commit).slice(0, 12)} for root code and tests to consume, and an edit or commit there would never Land. ` +
    `Revert that copy (git -C ${path} checkout --detach ${commit} && git -C ${path} reset --hard && git -C ${
      path} clean -fd), or select '${repository.id}' through a semantic amendment if the change must modify it`;
}

// Brings every projectable repository path of the root sandbox to the state
// described above. Idempotent and cheap when nothing moved, so lifecycle
// preparation and every root check run it. Returns what it did.
export function projectNestedRepositories(context, id, state) {
  const { git, fail } = context;
  const result = { linked: [], checkedOut: [], preserved: [], unavailable: [] };
  const workspace = projectionWorkspace(state);
  if (!workspace) return result;
  const selected = new Set(context.selectedIds || []);
  for (const repository of projectableRepositories(context.repositories)) {
    const rel = repository.relativePath;
    const path = join(workspace, rel);
    if (relative(workspace, resolve(workspace, rel)).startsWith("..")) continue;
    const gitlink = recordedGitlink(git, workspace, rel);
    const record = selected.has(repository.id) ? state.repositories?.[repository.id] : null;
    const sandbox = record?.path && existsSync(record.path) ? canonical(record.path) : null;
    // Selected, but its sandbox is created after the root one: leave the path
    // alone until it exists; the next pass links it.
    if (selected.has(repository.id) && !sandbox) continue;
    const current = entryState(path);
    if (sandbox) {
      if (current === "link" && canonical(resolve(dirname(path), readlinkSync(path))) === sandbox) {
        // Already the single source of truth.
      } else {
        if (current === "link" || current === "empty") rmSync(path, { recursive: true, force: true });
        else if (current === "repository" && ours(git, path, repository.id) &&
            !projectionDrift(git, path).drifted) rmSync(path, { recursive: true, force: true });
        else if (current !== "missing") result.preserved.push(preserve(context, id, workspace, rel));
        link(path, sandbox);
        result.linked.push(rel);
      }
    } else {
      const commit = gitlink?.commit ||
        (repository.type !== "submodule" ? context.gitHead(repository.path) : null);
      // A nested repository that is not a Git checkout has nothing to project.
      if (!commit) {
        if (repository.type === "submodule")
          result.unavailable.push({ repository: repository.id, path: rel, reason: "no recorded commit" });
        continue;
      }
      if (current === "repository" && ours(git, path, repository.id)) {
        const { projected, drifted } = projectionDrift(git, path);
        if (drifted) fail(driftRefusal(id, repository, path, projected || commit));
        if (projected !== commit &&
            !(git(["checkout", "--quiet", "--detach", commit], path).status === 0 &&
              git(["config", PROJECTION_COMMIT, commit], path).status === 0) &&
            !checkout(context, repository, path, commit)) {
          result.unavailable.push({ repository: repository.id, path: rel, reason: "commit not available locally" });
          continue;
        }
        if (projected !== commit) result.checkedOut.push(rel);
      } else {
        if (current === "link" || current === "empty") rmSync(path, { recursive: true, force: true });
        else if (current !== "missing") result.preserved.push(preserve(context, id, workspace, rel));
        if (!checkout(context, repository, path, commit)) {
          result.unavailable.push({ repository: repository.id, path: rel, reason: "commit not available locally" });
          continue;
        }
        result.checkedOut.push(rel);
      }
    }
    if (gitlink && !gitlink.skipWorktree)
      git(["update-index", "--skip-worktree", "--", rel], workspace);
  }
  for (const row of result.unavailable)
    context.log(`NOTICE: root sandbox path '${row.path}' of repository '${row.repository}' stays empty: ${
      row.reason}; select the repository or make its recorded commit available in a local clone`);
  return result;
}
