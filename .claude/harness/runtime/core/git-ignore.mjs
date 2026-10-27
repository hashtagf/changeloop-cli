import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

// Git-ignored files are not part of any change, decided in one place.
//
// A tool that rewrites an ignored file on every run (a counter, a cache, a
// local log) made Land compare it, project it, and report it as unlanded work
// wherever a comparison walked the filesystem instead of asking Git: a copy
// sandbox of a checkout whose `.git` is a file, and the shared sandbox's empty
// placeholder for a nested repository. Every such site asks here, against the
// repository whose rules govern the path, so each repository's own
// `.gitignore`, `.git/info/exclude`, and `core.excludesFile` apply.
//
// `git check-ignore` consults the index, so a tracked file is never reported
// even when it also matches an ignore pattern: tracked content stays compared.
// An unanswerable question (no repository, Git failure) answers "nothing is
// ignored", which keeps every path compared exactly as before.

const MAX_BUFFER = 64 * 1024 * 1024;

function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

// Gitlinks of `repositoryPath`. A path inside a submodule makes
// `check-ignore` refuse the whole batch, and the superproject's rules never
// govern it anyway, so such paths are never asked about here.
function gitlinkPaths(repositoryPath, spawn) {
  const listed = spawn("git", ["ls-files", "-z", "--stage"], {
    cwd: repositoryPath, encoding: "utf8", maxBuffer: MAX_BUFFER
  });
  if (listed.error || listed.status !== 0) return [];
  return String(listed.stdout).split("\0")
    .map((record) => record.match(/^160000 [0-9a-f]+ \d+\t(.+)$/)?.[1])
    .filter(Boolean);
}

// The subset of `paths` (relative to `repositoryPath`) that the repository's
// ignore rules exclude. With `ownRepository`, the directory must be the top
// level of its own repository: an uninitialized submodule would otherwise
// answer with its superproject's rules.
export function gitIgnoredPaths(repositoryPath, paths, {
  spawn = spawnSync, ownRepository = false
} = {}) {
  const candidates = [...new Set((paths || []).map((path) =>
    String(path || "").replaceAll("\\", "/").replace(/^\.\//, "")).filter(Boolean))];
  if (!repositoryPath || !candidates.length) return new Set();
  if (ownRepository) {
    const top = spawn("git", ["rev-parse", "--show-toplevel"], {
      cwd: repositoryPath, encoding: "utf8"
    });
    if (top.error || top.status !== 0 ||
        canonical(String(top.stdout).trim()) !== canonical(repositoryPath)) return new Set();
  }
  const gitlinks = gitlinkPaths(repositoryPath, spawn);
  const asked = candidates.filter((path) => !gitlinks.some((link) =>
    path === link || path.startsWith(`${link}/`)));
  if (!asked.length) return new Set();
  const result = spawn("git", ["check-ignore", "-z", "--stdin"], {
    cwd: repositoryPath, input: `${asked.join("\0")}\0`, encoding: "utf8",
    maxBuffer: MAX_BUFFER
  });
  // Exit 1 means "none ignored"; anything else is an unanswered question.
  if (result.error || ![0, 1].includes(result.status)) return new Set();
  return new Set(String(result.stdout).split("\0").filter(Boolean));
}

export function withoutGitIgnored(repositoryPath, paths, options = {}) {
  const ignored = gitIgnoredPaths(repositoryPath, paths, options);
  return ignored.size ? paths.filter((path) => !ignored.has(path)) : paths;
}
