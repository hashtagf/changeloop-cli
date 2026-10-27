import { gateDigest } from "../core/convergent-gate.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

// The recovery ladder: the owner repairs, then tries one materially different
// approach, then receives a bounded strategy change carrying every attempt and
// the output that kept repeating. Each rung is one unchanged round. Only a
// boundary the user owns (approval, Land, external side effect, product
// meaning, spend) becomes a question; repeated code, harness, or setup work
// stays with its owner.
export const ALTERNATE_AFTER_ROUNDS = 2;
export const ASK_AFTER_ROUNDS = 3;
export const STRATEGY_AFTER_ROUNDS = ASK_AFTER_ROUNDS;

// Boundaries only the user may cross.
export const USER_AUTHORITY_BOUNDARIES = new Set([
  "user-authority", "land-authority", "spec-approval", "approval",
  "external-side-effect", "product-decision", "product-meaning",
  "budget", "budget-no-progress", "spend"
]);

// Lifecycle primitives AGENT.md does not let the agent run. A route that names
// one is rewritten to the `advance` route that performs the same step.
const PRIMITIVE_COMMAND =
  /claude-foundation\s+(proof|land|sandbox|evidence)\s+(?:run|advance|execute|collect|finalize|check|apply|recover|archive|sync|create|copy-path|init|upgrade)\b[^'"`\n;]*/g;

function routeThrough(value) {
  return String(value?.resume || value?.resumeCommand || "")
    .match(/--through (build|proven|archived)/)?.[1] || null;
}

export function agentLifecycleRoute(id, family, through = null) {
  // Land authority is never inferred: only a route already headed to
  // `archived`, or one that names Land itself, may resume through archived.
  const target = family === "land" ? "archived"
    : family === "proof" ? (through === "archived" ? "archived" : "proven")
      : through;
  return `claude-foundation advance ${id}${target ? ` --through ${target}` : ""}`;
}

function routeText(id, through, input) {
  if (typeof input !== "string" || !input.includes("claude-foundation")) return input;
  return input.replace(PRIMITIVE_COMMAND, (match, family) =>
    agentLifecycleRoute(id, family, through));
}

// Every agent-facing route stays on the public `advance` surface.
export function agentSafeRoutes(value) {
  const id = value?.changeId;
  if (!id || typeof value !== "object") return value;
  const through = routeThrough(value);
  const route = (input) => routeText(id, through, input);
  const rows = (list, fields) => Array.isArray(list)
    ? list.map((row) => row && typeof row === "object"
      ? { ...row, ...Object.fromEntries(fields.filter((field) => typeof row[field] === "string")
        .map((field) => [field, route(row[field])])) } : row)
    : list;
  const next = { ...value };
  for (const field of ["command", "instruction", "reason"])
    if (typeof next[field] === "string") next[field] = route(next[field]);
  if (Array.isArray(next.instructions)) next.instructions = next.instructions.map(route);
  if (Array.isArray(next.next)) next.next = rows(next.next, ["command", "reason"]);
  if (next.decision && typeof next.decision === "object") next.decision = {
    ...next.decision,
    ...(typeof next.decision.summary === "string" ? { summary: route(next.decision.summary) } : {}),
    ...(Array.isArray(next.decision.options)
      ? { options: rows(next.decision.options, ["command", "outcome"]) } : {})
  };
  if (next.automaticRecovery?.command)
    next.automaticRecovery = { ...next.automaticRecovery, command: route(next.automaticRecovery.command) };
  if (next.wait?.checkCommand) next.wait = { ...next.wait, checkCommand: route(next.wait.checkCommand) };
  if (Array.isArray(next.recovery?.alternatives))
    next.recovery = { ...next.recovery, alternatives: next.recovery.alternatives.map(route) };
  return next;
}

// Causes only the user can clear. They go to the user on the first
// observation with the exact fix, instead of the agent resuming unchanged.
// `product: true` causes are recognized on every route; the others only on
// harness, setup, delivery, and reviewer infrastructure routes, never in
// product output. `category` is the typed boundary the cause belongs to:
// `resource` (disk), `credential` (login, token, registry or remote
// permission), or `network`. Typed error codes win; the patterns recognize the
// same causes in child-process output, which carries no code.
const USER_ENVIRONMENT_CAUSES = [
  { cause: "disk-full", category: "resource", codes: ["ENOSPC", "EDQUOT"], product: true,
    pattern: /\bENOSPC\b|no space left on device|disk quota exceeded/i,
    fix: "Free disk space on the volume that holds the repository and its .foundation sandboxes" },
  { cause: "reviewer-login", category: "credential", codes: [],
    pattern: /please run \/login|run `?claude \/login|\bnot logged in\b|oauth token (?:has )?expired|invalid api key/i,
    fix: "Run `claude /login` (or log the configured reviewer CLI in) on this machine" },
  { cause: "registry-auth", category: "credential", codes: ["E401"],
    pattern: /\bE401\b|ERR_PNPM_FETCH_40[13]|\bE403\b[^\n]*registry|registry[^\n]*\b(?:401|403)\b|unable to authenticate[^\n]*registry/i,
    fix: "Log in to the private package registry (for example `npm login --registry <url>`) or export its token in the environment" },
  { cause: "remote-permission", category: "credential", codes: [],
    pattern: /remote: Permission to \S+ denied|The requested URL returned error: 40[13]\b|Permission denied \(publickey\)|could not read Username for|fatal: Authentication failed for|\bHTTP 40[13]\b|Resource not accessible by (?:integration|personal access token)|\bgh auth login\b/i,
    fix: "Give this machine's Git or GitHub credential access to the named remote (for example `gh auth login` or a token with push rights)" },
  { cause: "credential", category: "credential", codes: [],
    pattern: /\b\w*(?:token|credentials?|api[ _-]?key|access[ _-]?key)\b[^.\n]{0,40}\b(?:expired|missing|invalid|revoked|not set)\b|\b(?:expired|revoked)\s+(?:token|credentials?)\b|\b401 Unauthorized\b|bad credentials|authentication failed/i,
    fix: "Renew or supply the named credential or token (log in again or export it in the environment)" },
  // A bare ETIMEDOUT is also how a local process timeout (spawn, setup,
  // reviewer) reports itself; only a socket timeout is a network cause.
  { cause: "network", category: "network", codes: ["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"],
    pattern: /\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED)\b|\b(?:connect|read|write) ETIMEDOUT\b|\bETIMEDOUT \S+:\d+|proxy authentication required|\b407 Proxy\b|tunneling socket could not be established|network is unreachable|could not resolve host|\bVPN\b/i,
    fix: "Connect the VPN or allow the network and proxy access the named host needs" }
];

// Routes whose output describes the product under change. A credential or
// network word in a failing product test is a product finding, not a cause
// only the user can clear.
const PRODUCT_ROUTES = new Set([
  "REPAIR_PROOF_RESULT", "EXECUTE_REPAIR_BATCH", "REPAIR_SYNC_CONFLICT",
  "RECONCILE_TARGET_EDITS", "REPAIR_BUILD_PLAN", "TRY_ALTERNATE_APPROACH",
  "REPAIR_APPLY_RECOVERY", "EXECUTE_TASK", "EXECUTE_TASK_GROUP"
]);

function observedText(value) {
  const parts = [value.reason, value.handoff?.log, value.details?.detail, value.details?.log,
    ...(value.requests || []).map((row) => row?.infrastructureError)];
  try { parts.push(JSON.stringify(value.details ?? null).slice(0, 4000)); } catch {}
  return parts.filter((part) => typeof part === "string").join("\n");
}

// The one classifier: typed codes first, then the known output signatures.
// `product` output only yields causes that can never be a product finding.
export function environmentCause({ codes = [], text = "", product = false } = {}) {
  const typed = codes.filter(Boolean).map(String);
  for (const row of USER_ENVIRONMENT_CAUSES)
    if ((!product || row.product) && typed.some((code) => row.codes.includes(code)))
      return { cause: row.cause, category: row.category, fix: row.fix };
  for (const row of USER_ENVIRONMENT_CAUSES)
    if ((!product || row.product) && row.pattern.test(String(text || "")))
      return { cause: row.cause, category: row.category, fix: row.fix };
  return null;
}

// Codes a thrown error carries itself or through its cause and details.
export function errorCodes(error) {
  return [error?.code, error?.cause?.code, error?.details?.code]
    .filter(Boolean).map(String);
}

export function userEnvironmentCause(value, codes = []) {
  if (!value || !["REPAIR", "WAIT"].includes(value.action)) return null;
  return environmentCause({
    codes: [...codes, value.errorCode, value.details?.code],
    text: observedText(value),
    product: PRODUCT_ROUTES.has(value.legacyAction)
  });
}

// A cause only the user can clear goes to the user now, with the fix and
// the resume route. Nothing is recorded: resuming after the fix re-runs the
// same route, and an uncleared cause is reported again the same way.
export function userEnvironmentAction(id, input, found) {
  // The agent repair the route carried (edit the workspace or foundation.json,
  // set a field) is not the fix and must not survive into the question.
  const { instruction, instructions, repairTarget, ...value } = input;
  const resumeCommand = value.resume || `claude-foundation advance ${id}`;
  const summary = `${found.fix}. Only the user can clear this (${found.cause}): ${value.reason}`;
  return { ...value, action: "ASK_USER", actor: "user", owner: "user",
    legacyAction: "USER_ENVIRONMENT_REQUIRED", boundary: "user-environment",
    reason: summary, command: resumeCommand,
    decision: { kind: "user-environment", cause: found.cause,
      ...(found.category ? { category: found.category } : {}), fix: found.fix, summary,
      options: [
        { id: "fixed", outcome: `${found.fix}; then the agent runs '${resumeCommand}'.`, command: resumeCommand },
        { id: "pause", outcome: "Keep all work and evidence and pause until the environment is fixed." }
      ], recommended: "fixed" },
    recovery: { type: "ASK_USER", statePreserved: true,
      alternatives: [found.fix, "pause with all work preserved"] }
  };
}

// Verify output carries durations and timestamps; identical failures must
// compare equal so a Build verify that keeps failing the same way is counted.
function stableOutput(value) {
  return String(value || "")
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, "<time>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds)\b/g, "<duration>")
    .replace(/\s+/g, " ").trim();
}

// Complete legacy diagnostic packets at the lifecycle boundary. Missing detail
// offers investigation, never a fabricated approval, waiver, or successful run.
export function actionableGuidance(input) {
  const value = agentSafeRoutes(input);
  if (value.action === "ASK_USER") {
    const supplied = value.decision || {};
    const options = [...new Map((Array.isArray(supplied.options) ? supplied.options : [])
      .filter((row) => text(row?.id) && text(row?.outcome))
      .map((row) => [row.id, row])).values()];
    if (!options.length) options.push(value.boundary === "land-authority"
      ? { id: "land", outcome: "Authorize applying and archiving this exact proven change." }
      : { id: "investigate", outcome: "Investigate the reported cause and choose a concrete repair before resuming." });
    if (!options.some((row) => row.id === "pause"))
      options.push({ id: "pause", outcome: "Preserve the work and pause until a decision is made." });
    if (options.length < 2)
      options.unshift({ id: "investigate", outcome: "Inspect the cause and available recovery before choosing." });
    return { ...value, decision: {
      ...supplied,
      kind: supplied.kind || (value.boundary === "land-authority" ? "land-authority" : "work-decision"),
      summary: supplied.summary || value.reason || "Choose how to continue the preserved work.",
      options,
      recommended: options.some((row) => row.id === supplied.recommended)
        ? supplied.recommended : options.find((row) => ["investigate", "retry"].includes(row.id))?.id || "pause"
    } };
  }
  if (value.action === "WAIT" || value.legacyAction === "PROOF_IN_PROGRESS") {
    const request = value.requests?.[0];
    const worker = value.wait?.workers?.[0];
    return { ...value, wait: {
      ...value.wait,
      owner: value.wait?.owner || request?.reviewer || request?.owner || worker?.owner || value.actor,
      condition: value.wait?.condition || value.reason || "The current operation finishes and its result becomes available.",
      checkCommand: value.wait?.checkCommand || value.command || value.resume,
      requestId: value.wait?.requestId || value.requestId || request?.requestId || null
    } };
  }
  if (value.action === "REPAIR" && !text(value.command) && !text(value.instruction))
    return { ...value, instruction: repairInstruction(value) };
  return value;
}

// Every REPAIR names what to change. Routes without an exact command describe
// the field or artifact that carries the fix; never "go read the source".
const REPAIR_INSTRUCTIONS = {
  REPAIR_PROOF_RESULT: "Fix the findings listed in next[] (and repairGraph when present) inside the Build workspace",
  EXECUTE_REPAIR_BATCH: "Apply the dependency-ordered repairGraph.nodes batch inside the Build workspace, touching only each node's paths",
  REPAIR_BUILD_PLAN: "Give every task in openspec/changes/<change>/tasks.md a stable ID (T001) and a [paths: ...] scope through a semantic amendment",
  REPAIR_REVIEW_INFRASTRUCTURE: "Repair or switch the configured reviewer named in requests[] (see its infrastructureError), then acknowledge its consumed attempts with `claude-foundation authority reset-infra <change> --decision-ref <user-decision>`",
  TRY_ALTERNATE_APPROACH: "Apply a materially different repair than attemptedStrategies[] inside the approved agreement",
  REPAIR_SYNC_CONFLICT: "Resolve the conflicting paths in details.conflicts inside the Build workspace to the intended result",
  NO_PROGRESS_BOUNDARY: "Change the input that keeps the operation idempotent (code, agreement, or evidence wiring)"
};

// The third unchanged round changes strategy instead of asking. The agent
// gets a bounded set of different approaches; a harness-owned route keeps its
// own step and is told not to repeat it unchanged.
function strategyChangeInstruction(value, owner, rounds) {
  const route = value.legacyAction || value.action;
  const last = text(value.instruction) || (text(value.command) ? `run \`${text(value.command)}\`` : "");
  const approaches = owner === "agent"
    ? "Choose exactly one approach not listed in attemptedStrategies[]: reproduce the failure " +
      "in isolation from repetition.output, revert the last repair and fix the cause at a " +
      "different layer, or correct the test or evidence wiring that reports it. Stay inside the " +
      "approved agreement and the task paths; a needed behavior change is one semantic amendment."
    : "Do not rerun the same step unchanged: run its command, read repetition.output, and fix " +
      "what it reports in the workspace, the declared setup in foundation.json, or the sandbox.";
  return `${route} returned the same result ${rounds} times without progress.` +
    `${last ? ` The last route was: ${last}.` : ""} ${approaches} Then run the resume command; ` +
    "repetition.rounds keeps counting until the delivery state changes.";
}

function repetitionEvidence(value, attempt) {
  return {
    rounds: attempt.count,
    firstObservedAt: attempt.firstObservedAt || attempt.observedAt,
    lastObservedAt: attempt.observedAt,
    output: String(value.reason || "").slice(0, 2000),
    ...(value.details ? { details: boundedJson(value.details) } : {}),
    ...(value.verificationFailures?.length ? {
      verification: value.verificationFailures.slice(0, 8).map((row) => ({
        taskId: row.taskId || null, command: row.command || null,
        exitCode: row.exitCode ?? null, output: String(row.output || "").slice(-1000)
      }))
    } : {})
  };
}

function boundedJson(value) {
  try {
    const encoded = JSON.stringify(value);
    return encoded.length <= 4000 ? value : encoded.slice(0, 4000);
  } catch { return null; }
}

function repairInstruction(value) {
  const base = REPAIR_INSTRUCTIONS[value.legacyAction] ||
    `Fix the reported cause${value.repairTarget?.field ? ` in '${value.repairTarget.field}'` : ""}`;
  const commands = (Array.isArray(value.next) ? value.next : [])
    .map((row) => text(row?.command)).filter(Boolean).slice(0, 3);
  const cause = text(value.reason) ? `: ${value.reason}` : "";
  return `${base}${cause}${commands.length ? `. Listed commands: ${commands.join("; ")}` : ""}` +
    ". Then run the resume command.";
}

// Interrupted-apply resolutions the harness may apply without asking: neither
// overwrites content Land did not write itself.
const AUTOMATIC_APPLY_RESOLUTIONS = new Set(["settle", "keep-current"]);

export function automaticRecoveryAction(id, decision) {
  // Only typed, known recovery routes can execute. Never execute a command
  // extracted from reviewer text, exception messages, or arbitrary options.
  if (["apply-pending-recovery", "manual-recovery"].includes(decision?.kind) &&
      AUTOMATIC_APPLY_RESOLUTIONS.has(decision.automaticRecovery))
    return {
      kind: "apply-recovery",
      resolution: decision.automaticRecovery,
      command: `claude-foundation advance ${id} --through archived`,
      reason: decision.summary,
      divergentPaths: Array.isArray(decision.divergentPaths) ? decision.divergentPaths : []
    };
  // Target edits Land would overwrite are kept; the agent carries them into
  // the sandbox. Not a harness execution, so no command runs here.
  if (decision?.kind === "target-edit-conflict" && decision.automaticRecovery === "keep-target")
    return {
      kind: "reconcile-target-edits",
      command: `claude-foundation advance ${id} --through archived`,
      reason: decision.summary,
      paths: Array.isArray(decision.paths) ? decision.paths : []
    };
  // Out-of-band delivery drift is the same moved target with an observation
  // attached, and a target kept during manual recovery is the same moved
  // content, as is another change's landed but uncommitted diff: the contract
  // is still sync, re-prove if invalidated, continue. So is a user's target
  // edit on other lines than the change, which the sync merges into the sandbox.
  if (!["control-head-moved", "out-of-band-delivery-drift", "recovery-sync-required",
    "landed-change-sync", "target-edit-sync"].includes(decision?.kind) ||
      decision.automaticRecovery !== "sync") return null;
  return {
    kind: "sandbox-sync",
    command: `claude-foundation sandbox sync ${id}`,
    reason: decision.summary
  };
}

export function currentDeliveryProof({ proofAudit, relevantHash, requiredProviders,
  receiptValidity, receiptPath, fileDigest }, id) {
  const audit = proofAudit(id, true);
  if (!audit.valid) return false;
  const hash = relevantHash(id, null, true);
  if (audit.proof.workspaceHash !== hash) return false;
  return requiredProviders(id).every((provider) => {
    if (receiptValidity(id, provider, hash).validity !== "valid") return false;
    const manifest = audit.proof.receipts.find((row) => row.provider === provider);
    return manifest && manifest.sha256 === fileDigest(receiptPath(id, provider));
  });
}

export function recoveryBoundaryKey(value) {
  // Diagnostic prose can contain timestamps, attempt counters or transport
  // details. It describes an observation, not a new recovery boundary.
  return gateDigest({
    action: value.action, route: value.legacyAction || null,
    boundary: value.boundary || null,
    decision: value.decision?.kind || null,
    command: value.command || null,
    ...(value.action === "EDIT" && value.verificationFailures?.length ? {
      verification: value.verificationFailures.map((row) => ({
        task: row.taskId || null, command: row.command || null, exitCode: row.exitCode ?? null,
        output: stableOutput(row.output)
      }))
    } : {}),
    ...(value.action === "WAIT" ? { wait: {
      owner: value.wait?.owner || null,
      condition: value.wait?.condition || null,
      checkCommand: value.wait?.checkCommand || null
    } } : {}),
    requests: (value.requests || []).map((row) => ({
      id: row.requestId, status: row.status
    }))
  });
}

// Decisions `advance` records and resumes itself. Their options are answered
// through the advance decision route, never the primitive the raising module
// would otherwise name (`proof advance --retry-indeterminate`,
// `sandbox sync --resolve`).
export const ADVANCE_DECISIONS = {
  "indeterminate-execution": {
    legacyAction: "DECIDE_INDETERMINATE_EXECUTION", boundary: "external-side-effect"
  },
  "amended-agreement-conflict": {
    legacyAction: "RESOLVE_AGREEMENT_CONFLICT", boundary: "amended-agreement-conflict"
  }
};

// A proof gate's no-progress decision whose options carry no command of their
// own is answered through `advance` too, with every option the gate offered.
// A gate option with its own command (one-more-ai-attempt's grant) stays as
// the gate wrote it.
export function proofGateDecision(decision) {
  if (decision?.kind !== "repair-no-progress" || decision.fingerprint ||
      !Array.isArray(decision.options) || !decision.options.length ||
      decision.options.some((row) => row?.command)) return null;
  return { legacyAction: "NO_PROGRESS_BOUNDARY", boundary: "repeated-no-progress" };
}

const decisionCommand = (id, option, fingerprint) =>
  `claude-foundation advance ${id} --decision ${option} --decision-fingerprint ${fingerprint} ` +
  "--decision-ref <user-answer> --reason <chosen-approach>";

export function createAdvanceRecovery({ loadRuntime, saveRuntime, subject, now = () => new Date().toISOString() }) {
  function read(id, state = loadRuntime(id)) {
    const binding = subject(id);
    const current = state.advanceRecovery;
    const record = current?.version === 1 && current.subject === binding
      ? current : { version: 1, subject: binding, attempts: [], answers: current?.answers || [] };
    return { state, binding, record };
  }

  function save(state, record) {
    state.advanceRecovery = record;
    saveRuntime(state);
  }

  const strategies = (record) => record.attempts.slice(-8).map(({ action, reason, command, count }) =>
    ({ action, reason, command, observations: count }));

  function decision(id, value, record, attempt = null, kind = "repair-no-progress", summary = null) {
    const key = kind === "repair-no-progress" ? recoveryBoundaryKey(value) : kind;
    const fingerprint = gateDigest({ subject: record.subject, key, kind });
    const options = [
      { id: "retry", outcome: "Choose a different repair strategy or explain what changed, then retry within the existing scope." },
      { id: "pause", outcome: "Keep all work and evidence and pause this delivery attempt." }
    ].map((row) => ({ ...row, command: decisionCommand(id, row.id, fingerprint) }));
    return {
      kind, fingerprint,
      summary: summary || `Recovery has not changed the delivery state: ${value.reason}`,
      options, recommended: "retry",
      attemptedStrategies: strategies(record),
      // The evidence of repetition the user decides on: how many unchanged
      // rounds, since when, and the output that kept repeating.
      ...(attempt ? { repetition: repetitionEvidence(value, attempt) } : {}),
      wait: null
    };
  }

  function typedDecision(id, value, record, kind) {
    const supplied = value.decision;
    const key = gateDigest({ typed: kind, summary: supplied.summary || value.reason || null });
    const fingerprint = gateDigest({ subject: record.subject, key, kind });
    const options = (Array.isArray(supplied.options) ? supplied.options : [])
      .filter((row) => text(row?.id) && text(row?.outcome))
      .map((row) => ({ id: row.id, outcome: row.outcome }));
    if (!options.some((row) => row.id === "pause"))
      options.push({ id: "pause", outcome: "Preserve the work and pause until a decision is made." });
    return { key, decision: {
      ...supplied, kind, fingerprint,
      summary: supplied.summary || value.reason,
      options: options.map((row) => ({ ...row, command: decisionCommand(id, row.id, fingerprint) })),
      recommended: options.some((row) => row.id === supplied.recommended)
        ? supplied.recommended : options[0].id
    } };
  }

  function ask(value, pending) {
    return { ...value, action: "ASK_USER", actor: "user", owner: "user",
      legacyAction: pending.legacyAction || "NO_PROGRESS_BOUNDARY",
      boundary: pending.boundary || "repeated-no-progress",
      reason: pending.decision.summary, decision: pending.decision,
      recovery: { type: "ASK_USER", statePreserved: true,
        alternatives: pending.decision.options.map((row) => row.outcome) }
    };
  }

  // Budget windows auto-continue, but not forever without progress: the
  // record is bound to the delivery subject (content and lifecycle), so any
  // progress starts a new baseline; unchanged reopening reaches the user.
  function budgetBoundary(id, value, state, record) {
    if (!state.budget) return null;
    const reopened = Number(state.budget.autoContinuation?.count || 0);
    if (record.budgetBaseline === undefined) {
      record.budgetBaseline = reopened;
      save(state, record);
      return null;
    }
    const rounds = reopened - Number(record.budgetBaseline);
    if (rounds < ASK_AFTER_ROUNDS) return null;
    const pending = record.pending?.key === "budget-no-progress" ? record.pending : {
      key: "budget-no-progress", budgetCount: reopened, through: routeThrough(value),
      boundary: "budget-no-progress",
      decision: { ...decision(id, value, record, null, "budget-no-progress",
        `The budget window reopened ${rounds} times without delivery progress: ${value.reason || value.action}`),
      repetition: { rounds, windows: reopened, baseline: Number(record.budgetBaseline),
        lastReopenedAt: state.budget.autoContinuation?.at || null } }
    };
    record.pending = pending;
    save(state, record);
    return ask(value, pending);
  }

  function observe(id, value, { force = false } = {}) {
    const { state, record } = read(id);
    if (value.action === "DONE") {
      if (state.advanceRecovery) save(state, { ...record, attempts: [], pending: null });
      return value;
    }
    const typed = value.action === "ASK_USER" &&
      (ADVANCE_DECISIONS[value.decision?.kind] || proofGateDecision(value.decision));
    if (typed) {
      const built = typedDecision(id, value, record, value.decision.kind);
      const pending = record.pending?.key === built.key ? record.pending : {
        key: built.key, decision: built.decision, through: routeThrough(value), ...typed
      };
      record.pending = pending;
      save(state, record);
      const asked = ask(value, pending);
      // The gate's own resume route (`packet`) records nothing; the answer does.
      return proofGateDecision(value.decision) ? { ...asked, next: [] } : asked;
    }
    const environment = userEnvironmentCause(value);
    if (environment) return userEnvironmentAction(id, value, environment);
    const budget = budgetBoundary(id, value, state, record);
    if (budget) return budget;
    // Only repeated repair, or a Build verify that keeps failing the same
    // way, can become a question. Waiting on a named external owner is the
    // default: the WAIT already carries the owner, condition, and resume route.
    const counted = value.action === "REPAIR" ||
      (value.action === "EDIT" && value.verificationFailures?.length > 0);
    if (!counted) return value;
    const key = recoveryBoundaryKey(value);
    const prior = record.attempts.find((row) => row.key === key);
    const observedAt = now();
    const attempt = {
      key, action: value.action, reason: value.reason, command: value.command || null,
      count: (prior?.count || 0) + 1, observedAt,
      firstObservedAt: prior?.firstObservedAt || prior?.observedAt || observedAt,
      ...(prior?.alternateRequested ? { alternateRequested: prior.alternateRequested } : {})
    };
    record.attempts = [...record.attempts.filter((row) => row.key !== key), attempt].slice(-16);
    // Before asking, the agent gets one turn to try a materially different
    // repair inside the approved agreement. Recorded so it happens once per key.
    if (!force && attempt.count >= ALTERNATE_AFTER_ROUNDS && !attempt.alternateRequested) {
      attempt.alternateRequested = now();
      save(state, record);
      return { ...value, action: "REPAIR", actor: "agent", owner: "agent",
        legacyAction: "TRY_ALTERNATE_APPROACH", boundary: "alternate-approach",
        reason: `The same ${value.action === "EDIT" ? "verify failure" : "repair"} returned ${
          attempt.count} times without progress: ${value.reason}. ` +
          "Try a materially different approach inside the approved agreement, then resume.",
        instruction: repairInstruction({ legacyAction: "TRY_ALTERNATE_APPROACH", reason: value.reason }),
        attemptedStrategies: strategies(record),
        recoveryType: "EDIT"
      };
    }
    if (force || attempt.count >= STRATEGY_AFTER_ROUNDS) {
      // A user-owned boundary is the user's to cross; everything else is
      // repaired by its owner with a changed strategy and is never asked.
      if (USER_AUTHORITY_BOUNDARIES.has(value.boundary)) {
        const pending = record.pending?.key === key ? record.pending : {
          key, decision: decision(id, value, record, attempt), through: routeThrough(value),
          legacyAction: "NO_PROGRESS_BOUNDARY", boundary: value.boundary
        };
        record.pending = pending;
        save(state, record);
        return ask(value, pending);
      }
      save(state, record);
      return strategyChange(value, record, attempt);
    }
    save(state, record);
    return value;
  }

  // Owner-preserving: the agent keeps code work; a harness, operator, or
  // reviewer-infrastructure route stays harness-owned with its own command
  // and automatic recovery, so the harness keeps automating it.
  function strategyChange(value, record, attempt) {
    const declared = value.owner || value.actor;
    const owner = declared && !["agent", "user"].includes(declared) ? "harness" : "agent";
    const { command: _command, ...agentValue } = value;
    const recoveryType = owner === "agent" ? "EDIT" : "HANDOFF";
    return { ...(owner === "harness" ? value : agentValue), action: "REPAIR", actor: owner, owner,
      legacyAction: "NO_PROGRESS_BOUNDARY", boundary: "repeated-no-progress",
      repeatedAction: value.legacyAction || value.action,
      reason: `The same ${value.action === "EDIT" ? "verify failure" : "repair"} returned ${
        attempt.count} times without progress: ${value.reason}`,
      instruction: strategyChangeInstruction(value, owner, attempt.count),
      attemptedStrategies: strategies(record),
      repetition: repetitionEvidence(value, attempt),
      recoveryType,
      recovery: { type: recoveryType, statePreserved: true,
        alternatives: ["change strategy using repetition and attemptedStrategies, then resume"] }
    };
  }

  function pending(id) {
    const state = loadRuntime(id);
    // A fresh/legacy runtime has nothing to validate. Hashing it here would
    // require complete repository bindings before Build can repair them.
    if (!state.advanceRecovery?.pending) return null;
    const { record } = read(id, state);
    // An unanswered repetition question recorded before repeated repair
    // stopped asking carries no user boundary and no longer holds delivery.
    // Typed, budget, and user-authority questions record their boundary.
    const current = record.pending;
    if (current && !current.paused && !current.boundary && !current.legacyAction) return null;
    return current || null;
  }

  function resolve(id, flags) {
    const { state, record } = read(id);
    const current = record.pending;
    const choice = text(flags.decision);
    const reference = text(flags["decision-ref"]);
    const reason = text(flags.reason);
    const previous = record.answers.find((row) => row.reference === reference);
    if (previous) {
      if (previous.subject === record.subject && previous.fingerprint === flags["decision-fingerprint"] &&
          previous.choice === choice && previous.reason === reason)
        return { choice, through: previous.through, kind: previous.kind || null, reference };
      throw new Error("This decision reference already records a different or stale recovery answer.");
    }
    if (!current || flags["decision-fingerprint"] !== current.decision.fingerprint)
      throw new Error("Recovery decision is stale or absent; inspect the current action before recording an answer.");
    if (!reference || !reason) throw new Error("Recovery decisions require an explicit user decision-ref and reason.");
    if (reference.length > 160 || reason.length > 2000)
      throw new Error("Recovery decision references are limited to 160 characters and reasons to 2000 characters.");
    if (!current.decision.options.some((row) => row.id === choice))
      throw new Error("Recovery choice is not offered by the current decision.");
    const kind = current.decision.kind || null;
    record.answers.push({ subject: record.subject, key: current.key,
      fingerprint: current.decision.fingerprint, choice, reference, reason, kind,
      through: current.through, recordedAt: now() });
    if (choice !== "pause") {
      record.attempts = record.attempts.filter((row) => row.key !== current.key);
      // A user who continues past repeated budget windows starts a new count.
      if (kind === "budget-no-progress") record.budgetBaseline = current.budgetCount;
      record.pending = null;
    } else record.pending.paused = true;
    save(state, record);
    return { choice, through: current.through, kind, reference };
  }

  return { observe, pending, resolve };
}

// Harness-owned automatic operations `advance` performs instead of handing the
// agent a primitive command. Inputs are typed harness output only: a reviewer
// command must be the exact harness-generated `authority run` route, with no
// placeholder the host would have to fill in (those stay a handoff).
const REVIEW_RUN_FLAGS = new Set([
  "request", "reviewer", "subject-actor", "subject-session",
  "subject-provider-family", "subject-model-family", "subject-model"
]);

export function automaticReviewRun(id, commandText) {
  const tokens = String(commandText || "").trim().split(/\s+/);
  if (tokens[0] !== "claude-foundation" || tokens[1] !== "authority" ||
      tokens[2] !== "run" || tokens[3] !== id || (tokens.length - 4) % 2 !== 0) return null;
  const flags = {};
  for (let index = 4; index < tokens.length; index += 2) {
    const flag = tokens[index].startsWith("--") ? tokens[index].slice(2) : null;
    const value = tokens[index + 1];
    if (!flag || !REVIEW_RUN_FLAGS.has(flag) || Object.hasOwn(flags, flag) ||
        value.startsWith("--") || /[<>'"`$;&|\\(){}]/.test(value)) return null;
    flags[flag] = value;
  }
  return flags.request && flags["subject-actor"] ? flags : null;
}

// Missing provider wiring that the project already owns a safe command for is
// a write to execution.yaml, not a user decision. Only detection-recommended
// candidates qualify; anything else remains the external-evidence question.
export function automaticEvidenceWiring(id, preflight) {
  if (preflight?.status !== "NEEDS_USER_DECISION") return null;
  if (preflight.authorityPreflight && preflight.authorityPreflight.status !== "READY") return null;
  const providers = [...new Set((preflight.next || [])
    .filter((row) => row?.wiring?.kind === "configure-provider" && row.provider)
    .map((row) => row.provider))].sort();
  if (!providers.length) return null;
  return {
    kind: "evidence-wiring",
    providers,
    command: `claude-foundation evidence init ${id} --write`
  };
}
