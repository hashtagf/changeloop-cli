// `git rev-parse HEAD` without a process, for the common layouts.
//
// The harness asks "what is HEAD here?" hundreds of times per lifecycle
// command (every changed-surface and readiness check), and each answer used to
// cost a git process: ~7 ms warm, and the same again for every repeat in a
// directory that is not a repository at all. Answering from the repository
// files is exact for the layouts below; anything else returns `undefined` and
// the caller asks git, so an unusual layout can never produce a wrong answer.
//
// Result: a 40/64-hex object name, `null` when git would report no HEAD (not a
// repository, or an unborn branch), or `undefined` when only git can answer.
import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// Environment that changes where git looks, so file discovery is not faithful.
const REDIRECTING_ENVIRONMENT = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES",
  "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE", "GIT_REPLACE_REF_BASE"
];

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function exists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

// Walks up like git's repository discovery. Returns the `.git` entry's
// directory, `null` when no repository encloses `start`, or `undefined` when a
// bare-repository-looking directory makes discovery ambiguous.
function discoverRepositoryRoot(start) {
  let directory = start;
  for (;;) {
    if (exists(join(directory, ".git"))) return directory;
    if (exists(join(directory, "HEAD")) && isDirectory(join(directory, "objects")))
      return undefined;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function gitDirectoryOf(root) {
  const dotGit = join(root, ".git");
  const entry = lstatSync(dotGit);
  // Git refuses repositories owned by someone else; leave that to git.
  if (typeof process.getuid === "function" && entry.uid !== process.getuid()) return undefined;
  if (entry.isDirectory()) return dotGit;
  if (!entry.isFile()) return undefined;
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit) || "");
  return match ? resolve(root, match[1]) : undefined;
}

function packedRef(commonDirectory, ref) {
  const packed = readText(join(commonDirectory, "packed-refs"));
  if (packed === null) return null;
  for (const line of packed.split("\n")) {
    if (!line || line[0] === "#" || line[0] === "^") continue;
    const separator = line.indexOf(" ");
    if (separator > 0 && line.slice(separator + 1).trim() === ref)
      return line.slice(0, separator);
  }
  return null;
}

function resolveReference(gitDirectory, commonDirectory, ref, depth = 0) {
  if (depth > 5 || !/^refs\/[^\0]+$/.test(ref) || ref.includes("..")) return undefined;
  for (const base of gitDirectory === commonDirectory
    ? [commonDirectory] : [gitDirectory, commonDirectory]) {
    const loose = readText(join(base, ref));
    if (loose === null) continue;
    const text = loose.trim();
    if (OBJECT_NAME.test(text)) return text;
    const symbolic = /^ref:\s*(.+)$/.exec(text);
    return symbolic ? resolveReference(gitDirectory, commonDirectory, symbolic[1].trim(), depth + 1)
      : undefined;
  }
  return packedRef(commonDirectory, ref);
}

export function resolveGitHead(cwd, env = process.env) {
  try {
    if (REDIRECTING_ENVIRONMENT.some((name) => env[name] !== undefined)) return undefined;
    const start = resolve(cwd);
    if (!isDirectory(start)) return undefined;
    const root = discoverRepositoryRoot(start);
    if (root === null) return null;
    if (root === undefined) return undefined;
    const gitDirectory = gitDirectoryOf(root);
    if (!gitDirectory) return undefined;
    const common = readText(join(gitDirectory, "commondir"));
    const commonDirectory = common ? resolve(gitDirectory, common.trim()) : gitDirectory;
    if (exists(join(commonDirectory, "reftable"))) return undefined;
    const head = readText(join(gitDirectory, "HEAD"));
    if (head === null) return undefined;
    const text = head.trim();
    if (OBJECT_NAME.test(text)) return text;
    const symbolic = /^ref:\s*(.+)$/.exec(text);
    if (!symbolic) return undefined;
    return resolveReference(gitDirectory, commonDirectory, symbolic[1].trim());
  } catch { return undefined; }
}

// True only when git would certainly report "not a git repository" for `cwd`:
// no `.git` in it or any ancestor and nothing bare-repository-shaped. A false
// answer means "ask git", never "there is a repository".
export function gitRepositoryAbsent(cwd, env = process.env) {
  try {
    if (REDIRECTING_ENVIRONMENT.some((name) => env[name] !== undefined)) return false;
    const start = resolve(cwd);
    return isDirectory(start) && discoverRepositoryRoot(start) === null;
  } catch { return false; }
}
