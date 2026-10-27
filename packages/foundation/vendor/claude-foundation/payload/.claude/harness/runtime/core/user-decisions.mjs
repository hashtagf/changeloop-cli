import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitSignal } from "./signals.mjs";

// Review is bounded by its rounds (full, then one delta), not by elapsed
// time: a shared wall-clock window also counted the agent's repair between
// rounds and reviewer retries, and asked the user about neither. Each
// dispatch still has its own timeout, which counts as an infrastructure
// failure when it expires.
export const REVIEW_DISPATCH_TIMEOUT_MS = 30 * 60 * 1000;

// Task write scope is agent-owned bookkeeping, like completion: readiness and
// apply repairs direct the agent to widen `[paths:]`, and Land still shows the
// user the real diff. Values may nest brackets (`app/[tenant]/**`), so the
// annotation ends at its balancing `]`.
function stripPathAnnotations(content) {
  let result = "";
  let from = 0;
  const lower = content.toLowerCase();
  while (true) {
    const start = lower.indexOf("[paths:", from);
    if (start === -1) return result + content.slice(from);
    let depth = 0;
    let end = -1;
    for (let i = start; i < content.length && end === -1; i += 1) {
      if (content[i] === "[") depth += 1;
      else if (content[i] === "]" && --depth === 0) end = i;
    }
    if (end === -1) return result + content.slice(from);
    result += content.slice(from, start).replace(/[ \t]+$/, "");
    from = end + 1;
  }
}

// Provider wiring (commands, timeouts, env, services) is evidence
// configuration: its change invalidates that provider's receipts, not consent.
// Which providers exist and every claim stay part of the agreement. Content
// that is not JSON keeps its full bytes, so an unreadable file never loosens
// consent.
function wiringBlindContent(name, content) {
  if (name !== "execution.yaml" && name !== "evidence.yaml") return content;
  let value;
  try { value = JSON.parse(content); } catch { return content; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return content;
  const names = (section) => section && typeof section === "object" && !Array.isArray(section)
    ? Object.keys(section).sort() : section;
  const reduced = { ...value };
  if ("providers" in reduced) reduced.providers = names(reduced.providers);
  if (name === "execution.yaml" && "services" in reduced) reduced.services = names(reduced.services);
  return JSON.stringify(reduced);
}

// Task completion and write scope are bookkeeping; editing task semantics
// still changes consent. `legacy` reproduces identities recorded before write
// scope became bookkeeping, and `wiring` those recorded before provider wiring
// became evidence configuration, so in-flight approvals survive an upgrade.
export function agreementIdentity(root, id, { legacy = false, wiring = legacy } = {}) {
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
        if (name === "tasks.md") {
          content = content.replace(/^(\s*-\s*)\[[ xX]\]/gm, "$1[ ]");
          if (!legacy) content = stripPathAnnotations(content);
        }
        if (!wiring) content = wiringBlindContent(name, content);
        hash.update(name).update("\0").update(content).update("\0");
      }
    }
  }
  if (!existsSync(base)) throw new Error(`Agreement is missing: ${id}`);
  visit(base);
  return hash.digest("hex");
}

export function approvalMatches(identity, root, id) {
  return Boolean(identity) && (identity === agreementIdentity(root, id) ||
    identity === agreementIdentity(root, id, { wiring: true }) ||
    identity === agreementIdentity(root, id, { legacy: true }));
}

export function userDecisionError(code, summary, options, recommended) {
  const error = new Error(summary);
  error.code = code;
  error.owner = "user";
  error.boundary = code.toLowerCase().replaceAll("_", "-");
  error.decision = { kind: error.boundary, summary, options, recommended };
  return error;
}

