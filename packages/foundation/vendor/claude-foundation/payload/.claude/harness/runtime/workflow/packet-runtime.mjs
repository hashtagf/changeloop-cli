import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  cachedUpdateAdvisory, updateNotificationDirective
} from "../core/update-advisory.mjs";
import { verificationPlanValue } from "./verification-plan.mjs";
import { authorityPreflightValue } from "../core/authority-policy.mjs";
import { repositoryBaseHead } from "../core/repository-binding.mjs";
import { archivedResumeSource, resumePacketValue } from "./resume-packet.mjs";

export function attachPhaseUpdateAdvisory(value, phase, options = {}) {
  if (!["change", "build"].includes(phase)) return value;
  const advisory = cachedUpdateAdvisory({
      installedVersion: options.installedCliVersion || options.foundationVersion,
      projectVersion: options.foundationVersion,
      cachePath: options.cachePath,
      env: options.env,
      now: options.now
    });
  value.update = {
    ...advisory,
    trigger: phase
  };
  value.notification = updateNotificationDirective(advisory, phase, options);
  return value;
}

export function packetOverflowSummary(value, bytes, limit, largestFields = []) {
  return {
    version: 1,
    packetType: value.packetType,
    changeId: value.changeId,
    packetDigest: value.packetDigest,
    packetValidity: "valid",
    display: { status: "truncated", bytes, limit, largestFields },
    durableAuthorityRequest: {
      status: "not-requested",
      next: `claude-foundation authority request ${value.changeId} --type review`,
      note: "The display budget does not invalidate the packet. The authority request persists the complete bounded packet."
    },
    references: value.references || null
  };
}

export function reviewArtifactValue(context, activePath, name) {
  const path = join(activePath, name);
  if (!context.pathExists(path)) return null;
  return {
    relativePath: name,
    sha256: context.fileStat(path).isDirectory()
      ? context.directoryHash(path)
      : context.fileDigest(path)
  };
}

export function reviewSurfaceWorkspace(context, id, state, repositoryId) {
  if (repositoryId === "root") return state.workspace?.path || context.root;
  return state.repositories?.[repositoryId]?.path ||
    context.repositoryById(id, repositoryId, state).workspacePath;
}

export function reviewSurfaceRows(context, id, state) {
  return context.canonicalChangedSurface(id, state).map((row) => {
    const workspace = reviewSurfaceWorkspace(context, id, state, row.repositoryId);
    const path = join(workspace, row.path);
    let identity = "deleted";
    if (context.pathExists(path)) {
      try {
        identity = context.fileStat(path).isDirectory()
          ? context.directoryHash(path)
          : context.fileDigest(path);
      } catch {
        identity = "unreadable";
      }
    }
    return { ...row, kind: "code", identity };
  });
}

