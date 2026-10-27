import { currentWaivers } from "../core/user-decisions.mjs";
import { repairActionForWorkspace } from "../evidence/repair-runtime.mjs";
import { behaviorChangingWork } from "../evidence/test-discrimination.mjs";
import { changeWorkTypes } from "./task-change.mjs";
import { proofCursorToken } from "../evidence/proof-execution-runtime.mjs";
import { isProcessAlive } from "../core/process-lock.mjs";
import { shellDisplayArgument } from "../core/shell-mutation-policy.mjs";
import { pathInside } from "../core/process-runtime.mjs";
import { drainSignals, recordSignal } from "../core/signals.mjs";
import {
  lifecycleOutcome, lifecycleUserProjection, lifecycleUserState
} from "../core/lifecycle-outcome.mjs";
import {
  actionableGuidance, automaticEvidenceWiring, automaticRecoveryAction,
  automaticReviewRun, createAdvanceRecovery, errorCodes, userEnvironmentAction,
  userEnvironmentCause
} from "./advance-recovery.mjs";

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

export const ADVANCE_PROTOCOL_VERSION = 6;

const command = (value) => `claude-foundation ${value}`;

const THROUGH_ORDER = ["build", "proven", "archived"];
const resume = (id, through = null) => command(
  `advance ${id}${through ? ` --through ${through}` : ""}`);

function envelope(id, action, values = {}) {
  const {
    legacyAction = null, boundary = null, actor = "harness", reason = null,
    resumeCommand = resume(id), recoveryType = null, alternatives = [], ...rest
  } = values;
  const value = lifecycleOutcome(actionableGuidance({
    protocol: ADVANCE_PROTOCOL_VERSION,
    version: ADVANCE_PROTOCOL_VERSION,
    action,
    changeId: id,
    actor,
    boundary,
    reason,
    ...(legacyAction ? { legacyAction } : {}),
    ...rest,
    recovery: recoveryType ? {
      type: recoveryType,
      alternatives,
      statePreserved: true
    } : null,
    resume: resumeCommand,
    // Kept for v2 host adapters during the protocol migration.
    resumeCommand
  }));
  return {
    ...value,
    userState: lifecycleUserState(value),
    user: lifecycleUserProjection(value)
  };
}

// What an unchanged automated step reported, as one bounded line the agent can
// act on: its reason, issues, and next steps with their commands.
export function noProgressOutput(output) {
  if (!output) return "";
  const parts = [];
  if (typeof output.reason === "string" && output.reason.trim()) parts.push(output.reason.trim());
  for (const issue of Array.isArray(output.issues) ? output.issues.slice(0, 5) : [])
    parts.push(typeof issue === "string" ? issue : issue?.message || issue?.reason || JSON.stringify(issue));
  for (const row of Array.isArray(output.next) ? output.next.slice(0, 5) : []) {
    const reason = typeof row?.reason === "string" ? row.reason : "";
    const commandText = typeof row?.command === "string" ? row.command : "";
    if (reason || commandText) parts.push(commandText ? `${reason || "next"} (${commandText})` : reason);
  }
  return parts.filter(Boolean).join("; ").slice(0, 2000);
}

// Scenarios a task owns: its ledger line links one claim per scenario.
function taskScenarioCount(task) {
  const linked = String(task?.instruction ?? task?.text ?? "").match(/\[claims:([^\]]*)\]/);
  return linked ? linked[1].split(",").filter((claim) => claim.trim()).length : 0;
}

// The Build line that makes a test count: how many scenarios each behavior-
// changing task covers, and the one rule for proving them. Null for work that
// changes no behavior and for tasks with no linked claim. It names no skill.
export function testAdequacyInstruction({ workTypes, tasks }) {
  if (!behaviorChangingWork(workTypes)) return null;
  const owned = (tasks || []).map((task) => ({ id: task.id, count: taskScenarioCount(task) }))
    .filter((row) => row.id && row.count > 0);
  if (!owned.length) return null;
  const covers = owned.map((row) =>
    `${row.id} covers ${row.count} ${row.count === 1 ? "scenario" : "scenarios"}`).join(", ");
  return `${covers}: write at least one test per scenario that fails on the code before ` +
    "your change and passes after it.";
}

function packetSpecFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => entry.isDirectory() ? packetSpecFiles(join(dir, entry.name))
      : entry.isFile() ? [join(dir, entry.name)] : []);
}

// Resolved read set for an EDIT/REPAIR envelope, as absolute paths: the
// packet files that exist, plus declared task paths split into the ones that
// exist in the workspace (`contextFiles`) and the ones the task creates
// (`newFiles`). Globs are scope, not files, and are left to `allowedPaths`.
// A path outside every workspace/repository base (absolute or `../`) is never
// handed to the agent as a file to open. `scopedPaths` are review identities
// (`<repository>/<path>`, as repair-graph nodes carry them) and resolve in
// that repository's own sandbox, never in the shared sandbox's submodule mirror.
export function envelopeContextFiles({
  packetDir, state = {}, tasks = [], paths = [], scopedPaths = []
}) {
  const specs = packetSpecFiles(join(packetDir, "specs"));
  // The harness ticks the isolated workspace's ledger; the main checkout's
  // copy stays unticked until Land, so it would report finished work pending.
  const isolatedLedger = ["worktree", "copy"].includes(state.workspace?.mode) &&
    state.workspace?.path
    ? join(state.workspace.path, "openspec", "changes", basename(packetDir), "tasks.md")
    : null;
  const packet = ["proposal.md", "design.md", "tasks.md"]
    .map((name) => name === "tasks.md" && isolatedLedger && existsSync(isolatedLedger)
      ? isolatedLedger : join(packetDir, name))
    .filter((file) => existsSync(file));
  const root = (repository) => repositoryWorkspace(state, repository);
  const scoped = (path) => {
    const value = String(path || "");
    const separator = value.indexOf("/");
    const repository = separator > 0 ? value.slice(0, separator) : null;
    return repository && (repository === "root" || state.repositories?.[repository]?.path)
      ? [repository, value.slice(separator + 1)] : [null, value];
  };
  const declared = [
    ...tasks.flatMap((task) => (task.allowedPaths || []).map((path) => [task.repository, path])),
    ...paths.map((path) => [null, path]),
    ...scopedPaths.map(scoped)
  ];
  const bases = [state.workspace?.path,
    ...Object.values(state.repositories || {}).map((entry) => entry?.path)]
    .filter((base) => typeof base === "string" && base);
  const existing = [], created = [];
  for (const [repository, path] of declared) {
    const base = root(repository);
    if (typeof path !== "string" || !path || /[*?[\]{}]/.test(path) || !base) continue;
    const file = resolve(base, path);
    if (isAbsolute(path) ? !bases.some((candidate) => pathInside(candidate, file))
      : !pathInside(base, file)) continue;
    const exists = existsSync(file) && (statSync(file).isFile() || statSync(file).isDirectory());
    (exists ? existing : created).push(file);
  }
  return {
    contextFiles: [...new Set([...packet, ...specs, ...existing])],
    newFiles: [...new Set(created)].filter((file) => !existing.includes(file)),
    contextScope: { paths: "absolute", specs: specs.length ? "included" : "none" }
  };
}

// Where a task's repository is edited: its own repository sandbox when the
// change isolated one, otherwise the shared control workspace.
function repositoryWorkspace(state, repository) {
  return (repository && state.repositories?.[repository]?.path) ||
    state.workspace?.path || null;
}