// A lane counts only for the current revision and the packet it was given on.
export function laneApproved(root, id, state, role) {
  const lane = state?.specApproval?.lanes?.[role];
  if (!lane?.identity || !lane.decisionRef) return false;
  if (Number(lane.revision) !== Number(state.contractRevision || 0)) return false;
  return approvalMatches(lane.identity, root, id) ||
    Boolean(state.workspace?.path && existsSync(join(state.workspace.path, "openspec", "changes", id)) &&
      approvalMatches(lane.identity, state.workspace.path, id));
}

export function missingApprovalLanes(root, id, state) {
  const required = Array.isArray(state?.specApproval?.requiredLanes) ? state.specApproval.requiredLanes : [];
  return required.filter((role) => !laneApproved(root, id, state, role));
}

export function assertSpecApproval(root, id, state, { workspace = true } = {}) {
  // Legacy primitive-created/in-flight agreements retain their compatibility route.
  if (!state.specApproval?.required || state.status === "archived") return;
  const hasWorkspaceAgreement = state.workspace?.path && state.workspace.path !== root &&
    existsSync(join(state.workspace.path, "openspec", "changes", id));
  const workspaceAgreement = workspace && hasWorkspaceAgreement;
  const revisionMatches = state.specApproval.revision === Number(state.contractRevision || 0);
  const approved = state.specApproval.identity;
  const rootApproved = approvalMatches(approved, root, id);
  // The same content under the current identity is the same consent, so a
  // pre-upgrade approval of the target also covers a bookkeeping-only sandbox.
  const workspaceApproved = hasWorkspaceAgreement &&
    (approvalMatches(approved, state.workspace.path, id) || rootApproved &&
      agreementIdentity(root, id) === agreementIdentity(state.workspace.path, id));
  if (revisionMatches && rootApproved && (!workspaceAgreement || workspaceApproved)) return;
  // A harness-owned semantic amendment is written to the isolated packet and
  // reaches the target only through Land. Its post-amendment approval therefore
  // has a legitimate workspace-only identity at the matching amendment revision.
  const currentAmendment = (state.amendments || []).some((entry) =>
    Number(entry?.revision) === Number(state.contractRevision || 0));
  if (revisionMatches && currentAmendment && workspaceApproved) return;
  // Without an amendment the target packet is canonical, so an isolated packet
  // that differs from it can never be approved: recording consent binds one
  // identity that cannot equal both. The harness restores it (whitespace in
  // place, any other edit saved aside for an amendment); only a restore that
  // cannot reproduce consent is agent repair, never a user decision.
  if (workspaceAgreement && !currentAmendment &&
      agreementIdentity(root, id) !== agreementIdentity(state.workspace.path, id)) {
    if (repairWhitespaceDrift(root, state.workspace.path, id))
      return assertSpecApproval(root, id, state, { workspace });
    const saved = restoreDriftedAgreement(root, state.workspace.path, id);
    if (saved) {
      emitSignal("agreement-restored", agreementRestoredNotice(id, saved));
      return assertSpecApproval(root, id, state, { workspace });
    }
    throw agreementDriftError(id, state.workspace.path);
  }
  // Role lanes: the whole approval exists only once every required lane has
  // approved this revision, so name the roles still missing.
  const missingLanes = state.specApproval.identity ? [] : missingApprovalLanes(root, id, state);
  if (missingLanes.length)
    throw userDecisionError("SPEC_APPROVAL_REQUIRED",
      `Approval lanes still needed before Build: ${missingLanes.join(", ")}. ` +
      "Ask each role to approve this exact spec.",
      [
        ...missingLanes.map((role) => ({
          id: `approve-${role}`, outcome: `Record the ${role} approval for this spec`,
          command: `claude-foundation advance ${id} --approve-spec --role ${role} --decision-ref <user-decision>`
        })),
        { id: "revise", outcome: "Revise the spec before implementation" }
      ], `approve-${missingLanes[0]}`);
  throw userDecisionError("SPEC_APPROVAL_REQUIRED",
    "Inspect the compiled spec with the user and obtain approval before Build.", [
      { id: "approve", outcome: "Approve this exact spec, then begin Build",
        command: `claude-foundation advance ${id} --approve-spec --decision-ref <user-decision> --through proven` },
      { id: "revise", outcome: "Revise the spec before implementation" }
    ], "approve");
}

