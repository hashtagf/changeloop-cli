import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { compositeRepositorySelection } from "../core/repository-binding.mjs";
import { assessSandbox, sandboxDescriptors } from "./sandbox-preservation.mjs";

// Land used to decide `archived` from what its own records said had been
// applied. A record is not the target: a repository whose delivery record read
// `applied-uncommitted` while its checkout still sat at the base commit was
// archived, and archive then deleted the only copy of the work. This check reads
// the target itself, per selected repository, after apply and before anything
// is archived or removed.

export const LAND_PROJECTION_MISSING = "LAND_PROJECTION_MISSING";

function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

// An uninitialized submodule is an empty directory inside the superproject, so
// every Git command run there silently answers for the superproject instead.
export function targetBindingProblem(targetPath) {
  if (!targetPath) return "has no recorded target checkout";
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetPath, encoding: "utf8"
  });
  if (top.error || top.status !== 0)
    return `target '${targetPath}' is not a Git checkout`;
  if (canonical(top.stdout.trim()) !== canonical(targetPath))
    return `target '${targetPath}' is not its own Git repository (an uninitialized submodule resolves to its superproject '${top.stdout.trim()}')`;
  return null;
}

// `preflight` is the same check before Apply: a target binding, an
// uninspectable sandbox, or work in a placeholder already decides the outcome;
// only "not landed yet" waits for Apply.
export function landedProjectionFindings({ root, id, state, preflight = false }) {
  const findings = [];
  for (const descriptor of sandboxDescriptors(root, id, state)) {
    if (descriptor.access === "read") continue;
    if (descriptor.kind === "repository") {
      const binding = targetBindingProblem(descriptor.targetPath);
      if (binding) {
        findings.push({ repositoryId: descriptor.repositoryId, reason: "target-binding",
          detail: binding, paths: [] });
        continue;
      }
    }
    const assessment = assessSandbox(descriptor);
    if (!assessment.inspected) {
      findings.push({ repositoryId: descriptor.repositoryId, reason: "uninspectable",
        detail: assessment.error, paths: [] });
      continue;
    }
    if (assessment.absent) continue;
    if (assessment.placeholders.length)
      findings.push({ repositoryId: descriptor.repositoryId, reason: "placeholder",
        detail: "written into the shared sandbox's placeholder for a nested repository, which no repository projection reads",
        paths: assessment.placeholders });
    // A copy sandbox also carries the target's own pre-existing dirty files;
    // its root projection is bound by the apply journal instead.
    if (descriptor.kind === "shared" && descriptor.mode === "copy") continue;
    if (!preflight && assessment.unlanded.length)
      findings.push({ repositoryId: descriptor.repositoryId, reason: "not-landed",
        detail: "the proven sandbox content is not in the target checkout",
        paths: assessment.unlanded });
  }
  return findings;
}

export function landVerificationMessage(id, findings, { preflight = false } = {}) {
  const lines = findings.map((finding) => {
    const paths = finding.paths.slice(0, 10).join(", ");
    return `  ${finding.repositoryId}: ${finding.detail}${paths ? `: ${paths}${
      finding.paths.length > 10 ? ", ..." : ""}` : ""}`;
  });
  return (preflight ? "Land cannot deliver every selected repository; nothing was applied " +
    "or archived" : "Land did not deliver every selected repository; the change was not archived") +
    ` and no sandbox was removed:\n${lines.join("\n")}\n` +
    "Move work written into a shared-sandbox placeholder into that repository's sandbox " +
    "(.foundation/repository-sandboxes/<change>/<repository>), make the target checkout a " +
    "real repository where its binding is wrong, then resume with " +
    `'claude-foundation advance ${id} --through archived'.`;
}