export function reviewChangedSurface(context, id, state, surfaceRows) {
  const paths = surfaceRows.map((row) => `${row.repositoryId}/${row.path}`);
  const inspection = [...surfaceRows.reduce((groups, row) => {
    if (!groups.has(row.repositoryId)) groups.set(row.repositoryId, []);
    groups.get(row.repositoryId).push(row.path);
    return groups;
  }, new Map())].map(([repositoryId, repositoryPaths]) => {
    const repository = context.repositoryById(id, repositoryId, state);
    return {
      repositoryId,
      workspacePath: reviewSurfaceWorkspace(context, id, state, repositoryId),
      baseHead: repositoryBaseHead(repository, state),
      paths: repositoryPaths
    };
  });
  if (paths.length <= 60) return {
    paths, digest: context.stableHash(paths), inspection
  };
  const groups = Object.entries(paths.reduce((counts, path) => {
    const prefix = path.split("/").slice(0, 2).join("/");
    counts[prefix] = Number(counts[prefix] || 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right))
    .map(([prefix, count]) => ({ prefix, count }));
  return {
    count: paths.length,
    digest: context.stableHash(paths),
    groups: context.compactList(groups, 30),
    inspection: inspection.map((entry) => ({
      ...entry,
      pathCount: entry.paths.length,
      paths: entry.paths.slice(0, 20),
      truncated: entry.paths.length > 20
    }))
  };
}

export function reviewEvidenceRows(context, id, workspaceHash) {
  return context.requiredProviders(id)
    .filter((provider) => !["review", "acceptance"].includes(
      context.providerCapability(provider, context.providerConfig(id, provider))))
    .map((provider) => {
      const config = context.providerConfig(id, provider);
      const capability = context.providerCapability(provider, config);
      const check = context.receiptValidity(id, provider, workspaceHash);
      const path = context.receiptPath(id, provider);
      const receipt = check.receipt ||
        (context.pathExists(path) ? context.readJson(path, {}) : {});
      return {
        provider,
        capability,
        validity: check.validity,
        status: check.status || receipt.status || null,
        observed: receipt.observed ? String(receipt.observed).slice(0, 240) : null,
        artifacts: (receipt.artifacts || []).slice(0, 5).map((value) => value.path),
        references: (receipt.references || []).slice(0, 5)
      };
    });
}

export function priorReviewValue(prior) {
  if (!prior) return null;
  return {
    round: prior.review?.round || null,
    status: prior.status || null,
    workspaceHash: prior.workspaceHash || null,
    observed: prior.observed ? String(prior.observed).slice(0, 240) : null,
    findings: prior.review?.findings || null,
    scope: prior.review?.scope || null
  };
}

export function reviewContractArtifactValues(artifact, names, activePath = null) {
  const rows = names.map((name) => [name, artifact(name)])
    .filter(([, row]) => Boolean(row));
  // Keep directory references in the agreement, but dispatch file identities.
  // Never follow directory symlinks while enumerating the review surface.
  function files(name) {
    if (!activePath || !lstatSync(join(activePath, name)).isDirectory()) return [name];
    return readdirSync(join(activePath, name)).sort()
      .flatMap((child) => files(`${name}/${child}`));
  }
  const fileRows = rows.flatMap(([name, row]) => files(name)
    .map((file) => [file, file === name ? row : artifact(file)]));
  return {
    contractArtifacts: Object.fromEntries(rows),
    manifest: fileRows.map(([name, row]) => ({
      repositoryId: "contract",
      path: name,
      relativePath: name,
      kind: "contract-artifact",
      sources: ["change-contract"],
      identity: row.sha256
    }))
  };
}

export function createPacketRuntime({
  ROOT, PACKET_SCHEMA_VERSION, REVIEW_PACKET_SCHEMA_VERSION, leasesRoot = null, loadRuntime,
  foundationVersion, installedCliVersion,
  readJson, activeChangePath, canonicalChangedSurface,
  evidence, taskBlocks, taskMetadata, repositoryById, claimsForProvider,
  relevantSnapshot, snapshotPath, singleRelevantSnapshot, requiredProviders,
  receiptValidity, providerConfig, adapterResources, stableHash, compactStrings,
  providerRepositories,
  modelForTask, compactList, fileDigest, directoryHash, ensureBudgetState,
  budgetDecision, scopedReviewClaims, relevantHash, providerCapability,
  receiptPath, contractFingerprint, reviewPolicy, resolvedAcceptance,
  handoffReadiness,
  executionContract = null,
  authorityPreflight = (id) => {
    const state = loadRuntime(id);
    const contract = evidence(id, activeChangePath(id, state));
    return authorityPreflightValue({
      changeId: id, state, reviewRisk: reviewPolicy(id, state, contract),
      providers: requiredProviders(id),
      providerConfig: (provider) => providerConfig(id, provider), providerCapability,
      acceptance: resolvedAcceptance(id, state, contract),
      grounding: {
        required: state.groundingRequired === true,
        locked: Boolean(state.groundingDigest),
        reopenPending: Boolean(state.groundingReopenPending)
      },
      handoffs: handoffReadiness(id)
    });
  },
  deliveredAiAttempts = () => [],
  resumeAction = null, activeLeases = () => [],
  inspectSnapshots = (operation) => operation(),
  serializedJson, foundationPolicy, recordContextMetric, recordInstructionManifest,
  fail
}) {
  const die = fail;

  function packetScope(id, state, allTasks, repositoryId, taskId) {
    const selectedTask = taskId
      ? allTasks.find((task) => task.id === String(taskId).toUpperCase())
      : null;
    if (taskId && !selectedTask) die(`unknown task '${taskId}'`);
    const effectiveRepositoryId = repositoryId || selectedTask?.repository || null;
    const repository = effectiveRepositoryId
      ? repositoryById(id, effectiveRepositoryId, state) : null;
    if (selectedTask && repository && selectedTask.repository !== repository.id)
      die(`task '${selectedTask.id}' is not assigned to repository '${repository.id}'`);
    const packetType = selectedTask ? "task" : repository ? "repository" : "global";
    return { selectedTask, repository, packetType };
  }

  function packetClaims(contract, selectedTask, repository) {
    const declaredClaimIds = new Set(contract.claims.map((claim) => claim.id));
    const unknownTaskClaims = (selectedTask?.claims || [])
      .filter((claim) => !declaredClaimIds.has(claim));
    if (unknownTaskClaims.length)
      die(`task '${selectedTask.id}' references unknown claim(s): ${unknownTaskClaims.join(", ")}`);
    const claims = contract.claims.filter((claim) => {
      if (selectedTask?.claims.length)
        return selectedTask.claims.includes(claim.id);
      return !repository || !claim.repositories || claim.repositories.includes(repository.id);
    });
    if (selectedTask && claims.length === 0 &&
        !["inventory", "logs", "mechanical-docs"].includes(selectedTask.kind))
      die(`task '${selectedTask.id}' has no claims in repository '${selectedTask.repository}'`);
    return claims;
  }

  function packetProviders(id, repository, claims, compositeHash, workspaceHash) {
    const claimIds = new Set(claims.map((claim) => claim.id));
    const rows = requiredProviders(id).map((provider) => {
      const config = providerConfig(id, provider);
      const check = receiptValidity(id, provider,
        repository && !config?.repository ? compositeHash : workspaceHash);
      return {
        provider, adapter: config?.adapter || "external",
        repository: config?.repository || null,
        repositories: providerRepositories(id, provider, config).map((row) => row.id),
        resources: config ? adapterResources(provider, config) : [],
        validity: check.validity, status: check.status || check.receipt?.status || null
      };
    }).filter((provider) => !repository || provider.repositories.includes(repository.id))
      .filter((provider) => {
        const covered = claimsForProvider(id, provider.provider).map((claim) => claim.id);
        return covered.length === 0 || covered.some((claim) => claimIds.has(claim));
      });
    return rows;
  }

  function scopedFileChanges(id, state, repository, selectedTask) {
    const packetSurface = canonicalChangedSurface(id, state);
    const multiRepository = new Set(packetSurface.map((row) => row.repositoryId)).size > 1;
    let paths = packetSurface
      .filter((row) => !repository || row.repositoryId === repository.id)
      .map((row) => repository || !multiRepository
        ? row.path : `${row.repositoryId}/${row.path}`);
    if (selectedTask?.paths.length)
      paths = paths.filter((path) => selectedTask.paths.some((scope) => {
        const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
      }));
    return paths;
  }

  function changedFilesValue(paths, packetType) {
    const limit = packetType === "task" ? 50 : 100;
    if (paths.length <= limit) return paths;
    const groups = paths.reduce((counts, path) => {
      const prefix = path.split("/").slice(0, 2).join("/");
      counts[prefix] = (counts[prefix] || 0) + 1;
      return counts;
    }, {});
    return {
      count: paths.length,
      digest: stableHash(paths),
      groups: Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))
        .map(([prefix, count]) => ({ prefix, count }))
    };
  }

  function packetTasks(id, allTasks, repository, selectedTask, packetType) {
    const scopedTasks = allTasks.filter((task) =>
      (!repository || task.repository === repository.id) &&
      (!selectedTask || task.id === selectedTask.id));
    const rows = scopedTasks.map((task) => ({
      id: task.id, done: task.done, kind: task.kind,
      dependsOn: task.dependsOn,
      paths: compactStrings(task.paths, 20),
      resources: compactStrings(task.resources, 20),
      ...(packetType === "task" ? {
        text: task.text, claims: task.claims, model: modelForTask(id, task)
      } : {})
    }));
    if (packetType !== "global")
      return { scopedTasks, payload: compactList(rows, packetType === "task" ? 1 : 40) };
    const counts = scopedTasks.reduce((values, task) => {
      values[task.repository] = (values[task.repository] || 0) + 1;
      return values;
    }, {});
    return {
      scopedTasks,
      payload: {
        count: scopedTasks.length,
        pending: scopedTasks.filter((task) => !task.done).length,
        completed: scopedTasks.filter((task) => task.done).length,
        byRepository: Object.entries(counts)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([repositoryIdValue, count]) => ({ repository: repositoryIdValue, count })),
        digest: stableHash(scopedTasks.map((task) => ({
          id: task.id, done: task.done, repository: task.repository,
          dependsOn: task.dependsOn
        })))
      }
    };
  }

  function packetArtifactReferences(activePath) {
    const references = {};
    for (const name of [
      "proposal.md", "design.md", "tasks.md", "evidence.yaml",
      "execution.yaml", "repositories.yaml", "grounding.yaml", "handoffs.yaml"
    ]) {
      const path = join(activePath, name);
      if (existsSync(path))
        references[name] = {
          path: relative(ROOT, path).replaceAll("\\", "/"),
          sha256: fileDigest(path)
        };
    }
    const specsPath = join(activePath, "specs");
    if (existsSync(specsPath))
      references.specs = {
        path: relative(ROOT, specsPath).replaceAll("\\", "/"),
        sha256: directoryHash(specsPath)
      };
    return references;
  }

  function packetClaimRows(claims, packetType) {
    const rows = claims.map((claim) => ({
      id: claim.id,
      ...(packetType === "global"
        ? { scenarioDigest: stableHash(String(claim.scenario)) }
        : { scenario: String(claim.scenario).slice(0, packetType === "task" ? 500 : 240) }),
      capabilities: compactStrings(claim.capabilities, 12),
      repositories: claim.repositories ? compactStrings(claim.repositories, 12) : null
    }));
    const limit = packetType === "task" ? 20 : packetType === "repository" ? 25 : 40;
    return compactList(rows, limit);
  }

  function taskExecutionContext(id, selectedTask) {
    if (!selectedTask) return {};
    const leasePath = leasesRoot
      ? join(leasesRoot, "tasks", id, `${selectedTask.id}.json`) : null;
    const leaseValue = leasePath && existsSync(leasePath) ? readJson(leasePath, {}) : null;
    const lease = leaseValue && leaseValue.leaseId ? leaseValue : null;
    const executionAuthority = lease ? {
      status: "leased",
      graphRevision: lease.graphRevision,
      graphIdentity: lease.graphIdentity,
      planDigest: lease.planDigest,
      contractRevision: lease.contractRevision,
      workspaceHash: lease.workspaceHash,
      leaseId: lease.leaseId,
      fencingGeneration: lease.fencingGeneration,
      executionAttempt: lease.executionAttempt,
      repository: lease.repository,
      paths: lease.paths,
      claimIds: lease.claimIds,
      outputSchema: lease.outputSchema,
      expiresAt: lease.expiresAt
    } : {
      status: "unleased",
      instruction: "Acquire the host lease, then regenerate this task packet before execution."
    };
    return {
      workerContract: {
        version: 1,
        role: "leased-task-worker",
        must: [
          "implement-only-the-leased-task",
          "edit-only-authorized-paths",
          "run-focused-checks",
          "report-summary-checks-and-blockers"
        ],
        mustNot: [
          "edit-task-ledger",
          "dispatch-successors",
          "claim-peer-results"
        ],
        parentOwns: ["group-join", "task-ledger", "successor-dispatch"],
        resultAuthority: "observed-workspace-writes-and-lease-authority"
      },
      executionAuthority
    };
  }

  function repairContext(id, repository, fileChanges) {
    const latestReview = deliveredAiAttempts(id).at(-1) || null;
    if (latestReview?.resultStatus !== "fail") return null;
    const findings = (latestReview.findings || [])
      .filter((finding) => ["blocker", "major"].includes(finding.severity))
      .filter((finding) => !repository || !finding.path ||
        finding.path.startsWith(`${repository.id}/`) || fileChanges.includes(finding.path))
      .slice(0, 8).map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        path: finding.path || null,
        line: finding.line ?? null,
        message: String(finding.message || "").slice(0, 600),
        claimIds: (finding.claimIds || []).slice(0, 12),
        verificationCaseIds: (finding.verificationCaseIds || []).slice(0, 12)
      }));
    if (!findings.length) return null;
    return {
      version: 1,
      kind: "review-findings",
      attempt: latestReview.attempt,
      attemptDigest: latestReview.digest,
      workspaceHash: latestReview.workspaceHash,
      findings,
      findingDigest: stableHash(findings),
      instruction: "Repair this bounded finding batch inside the current contract, then rerun only evidence bound to the affected paths. Do not request another open-ended review."
    };
  }

  function packetMetadata(state, activePath, repository, compositeHash) {
    return {
      status: state.status,
      revision: Number(state.revision || 0),
      contractRevision: Number(state.contractRevision || 0),
      executionRevision: Number(state.executionRevision || 0),
      impact: state.impact,
      coupling: state.coupling,
      reviewRequired: Boolean(state.reviewRequired),
      changePath: relative(ROOT, activePath) || ".",
      repository: repository ? {
        id: repository.id, type: repository.type, mode: repository.mode,
        relativePath: repository.relativePath,
        dependsOn: repository.dependsOn || []
      } : null,
      workspacePath: repository?.workspacePath || state.workspace?.path || ROOT,
      compositeWorkspaceHash: compositeHash || null
    };
  }

  function packetInvariants(contract, packetType) {
    const values = Array.isArray(contract.invariants)
      ? contract.invariants.map((value) => String(value)) : [];
    return packetType === "global" ? {
      count: values.length,
      digest: stableHash(values),
      reference: "evidence.yaml#invariants"
    } : values.map((value) => value.slice(0, 300)).slice(0, 10);
  }

  function packetValue(id, repositoryId, taskId) {
    const state = loadRuntime(id);
    const activePath = activeChangePath(id, state);
    const contract = evidence(id, activePath);
    const allTasks = taskBlocks(readFileSync(join(activePath, "tasks.md"), "utf8"))
      .map(taskMetadata);
    const { selectedTask, repository, packetType } =
      packetScope(id, state, allTasks, repositoryId, taskId);
    const claims = packetClaims(contract, selectedTask, repository);
    // One live composite for the whole packet, scoped or not: reading the
    // stored snapshot for display while receiptValidity recomputed its own
    // fresh composite per provider row showed the operator one hash and judged
    // receipts against another — and rewrote the stored snapshot M times from
    // a read command.
    const compositeSnapshot = relevantSnapshot(id);
    const hash = repository
      ? singleRelevantSnapshot(id, repository.workspacePath).workspaceHash
      : compositeSnapshot.workspaceHash;
    const providerRows = packetProviders(
      id, repository, claims, compositeSnapshot.workspaceHash, hash);
    if (selectedTask && claims.length > 0 && providerRows.length === 0)
      die(`task '${selectedTask.id}' has no provider coverage`);
    const fileChanges = scopedFileChanges(id, state, repository, selectedTask);
    const changedFileSummary = changedFilesValue(fileChanges, packetType);
    const { scopedTasks, payload: taskPayload } =
      packetTasks(id, allTasks, repository, selectedTask, packetType);
    const artifactReferences = packetArtifactReferences(activePath);
    const providers = compactList(providerRows, 30);
    const claimPayload = packetClaimRows(claims, packetType);
    const packet = {
      version: Number(PACKET_SCHEMA_VERSION),
      packetType, changeId: id, intent: state.intent, schema: state.schema,
      controlProjectRoot: ROOT,
      externalOperations: handoffReadiness(id),
      ...packetMetadata(state, activePath, repository, compositeSnapshot.workspaceHash),
      workspaceHash: hash,
      pendingTaskCount: scopedTasks.filter((task) => !task.done).length,
      tasks: taskPayload,
      claims: claimPayload,
      providers, changedFiles: changedFileSummary,
      invariants: packetInvariants(contract, packetType),
      references: artifactReferences,
      ...taskExecutionContext(id, selectedTask),
      budget: ensureBudgetState(state),
      budgetDecision: budgetDecision(state)
    };
    if (packetType !== "task") {
      packet.authorityPreflight = authorityPreflight(id);
      packet.executionContract = executionContract?.(id) || null;
    }
    const repairs = repairContext(id, repository, fileChanges);
    if (repairs) packet.repairContext = repairs;
    return { ...packet, packetDigest: stableHash(packet) };
  }
  
  function reviewPacketValue(id) {
    const state = loadRuntime(id);
    const activePath = activeChangePath(id, state);
    const contract = evidence(id, activePath);
    const workspaceHash = relevantHash(id);
    const reviewClaims = scopedReviewClaims(contract.claims).map((claim) => ({
      id: claim.id,
      scenario: String(claim.scenario).slice(0, 160),
      impact: claim.impact,
      capabilities: claim.capabilities,
      repositories: claim.repositories || null
    }));
    const artifact = reviewArtifactValue.bind(null, {
      pathExists: existsSync, fileStat: statSync, directoryHash, fileDigest
    }, activePath);
    const surfaceContext = {
      root: ROOT, canonicalChangedSurface, repositoryById,
      pathExists: existsSync, fileStat: statSync, directoryHash, fileDigest,
      stableHash, compactList
    };
    const surfaceRows = reviewSurfaceRows(surfaceContext, id, state);
    const changedSurface = reviewChangedSurface(surfaceContext, id, state, surfaceRows);
    const evidenceRows = reviewEvidenceRows({
      requiredProviders, providerCapability, providerConfig, receiptValidity,
      receiptPath, pathExists: existsSync, readJson
    }, id, workspaceHash);
    const reviewProvider = requiredProviders(id).find((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === "review") || "review";
    const prior = existsSync(receiptPath(id, reviewProvider))
      ? readJson(receiptPath(id, reviewProvider), {}) : null;
    const grounding = artifact("grounding.yaml");
    const groundingValue = grounding ? readJson(join(activePath, "grounding.yaml"), {}) : null;
    const reviewArtifactNames = [
      "proposal.md", "design.md", "tasks.md", "evidence.yaml",
      "execution.yaml", "repositories.yaml", "grounding.yaml", "handoffs.yaml", "specs"
    ];
    const {
      contractArtifacts, manifest: reviewArtifactManifest
    } = reviewContractArtifactValues(artifact, reviewArtifactNames, activePath);
    const reviewManifest = [...surfaceRows, ...reviewArtifactManifest]
      .sort((left, right) => `${left.repositoryId}/${left.path}`
        .localeCompare(`${right.repositoryId}/${right.path}`));
    if (!changedSurface.inspection.some((entry) => entry.repositoryId === "root"))
      changedSurface.inspection.push({
        repositoryId: "root",
        workspacePath: reviewSurfaceWorkspace(surfaceContext, id, state, "root"),
        // The control workspace may hold the contract without being a selected
        // product repository. This empty inspection grants no product scope.
        baseHead: repositoryBaseHead({ id: "root" }, state),
        paths: []
      });
    if (reviewArtifactManifest.length) changedSurface.inspection.push({
      repositoryId: "contract",
      workspacePath: activePath,
      baseHead: null,
      paths: reviewArtifactManifest.map((row) => row.relativePath)
    });
    const packet = {
      version: Number(REVIEW_PACKET_SCHEMA_VERSION),
      packetType: "review",
      changeId: id,
      controlProjectRoot: ROOT,
      contractWorkspacePath: activePath,
      intent: state.intent,
      workspaceHash,
      contractFingerprint: contractFingerprint(id),
      reviewPolicy: reviewPolicy(id, state, contract),
      acceptance: resolvedAcceptance(id, state, contract),
      externalOperations: handoffReadiness(id),
      claims: compactList(reviewClaims, 8),
      decisions: {
        proposal: artifact("proposal.md"),
        design: artifact("design.md"),
        specs: artifact("specs"),
        grounding
      },
      contractArtifacts,
      changedSurface: {
        ...changedSurface,
        // Dispatch uses the identities to derive round-two scope from the
        // first dispatch. Keeping the complete manifest here prevents a large
        // change from degrading into a reviewer-supplied list.
        manifest: reviewManifest
      },
      grounding: groundingValue ? {
        decisionBatch: groundingValue.decisionBatch || null,
        readSet: compactList(groundingValue.readSet || [], 30),
        claims: compactList(groundingValue.claims || [], 30),
        reference: grounding
      } : null,
      evidence: compactList(evidenceRows, 15),
      priorReview: priorReviewValue(prior),
      unresolvedFindings: Number(prior?.review?.findings?.unresolvedBlockers || 0),
      references: {
        evidence: artifact("evidence.yaml"),
        tasks: artifact("tasks.md"),
        grounding,
        handoffs: artifact("handoffs.yaml")
      }
    };
    return { ...packet, packetDigest: stableHash(packet) };
  }

  function validatePacketRequest(id, flags) {
    if (flags.phase === "review" && flags.task)
      die("review packet does not accept --task; use its scoped references");
    if (flags.phase === "build") {
      const state = loadRuntime(id);
      if (!["worktree", "copy"].includes(state.workspace?.mode))
        die(`build packet requires an isolated workspace; run claude-foundation sandbox create ${id}`);
    }
  }

  function packetForRequest(id, flags) {
    const value = flags.phase === "review"
      ? reviewPacketValue(id) : packetValue(id, flags.repo || null, flags.task || null);
    if (flags.phase !== "review")
      value.verificationPlan = verificationPlanValue(value, flags.phase || "build", stableHash);
    return value;
  }

  function addPacketInstruction(id, flags, value) {
    const instructionPhase = flags.phase === "review" ? "prove" : flags.phase || "build";
    const taskModel = Array.isArray(value.tasks) ? value.tasks[0]?.model?.tier || null : null;
    const manifest = recordInstructionManifest?.(id, instructionPhase, {
      scope: flags.task || flags.repo || value.packetType,
      requestedModel: taskModel
    });
    if (manifest) value.instructionProvenance = {
      schemaVersion: manifest.schemaVersion,
      manifestDigest: manifest.manifestDigest,
      requestedModel: manifest.execution?.requestedModel || null
    };
    return manifest;
  }

  function addPacketGraphIdentity(flags, value) {
    if (flags.planDigest) value.planDigest = flags.planDigest;
    if (flags.graphRevision) value.graphRevision = flags.graphRevision;
    if (flags.graphIdentity) value.graphIdentity = flags.graphIdentity;
    if (flags.graphNode) value.graphNode = flags.graphNode;
  }

  function refreshPacketDigest(value, manifest) {
    const priorDigest = value.packetDigest;
    delete value.packetDigest;
    value.packetDigest = stableHash(value);
    if (!manifest && priorDigest) value.packetDigest = priorDigest;
  }

  function packetContextDetails(value, flags) {
    return {
      repositoryId: value.repository?.id || null,
      taskId: flags.task || null,
      claims: Array.isArray(value.claims) ? value.claims.length : value.claims.count,
      providers: Array.isArray(value.providers) ? value.providers.length :
        Array.isArray(value.evidence) ? value.evidence.length : value.providers?.count || 0
    };
  }

  function writePacketDisplay(id, flags, value) {
    attachPhaseUpdateAdvisory(value, flags.phase, {
      installedCliVersion, foundationVersion
    });
    const encoded = serializedJson(value, Boolean(flags.pretty));
    const bytes = Buffer.byteLength(encoded);
    const limit = Number(foundationPolicy().execution.packetBytes[value.packetType]);
    if (bytes > limit) {
      const fields = Object.entries(value).map(([field, fieldValue]) => ({
        field, bytes: Buffer.byteLength(JSON.stringify(fieldValue))
      })).sort((left, right) => right.bytes - left.bytes).slice(0, 5);
      if (value.packetType === "review") {
        const summary = packetOverflowSummary(value, bytes, limit, fields);
        const summaryEncoded = serializedJson(summary, Boolean(flags.pretty));
        console.error(`WARNING: review packet display truncated at ${limit} bytes; ` +
          `the ${bytes}-byte packet remains valid and can be persisted with: ${
            summary.durableAuthorityRequest.next}`);
        recordContextMetric(id, "packet-review-display", Buffer.byteLength(summaryEncoded), {
          originalBytes: bytes,
          limit,
          displayStatus: "truncated"
        });
        process.stdout.write(summaryEncoded);
        return summary;
      }
      die(`${value.packetType} packet exceeds ${limit} bytes (${bytes}); largest fields: ${
        fields.map((entry) => `${entry.field}=${entry.bytes}`).join(", ")
      }; narrow the task or inspect referenced artifacts`);
    }
    recordContextMetric(id, `packet-${value.packetType}`, bytes, packetContextDetails(value, flags));
    process.stdout.write(encoded);
  }

  function inspectionPacketValue(id, state = loadRuntime(id)) {
    if (state.status !== "archived") return packetValue(id);
    const activePath = activeChangePath(id, state);
    const tasks = taskBlocks(readFileSync(join(activePath, "tasks.md"), "utf8")).map(taskMetadata);
    return archivedResumeSource({
      id, state, version: PACKET_SCHEMA_VERSION, root: ROOT, tasks, stableHash,
      references: packetArtifactReferences(activePath),
      externalOperations: handoffReadiness(id)
    });
  }

  function renderPacket(id, suppliedFlags) {
    const flags = Object.assign({}, suppliedFlags);
    if (flags.resume) {
      if (flags.phase || flags.task || flags.repo)
        die("packet --resume uses the current change; do not combine it with phase, task or repo");
      if (!resumeAction) die("resume projection is unavailable");
      const state = loadRuntime(id);
      const activePath = activeChangePath(id, state);
      const tasks = taskBlocks(readFileSync(join(activePath, "tasks.md"), "utf8"))
        .map(taskMetadata);
      const packet = inspectionPacketValue(id, state);
      const value = resumePacketValue({
        packet, tasks, leases: activeLeases(id),
        action: resumeAction(id), stableHash,
        limit: Number(foundationPolicy().execution.packetBytes.global) - 1
      });
      // Compact JSON is intentional: pretty whitespace must not break ceilings.
      process.stdout.write(JSON.stringify(value) + "\n");
      return value;
    }
    validatePacketRequest(id, flags);
    const value = packetForRequest(id, flags);
    const manifest = addPacketInstruction(id, flags, value);
    addPacketGraphIdentity(flags, value);
    refreshPacketDigest(value, manifest);
    return writePacketDisplay(id, flags, value);
  }
  

  function showPacket(id, flags = {}) {
    return flags.resume
      ? inspectSnapshots(() => renderPacket(id, flags))
      : renderPacket(id, flags);
  }

  return {
    packetValue,
    inspectionPacketValue,
    reviewPacketValue,
    showPacket
  };
}