// A harness-owned rewrite of evidence wiring (moving providers into
// execution.yaml) changes packet bytes but not the requirements, tasks, or
// acceptance the user approved. Consent valid before the rewrite therefore
// moves to the rewritten packet with an audit row, as an additive amendment's
// does. Consent already stale before the rewrite is never refreshed by it.
export function preserveSpecApprovalAcross(root, id, {
  loadRuntime, saveRuntime, now = () => new Date().toISOString()
}, rewrite, reason) {
  const before = loadRuntime(id);
  const approval = before.specApproval;
  let valid = Boolean(approval?.required && approval.identity && approval.decisionRef &&
    !before.pendingApprovalDelta);
  if (valid) {
    try { assertSpecApproval(root, id, before); } catch { valid = false; }
  }
  const workspace = before.workspace?.path && before.workspace.path !== root &&
    existsSync(join(before.workspace.path, "openspec", "changes", id))
    ? before.workspace.path : null;
  const packet = valid && workspace && !approvalMatches(approval.identity, root, id)
    ? workspace : root;
  const result = rewrite();
  if (!valid) return result;
  const state = loadRuntime(id);
  const identity = agreementIdentity(packet, id);
  if (!state.specApproval || identity === state.specApproval.identity) return result;
  const revision = Number(state.contractRevision || 0);
  const carriedAt = now();
  const { carriedFrom: _prior, ...consent } = state.specApproval;
  state.specApproval = { ...consent, identity,
    carriedFrom: { revision, reason, carriedAt } };
  state.approvalCarries = [...(state.approvalCarries || []), {
    fromRevision: revision, toRevision: revision, reason,
    delta: { added: [], revised: [], removed: [] }, carriedAt
  }];
  saveRuntime(state);
  return result;
}

