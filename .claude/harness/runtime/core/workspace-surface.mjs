// What counts as workspace surface, decided in one place.
//
// The rule used to be "drop any path with an excluded name in any segment".
// That reads as conservative and is not: `.workflow` names the harness's own
// legacy migration source *at the project root*, but a repository is free to
// commit a fixture directory of that name anywhere else — and one did. The
// segment match dropped it from the change surface and from the copy sandbox
// at once, so the file vanished from the hash and reappeared to git as a
// deletion the change never made.
//
// Depth alone cannot decide it either. `node_modules` legitimately nests in
// every monorepo, so root-only matching would pull an entire dependency tree
// into the hash. The axis that actually separates the two is what git already
// knows: generated output is untracked, and committed content is content — no
// matter what the directory is called.
//
// Pure by construction. Callers supply the exclusion set they own and whether
// git tracks the path; nothing here reads the filesystem.

// Names that identify the harness's own directories at the project root and
// carry no meaning below it. Excluded at depth 0 only.
export const ROOT_ONLY_EXCLUDED_DIRS = new Set([".foundation", ".workflow"]);

export function isExcludedPath(rel, { excluded, tracked = false }) {
  if (!rel) return false;
  const segments = rel.split("/");
  // `.git` is the one name a caller may legitimately want at the root and
  // never anywhere else, so the caller's set decides: the change surface
  // excludes it outright, while the copy sandbox omits it from the set in
  // order to carry the root repository and stay a git repository itself.
  if (excluded.has(".git") && segments.includes(".git")) return true;
  if (ROOT_ONLY_EXCLUDED_DIRS.has(segments[0])) return true;
  // Tracked content is content. Whatever it is called, someone committed it.
  if (tracked) return false;
  return segments.some((segment) =>
    segment !== ".git" &&
    !ROOT_ONLY_EXCLUDED_DIRS.has(segment) &&
    excluded.has(segment));
}

// What the change said it would touch, normalized once.
//
// A path git does not track and the change did not declare is not this
// change's surface. Treating it as surface is what let an untracked tree
// sitting in the working directory expire collected evidence — and, because
// the apply projection reads the same manifests, be projected as a deletion of
// files the change never named.
//
// The glob vocabulary is the one `[paths:]` already uses: a trailing `/**`,
// `/*` or `/` is a prefix, `*` alone is everything, anything else is an exact
// path or a directory prefix.
export function declaredPathMatcher(globs) {
  const scopes = [...new Set((globs || [])
    .map((glob) => String(glob).trim())
    .filter(Boolean))];
  if (scopes.includes("*")) return () => true;
  const prefixes = scopes.map((scope) =>
    scope.replace(/\/\*\*?$/, "").replace(/\/$/, ""));
  return (rel) => prefixes.some((prefix) =>
    rel === prefix || rel.startsWith(`${prefix}/`));
}

// The change packet: proposal, design, tasks, spec deltas, evidence contract.
//
// Named here rather than spelled inline because three callers must agree on it
// exactly — the sandbox pathspec below, the workspace walk, and the code hash
// that decides whether an executable provider's receipt survives an edit. A
// path one counts as packet and another counts as code is either a receipt
// expiring for a note in `design.md` or a real code edit reusing evidence.
export function isChangePacketPath(rel, changeId) {
  const base = `openspec/changes/${changeId}`;
  return rel === base || rel.startsWith(`${base}/`);
}

// The git pathspec separating a change's own code work from everything a
// sandbox carries but does not own: the packet (whose source of truth is the
// target), provider output, machine state, and nested repositories.
//
// Shared because two callers must agree on it exactly. `apply` projects the
// sandbox through this pathspec, and the worktree rebase replays the sandbox
// through it onto a moved target. A path one includes and the other excludes is
// either work silently dropped at Land or a teammate's file replayed as this
// change's own.
export function sandboxCodePathspec(changeId, submoduleRelativePaths = []) {
  return [
    ".",
    `:(exclude)openspec/changes/${changeId}/**`,
    ":(exclude)coverage/**", ":(exclude)test-results/**",
    ":(exclude)playwright-report/**", ":(exclude).foundation/**",
    ...submoduleRelativePaths.map((rel) => `:(exclude)${rel}`)
  ];
}

export function nestedRepositoryPathMatcher(relativePaths = []) {
  const roots = relativePaths
    .map((path) => String(path || "").replace(/\/$/, ""))
    .filter(Boolean);
  return (path) => roots.some((root) => path === root || path.startsWith(`${root}/`));
}

// Every ancestor directory of a tracked file is itself worth descending into,
// which a directory-level filter has to know before it reaches the file.
export function trackedPathSet(relativePaths) {
  const set = new Set();
  for (const path of relativePaths) {
    if (!path) continue;
    set.add(path);
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1)
      set.add(segments.slice(0, index).join("/"));
  }
  return set;
}
