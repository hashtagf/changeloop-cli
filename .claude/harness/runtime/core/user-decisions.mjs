import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REVIEW_WINDOW_MS = 30 * 60 * 1000;

// Task completion is bookkeeping; editing task semantics still changes consent.
export function agreementIdentity(root, id) {
  const base = join(root, "openspec", "changes", id);
  const hash = createHash("sha256");
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Agreement symlink is not supported: ${name}`);
      if (entry.isDirectory()) visit(join(directory, entry.name), `${name}/`);
      else {
        let content = readFileSync(join(directory, entry.name), "utf8");
        if (name === "tasks.md") content = content.replace(/^(\s*-\s*)\[[ xX]\]/gm, "$1[ ]");
        hash.update(name).update("\0").update(content).update("\0");
      }
    }
  }
  if (!existsSync(base)) throw new Error(`Agreement is missing: ${id}`);
  visit(base);
  return hash.digest("hex");
}

export function userDecisionError(code, summary, options, recommended) {
  const error = new Error(summary);
  error.code = code;
  error.owner = "user";
  error.boundary = code.toLowerCase().replaceAll("_", "-");
  error.decision = { kind: error.boundary, summary, options, recommended };
  return error;
}

export function assertSpecApproval(root, id, state, { workspace = true } = {}) {
  // Legacy primitive-created/in-flight agreements retain their compatibility route.
  if (!state.specApproval?.required || state.status === "archived") return;
  if (state.specApproval.identity === agreementIdentity(root, id) &&
      state.specApproval.revision === Number(state.contractRevision || 0) &&
      (!workspace || !state.workspace?.path || state.workspace.path === root ||
       !existsSync(join(state.workspace.path, "openspec", "changes", id)) ||
       state.specApproval.identity === agreementIdentity(state.workspace.path, id))) return;
  throw userDecisionError("SPEC_APPROVAL_REQUIRED",
    "Inspect the compiled spec with the user and obtain approval before Build.", [
      { id: "approve", outcome: "Approve this exact spec, then begin Build",
        command: `claude-foundation change resolve ${id} --approve-spec --decision-ref <user-decision>` },
      { id: "revise", outcome: "Revise the spec before implementation" }
    ], "approve");
}

export function reviewWindowRemaining(state, timestamp = Date.now()) {
  const window = state.reviewWindow;
  if (!window) return REVIEW_WINDOW_MS;
  const deadline = Date.parse(window.deadline);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.min(REVIEW_WINDOW_MS, deadline - timestamp));
}

export function reviewWindowError(id) {
  return userDecisionError("REVIEW_TIME_EXHAUSTED",
    "The shared 30-minute review window has ended. Report completed findings and unreviewed scope; no passing verdict is implied.", [
      { id: "continue", outcome: "Authorize another 30-minute review window",
        command: `claude-foundation change resolve ${id} --continue-review --decision-ref <user-decision>` },
      { id: "land", outcome: "Accept the remaining review risk explicitly and Land the current diff",
        command: `claude-foundation change waive ${id} --capability review --reason <remaining-risk> --decision-ref <user-decision>` },
      { id: "pause", outcome: "Preserve the work and pause" }
    ], "continue");
}

export function currentWaivers(state, workspaceHash) {
  return (state.waivers || []).filter((row) => !row.binding ||
    row.binding.workspaceHash === workspaceHash &&
    row.binding.contractRevision === Number(state.contractRevision || 0));
}