function taskVerification(text) {
  return String(text || "").match(/—\s*verify:\s*`([^`]+)`/i)?.[1] || null;
}

// A task's focused check in the harness-owned form the installed allowlist
// already grants (`Bash(claude-foundation *)`). Run bare, the project's test
// runner costs a host approval prompt on every Build; `exec --task` runs the
// same command in that task's sandbox, the way advance's own verify does
// (`sh -c` whenever the text needs a shell), and records its duration. A
// leading `NAME=value` is a shell assignment, never a program to spawn.
export function taskCheckCommand(id, taskId, verify) {
  if (!id || !taskId || !String(verify || "").trim()) return null;
  const words = String(verify).trim().split(/\s+/);
  const argv = !/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) &&
    words.every((word) => shellDisplayArgument(word) === word)
    ? words.join(" ") : `sh -c ${shellDisplayArgument(String(verify).trim())}`;
  return command(`exec ${shellDisplayArgument(id)} --task ${shellDisplayArgument(taskId)} -- ${argv}`);
}

function compactRepairGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return null;
  return {
    nodes: graph.nodes.slice(0, 20).map((node) => ({
      id: node.id,
      findingIds: node.findingIds || [],
      dependsOn: node.dependsOn || [],
      paths: node.paths || node.files || [],
      claimIds: node.claimIds || [],
      verificationCaseIds: node.verificationCaseIds || [],
      sourceAttemptDigest: node.sourceAttemptDigest || null
    })),
    truncated: graph.nodes.length > 20
  };
}

function compactPreflight(value) {
  if (!value) return null;
  return {
    status: value.status,
    issues: (value.issues || []).slice(0, 20),
    repositoryIssues: (value.repositoryIssues || []).slice(0, 20),
    unavailableProviders: (value.unavailableProviders || []).slice(0, 20),
    activeWorkers: (value.activeWorkers || []).slice(0, 20),
    decision: value.decision || null,
    next: (value.next || []).slice(0, 20),
    truncated: (value.issues || []).length > 20 ||
      (value.repositoryIssues || []).length > 20 ||
      (value.unavailableProviders || []).length > 20 ||
      (value.activeWorkers || []).length > 20
  };
}

function exactRecoveryCommand(message) {
  const text = String(message || "");
  return text.match(/[\'\"`](claude-foundation\s+[^\'\"`\n]+)[\'\"`]/)?.[1] || null;
}

// Without an exact command, name what to change: the offending field, the
// value seen, and the expected shape. Typed error details win over prose.
export function repairTargetFromError(error) {
  const details = error?.details;
  if (details && typeof details === "object" && typeof details.field === "string")
    return { field: details.field, value: details.value ?? null, expected: details.expected ?? null };
  const lines = String(error?.message || error || "").split("\n")
    .map((line) => line.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  const field = "(-{0,2}[A-Za-z_$][\\w$.\\[\\]-]*)";
  const patterns = [
    [new RegExp(`['\`]?${field}['\`]? must (?:be|equal|use) ([^;\\n]+?)(?:[;.]\\s|[;.]?$)`), (m) => m[2].trim()],
    [new RegExp(`requires (?:a )?non-empty ['\`]${field}['\`]( array)?`), (m) => m[2] ? "a non-empty array" : "a non-empty value"],
    [new RegExp(`['\`]?${field}['\`]? is required`), () => "a value"]
  ];
  for (const line of lines) for (const [pattern, expected] of patterns) {
    const match = line.match(pattern);
    if (match) return {
      field: match[1],
      value: line.match(/(?:got|found) (?:version )?['`]?([^'`\s;,]+)['`]?/)?.[1] || null,
      expected: expected(match)
    };
  }
  return null;
}

// Signals raised while this command ran (see core/signals.mjs) ride on the
// envelope as `signals[]` ({code, message}); absent when there are none.
export function withSignals(value) {
  const raised = drainSignals();
  if (!raised.length || !value || typeof value !== "object") return value;
  const known = Array.isArray(value.signals) ? value.signals : [];
  return { ...value, signals: [...known, ...raised.filter((row) =>
    !known.some((seen) => seen.code === row.code && seen.message === row.message))] };
}

// A failure whose cause only the user can clear (a full disk, a missing or
// rejected credential, a denied network) is typed where it is raised, so every
// route — inspection included — asks the user with the exact cause instead of
// handing the agent a repair it cannot perform. Decisions, harness-owned
// automatic recovery, and product output keep their own routes.
export function advanceFailureAction(id, error, options = {}) {
  const value = failureEnvelope(id, error, options);
  if (value.action === "ASK_USER" || value.automaticRecovery) return value;
  const found = userEnvironmentCause(value, errorCodes(error));
  if (!found) return value;
  const asked = lifecycleOutcome(actionableGuidance(userEnvironmentAction(id, value, found)));
  return { ...asked, userState: lifecycleUserState(asked), user: lifecycleUserProjection(asked) };
}

function failureEnvelope(id, error, { stage = "build", through = null } = {}) {
  const reason = error?.message || String(error);
  const automatic = automaticRecoveryAction(id, error?.decision);
  if (automatic?.kind === "reconcile-target-edits") return envelope(id, "REPAIR", {
    legacyAction: "RECONCILE_TARGET_EDITS", actor: "agent", owner: "agent",
    boundary: "target-conflict", reason, decision: error.decision,
    paths: automatic.paths, command: resume(id, "archived"),
    instruction: "Keep the target checkout's edits at the listed paths: do not revert or commit " +
      "them. Merge each target edit into the sandbox copy of the same path so the sandbox keeps " +
      "both the change and the target edit, then run the resume command; Land proves the merged " +
      "files again and applies them once they carry the target edits.",
    recoveryType: "EDIT", resumeCommand: resume(id, "archived")
  });
  if (automatic?.kind === "apply-recovery") return envelope(id, "REPAIR", {
    legacyAction: "RECOVER_APPLY_TRANSACTION", actor: "harness",
    boundary: "internal-recovery", reason,
    automaticRecovery: automatic, decision: error.decision,
    command: automatic.command, recoveryType: "AUTO_RECOVER",
    resumeCommand: resume(id, through)
  });
  if (automatic) return envelope(id, "REPAIR", {
    legacyAction: "RECOVER_SANDBOX_SYNC", actor: "harness",
    boundary: "internal-recovery", reason,
    automaticRecovery: automatic, decision: error.decision,
    command: automatic.command, recoveryType: "AUTO_RECOVER",
    resumeCommand: resume(id, through)
  });
  if (error?.decision) return envelope(id, "ASK_USER", {
    legacyAction: "REQUEST_DECISION",
    actor: "user",
    boundary: error.boundary || "user-authority",
    reason,
    decision: error.decision,
    recoveryType: "ASK_USER",
    alternatives: error.decision.options?.map((option) => option.outcome) || [],
    resumeCommand: resume(id, through)
  });
  if (error?.owner === "user" || error?.boundary === "land-authority")
    return envelope(id, "ASK_USER", {
      legacyAction: error?.code === "LAND_GRANT_REQUIRED"
        ? "LAND_READY" : "REQUEST_DECISION",
      actor: "user",
      boundary: error?.boundary || "user-authority",
      reason,
      recoveryType: "ASK_USER",
      alternatives: error?.boundary === "land-authority"
        ? ["invoke /land for this exact change", "leave the proven change pending"] : [],
      resumeCommand: resume(id, through)
    });
  // A lease resource another task or change holds is queued: the harness
  // waits for the holder and retries on resume. Never a repair or a question.
  if (error?.code === "LEASE_RESOURCE_HELD" && error.wait) return envelope(id, "WAIT", {
    legacyAction: "WAIT_RESOURCE",
    actor: "harness",
    boundary: "resource",
    reason,
    wait: { ...error.wait, owner: "harness", checkCommand: resume(id, through) },
    recoveryType: "PAUSE",
    alternatives: ["wait for the holding lease to be released, then resume"],
    resumeCommand: resume(id, through)
  });
  if (error?.owner === "external") return envelope(id, "WAIT", {
    legacyAction: "WAIT_EXTERNAL",
    actor: "external-authority",
    boundary: error?.boundary || "external-authority",
    reason,
    wait: error?.details?.wait || null,
    recoveryType: "PAUSE",
    alternatives: error?.details?.alternatives || [],
    resumeCommand: resume(id, through)
  });
  // Harness automation that could not finish hands its exact step to the
  // agent — command, directory, and output — instead of a diagnostic loop
  // that ends at the user.
  const handoff = error?.details?.handoff;
  if (handoff?.command) return envelope(id, "REPAIR", {
    legacyAction: `REPAIR_${stage.toUpperCase()}_RUNTIME`,
    actor: "agent",
    boundary: error?.boundary || "resource",
    reason,
    details: error?.details || null,
    errorCode: error?.code || null,
    command: handoff.command,
    handoff,
    instruction: `The harness could not finish ${handoff.step || "this step"}. Run \`${
      handoff.command}\`${handoff.cwd ? ` in ${handoff.cwd}` : ""}, fix what its output reports ` +
      "(inside the workspace or the declared setup in foundation.json), then resume.",
    recoveryType: "HANDOFF",
    alternatives: ["finish the harness step yourself, then resume the same lifecycle route"],
    resumeCommand: resume(id, through)
  });
  // Land's diagnosis is Land itself: resuming the archived route re-runs every
  // Land check and recovery. `land check` is an internal primitive.
  const fallback = stage === "land"
    ? resume(id, "archived")
    : command(`doctor --stage ${stage === "prove" ? "prove" : "build"} --change ${id}`);
  const exact = exactRecoveryCommand(reason);
  const repairTarget = exact ? null : repairTargetFromError(error);
  return envelope(id, "REPAIR", {
    legacyAction: `REPAIR_${stage.toUpperCase()}_RUNTIME`,
    actor: error?.owner === "agent" ? "agent" : "harness",
    boundary: error?.boundary || "resource",
    reason,
    details: error?.details || null,
    errorCode: error?.code || null,
    command: exact || fallback,
    ...(exact ? {} : {
      repairTarget,
      instruction: stage === "land"
        ? `Fix the reported cause: ${reason}. Then run '${fallback}'; it re-runs every Land check ` +
          "and resumes Land from its retained state."
        : repairTarget
        ? `Set '${repairTarget.field}' to ${repairTarget.expected}` +
          `${repairTarget.value ? ` (found '${repairTarget.value}')` : ""}, then resume; ` +
          `'${fallback}' diagnoses the stage if the cause is elsewhere.`
        : `Fix the reported cause: ${reason}. '${fallback}' names the failing stage check; then resume.`
    }),
    recoveryType: "RECONFIGURE",
    alternatives: [exact ? "run the exact recovery command, then resume the same lifecycle route"
      : "apply the named fix, then resume the same lifecycle route"],
    resumeCommand: resume(id, through)
  });
}

// An exhausted request keeps replaying until its consumed attempts are
// acknowledged; name the supported command so nobody moves request files.
export function reviewInfrastructureAlternatives(id) {
  return [
    "repair or switch the configured reviewer named in requests[] (see its infrastructureError)",
    `then acknowledge the consumed attempts with the user's decision: ${command(
      `authority reset-infra ${id} --decision-ref <user-decision>`)}`,
    `then resume: ${resume(id, "proven")}`
  ];
}

// A requested review no configured reviewer can start waits on a person; say
// so, rather than look like a reviewer that is still working.
export function unstartableReviewReason(id, requestId) {
  return `no configured reviewer can start review request ${requestId}: bounded AI review is ` +
    "unavailable or exhausted, so an external verdict is pending. Configure a reviewer, or " +
    `record an authorized external verdict; inspect: ${command(
      `authority status ${id} --request ${requestId}`)}`;
}

// Every routed AI wave is delivered and review is still required: only the
// user can choose who reviews next. Review is never waived here.
export function exhaustedReviewDecision(id, requestId, exhausted = {}) {
  const waves = `${exhausted.delivered ?? "?"}/${exhausted.maxAiAttempts ?? "?"}`;
  const summary = `All ${waves} AI review waves are delivered and review request ${requestId} ` +
    "still needs a verdict. Choose a human verdict, one more AI wave, or a pause.";
  return envelope(id, "ASK_USER", {
    legacyAction: "DECIDE_EXHAUSTED_REVIEW",
    actor: "user",
    boundary: "user-authority",
    reason: summary,
    requestId,
    decision: {
      kind: "review-exhausted",
      summary,
      requestId,
      aiWaves: exhausted,
      options: [
        { id: "human-verdict",
          outcome: "A person reviews the change; dispatch a human review, then record the verdict they gave.",
          command: command(`authority dispatch ${id} --request ${requestId} --scope full --reviewer-type human --reviewer-identity <person>`),
          then: command(`authority record ${id} --request ${requestId} --response <file>`) },
        { id: "one-more-ai-attempt",
          outcome: "Allow one more AI review wave on the user's recorded decision; advance then runs it.",
          command: command(`authority extend-review ${id} --decision-ref <user-decision>`) },
        { id: "pause",
          outcome: "Keep the change proven-pending with its state preserved; resume later.",
          command: null }
      ],
      recommended: "human-verdict"
    },
    recoveryType: "ASK_USER",
    alternatives: ["record a human verdict", "allow one more AI review wave", "pause"]
  });
}

// A configured reviewer the harness can start with no host-supplied input runs
// inside `advance --through`, in the foreground and bounded by the review
// window. A route with placeholders stays a handoff.
function configuredReviewAutomation(id, commandText) {
  const automaticReview = automaticReviewRun(id, commandText);
  return automaticReview ? { automaticReview, automatic: true } : {};
}

function configuredReviewWait(id, request) {
  const controller = request?.configuredController;
  if (request?.status !== "dispatched" || (!controller && !request.configuredResult)) return null;
  const live = isProcessAlive(Number(controller?.pid));
  const subject = request.configuredResult?.subject || controller?.subject;
  const subjectFlags = [
    ["subject-actor", subject?.subjectActor],
    ["subject-session", subject?.subjectSession],
    ["subject-provider-family", subject?.subjectProvider],
    ["subject-model-family", subject?.subjectFamily],
    ["subject-model", subject?.subjectModel]
  ].filter(([, value]) => value).map(([flag, value]) => `--${flag} ${shellDisplayArgument(value)}`);
  // Old controller records did not retain provenance. The host must supply its
  // original implementer identity, never silently downgrade an AI subject.
  if (!subject?.subjectActor) subjectFlags.unshift("--subject-actor <original-implementer>");
  const runCommand = command(`authority run ${id} --request ${request.requestId} ${subjectFlags.join(" ")}`);
  const automaticReview = live ? null : automaticReviewRun(id, runCommand);
  return envelope(id, live ? "WAIT" : "RUN_EXTERNAL", {
    actor: live ? "harness" : "configured-reviewer",
    legacyAction: live ? "WAIT_CONFIGURED_REVIEW" : "RUN_CONFIGURED_REVIEW",
    boundary: "resource",
    reason: live ? "The authorized configured reviewer is still running."
      : "Resume the stopped reviewer through bounded authority recovery; reuse a valid checkpoint before starting another attempt.",
    requestId: request.requestId,
    ...(!live && !subject?.subjectActor ? { requiredContext: "original implementation subject provenance" } : {}),
    command: live ? command(`authority status ${id} --request ${request.requestId}`) : runCommand,
    ...(automaticReview ? { automaticReview, automatic: true } : {}),
    wait: live ? { owner: controller.reviewer || "configured-reviewer",
      condition: `Review request ${request.requestId} returns its verdict.`, pid: controller.pid } : null,
    recoveryType: live ? "PAUSE" : "HANDOFF"
  });
}

export function proofOperationAction(id, result) {
  if (!result || typeof result !== "object") return null;
  if (result.action) return result;
  if (result.decision && (result.status === "BLOCKED" || result.decision.automaticRecovery))
    return advanceFailureAction(id, { message: result.decision.summary, decision: result.decision }, { stage: "prove" });
  if (["PASS", "READY"].includes(result.status) || result.completed === true) return null;
  // A lock whose owner cannot be read yet (released between the failed
  // acquire and the read, or still initializing) is a hand-over, not a dead
  // worker: report it as working instead of a repair that counts as no progress.
  if (result.status === "IN_PROGRESS" && result.owner && !isProcessAlive(Number(result.owner.pid)) &&
      !(result.owner.state === "initializing" && Date.parse(result.owner.recoverableAfter) > Date.now()))
    return envelope(id, "REPAIR", {
      actor: "harness", legacyAction: "REPAIR_PROOF_LOCK", boundary: "internal-lock",
      reason: "The reported proof worker is no longer live; inspect and recover its lock before resuming.",
      command: command(`doctor --stage prove --change ${id}`), recoveryType: "RECONFIGURE"
    });
  if (result.status === "IN_PROGRESS") return envelope(id, "WORKING", {
    legacyAction: "PROOF_IN_PROGRESS",
    actor: "harness",
    boundary: "internal-lock",
    reason: "proof is already running for this change",
    wait: { owner: result.owner || null, next: result.next || [],
      ...(result.progress ? { progress: result.progress } : {}) },
    recoveryType: "AUTO_RECOVER",
    alternatives: ["reuse the active proof operation"]
  });
  if (result.status === "WAITING_EXTERNAL" &&
      (result.requests || []).some((request) =>
        request.status === "infrastructure-exhausted"))
    return envelope(id, "REPAIR", {
      legacyAction: "REPAIR_REVIEW_INFRASTRUCTURE",
      actor: "harness",
      boundary: "resource",
      reason: result.next?.[0]?.reason ||
        "configured review infrastructure is exhausted",
      requests: result.requests || [],
      next: result.next || [],
      recoveryType: "RECONFIGURE",
      alternatives: reviewInfrastructureAlternatives(id)
    });
  if (result.status === "WAITING_EXTERNAL") {
    const running = (result.requests || []).map((row) => configuredReviewWait(id, row)).find(Boolean);
    if (running) return running;
    const review = (result.requests || []).find((request) =>
      request.type === "review" && request.status === "requested");
    const next = review && (result.next || []).find((row) =>
      row.requestId === review.requestId &&
      /^claude-foundation authority run\s/.test(row.command || ""));
    if (next) return envelope(id, "RUN_EXTERNAL", {
      legacyAction: "RUN_CONFIGURED_REVIEW",
      actor: "configured-reviewer",
      boundary: "external-authority",
      reason: "configured review is ready",
      requestId: review.requestId,
      command: next.command,
      ...configuredReviewAutomation(id, next.command),
      recoveryType: "HANDOFF",
      alternatives: ["run the configured reviewer", "record an authorized external verdict"]
    });
    const exhausted = review && (result.next || []).find((row) =>
      row.requestId === review.requestId && row.aiReviewExhausted);
    if (exhausted)
      return exhaustedReviewDecision(id, review.requestId, exhausted.aiReviewExhausted);
    return envelope(id, "WAIT", {
      legacyAction: "WAIT_EXTERNAL",
      actor: "external-authority",
      boundary: "external-authority",
      reason: review ? unstartableReviewReason(id, review.requestId)
        : result.next?.[0]?.reason || "required external evidence is pending",
      requests: result.requests || [],
      providers: result.providers || [],
      wait: result.wait || null,
      next: result.next || [],
      recoveryType: "PAUSE",
      alternatives: (result.next || []).map((row) => row.reason).filter(Boolean)
    });
  }
  if (result.status === "NEEDS_USER_DECISION" ||
      ["CONTRACT_DECISION_REQUIRED", "NO_PROGRESS_DECISION"].includes(result.route))
    return envelope(id, "ASK_USER", {
      legacyAction: "REQUEST_DECISION",
      actor: "user",
      boundary: "user-authority",
      reason: result.decision?.summary || result.next?.[0]?.reason ||
        "proof reached a material work decision",
      decision: result.decision || {
        kind: "work-decision",
        summary: result.next?.[0]?.reason || "A work decision is required",
        options: []
      },
      next: result.next || [],
      recoveryType: "ASK_USER",
      alternatives: result.decision?.options?.map((option) => option.outcome) || []
    });
  // A provider reserved but never proved its receipt. Whether to run it again
  // is the user's external side-effect decision, answered through `advance`.
  if (result.stage === "execution-indeterminate") return envelope(id, "ASK_USER", {
    legacyAction: "DECIDE_INDETERMINATE_EXECUTION", actor: "user",
    boundary: "external-side-effect",
    reason: result.next?.[0]?.reason ||
      "A provider execution stopped before proving its receipt.",
    decision: {
      kind: "indeterminate-execution",
      summary: `${result.next?.[0]?.reason || "A provider execution stopped before proving its receipt."} ` +
        `Providers: ${(result.providers || []).join(", ") || "unknown"}.`,
      providers: result.providers || [],
      options: [
        { id: "retry", outcome: "The interrupted run's side effects were inspected; run the providers again." },
        { id: "pause", outcome: "Keep the reservation and pause until the side effects are inspected." }
      ],
      recommended: "retry"
    },
    recoveryType: "ASK_USER"
  });
  if (result.status === "ACTION_REQUIRED" || result.status === "BLOCKED")
    return envelope(id, "REPAIR", {
      legacyAction: "REPAIR_PROOF_RESULT",
      actor: "agent",
      boundary: "host-execution",
      reason: result.next?.[0]?.reason || result.issues?.[0] ||
        "proof found work that must be repaired",
      route: result.route || null,
      decision: result.decision || null,
      repairPlan: result.repairPlan || null,
      repairGraph: compactRepairGraph(result.repairGraph),
      invalidation: result.invalidation || null,
      next: result.next || [],
      recoveryType: "EDIT",
      alternatives: ["repair the dependency-ordered finding batch"]
    });
  return null;
}

function landOperationAction(id, result) {
  if (!result || typeof result !== "object") return null;
  if (result.action) return result;
  if (result.decision?.automaticRecovery)
    return advanceFailureAction(id, { message: result.decision.summary, decision: result.decision }, { stage: "land" });
  if (["ARCHIVED", "PASS"].includes(result.status) || result.archived === true) return null;
  if (result.status === "BLOCKED" && result.decision) return envelope(id, "ASK_USER", {
    legacyAction: "REQUEST_LAND_DECISION",
    actor: "user",
    boundary: "user-authority",
    reason: result.decision.summary || "Land requires a work decision",
    decision: result.decision,
    recoveryType: "ASK_USER",
    alternatives: result.decision.options?.map((option) => option.outcome) || []
  });
  if (["WAITING_EXTERNAL", "PENDING_EXTERNAL"].includes(result.status))
    return envelope(id, "WAIT", {
      legacyAction: "WAIT_LAND_EXTERNAL",
      actor: "external-authority",
      boundary: "external-authority",
      reason: result.reason || "an external delivery dependency is pending",
      wait: result.wait || null,
      repositories: result.repositories || [],
      recoveryType: "PAUSE",
      alternatives: result.alternatives || []
    });
  if (["IN_PROGRESS", "READY", "PENDING"].includes(result.status))
    return envelope(id, "WORKING", {
      legacyAction: "LAND_IN_PROGRESS",
      actor: "harness",
      boundary: "internal-transaction",
      reason: result.reason || "Land has a resumable internal transaction",
      repositories: result.repositories || [],
      recoveryType: "AUTO_RECOVER",
      alternatives: ["resume the same Land transaction"]
    });
  return null;
}

function selectedBuildTasks(id, dispatch, plan) {
  const ids = dispatch.action === "spawn-group"
    ? (dispatch.workers || []).map((worker) => worker.taskId)
    : dispatch.task?.taskId ? [dispatch.task.taskId]
      // A session plan hands every pending task at once, in dependency order;
      // the next advance verifies and ticks each one.
      : (plan?.groups?.flat() || plan?.tasks?.slice(0, 1).map((task) => task.id) || []);
  return ids.map((id) => plan?.tasks?.find((task) => task.id === id))
    .filter(Boolean).map((task) => {
      const verify = taskVerification(task.text);
      const checkCommand = taskCheckCommand(id, task.id, verify);
      return {
        id: task.id,
        instruction: task.text,
        repository: task.repository,
        allowedPaths: task.paths || [],
        verification: [verify].filter(Boolean),
        ...(checkCommand ? { checkCommand } : {})
      };
    });
}

// Finished tasks the handed work builds on: every completed task it depends
// on, transitively, and any completed task in another repository. Each names
// the workspace that holds its output, so a task in one repository never reads
// another repository's finished work as missing.
function completedTaskContext(state, plan, tasks) {
  const nodes = (plan?.graph?.nodes || []).filter((node) => node.kind === "task" &&
    String(node.id).startsWith("task:"));
  if (!nodes.length) return [];
  const taskId = (node) => String(node.id).slice("task:".length);
  const byId = new Map(nodes.map((node) => [taskId(node), node]));
  const pending = new Set((plan.tasks || []).map((task) => task.id));
  const repositories = new Set(tasks.map((task) => task.repository));
  const needed = new Set();
  const visit = (id) => {
    for (const dependency of (byId.get(id)?.dependsOn || [])
      .filter((value) => String(value).startsWith("task:")).map((value) => value.slice(5))) {
      if (needed.has(dependency)) continue;
      needed.add(dependency);
      visit(dependency);
    }
  };
  tasks.forEach((task) => visit(task.id));
  return nodes.map((node) => [taskId(node), node])
    .filter(([id, node]) => !pending.has(id) &&
      (needed.has(id) || !repositories.has(node.repository || "root")))
    .slice(0, 20)
    .map(([id, node]) => ({
      id, repository: node.repository || "root",
      workspace: repositoryWorkspace(state, node.repository || "root")
    }));
}

function buildAction(id, dispatch, state, plan = null) {
  if (dispatch.action === "build-complete") return null;
  if (["run-in-session", "run-leased-in-session", "spawn-group"].includes(dispatch.action)) {
    const tasks = selectedBuildTasks(id, dispatch, plan);
    if (!plan || tasks.length === 0 || tasks.some((task) =>
      !task.id || task.allowedPaths.length === 0)) return envelope(id, "REPAIR", {
      legacyAction: "REPAIR_BUILD_PLAN",
      actor: "harness",
      boundary: "contract",
      reason: "the compiled Build plan is missing executable task or path scope",
      recoveryType: "AUTO_RECOVER",
      alternatives: ["regenerate the compiled task graph from the current agreement"]
    });
    // A task listed here is already implemented; only its execution record is
    // stale and the harness could not re-verify it (its check failed, a worker
    // still holds it, or a dependency is unverified). Say so, so the agent
    // repairs that instead of redoing the work or splitting diffs per task.
    const reverification = (plan.verification || [])
      .filter((row) => tasks.some((task) => task.id === row.taskId));
    const instructions = [
      ...(dispatch.action === "run-in-session" ? [
        tasks.length > 1
          ? `Implement ${tasks.map((task) => task.id).join(", ")} in this order inside the workspace.`
          : `Implement ${tasks[0].id} inside the workspace.`,
        "Then run the resume command once: advance runs every task's verify check, marks each " +
        "passing task [x], and hands back only failures with their output; run a task's " +
        "checkCommand (present only where it has a verify) just to diagnose one."
      ] : []),
      ...reverification.map((row) =>
        `${row.taskId} is already implemented; its execution record is stale (${row.reason}). ` +
        "Do not re-implement it or split the diff per task: make its checkCommand pass, " +
        "then resume and the harness re-verifies it.")
    ];
    // One location per task repository: each task names its own sandbox, and
    // the top-level workspace is that sandbox whenever every task shares it.
    const located = tasks.map((task) => ({
      ...task, workspace: repositoryWorkspace(state, task.repository)
    }));
    const workspaces = Object.fromEntries(located
      .filter((task) => task.repository && task.workspace)
      .map((task) => [task.repository, task.workspace]));
    const locations = [...new Set(located.map((task) => task.workspace))];
    const completed = completedTaskContext(state, plan, tasks);
    if (completed.length) instructions.push(
      `Already complete and verified: ${completed.map((task) =>
        `${task.id} (${task.repository})`).join(", ")}. Build on that work where its ` +
      "workspace holds it; do not re-implement it.");
    return envelope(id, "EDIT", {
      legacyAction: dispatch.action === "spawn-group" ? "EXECUTE_TASK_GROUP" : "EXECUTE_TASK",
      actor: "agent",
      boundary: "host-execution",
      reason: dispatch.reason,
      workspace: locations.length === 1 && locations[0]
        ? locations[0] : state.workspace?.path || null,
      ...(Object.keys(workspaces).length ? { workspaces } : {}),
      tasks: located,
      allowedPaths: [...new Set(tasks.flatMap((task) => task.allowedPaths))],
      verification: [...new Set(tasks.flatMap((task) => task.verification))],
      execution: {
        mode: dispatch.action === "spawn-group" ? "parallel" : "session",
        leases: dispatch.action === "spawn-group" ? dispatch.workers :
          dispatch.task ? [dispatch.task] : []
      },
      ...(reverification.length ? { reverification } : {}),
      ...(completed.length ? { completed } : {}),
      ...(instructions.length ? { instructions } : {}),
      recoveryType: "EDIT",
      alternatives: ["amend the agreement if Build discovers new behavior"]
    });
  }
  // Another active change holding a shared resource queues this one: the
  // harness waits for the holder and resumes; no repair and no question.
  if (dispatch.action === "wait" && dispatch.waitKind === "cross-change-resource")
    return envelope(id, "WAIT", {
      legacyAction: "WAIT_RESOURCE", actor: "harness", boundary: "resource",
      reason: dispatch.reason,
      resourceWaits: dispatch.resourceWaits || [],
      wait: { owner: "harness", kind: "cross-change-resource",
        holders: dispatch.holders || [], resources: (dispatch.resourceWaits || []).map((row) => row.key),
        condition: `The shared resource is released when ${(dispatch.holders || []).join(", ") ||
          "the holding change"} lands, is archived, or is abandoned.`,
        checkCommand: resume(id) },
      recoveryType: "PAUSE",
      alternatives: ["wait for the holding change to land or be abandoned"]
    });
  if (dispatch.action === "wait") return envelope(id, "WAIT", {
    legacyAction: "WAIT_RESOURCE", actor: "harness", boundary: "resource",
    reason: dispatch.reason, wait: { workers: dispatch.activeWorkers || [] },
    recoveryType: "PAUSE",
    alternatives: ["wait for the active lease", "release an abandoned lease after inspection"]
  });
  return envelope(id, "REPAIR", {
    legacyAction: "REPAIR_BUILD_PLAN", actor: "agent",
    boundary: "contract",
    reason: dispatch.reason || "the Build graph is not dispatchable",
    findings: dispatch.reasons || null,
    command: dispatch.nextCommand,
    ...(dispatch.reasons?.preview?.length ? {
      instruction: `Resolve this change's plan blockers: ${dispatch.reasons.preview.join("; ")}. ` +
        "Then run the resume command."
    } : {}),
    recoveryType: "RECONFIGURE",
    alternatives: ["repair the agreement or task graph", "inspect the Build diagnostic"]
  });
}

export function coordinatorAction({
  id, state, dispatch, workspaceHash, latestReview = null,
  proofCursor = {}, authorityRequests = [], stableHash, authorityActions = null,
  proofPreflight = null, plan = null, proofIsCurrent = null, automation = {}
}) {
  if (state.status === "archived") return envelope(id, "DONE", {
    legacyAction: "ARCHIVED", boundary: null, reason: "change is archived",
    completed: true, reached: "archived", resumeCommand: null
  });

  const pendingBuild = buildAction(id, dispatch, state, plan);
  if (pendingBuild) return pendingBuild;

  if (state.status === "proven" && proofIsCurrent === false)
    return envelope(id, "RUN_EXTERNAL", {
      legacyAction: "RUN_INVALIDATED_EVIDENCE", actor: "harness",
      reason: "The retained proof or required receipts are no longer current; refresh only invalidated evidence before delivery.",
      command: command(`proof advance ${id}`), automatic: true,
      recoveryType: "AUTO_RECOVER"
    });

  // A successful proof supersedes earlier review failures. Without this
  // ordering, the last failed AI attempt could keep routing a proven change
  // back into repair after deterministic closure had already passed.
  const proofCurrent = proofCursor.workspaceHash === workspaceHash &&
    (state.status === "proven" || proofCursor.status === "PASS");
  if (proofCurrent)
    return envelope(id, "ASK_USER", {
      legacyAction: "LAND_READY", actor: "user", 
      boundary: "land-authority",
      reason: "proof is current; explicit Land authority is required",
      command: resume(id, "archived"),
      forbidden: ["commit", "push", "publish", "open-pr", "waive"],
      recoveryType: "ASK_USER",
      alternatives: ["invoke /land to apply and archive", "leave the proven change pending"]
    });

  // A new request is evidence that invalidated checks have already advanced
  // far enough to need the configured authority. Prefer it over a stale
  // failure from the previous workspace.
  const open = authorityRequests.find((request) =>
    ["requested", "dispatched", "pending", "infrastructure-exhausted"]
      .includes(request.status));
  if (open) {
    const running = configuredReviewWait(id, open);
    if (running) return running;
    const authorityAction = authorityActions?.find((entry) => entry.requestId === open.requestId);
    const authorityCommand = authorityAction?.command || null;
    // A requested review is executable only while the authority router still
    // offers `authority run`. Once the bounded AI circuit is exhausted it
    // deliberately offers the external response template instead. Treating
    // that template as configured work makes a host print it, resume, and
    // receive the same RUN_EXTERNAL action forever.
    if (open.status === "infrastructure-exhausted") return envelope(id, "REPAIR", {
      legacyAction: "REPAIR_REVIEW_INFRASTRUCTURE",
      actor: "harness",
      boundary: "resource",
      reason: open.infrastructureError ||
        "configured review infrastructure is exhausted",
      requestId: open.requestId,
      recoveryType: "RECONFIGURE",
      alternatives: reviewInfrastructureAlternatives(id)
    });
    const configuredReview = open.type === "review" && open.status === "requested" &&
      /^claude-foundation authority run\s/.test(authorityCommand || "");
    if (open.type === "review" && open.status === "requested" &&
        authorityAction?.aiReviewExhausted)
      return exhaustedReviewDecision(id, open.requestId, authorityAction.aiReviewExhausted);
    return envelope(id, configuredReview ? "RUN_EXTERNAL" : "WAIT", {
      legacyAction: configuredReview ? "RUN_CONFIGURED_REVIEW" : "WAIT_EXTERNAL",
      actor: configuredReview ? "configured-reviewer" : "external-authority",
      boundary: "external-authority",
      reason: configuredReview ? "configured review is ready" :
        open.type === "review" && open.status === "requested"
          ? unstartableReviewReason(id, open.requestId)
          : "external authority is pending",
      requestId: open.requestId,
      command: authorityCommand || command(`authority status ${id} --request ${open.requestId}`),
      ...(configuredReview ? configuredReviewAutomation(id, authorityCommand) : {}),
      recoveryType: configuredReview ? "HANDOFF" : "PAUSE",
      alternatives: configuredReview
        ? ["run the configured reviewer", "record an authorized external verdict"]
        : ["wait for the requested verdict", "record the external verdict when available"]
    });
  }

  const repair = repairActionForWorkspace(latestReview, workspaceHash, stableHash);
  if (repair) return envelope(id,
    repair.action === "RUN_INVALIDATED_EVIDENCE" ? "RUN_EXTERNAL" : "REPAIR", {
    legacyAction: repair.action,
    actor: repair.action === "RUN_INVALIDATED_EVIDENCE" ? "harness" : "agent",
    boundary: repair.action === "EXECUTE_REPAIR_BATCH"
      ? "host-execution" : null,
    reason: repair.reason || "review findings require a bounded repair",
    repairGraph: compactRepairGraph(repair.repairGraph),
    command: repair.action === "RUN_INVALIDATED_EVIDENCE"
      ? command(`proof advance ${id}`) : null,
    recoveryType: repair.action === "RUN_INVALIDATED_EVIDENCE" ? "AUTO_RECOVER" : "EDIT",
    alternatives: repair.action === "RUN_INVALIDATED_EVIDENCE"
      ? ["rerun only invalidated evidence"] : ["apply the dependency-ordered repair batch"]
  });

  if (proofPreflight?.status !== "READY" && (proofCursor.status === "NEEDS_USER_DECISION" ||
      proofCursor.route === "CONTRACT_DECISION_REQUIRED" ||
      proofCursor.route === "NO_PROGRESS_DECISION")) return envelope(id, "ASK_USER", {
    legacyAction: "REQUEST_DECISION", actor: "user",
    boundary: "user-authority",
    reason: "proof reached a material decision boundary",
    decision: proofCursor.decision || null,
    recoveryType: "ASK_USER",
    alternatives: proofCursor.decision?.alternatives || []
  });

  if (proofPreflight && proofPreflight.status !== "READY") {
    const next = proofPreflight.next || [];
    const needsDecision = proofPreflight.status === "NEEDS_USER_DECISION";
    // Proof already owns request creation and reuse. A required review is
    // deterministic preparation, not permission to change review policy.
    if (needsDecision && next.length &&
        (!proofPreflight.authorityPreflight ||
          proofPreflight.authorityPreflight.status === "READY") &&
        next.every((row) => row.decision?.kind === "independent-review"))
      return envelope(id, "RUN_EXTERNAL", {
        legacyAction: "RUN_PROOF", actor: "harness",
        reason: "prepare required review through the deterministic proof chain",
        command: command(`proof advance ${id}`),
        automatic: true,
        recoveryType: "AUTO_RECOVER",
        alternatives: ["collect current evidence and prepare required review"]
      });
    const wiring = automation.wiringAttempted ? null : automaticEvidenceWiring(id, proofPreflight);
    if (wiring) return envelope(id, "RUN_EXTERNAL", {
      legacyAction: "WIRE_EVIDENCE", actor: "harness",
      reason: `wire detected project-owned providers: ${wiring.providers.join(", ")}`,
      command: wiring.command,
      automaticWiring: wiring,
      automatic: true,
      recoveryType: "AUTO_RECOVER",
      alternatives: ["write the detected provider wiring, then continue proof"]
    });
    const first = (needsDecision && next.find((row) =>
      row.decision && row.decision.kind !== "independent-review")) || next[0] || null;
    const decision = proofPreflight.authorityPreflight?.decision ||
      proofPreflight.decision || first?.decision || null;
    const mapping = {
      NEEDS_CODE_CHANGE: ["EDIT", "EXECUTE_TASK", "agent", "host-execution", "EDIT"],
      CONFIGURATION_ERROR: ["REPAIR", "REPAIR_PROOF_CONTRACT", "agent", "contract", "RECONFIGURE"],
      BLOCKED_BY_ACTIVE_WORK: ["WAIT", "WAIT_RESOURCE", "harness", "resource", "PAUSE"],
      INFRASTRUCTURE_ERROR: ["REPAIR", "REPAIR_PROVIDER_ENVIRONMENT", "operator", "resource", "RECONFIGURE"],
      NEEDS_USER_DECISION: ["ASK_USER", "REQUEST_DECISION", "user", "user-authority", "ASK_USER"]
    };
    const [action, legacyAction, actor, boundary, recoveryType] = mapping[proofPreflight.status] ||
      ["REPAIR", "REPAIR_PROOF_PREFLIGHT", "agent", "contract", "RECONFIGURE"];
    return envelope(id, action, {
      legacyAction,
      actor,
      action,
      boundary,
      reason: decision?.summary || proofPreflight.issues?.[0] || proofPreflight.status,
      preflight: compactPreflight(proofPreflight),
      ...(needsDecision ? { decision } : {}),
      command: first?.command || command(`doctor --stage prove --change ${id}`),
      recoveryType,
      alternatives: needsDecision && decision?.options
        ? decision.options.map((option) => option.outcome)
        : next.map((row) => row.reason || row.command)
    });
  }

  return envelope(id, "RUN_EXTERNAL", {
    legacyAction: "RUN_PROOF", actor: "harness",
    boundary: null,
    reason: "deterministic evidence is ready to run",
    command: command(`proof advance ${id}`),
    automatic: true,
    recoveryType: "AUTO_RECOVER",
    alternatives: ["run the deterministic proof chain"]
  });
}

export function createAdvanceRuntime({
  inspectSnapshots = (operation) => operation(),
  loadRuntime, agentDispatchValue, relevantHash, deliveredAiAttempts,
  authorityStatusValue, authorityNext, readJson, proofAdvancePath, stableHash,
  proofReadinessValue = null, agentPlanValue = null,
  nowMs = Date.now,
  assertApproval = null,
  prepareBuild = null, runProof = null, runLand = null,
  recoverReviewBindings = null,
  recoverWorkspace = null,
  recoverArchive = null,
  recoverSandbox = null, recoverApply = null, saveRuntime = () => {}, proofIsCurrent = null,
  settleSessionLeases = null, issueSessionLease = null, reverifyCompletedTasks = null,
  // Resolves a change's packet directory; enables `contextFiles` on EDIT/REPAIR.
  changePath = null,
  // Project root whose `.claude/skills/<name>/SKILL.md` enables `skills` on a
  // Build EDIT.
  projectRoot = null,
  // Harness-owned operations advance performs itself instead of handing the
  // agent a primitive: detected provider wiring and a configured reviewer.
  wireEvidence = null, runReview = null, synchronizeAgreement = null,
  authorizeLand = null,
  hasLandGrant = () => false,
  recordPhase = null, output = console.log,
  capture = (operation) => operation(),
  captureAsync = async (operation) => operation(),
  markBlocked = () => {},
  // Authority the change already needs (signed CI, ...); asked with spec
  // approval so it never first surfaces at Build dispatch.
  pendingApprovalDecisions = () => [],
  // Writes the approval package and returns { path } or { error }; a failure
  // never changes the approval question.
  approvalPackageLink = () => null
}) {
  // Spec approval is the one Change-time question; known authority gates ride
  // along with it instead of stopping Build later.
  function failureAction(id, error, options) {
    if (error?.code !== "SPEC_APPROVAL_REQUIRED" || !error.decision)
      return advanceFailureAction(id, error, options);
    let alongside = [];
    try { alongside = pendingApprovalDecisions(id) || []; } catch {}
    let link = null;
    try { link = approvalPackageLink(id); } catch {}
    const packageNote = link?.path ? ` Approval package: ${link.path}.`
      : link?.error ? ` Approval package not written (${link.error}); review the packet.` : "";
    if (!alongside.length && !packageNote) return advanceFailureAction(id, error, options);
    const summary = `${error.decision.summary}${packageNote}${alongside.length ? ` Ask in the same question, before Build: ${
      alongside.map((item) => `${item.summary} (${item.next})`).join("; ")}` : ""}`;
    return advanceFailureAction(id, Object.assign(error, {
      message: summary,
      decision: { ...error.decision, summary, ...(alongside.length ? { alongside } : {}),
        ...(link?.path ? { approvalPackage: link.path } : {}) }
    }), options);
  }

  const recovery = createAdvanceRecovery({
    loadRuntime, saveRuntime,
    // Failure recovery may run after captureAsync has unwound. Keep runtime
    // fail() calls throwable while reading the recovery binding there too.
    subject: (id) => capture(() => convergenceFingerprint(id)),
    now: () => new Date(nowMs()).toISOString()
  });

  function projected(value) {
    const result = lifecycleOutcome(actionableGuidance(value));
    return { ...result, userState: lifecycleUserState(result), user: lifecycleUserProjection(result) };
  }

  // Agents open only these files: the packet and the handed tasks' paths.
  function withContext(id, value) {
    if (!changePath || !value || !["EDIT", "REPAIR"].includes(value.action) || value.contextFiles)
      return value;
    try {
      return capture(() => {
        const tasks = value.tasks || [];
        const paths = tasks.length ? [] : value.allowedPaths || [];
        const scopedPaths = (value.repairGraph?.nodes || []).flatMap((node) => node.paths || []);
        const state = loadRuntime(id);
        // An EDIT names no skills: in every observed paid run agents skipped
        // routed skills, wherever the action put them. Agents choose skills
        // from the skills' own descriptions.
        const adequacy = value.action === "EDIT"
          ? testAdequacyInstruction({ workTypes: changeWorkTypes(changePath(id)), tasks }) : null;
        return { ...value, ...envelopeContextFiles({
          packetDir: changePath(id), state, tasks, paths, scopedPaths
        }), ...(adequacy ? { instructions: [...(value.instructions || []), adequacy] } : {}) };
      });
    } catch { return value; }
  }

  function pendingAction(id, through, pending) {
    return envelope(id, pending.paused ? "WAIT" : "ASK_USER", {
      legacyAction: pending.paused ? "PAUSED_BY_USER" : pending.legacyAction || "NO_PROGRESS_BOUNDARY",
      actor: pending.paused ? "harness" : "user",
      boundary: pending.paused ? "user-paused" : pending.boundary || "repeated-no-progress",
      decision: pending.decision,
      ...(pending.paused ? { paused: true, wait: {
        owner: "user", condition: "The user explicitly chooses to resume the preserved work."
      } } : {}),
      reason: pending.paused ? "Delivery is paused by the user; work and evidence are preserved."
        : pending.decision.summary,
      recoveryType: pending.paused ? "PAUSE" : "ASK_USER", resumeCommand: resume(id, through || pending.through)
    });
  }
  function readAdvanceValue(id, options = {}, automation = {}) {
    let stage = "build";
    try {
      return capture(() => {
        const state = loadRuntime(id);
        assertApproval?.(id, state);
        if (state.status === "archived") return coordinatorAction({
          id, state, dispatch: { action: "build-complete" }, workspaceHash: null,
          stableHash
        });
        if (state.status === "proven") stage = "land";
        const authority = authorityStatusValue(id);
        // Plan once per read: dispatch and the Build action consume the same
        // compiled graph. A planning failure leaves dispatch to plan (and
        // report) exactly as before.
        let readPlan = null;
        if (agentPlanValue) {
          try { readPlan = agentPlanValue(id, options); }
          catch { readPlan = null; }
        }
        const dispatch = agentDispatchValue(id, options, readPlan);
        let proofPreflight = null;
        if (dispatch.action === "build-complete") {
          stage = "prove";
          if (proofReadinessValue) proofPreflight = proofReadinessValue(id, "prove", options);
        }
        const openRequests = authority.requests || [];
        let plan = null;
        if (agentPlanValue && ["run-in-session", "run-leased-in-session", "spawn-group"]
          .includes(dispatch.action)) {
          try { plan = readPlan || agentPlanValue(id, options); }
          catch { /* dispatch still carries an exact compatibility route */ }
        }
        const workspaceHash = dispatch.action === "build-complete" && proofPreflight
          ? proofPreflight.workspaceHash : relevantHash(id);
        const proofCursor = readJson(proofAdvancePath(id), {});
        // The cursor this decision was read from; a proof run started from it
        // can tell a gate pass another process recorded in the meantime.
        if (automation) automation.proofCursorToken = proofCursorToken(proofCursor);
        return coordinatorAction({
          id,
          state,
          dispatch,
          workspaceHash,
          latestReview: currentWaivers(state, workspaceHash).some((row) => row.capability === "review")
            ? null : deliveredAiAttempts(id).at(-1) || null,
          proofCursor,
          authorityRequests: openRequests,
          proofPreflight,
          plan,
          proofIsCurrent: proofIsCurrent && state.status === "proven"
            ? proofIsCurrent(id) : null,
          authorityActions: authorityNext
            ? authorityNext(id, openRequests[0]?.type || "review", openRequests) : null,
          stableHash,
          automation
        });
      });
    } catch (error) {
      markBlocked(error?.message || String(error));
      return failureAction(id, error, { stage });
    }
  }

  function phaseForAction(value) {
    if (["REPAIR_PROVE_RUNTIME", "REPAIR_REVIEW_INFRASTRUCTURE"].includes(value.legacyAction)) return "prove";
    if (value.legacyAction === "REPAIR_LAND_RUNTIME") return "land";
    if (value.action === "EDIT" || value.action === "REPAIR") return "build";
    if (value.legacyAction === "LAND_READY" || value.reached === "archived") return "land";
    if (["RUN_PROOF", "RUN_INVALIDATED_EVIDENCE", "RUN_CONFIGURED_REVIEW", "WIRE_EVIDENCE",
      "WAIT_EXTERNAL", "REQUEST_DECISION"].includes(value.legacyAction)) return "prove";
    return null;
  }

  // A Land grant outlives a Prove rerun, so an in-progress Land journal stays
  // reusable. It short-circuits to Land only while the lifecycle is landable:
  // mid-apply, or proven on proof current for this workspace. A change sent
  // back to Build (root-pointer staging, target-edit or sandbox sync) re-proves
  // first instead of retrying a Land that its gate must refuse.
  function landableGrant(id) {
    if (!hasLandGrant(id)) return false;
    const status = loadRuntime(id).status;
    if (status === "applied") return true;
    return status === "proven" && (!proofIsCurrent || proofIsCurrent(id));
  }

  function reached(id, through) {
    const state = loadRuntime(id);
    if (state.status === "archived") return "archived";
    if (through === "proven" && state.status === "proven" &&
        (!proofIsCurrent || proofIsCurrent(id))) return "proven";
    return null;
  }

  // The latest AI review's advisory spec gaps ride on a proven or archived
  // result so the agent reports them; they never change the outcome.
  function reviewSpecGaps(id) {
    try {
      const gaps = deliveredAiAttempts(id).at(-1)?.specGaps;
      return Array.isArray(gaps) ? gaps : [];
    } catch { return []; }
  }

  function done(id, stage, through) {
    const next = stage === "build" ? resume(id, "proven")
      : stage === "proven" ? resume(id, "archived") : null;
    const specGaps = stage === "build" ? [] : reviewSpecGaps(id);
    return envelope(id, "DONE", {
      legacyAction: stage === "archived" ? "ARCHIVED" : "TARGET_REACHED",
      reason: `${stage} target reached`, completed: true, reached: stage,
      resumeCommand: null,
      ...(specGaps.length ? { reviewAdvisories: { specGaps } } : {}),
      next
    });
  }

  function convergenceFingerprint(id) {
    const state = loadRuntime(id);
    const proof = readJson(proofAdvancePath(id), {});
    const repositoryState = Object.entries(state.repositories || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repository, value]) => [repository, {
        mode: value.mode || null,
        path: value.path || null,
        targetPath: value.targetPath || null,
        baseHead: value.baseHead || null,
        access: value.access || null,
        applied: value.applied === true,
        setupStatus: value.setup?.status || null,
        landCommit: value.land?.commit || null,
        landStatus: value.land?.status || null
      }]);
    return stableHash({
      workspaceHash: relevantHash(id),
      state: {
        status: state.status,
        contractRevision: state.contractRevision || 0,
        executionRevision: state.executionRevision || 0,
        approval: state.specApproval?.decisionRef || null,
        reviewContinuation: state.reviewWindow?.decisionRef || null,
        waivers: state.waivers || [],
        workspace: {
          mode: state.workspace?.mode || null,
          path: state.workspace?.path || null,
          baseHead: state.workspace?.baseHead || null,
          applied: state.workspace?.applied === true
        },
        repositories: repositoryState,
        applyStatus: state.apply?.status || state.applyTransaction?.status || null,
        landStatus: state.land?.status || null
      },
      proof: {
        status: proof.status || null,
        stage: proof.stage || null,
        completed: proof.completed === true,
        workspaceHash: proof.workspaceHash || null,
        route: proof.route || null,
        requestIds: [...(proof.requestIds || [])].sort(),
        providers: [...(proof.providers || [])].sort(),
        subjectHash: proof.subjectHash || null,
        recoveryDecisionRef: proof.recoveryDecisionRef || null,
        progressFingerprint: proof.progressFingerprint || null,
        repairPlanDigest: proof.repairPlanDigest || null,
        next: (proof.next || []).map((row) => ({
          kind: row.kind || null, command: row.command || null
        }))
      }
    });
  }

  // Review runs change authority state that the delivery fingerprint does not
  // bind; count them as progress only when a request actually moved.
  function reviewProgressFingerprint(id) {
    let requests = [];
    try { requests = authorityStatusValue(id).requests || []; } catch { /* unavailable */ }
    return stableHash({
      delivery: convergenceFingerprint(id),
      requests: requests.map((row) => [row.requestId, row.status, row.dispatch?.attemptDigest || null])
    });
  }

  // An automated step that keeps completing without progress is handed to the
  // agent with what the step returned. Repeated rounds stay with the agent:
  // the recovery ladder changes strategy and never asks for code work.
  function noProgress(id, through, operation = null, result = null) {
    const name = operation?.legacyAction || "the automated step";
    const output = result && typeof result === "object"
      ? { issues: result.issues || null, next: result.next || null, reason: result.reason || null }
      : null;
    const observed = noProgressOutput(output);
    return projected(recovery.observe(id, withContext(id, envelope(id, "REPAIR", {
      legacyAction: "NO_PROGRESS_BOUNDARY", actor: "agent",
      boundary: "repeated-no-progress",
      reason: `The harness ran ${name} twice without changing delivery state`,
      details: output,
      step: { route: name, output: observed || null },
      instruction: `The harness ran ${name} twice and delivery state did not change. Its result: ${
          observed || "no issue, reason, or next step was reported"}. Fix what that result names ` +
        "inside the workspace (code, evidence wiring in execution.yaml, or declared setup in " +
        "foundation.json) so the step can change state, then run the resume command.",
      recoveryType: "HANDOFF",
      resumeCommand: resume(id, through)
    }))));
  }

  // An interrupted apply is settled by the harness under the Land route that
  // started it: `settle` finishes or reverses only bytes Land wrote, and
  // `keep-current` overwrites nothing (the kept target is then synchronized
  // and proved again through `recovery-sync-required`). Each resolution runs
  // at most once per invocation; if it cannot finish, the agent receives the
  // divergent paths and the transaction location, never the user.
  async function recoverInterruptedApply(id, through, value, internal) {
    const { resolution, divergentPaths = [] } = value.automaticRecovery;
    const notice = `Land kept an interrupted apply recoverable (${resolution})` +
      (divergentPaths.length ? `; the target held other content at: ${divergentPaths.join(", ")}` : "");
    recordSignal("apply-recovered", notice);
    const handoff = (reason) => projected(recovery.observe(id, withContext(id, envelope(id, "REPAIR", {
      actor: "agent", owner: "agent", legacyAction: "REPAIR_APPLY_RECOVERY",
      boundary: "internal-recovery", reason,
      details: { resolution, divergentPaths, transactions: value.decision?.transactions || [],
        transactionRoot: value.decision?.transactionRoot || null },
      instruction: "Automatic apply recovery could not finish. Compare the listed target paths " +
        "with the sandbox and the transaction backup, make each target path hold the intended " +
        "content without deleting anyone's work, then run the resume command.",
      recoveryType: "EDIT", resumeCommand: resume(id, through)
    }))));
    if (internal.applyRecovered.includes(resolution))
      return handoff(`The ${resolution} recovery already ran and the interrupted apply is still pending: ${value.reason}`);
    const next = { ...internal, applyRecovered: [...internal.applyRecovered, resolution],
      notices: [...internal.notices, notice] };
    try {
      await captureAsync(() => recoverApply(id, resolution));
    } catch (error) {
      // A settle that meets divergent content leaves a manual-recovery journal;
      // the next pass keeps the current target instead of stopping.
      if (resolution !== "settle") return handoff(`Automatic ${resolution} recovery failed: ${error.message}`);
    }
    const result = await advanceThrough(id, through, next);
    return { ...result, notices: [...new Set([...(result.notices || []), ...next.notices])] };
  }

  async function advanceThrough(id, through, internal = { applyRecovered: [], notices: [] }) {
    let stage = "build";
    const finish = async (value) => {
      if (issueSessionLease && value?.action === "EDIT") {
        try { value = capture(() => issueSessionLease(id, value)); }
        catch (error) { value = failureAction(id, error, { stage, through }); }
      }
      value = projected({ ...withContext(id, value), resume: resume(id, through), resumeCommand: resume(id, through) });
      try { value = projected(recovery.observe(id, value)); }
      catch (error) {
        // Recovery bookkeeping must not hide the original failure or turn a
        // corrupt/missing runtime into an uncaught exception loop. It is
        // harness bookkeeping, never a user decision: resume retries it.
        return envelope(id, "REPAIR", {
          actor: "harness", owner: "harness", legacyAction: "REPAIR_RECOVERY_STATE",
          boundary: "internal-recovery",
          reason: `${value.reason}; recovery state could not be retained: ${error.message}`,
          details: { original: value, error: error.message },
          command: resume(id, through),
          instruction: "The harness could not record recovery state; run the resume command to retry it.",
          recoveryType: "AUTO_RECOVER", resumeCommand: resume(id, through)
        });
      }
      if (value.action === "REPAIR" && value.automaticRecovery?.kind === "sandbox-sync" && recoverSandbox) {
        try {
          const result = await captureAsync(() => recoverSandbox(id));
          if (result?.conflicts?.length || result?.status === "CONFLICT")
            return projected(recovery.observe(id, withContext(id, envelope(id, "REPAIR", {
              actor: "agent", legacyAction: "REPAIR_SYNC_CONFLICT", boundary: "conflict",
              reason: "Sandbox synchronization found conflicting changes; choose the intended result before merging." +
                (result.conflicts?.some((row) => row?.landedBy) ? " Keep every earlier change's landed " +
                  "content; ask the user only if the two changes' intents contradict." : ""),
              details: result, recoveryType: "EDIT", resumeCommand: resume(id, through)
            }))));
          return advanceThrough(id, through, internal);
        } catch (error) {
          return projected(recovery.observe(id, failureAction(id, error, { stage, through })));
        }
      }
      if (value.action === "REPAIR" && value.automaticRecovery?.kind === "apply-recovery" &&
          recoverApply && through === "archived")
        return recoverInterruptedApply(id, through, value, internal);
      return value;
    };
    let recordedPhase = null;
    const recordActivePhase = (phase) => {
      if (phase && phase !== recordedPhase && recordPhase) {
        recordPhase(id, phase);
        recordedPhase = phase;
      }
    };
    try {
      return await captureAsync(async () => {
        if (through && !["build", "proven", "archived"].includes(through))
          throw new Error("advance --through must be build|proven|archived");
        let initial = loadRuntime(id);
        // Remember the furthest target asked for, so a route printed later
        // (next:, resume hints) continues toward it instead of repeating a
        // shorter one. Monotonic; Land authority is still its own grant.
        if (through && initial.status !== "archived" &&
            (THROUGH_ORDER.indexOf(through) > THROUGH_ORDER.indexOf(initial.requestedThrough))) {
          initial.requestedThrough = through;
          saveRuntime(initial);
        }
        if (through === "archived" && recoverArchive) {
          if (["proven", "applied", "archived"].includes(initial.status)) stage = "land";
          if (initial.advanceRecovery?.pending?.paused)
            return pendingAction(id, through, initial.advanceRecovery.pending);
          if (await recoverArchive(id)) return done(id, "archived", through);
        }
        if (initial.status === "archived") return done(id, "archived", through);
        if (initial.workspace?.amendmentReplay && recoverWorkspace) {
          if (initial.advanceRecovery?.pending?.paused)
            return pendingAction(id, through, initial.advanceRecovery.pending);
          // Approval belongs to the packet retained in replay staging. Restore
          // verified bytes before checking it; never grant or refresh approval.
          await recoverWorkspace(id);
          initial = loadRuntime(id);
        }
        const explicitLand = through === "archived" && landableGrant(id);
        if (!explicitLand) assertApproval?.(id, initial, { workspace: false });
        const pending = recovery.pending(id);
        if (pending && (pending.paused || pending.decision.kind !== "external-dependency"))
          return pendingAction(id, through, pending);
        // A recorded user answer to an advance-owned decision is consumed
        // once, by the step that raised it: the agreement resolution by the
        // synchronization, the indeterminate retry by the next proof run.
        const answer = internal.answer;
        if (answer) delete internal.answer;
        if (answer?.kind === "amended-agreement-conflict" && answer.choice !== "pause" &&
            synchronizeAgreement)
          await synchronizeAgreement(id, { resolve: `openspec/changes/${id}` });
        // An answer to a no-progress decision other than pause resumes the
        // gate as a first observation, so it returns repair work, not the
        // same question.
        const proofFlags = answer?.kind === "indeterminate-execution" && answer.choice === "retry"
          ? { "retry-indeterminate": true, "decision-ref": answer.reference }
          : answer?.kind === "repair-no-progress" && answer.choice !== "pause"
            ? { "reset-progress": true, "decision-ref": answer.reference } : null;
        // Preparation is identity-reused and also owns recovery of failed
        // sandbox setup. Re-enter it while Build is active so a prior setup
        // failure cannot be bypassed by the next coordinator invocation.
        if (!explicitLand && ["change", "building"].includes(initial.status) && prepareBuild) {
          recordActivePhase("build");
          await prepareBuild(id);
        }
        // Resuming after a session task is its completion signal: release the
        // harness-issued lease and record the task before dispatching again.
        if (!explicitLand && settleSessionLeases && loadRuntime(id).status === "building")
          capture(() => settleSessionLeases(id));
        // Implemented tasks whose execution record went stale are re-verified
        // by the harness, never handed back as work to redo or diffs to split.
        if (!explicitLand && reverifyCompletedTasks && loadRuntime(id).status === "building")
          capture(() => reverifyCompletedTasks(id));
        // Build preparation already synchronizes a revised agreement. After
        // proof, the same safe sync replaces an operator `sandbox sync`: it
        // invalidates only evidence the revision touched, and Land would
        // otherwise refuse the edited packet.
        if (synchronizeAgreement && loadRuntime(id).status === "proven")
          await synchronizeAgreement(id);
        if (!through) return finish(readAdvanceValue(id));
        const targetResume = (value) => ({
          ...value,
          resume: resume(id, through),
          resumeCommand: resume(id, through)
        });
        let unchangedAutomations = 0;
        const automation = { wiringAttempted: false };
        while (true) {
          const completed = reached(id, through);
          if (completed) return done(id, completed, through);
          let value = through === "archived" && landableGrant(id)
            ? { action: "WORKING", legacyAction: "LAND_READY", actor: "harness",
              reason: "explicit Land authority accepts the current assurance" }
            : readAdvanceValue(id, {}, automation);
          if (through !== "build" && value.legacyAction === "REPAIR_REVIEW_INFRASTRUCTURE" &&
              recoverReviewBindings) {
            stage = "prove";
            recordActivePhase("prove");
            if (await recoverReviewBindings(id)) value = readAdvanceValue(id, {}, automation);
          }
          if (through === "build" && ["RUN_PROOF", "WIRE_EVIDENCE", "LAND_READY"].includes(value.legacyAction)) {
            recordActivePhase("build");
            return done(id, "build", through);
          }
          const phase = phaseForAction(value);
          recordActivePhase(phase);
          let operation = null;
          let harnessOwned = false;
          if (value.legacyAction === "WIRE_EVIDENCE" && value.automaticWiring &&
              ["proven", "archived"].includes(through) && wireEvidence) {
            // Once per invocation: wiring that did not clear the gap falls
            // back to the external-evidence decision instead of repeating.
            stage = "prove";
            automation.wiringAttempted = true;
            harnessOwned = true;
            operation = (change) => wireEvidence(change, value.automaticWiring);
          } else if (value.legacyAction === "RUN_CONFIGURED_REVIEW" && value.automaticReview &&
              ["proven", "archived"].includes(through) && runReview) {
            // Foreground and bounded by the review window, like `authority run`.
            stage = "prove";
            harnessOwned = true;
            operation = (change) => runReview(change, value.automaticReview);
          } else if (["RUN_PROOF", "RUN_INVALIDATED_EVIDENCE"].includes(value.legacyAction) &&
              ["proven", "archived"].includes(through)) {
            if (!runProof) return finish(targetResume(value));
            stage = "prove";
            const answered = proofFlags && !automation.proofFlagsUsed ? proofFlags : null;
            if (answered) automation.proofFlagsUsed = true;
            const flags = { ...(answered || {}),
              ...(typeof automation.proofCursorToken === "string"
                ? { "cursor-token": automation.proofCursorToken } : {}) };
            operation = Object.keys(flags).length ? (change) => runProof(change, flags) : runProof;
          } else if (value.legacyAction === "LAND_READY" && through === "archived") {
            // The explicit archived target authorizes Land only once the exact
            // proof is ready. Earlier phases and inspection grant nothing.
            if (!explicitLand && !hasLandGrant(id) && authorizeLand) await authorizeLand(id);
            if (!explicitLand && !hasLandGrant(id)) return finish(targetResume(value));
            if (!runLand) return finish(targetResume(value));
            stage = "land";
            operation = runLand;
          }
          if (!operation) return finish(targetResume(value));
          const fingerprint = harnessOwned ? reviewProgressFingerprint : convergenceFingerprint;
          const before = fingerprint(id);
          const operationResult = await operation(id);
          // Archive may remove the sandbox and active agreement. Do not hash
          // those retired paths after the authoritative lifecycle reached its
          // target; the archived proof already retains its durable identity.
          const completedAfterOperation = reached(id, through);
          if (completedAfterOperation) return done(id, completedAfterOperation, through);
          // An operation is the authoritative source for its own boundary.
          // Consume it before consulting projections, otherwise quiet proof or
          // Land composition can discard a decision and repeat the operation.
          // Wiring and review results are consumed by the next proof pass.
          const boundaryResult = harnessOwned ? null : stage === "land"
            ? landOperationAction(id, operationResult)
            : proofOperationAction(id, operationResult);
          // A reviewer the harness can run is consumed by the next pass.
          const reviewNext = boundaryResult?.automaticReview && runReview;
          if (boundaryResult && boundaryResult.legacyAction !== "LAND_IN_PROGRESS" && !reviewNext)
            return finish(targetResume(boundaryResult));
          const after = fingerprint(id);
          unchangedAutomations = before === after ? unchangedAutomations + 1 : 0;
          if (unchangedAutomations >= 2) return noProgress(id, through, value, operationResult);
        }
      });
    } catch (error) {
      markBlocked(error?.message || String(error));
      return finish(failureAction(id, error, { stage, through }));
    }
  }

  function advanceValue(id, options = {}) {
    const read = () => {
      const value = withContext(id, readAdvanceValue(id, options));
      try {
        const pending = recovery.pending(id);
        if (pending)
          return pendingAction(id, null, pending);
      } catch { /* The original diagnostic already describes unavailable state. */ }
      return value;
    };
    return options.inspect ? inspectSnapshots(read) : read();
  }

  async function showAdvance(id, flags = {}) {
    if (flags.inspect && (flags.through || flags.decision || flags["decision-ref"] || flags["decision-fingerprint"] || flags.reason))
      throw new Error("advance --inspect cannot execute --through; inspect first, then advance");
    let through = flags.through || null;
    let answer = null;
    if (flags.decision) {
      answer = recovery.resolve(id, flags);
      through ||= answer.through;
    }
    const value = withSignals(flags.inspect ? advanceValue(id, { inspect: true })
      : await advanceThrough(id, through, { applyRecovered: [], notices: [], answer }));
    if (!flags.through && !flags.inspect &&
        process.env.FOUNDATION_READ_ONLY_INSPECTION !== "1") {
      const phase = phaseForAction(value);
      if (phase && recordPhase) recordPhase(id, phase);
    }
    output(JSON.stringify(value, null, flags.pretty ? 2 : 0));
    return value;
  }

  return { advanceValue, advanceThrough, showAdvance };
}
export async function prepareAdvanceBuild(context, id) {
  return context.measureAsync("build.prepare", () => context.runQuietly(async () => {
    context.prepareBuildSandbox(id);
    context.prepareExecution(id, { stage: "build" });
  }));
}

// Only the `advance --through proven|archived` route runs a harness-runnable
// configured review beside the executable providers; `proof advance` stays
// serial.
export async function runAdvanceProof(context, id, flags = null) {
  return context.measureAsync("prove.execute", () =>
    context.runQuietly(() => {
      // Prove validates the agreement with the strict OpenSpec lint, so a
      // resumed Prove re-prepares the tool Build prepared, like Land does.
      context.prepareExecution(id, { stage: "prove" });
      // `flags` carries only a recorded user answer to an indeterminate run.
      return context.proofAdvance(id, { ...(flags || {}), quiet: true, concurrentReview: true });
    }));
}

export function hasValidLandGrant(landGrantRuntime, id) {
  return landGrantRuntime.valid(id).valid;
}