// A declared nested repository's gitlink is that repository's own pointer, so
// the root projection never carries it. A pointer the root sandbox moved
// (committed or staged) therefore cannot land as root content, and Land leaves
// every target's HEAD and index unchanged, so it cannot land on its own either.
// Rows come from `git diff --cached --raw -z --no-abbrev <base> -- <paths>`; a
// removed or emptied gitlink is not a move (the shared sandbox keeps nested
// repositories as empty placeholders).
export function rootPointerMoves(raw) {
  const tokens = String(raw || "").split("\0");
  const moves = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const [modes, path] = [tokens[index], tokens[index + 1]];
    const [oldMode, newMode, from, to] = modes.replace(/^:/, "").split(" ");
    if (newMode !== "160000" || !path || from === to) continue;
    moves.push({ path, from: oldMode === "160000" ? from : null, to });
  }
  return moves;
}

export const REPOSITORY_POINTER_CHANGE = "repository-pointer-change";
export const ROOT_POINTER_MOVED = "ROOT_POINTER_MOVED";

// A moved pointer of a repository the change already selects is agent work:
// the commit belongs in that repository's sandbox, where Land and Deliver carry
// it, and the root pointer goes back to its base. No scope widens, so nobody is
// asked. Each move carries `repositoryId` and `sandboxPath`.
export function rootPointerRepairMessage({ changeId, rootSandbox, moves }) {
  const steps = moves.map((move) => {
    const restore = move.from
      ? `git update-index --cacheinfo 160000,${move.from},${move.path}`
      : `git rm --cached -q ${move.path}`;
    return `  ${move.path} (repository '${move.repositoryId}'): in ${move.sandboxPath} run ` +
      `'git merge --ff-only ${move.to}' (fetch ${move.to} into that repository first if it is ` +
      `missing, or bring its changes in another way), then in ${rootSandbox} run '${restore}'`;
  });
  return `the root sandbox moves the pointer of selected repository path(s); a pointer is ` +
    `never root content, and that repository's own sandbox carries its commits:\n${
      steps.join("\n")}\nThen resume with 'claude-foundation advance ${changeId} --through ` +
    "archived'; it proves what changed, lands the repository work, and '/deliver' sets the " +
    "root pointer to the delivered commit.";
}

export function repositoryPointerStop({ changeId, moves }) {
  const short = (commit) => commit ? commit.slice(0, 12) : "none";
  const listed = moves.map((move) => `${move.path} (${short(move.from)} -> ${short(move.to)})`)
    .join(", ");
  return {
    code: REPOSITORY_POINTER_CHANGE,
    decision: {
      kind: REPOSITORY_POINTER_CHANGE,
      summary: `the root sandbox of '${changeId}' moves the pointer of declared repository ` +
        `path(s) ${listed}. Land never commits or stages, so a pointer move cannot land as ` +
        "root content; it is not dropped silently.",
      paths: moves.map((move) => move.path),
      moves,
      options: [
        { id: "deliver-through-repository", outcome: "Land the pointer through its " +
          "repository: select that repository for this change (a semantic amendment that " +
          "widens its scope), bring the target commit into its repository sandbox " +
          "(.foundation/repository-sandboxes/<change>/<repository>), restore the root pointer " +
          `to its base, then 'claude-foundation advance ${changeId} --through archived'. ` +
          "'/deliver' sets the root pointer to the delivered repository commit." },
        { id: "restore-pointer", outcome: "Drop the pointer move: restore each listed path " +
          "to its base pointer in the root sandbox and land the remaining work with " +
          `'claude-foundation advance ${changeId} --through archived'.` },
        { id: "pause", outcome: "Change nothing and leave the sandbox and target as they are." }
      ],
      recommended: "deliver-through-repository"
    }
  };
}

// Composite selections only: a single-repository change is already bound by
// its apply journal's verified projection. The isolated runtime bindings are
// what this check reads, so they also decide whether it applies: an
// interrupted archive has already moved the packet the selection is read from.
export function assertLandedProjection({ root, id, state, fail, preflight = false }) {
  const bound = Object.keys(state?.repositories || {}).map((repositoryId) => ({ id: repositoryId }));
  if (!compositeRepositorySelection(bound)) return;
  const findings = landedProjectionFindings({ root, id, state, preflight });
  if (!findings.length) return;
  fail(landVerificationMessage(id, findings, { preflight }), 1, {
    owner: "agent", boundary: "land-verification", code: LAND_PROJECTION_MISSING
  });
}
