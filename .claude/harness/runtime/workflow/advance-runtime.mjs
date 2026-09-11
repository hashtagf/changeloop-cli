import { reviewWindowRemaining, reviewWindowError, currentWaivers } from "../core/user-decisions.mjs";
import { repairActionForWorkspace } from "../evidence/repair-runtime.mjs";
import {
  lifecycleOutcome, lifecycleUserProjection, lifecycleUserState
} from "../core/lifecycle-outcome.mjs";

export const ADVANCE_PROTOCOL_VERSION = 5;

const command = (value) => `claude-foundation ${value}`;

const resume = (id, through = null) => command(
  `advance ${id}${through ? ` --through ${through}` : ""}`);

function envelope(id, action, values = {}) {
  const {
    legacyAction = null, boundary = null, actor = "harness", reason = null,
    resumeCommand = resume(id), recoveryType = null, alternatives = [], ...rest
  } = values;
  const value = lifecycleOutcome({
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
  });
  return {
    ...value,
    userState: lifecycleUserState(value),
    user: lifecycleUserProjection(value)
  };
}

function taskVerification(text) {
  return String(text || "").match(/—\s*verify:\s*`([^`]+)`/i)?.[1] || null;
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

export function advanceFailureAction(id, error, { stage = "build", through = null } = {}) {
  const reason = error?.message || String(error);
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
  if (error?.owner === "external") return envelope(id, "WAIT", {
    legacyAction: "WAIT_EXTERNAL",
    actor: "external-authority",
    boundary: error?.boundary || "external-authority",
    reason,
    recoveryType: "PAUSE",
    alternatives: error?.details?.alternatives || [],
    resumeCommand: resume(id, through)
  });
  const fallback = stage === "land"
    ? command(`land check ${id}`)
    : command(`doctor --stage ${stage === "prove" ? "prove" : "build"} --change ${id}`);
  return envelope(id, "REPAIR", {
    legacyAction: `REPAIR_${stage.toUpperCase()}_RUNTIME`,
    actor: error?.owner === "harness" ? "harness" : "agent",
    boundary: error?.boundary || "resource",
    reason,
    details: error?.details || null,
    command: exactRecoveryCommand(reason) || fallback,
    recoveryType: "RECONFIGURE",
    alternatives: ["run the exact recovery command, then resume the same lifecycle route"],
    resumeCommand: resume(id, through)
  });
}

function proofOperationAction(id, result) {
  if (!result || typeof result !== "object") return null;
  if (result.action) return result;
  if (["PASS", "READY"].includes(result.status) || result.completed === true) return null;
  if (result.status === "IN_PROGRESS") return envelope(id, "WORKING", {
    legacyAction: "PROOF_IN_PROGRESS",
    actor: "harness",
    boundary: "internal-lock",
    reason: "proof is already running for this change",
    wait: { owner: result.owner || null, next: result.next || [] },
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
      alternatives: ["repair or switch the configured reviewer, then resume"]
    });
  if (result.status === "WAITING_EXTERNAL") {
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
      recoveryType: "HANDOFF",
      alternatives: ["run the configured reviewer", "record an authorized external verdict"]
    });
    return envelope(id, "WAIT", {
      legacyAction: "WAIT_EXTERNAL",
      actor: "external-authority",
      boundary: "external-authority",
      reason: result.next?.[0]?.reason || "required external evidence is pending",
      requests: result.requests || [],
      providers: result.providers || [],
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

function selectedBuildTasks(dispatch, plan) {
  const ids = dispatch.action === "spawn-group"
    ? (dispatch.workers || []).map((worker) => worker.taskId)
    : dispatch.task?.taskId ? [dispatch.task.taskId]
      : (plan?.groups?.[0] || plan?.tasks?.slice(0, 1).map((task) => task.id) || []);
  return ids.map((id) => plan?.tasks?.find((task) => task.id === id))
    .filter(Boolean).map((task) => ({
      id: task.id,
      instruction: task.text,
      repository: task.repository,
      allowedPaths: task.paths || [],
      verification: [taskVerification(task.text)].filter(Boolean)
    }));
}

function buildAction(id, dispatch, state, plan = null) {
  if (dispatch.action === "build-complete") return null;
  if (["run-in-session", "run-leased-in-session", "spawn-group"].includes(dispatch.action)) {
    const tasks = selectedBuildTasks(dispatch, plan);
    if (!plan || tasks.length === 0 || tasks.some((task) =>
      !task.id || task.allowedPaths.length === 0)) return envelope(id, "REPAIR", {
      legacyAction: "REPAIR_BUILD_PLAN",
      actor: "harness",
      boundary: "contract",
      reason: "the compiled Build plan is missing executable task or path scope",
      recoveryType: "AUTO_RECOVER",
      alternatives: ["regenerate the compiled task graph from the current agreement"]
    });
    return envelope(id, "EDIT", {
      legacyAction: dispatch.action === "spawn-group" ? "EXECUTE_TASK_GROUP" : "EXECUTE_TASK",
      actor: "agent",
      boundary: "host-execution",
      reason: dispatch.reason,
      workspace: state.workspace?.path || null,
      tasks,
      allowedPaths: [...new Set(tasks.flatMap((task) => task.allowedPaths))],
      verification: [...new Set(tasks.flatMap((task) => task.verification))],
      execution: {
        mode: dispatch.action === "spawn-group" ? "parallel" : "session",
        leases: dispatch.action === "spawn-group" ? dispatch.workers :
          dispatch.task ? [dispatch.task] : []
      },
      recoveryType: "EDIT",
      alternatives: ["amend the agreement if Build discovers new behavior"]
    });
  }
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
    recoveryType: "RECONFIGURE",
    alternatives: ["repair the agreement or task graph", "inspect the Build diagnostic"]
  });
}

export function coordinatorAction({
  id, state, dispatch, workspaceHash, latestReview = null,
  proofCursor = {}, authorityRequests = [], stableHash, authorityActions = null,
  proofPreflight = null, plan = null, budget = null
}) {
  if (state.status === "archived") return envelope(id, "DONE", {
    legacyAction: "ARCHIVED", boundary: null, reason: "change is archived",
    completed: true, reached: "archived", resumeCommand: null
  });

  if (dispatch.action !== "build-complete" &&
      budget?.status === "NEEDS_USER_DECISION") return envelope(id, "ASK_USER", {
    legacyAction: "BUDGET_DECISION_REQUIRED",
    actor: "user",
    boundary: "user-authority",
    reason: budget.decision?.summary || "the active model budget is exhausted",
    decision: budget.decision,
    recoveryType: "ASK_USER",
    alternatives: budget.decision?.options?.map((option) => option.outcome) || []
  });

  const pendingBuild = buildAction(id, dispatch, state, plan);
  if (pendingBuild) return pendingBuild;

  // A successful proof supersedes earlier review failures. Without this
  // ordering, the last failed AI attempt could keep routing a proven change
  // back into repair after deterministic closure had already passed.
  const proofCurrent = proofCursor.workspaceHash === workspaceHash &&
    (["proven", "landing"].includes(state.status) || proofCursor.status === "PASS");
  if (proofCurrent)
    return envelope(id, "ASK_USER", {
      legacyAction: "LAND_READY", actor: "user", 
      boundary: "land-authority",
      reason: "proof is current; explicit Land authority is required",
      command: command(`land advance ${id}`),
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
      alternatives: ["repair or switch the configured reviewer, then resume"]
    });
    const configuredReview = open.type === "review" && open.status === "requested" &&
      /^claude-foundation authority run\s/.test(authorityCommand || "");
    return envelope(id, configuredReview ? "RUN_EXTERNAL" : "WAIT", {
      legacyAction: configuredReview ? "RUN_CONFIGURED_REVIEW" : "WAIT_EXTERNAL",
      actor: configuredReview ? "configured-reviewer" : "external-authority",
      boundary: "external-authority",
      reason: configuredReview ? "configured review is ready" :
        open.type === "review" && open.status === "requested"
          ? "bounded AI review is unavailable; an external verdict is pending"
          : "external authority is pending",
      requestId: open.requestId,
      command: authorityCommand || command(`authority status ${id} --request ${open.requestId}`),
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
  budgetDecisionValue = null,
  nowMs = Date.now,
  assertApproval = null,
  prepareBuild = null, runProof = null, runLand = null,
  recoverReviewBindings = null,
  authorizeLand = null,
  hasLandGrant = () => false,
  recordPhase = null, output = console.log,
  capture = (operation) => operation(),
  captureAsync = async (operation) => operation(),
  markBlocked = () => {}
}) {
  function readAdvanceValue(id, options = {}) {
    let stage = "build";
    try {
      return capture(() => {
        const state = loadRuntime(id);
        assertApproval?.(id, state);
        if (state.status === "archived") return coordinatorAction({
          id, state, dispatch: { action: "build-complete" }, workspaceHash: null,
          stableHash
        });
        if (["proven", "landing"].includes(state.status)) stage = "land";
        const authority = authorityStatusValue(id);
        const dispatch = agentDispatchValue(id, options);
        const budget = budgetDecisionValue ? budgetDecisionValue(state) : null;
        let proofPreflight = null;
        if (dispatch.action === "build-complete") {
          stage = "prove";
          if (proofReadinessValue) proofPreflight = proofReadinessValue(id, "prove", options);
        }
        const openRequests = authority.requests || [];
        if (openRequests.some((request) => request.type === "review" &&
            ["requested", "dispatched", "infrastructure-exhausted"].includes(request.status)) &&
            !reviewWindowRemaining(state, nowMs())) throw reviewWindowError(id);
        let plan = null;
        if (agentPlanValue && ["run-in-session", "run-leased-in-session", "spawn-group"]
          .includes(dispatch.action)) {
          try { plan = agentPlanValue(id, options); }
          catch { /* dispatch still carries an exact compatibility route */ }
        }
        const workspaceHash = dispatch.action === "build-complete" && proofPreflight
          ? proofPreflight.workspaceHash : relevantHash(id);
        return coordinatorAction({
          id,
          state,
          dispatch,
          workspaceHash,
          latestReview: currentWaivers(state, workspaceHash).some((row) => row.capability === "review")
            ? null : deliveredAiAttempts(id).at(-1) || null,
          proofCursor: readJson(proofAdvancePath(id), {}),
          authorityRequests: openRequests,
          proofPreflight,
          plan,
          budget,
          authorityActions: authorityNext
            ? authorityNext(id, openRequests[0]?.type || "review", openRequests) : null,
          stableHash
        });
      });
    } catch (error) {
      markBlocked(error?.message || String(error));
      return advanceFailureAction(id, error, { stage });
    }
  }

  function phaseForAction(value) {
    if (["REPAIR_PROVE_RUNTIME", "REPAIR_REVIEW_INFRASTRUCTURE"].includes(value.legacyAction)) return "prove";
    if (value.legacyAction === "REPAIR_LAND_RUNTIME") return "land";
    if (value.action === "EDIT" || value.action === "REPAIR") return "build";
    if (value.legacyAction === "LAND_READY" || value.reached === "archived") return "land";
    if (["RUN_PROOF", "RUN_INVALIDATED_EVIDENCE", "RUN_CONFIGURED_REVIEW",
      "WAIT_EXTERNAL", "REQUEST_DECISION"].includes(value.legacyAction)) return "prove";
    return null;
  }

  function reached(id, through) {
    const state = loadRuntime(id);
    if (state.status === "archived") return "archived";
    if (through === "proven" && ["proven", "landing"].includes(state.status)) return "proven";
    return null;
  }

  function done(id, stage, through) {
    const next = stage === "build" ? resume(id, "proven")
      : stage === "proven" ? resume(id, "archived") : null;
    return envelope(id, "DONE", {
      legacyAction: stage === "archived" ? "ARCHIVED" : "TARGET_REACHED",
      reason: `${stage} target reached`, completed: true, reached: stage,
      resumeCommand: null,
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
      state: {
        status: state.status,
        revision: state.revision || 0,
        contractRevision: state.contractRevision || 0,
        executionRevision: state.executionRevision || 0,
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
        proofRunId: proof.proofRunId || null,
        route: proof.route || null,
        requestIds: [...(proof.requestIds || [])].sort(),
        providers: [...(proof.providers || [])].sort(),
        subjectHash: proof.subjectHash || null,
        recoveryDecisionRef: proof.recoveryDecisionRef || null,
        progressFingerprint: proof.progressFingerprint || null,
        repairCycle: Number(proof.repairCycle || 0),
        repairPlanDigest: proof.repairPlanDigest || null,
        next: (proof.next || []).map((row) => ({
          kind: row.kind || null, command: row.command || null
        }))
      }
    });
  }

  function noProgress(id, through) {
    const decision = {
      kind: "repair-no-progress",
      summary: "The same authorized operation completed twice without changing delivery state",
      options: [
        { id: "revise", outcome: "revise the work or contract so the blocked result can change" },
        { id: "land", outcome: "After inspecting remaining findings and the current diff, explicitly accept waivable evidence gaps and Land; conflicts and failed Apply still require recovery" },
        { id: "pause", outcome: "preserve the current state and stop this delivery attempt" }
      ],
      recommended: "revise"
    };
    return envelope(id, "ASK_USER", {
      legacyAction: "NO_PROGRESS_BOUNDARY", actor: "user",
      boundary: "repeated-no-progress", decision,
      reason: decision.summary,
      recoveryType: "ASK_USER",
      alternatives: decision.options.map((option) => option.outcome),
      resumeCommand: resume(id, through)
    });
  }

  async function advanceThrough(id, through) {
    let stage = "build";
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
        const initial = loadRuntime(id);
        assertApproval?.(id, initial, { workspace: false });
        // Preparation is identity-reused and also owns recovery of failed
        // sandbox setup. Re-enter it while Build is active so a prior setup
        // failure cannot be bypassed by the next coordinator invocation.
        if (["change", "building"].includes(initial.status) && prepareBuild) {
          recordActivePhase("build");
          await prepareBuild(id);
        }
        if (!through) return advanceValue(id);
        const targetResume = (value) => ({
          ...value,
          resume: resume(id, through),
          resumeCommand: resume(id, through)
        });
        let unchangedAutomations = 0;
        while (true) {
          const completed = reached(id, through);
          if (completed) return done(id, completed, through);
          let value = advanceValue(id);
          if (through !== "build" && value.legacyAction === "REPAIR_REVIEW_INFRASTRUCTURE" &&
              recoverReviewBindings) {
            stage = "prove";
            recordActivePhase("prove");
            if (await recoverReviewBindings(id)) value = advanceValue(id);
          }
          if (through === "build" && ["RUN_PROOF", "LAND_READY"].includes(value.legacyAction)) {
            recordActivePhase("build");
            return done(id, "build", through);
          }
          const phase = phaseForAction(value);
          recordActivePhase(phase);
          let operation = null;
          if (["RUN_PROOF", "RUN_INVALIDATED_EVIDENCE"].includes(value.legacyAction) &&
              ["proven", "archived"].includes(through)) {
            if (!runProof) return targetResume(value);
            stage = "prove";
            operation = runProof;
          } else if (value.legacyAction === "LAND_READY" && through === "archived") {
            // The explicit archived target authorizes Land only once the exact
            // proof is ready. Earlier phases and inspection grant nothing.
            if (!hasLandGrant(id) && authorizeLand) await authorizeLand(id);
            if (!hasLandGrant(id)) return targetResume(value);
            if (!runLand) return targetResume(value);
            stage = "land";
            operation = runLand;
          }
          if (!operation) return targetResume(value);
          const before = convergenceFingerprint(id);
          const operationResult = await operation(id);
          // An operation is the authoritative source for its own boundary.
          // Consume it before consulting projections, otherwise quiet proof or
          // Land composition can discard a decision and repeat the operation.
          const boundaryResult = stage === "land"
            ? landOperationAction(id, operationResult)
            : proofOperationAction(id, operationResult);
          if (boundaryResult) return targetResume(boundaryResult);
          const after = convergenceFingerprint(id);
          unchangedAutomations = before === after ? unchangedAutomations + 1 : 0;
          if (unchangedAutomations >= 2) return noProgress(id, through);
        }
      });
    } catch (error) {
      markBlocked(error?.message || String(error));
      return advanceFailureAction(id, error, { stage, through });
    }
  }

  function advanceValue(id, options = {}) {
    return options.inspect
      ? inspectSnapshots(() => readAdvanceValue(id, options))
      : readAdvanceValue(id, options);
  }

  async function showAdvance(id, flags = {}) {
    if (flags.inspect && flags.through)
      throw new Error("advance --inspect cannot execute --through; inspect first, then advance");
    const value = flags.inspect ? advanceValue(id, { inspect: true })
      : await advanceThrough(id, flags.through || null);
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

export async function runAdvanceProof(context, id) {
  return context.measureAsync("prove.execute", () =>
    context.runQuietly(() => context.proofAdvance(id, { quiet: true })));
}

export function hasValidLandGrant(landGrantRuntime, id) {
  return landGrantRuntime.valid(id).valid;
}