function packetFiles(base, prefix = "") {
  const files = [];
  for (const entry of readdirSync(join(base, prefix), { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...packetFiles(base, `${name}/`));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

const CHECKBOX = /^(\s*-\s*)\[([ xX])\]/;
const squeeze = (text) => text.replace(/\s+/g, "");
const taskKey = (line) => squeeze(stripPathAnnotations(line.replace(CHECKBOX, "$1[ ]")));

// A formatter or editor pass over the isolated packet (trailing spaces, wrap,
// blank lines) changes bytes but no agreement text. The harness puts the
// target's bytes back itself, keeping checkbox and `[paths:]` bookkeeping, so
// whitespace never becomes agreement drift the agent must repair. Any other
// difference is left untouched and still reported.
export function repairWhitespaceDrift(root, workspacePath, id) {
  const target = join(root, "openspec", "changes", id);
  const isolated = join(workspacePath, "openspec", "changes", id);
  if (!existsSync(target) || !existsSync(isolated)) return false;
  const names = packetFiles(target);
  if (names.join("\0") !== packetFiles(isolated).join("\0")) return false;
  const writes = [];
  for (const name of names) {
    const want = readFileSync(join(target, name), "utf8");
    const have = readFileSync(join(isolated, name), "utf8");
    if (want === have) continue;
    if (name !== "tasks.md") {
      if (squeeze(want) !== squeeze(have)) return false;
      writes.push([name, want, have]);
      continue;
    }
    const wantLines = want.split("\n").filter((line) => line.trim());
    const haveLines = have.split("\n").filter((line) => line.trim());
    if (wantLines.length !== haveLines.length ||
        wantLines.some((line, index) => taskKey(line) !== taskKey(haveLines[index]))) return false;
    let index = 0;
    const merged = want.split("\n").map((line) => {
      if (!line.trim()) return line;
      const mine = haveLines[index++];
      if (stripPathAnnotations(mine) !== mine || stripPathAnnotations(line) !== line) return mine;
      const mark = CHECKBOX.exec(mine)?.[2];
      return mark ? line.replace(CHECKBOX, `$1[${mark}]`) : line;
    }).join("\n");
    writes.push([name, merged, have]);
  }
  if (!writes.length) return false;
  for (const [name, content] of writes) writeFileSync(join(isolated, name), content);
  if (agreementIdentity(root, id) === agreementIdentity(workspacePath, id)) return true;
  for (const [name, , original] of writes) writeFileSync(join(isolated, name), original);
  return false;
}

// An isolated packet edited outside a semantic amendment cannot be approved,
// and asking the agent to undo it cost a turn. The harness saves the edited
// packet, puts the approved text back (keeping checkbox and `[paths:]`
// bookkeeping), and returns where the edit was saved so the agent can turn a
// real change of intent into one amendment. Null when restoring could not
// reproduce the approved identity; nothing is changed then.
export function restoreDriftedAgreement(root, workspacePath, id, stamp = Date.now()) {
  const target = join(root, "openspec", "changes", id);
  const isolated = join(workspacePath, "openspec", "changes", id);
  if (!existsSync(target) || !existsSync(isolated)) return null;
  const saved = join(root, ".foundation", "agreement-drift", id, String(stamp));
  mkdirSync(saved, { recursive: true });
  cpSync(isolated, saved, { recursive: true });
  const wanted = new Set(packetFiles(target));
  for (const name of packetFiles(isolated)) if (!wanted.has(name)) rmSync(join(isolated, name), { force: true });
  for (const name of wanted) {
    let content = readFileSync(join(target, name), "utf8");
    const mine = join(isolated, name);
    if (name === "tasks.md" && existsSync(mine)) {
      const bookkeeping = new Map(readFileSync(mine, "utf8").split("\n")
        .filter((line) => CHECKBOX.test(line)).map((line) => [taskKey(line), line]));
      content = content.split("\n").map((line) =>
        CHECKBOX.test(line) && bookkeeping.has(taskKey(line)) ? bookkeeping.get(taskKey(line)) : line)
        .join("\n");
    }
    mkdirSync(join(mine, ".."), { recursive: true });
    writeFileSync(mine, content);
  }
  if (agreementIdentity(root, id) === agreementIdentity(workspacePath, id)) return saved;
  rmSync(isolated, { recursive: true, force: true });
  cpSync(saved, isolated, { recursive: true });
  rmSync(saved, { recursive: true, force: true });
  return null;
}

export function agreementRestoredNotice(id, saved) {
  return `NOTICE: the isolated agreement for '${id}' was edited outside a semantic amendment; ` +
    `the harness restored the approved text and saved the edit at ${saved}. If that edit ` +
    `changes intent, express it with 'claude-foundation change amend ${id} <amendment.json>'.`;
}

export function agreementDriftError(id, workspacePath) {
  const error = new Error(
    `isolated agreement for '${id}' at ${workspacePath}/openspec/changes/${id} was edited outside a ` +
    "semantic amendment and no longer matches the target packet. Checkbox and `[paths:]` " +
    "edits are bookkeeping; revert any other edit there and express semantic changes with " +
    `'claude-foundation change amend ${id} <amendment.json>'. See the edit with ` +
    `\`diff -r openspec/changes/${id} ${workspacePath}/openspec/changes/${id}\` from the project root. Never ask the user to copy agreement files.`);
  error.code = "AGREEMENT_DRIFT";
  error.owner = "agent";
  error.boundary = "agreement-drift";
  return error;
}

export function currentWaivers(state, workspaceHash) {
  return (state.waivers || []).filter((row) => !row.binding ||
    row.binding.workspaceHash === workspaceHash &&
    row.binding.contractRevision === Number(state.contractRevision || 0));
}
