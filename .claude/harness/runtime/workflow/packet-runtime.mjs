import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function createPacketRuntime({
  ROOT, PACKET_SCHEMA_VERSION, REVIEW_PACKET_SCHEMA_VERSION, loadRuntime,
  readJson, activeChangePath, canonicalChangedSurface,
  evidence, taskBlocks, taskMetadata, repositoryById, claimsForProvider,
  relevantSnapshot, snapshotPath, singleRelevantSnapshot, requiredProviders,
  receiptValidity, providerConfig, adapterResources, stableHash, compactStrings,
  modelForTask, compactList, fileDigest, directoryHash, ensureBudgetState,
  budgetDecision, scopedReviewClaims, relevantHash, providerCapability,
  receiptPath, contractFingerprint, reviewPolicy, resolvedAcceptance,
  handoffReadiness,
  serializedJson, foundationPolicy, recordContextMetric, recordInstructionManifest,
  fail
}) {
  const die = fail;
  function packetValue(id, repositoryId = null, taskId = null) {
    const state = loadRuntime(id);
    const activePath = activeChangePath(id, state);
    const contract = evidence(id, activePath);
    const allTasks = taskBlocks(readFileSync(join(activePath, "tasks.md"), "utf8"))
      .map(taskMetadata);
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
    const declaredClaimIds = new Set(contract.claims.map((claim) => claim.id));
    const unknownTaskClaims = (selectedTask?.claims || [])
      .filter((claim) => !declaredClaimIds.has(claim));
    if (unknownTaskClaims.length)
      die(`task '${selectedTask.id}' references unknown claim(s): ${unknownTaskClaims.join(", ")}`);
    const claims = contract.claims.filter((claim) => {
      if (selectedTask?.claims.length)
        return selectedTask.claims.includes(claim.id);
      return !repository || !claim.repositories ||
        claim.repositories.includes(repository.id);
    });
    if (selectedTask && claims.length === 0 &&
        !["inventory", "logs", "mechanical-docs"].includes(selectedTask.kind))
      die(`task '${selectedTask.id}' has no claims in repository '${selectedTask.repository}'`);
    const claimIds = new Set(claims.map((claim) => claim.id));
    // One live composite for the whole packet, scoped or not: reading the
    // stored snapshot for display while receiptValidity recomputed its own
    // fresh composite per provider row showed the operator one hash and judged
    // receipts against another — and rewrote the stored snapshot M times from
    // a read command.
    const compositeSnapshot = relevantSnapshot(id);
    const hash = repository
      ? singleRelevantSnapshot(id, repository.workspacePath).workspaceHash
      : compositeSnapshot.workspaceHash;
    const providerRows = requiredProviders(id).map((provider) => {
      const config = providerConfig(id, provider);
      // In a repository-scoped packet an unscoped provider's receipt is bound
      // to the composite hash, not this repository's — validating it against
      // the single-repo hash reported fresh global evidence as stale.
      const check = receiptValidity(id, provider,
        repository && !config?.repository ? compositeSnapshot.workspaceHash : hash);
      return {
        provider, adapter: config?.adapter || "external",
        repository: config?.repository || null,
        resources: config ? adapterResources(provider, config) : [],
        validity: check.validity, status: check.status || check.receipt?.status || null
      };
    }).filter((provider) => !repository ||
      !provider.repository || provider.repository === repository.id)
      .filter((provider) => {
        const covered = claimsForProvider(id, provider.provider).map((claim) => claim.id);
        return covered.length === 0 || covered.some((claim) => claimIds.has(claim));
      });
    if (selectedTask && claims.length > 0 && providerRows.length === 0)
      die(`task '${selectedTask.id}' has no provider coverage`);
    const packetSurface = canonicalChangedSurface(id, state);
    const multiRepositoryPacket = new Set(packetSurface.map((row) => row.repositoryId)).size > 1;
    let fileChanges = packetSurface
      .filter((row) => !repository || row.repositoryId === repository.id)
      .map((row) => repository || !multiRepositoryPacket
        ? row.path : `${row.repositoryId}/${row.path}`);
    if (selectedTask?.paths.length)
      fileChanges = fileChanges.filter((path) => selectedTask.paths.some((scope) => {
        const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
      }));
    const changedFileLimit = packetType === "task" ? 50 : 100;
    const changedFileSummary = fileChanges.length <= changedFileLimit ? fileChanges : {
      count: fileChanges.length,
      digest: stableHash(fileChanges),
      groups: Object.entries(fileChanges.reduce((groups, path) => {
        const prefix = path.split("/").slice(0, 2).join("/");
        groups[prefix] = (groups[prefix] || 0) + 1;
        return groups;
      }, {})).sort(([left], [right]) => left.localeCompare(right))
        .map(([prefix, count]) => ({ prefix, count }))
    };
    const scopedTasks = allTasks.filter((task) =>
      (!repository || task.repository === repository.id) &&
      (!selectedTask || task.id === selectedTask.id));
    const taskRows = scopedTasks.map((task) => ({
      id: task.id, done: task.done, kind: task.kind,
      dependsOn: task.dependsOn,
      paths: compactStrings(task.paths, 20),
      resources: compactStrings(task.resources, 20),
      ...(packetType === "task" ? {
        text: task.text, claims: task.claims, model: modelForTask(id, task)
      } : {})
    }));
    const taskPayload = packetType === "global" ? {
      count: scopedTasks.length,
      pending: scopedTasks.filter((task) => !task.done).length,
      completed: scopedTasks.filter((task) => task.done).length,
      byRepository: Object.entries(scopedTasks.reduce((counts, task) => {
        counts[task.repository] = (counts[task.repository] || 0) + 1;
        return counts;
      }, {})).sort(([left], [right]) => left.localeCompare(right))
        .map(([repositoryIdValue, count]) => ({ repository: repositoryIdValue, count })),
      digest: stableHash(scopedTasks.map((task) => ({
        id: task.id, done: task.done, repository: task.repository,
        dependsOn: task.dependsOn
      })))
    } : compactList(taskRows, packetType === "task" ? 1 : 40);
    const artifactReferences = {};
    for (const name of [
      "proposal.md", "design.md", "tasks.md", "evidence.yaml",
      "execution.yaml", "repositories.yaml", "grounding.yaml", "handoffs.yaml"
    ]) {
      const path = join(activePath, name);
      if (existsSync(path))
        artifactReferences[name] = {
          path: relative(ROOT, path).replaceAll("\\", "/"),
          sha256: fileDigest(path)
        };
    }
    const specsPath = join(activePath, "specs");
    if (existsSync(specsPath))
      artifactReferences.specs = {
        path: relative(ROOT, specsPath).replaceAll("\\", "/"),
        sha256: directoryHash(specsPath)
      };
    const invariantValues = Array.isArray(contract.invariants)
      ? contract.invariants.map((value) => String(value)) : [];
    const claimRows = claims.map((claim) => ({
      id: claim.id,
      ...(packetType === "global"
        ? { scenarioDigest: stableHash(String(claim.scenario)) }
        : { scenario: String(claim.scenario)
          .slice(0, packetType === "task" ? 500 : 240) }),
      capabilities: compactStrings(claim.capabilities, 12),
      repositories: claim.repositories
        ? compactStrings(claim.repositories, 12) : null
    }));
    const providers = compactList(providerRows, 30);
    const claimPayload = compactList(
      claimRows, packetType === "task" ? 20 : packetType === "repository" ? 25 : 40);
    const packet = {
      version: Number(PACKET_SCHEMA_VERSION),
      packetType, changeId: id, intent: state.intent, schema: state.schema,
      controlProjectRoot: ROOT,
      status: state.status, revision: Number(state.revision || 0),
      contractRevision: Number(state.contractRevision || 0),
      executionRevision: Number(state.executionRevision || 0),
      impact: state.impact, coupling: state.coupling,
      reviewRequired: Boolean(state.reviewRequired),
      externalOperations: handoffReadiness(id),
      changePath: relative(ROOT, activePath) || ".",
      repository: repository ? {
        id: repository.id, type: repository.type, mode: repository.mode,
        relativePath: repository.relativePath,
        dependsOn: repository.dependsOn || []
      } : null,
      workspacePath: repository?.workspacePath || state.workspace?.path || ROOT,
      workspaceHash: hash,
      compositeWorkspaceHash: compositeSnapshot.workspaceHash || null,
      pendingTaskCount: scopedTasks.filter((task) => !task.done).length,
      tasks: taskPayload,
      claims: claimPayload,
      providers, changedFiles: changedFileSummary,
      invariants: packetType === "global" ? {
        count: invariantValues.length,
        digest: stableHash(invariantValues),
        reference: "evidence.yaml#invariants"
      } : invariantValues.map((value) => value.slice(0, 300)).slice(0, 10),
      references: artifactReferences,
      budget: ensureBudgetState(state),
      budgetDecision: budgetDecision(state)
    };
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
    const artifact = (name) => {
      const path = join(activePath, name);
      return existsSync(path) ? {
        relativePath: name,
        sha256: statSync(path).isDirectory() ? directoryHash(path) : fileDigest(path)
      } : null;
    };
    const surfaceRows = canonicalChangedSurface(id, state).map((row) => {
      const workspace = row.repositoryId === "root"
        ? state.workspace?.path || ROOT
        : state.repositories?.[row.repositoryId]?.path ||
          repositoryById(id, row.repositoryId, state).workspacePath;
      const path = join(workspace, row.path);
      let identity = "deleted";
      if (existsSync(path)) {
        try { identity = statSync(path).isDirectory() ? directoryHash(path) : fileDigest(path); }
        catch { identity = "unreadable"; }
      }
      return {
        ...row,
        kind: "code",
        identity
      };
    });
    const paths = surfaceRows.map((row) => `${row.repositoryId}/${row.path}`);
    const inspection = [...surfaceRows.reduce((groups, row) => {
      if (!groups.has(row.repositoryId)) groups.set(row.repositoryId, []);
      groups.get(row.repositoryId).push(row.path);
      return groups;
    }, new Map())].map(([repositoryId, repositoryPaths]) => ({
      repositoryId,
      workspacePath: repositoryId === "root"
        ? state.workspace?.path || ROOT
        : state.repositories?.[repositoryId]?.path ||
          repositoryById(id, repositoryId, state).workspacePath,
      baseHead: repositoryId === "root"
        ? state.repositories?.root?.baseHead || state.workspace?.baseHead || null
        : state.repositories?.[repositoryId]?.baseHead || null,
      paths: repositoryPaths
    }));
    const changedSurface = paths.length <= 60 ? {
      paths,
      digest: stableHash(paths),
      inspection
    } : {
      count: paths.length,
      digest: stableHash(paths),
      groups: compactList(Object.entries(paths.reduce((groups, path) => {
        const prefix = path.split("/").slice(0, 2).join("/");
        groups[prefix] = Number(groups[prefix] || 0) + 1;
        return groups;
      }, {})).sort(([left], [right]) => left.localeCompare(right))
        .map(([prefix, count]) => ({ prefix, count })), 30),
      inspection: inspection.map((entry) => ({
        ...entry,
        pathCount: entry.paths.length,
        paths: entry.paths.slice(0, 20),
        truncated: entry.paths.length > 20
      }))
    };
    const evidenceRows = requiredProviders(id)
      .filter((provider) => !["review", "acceptance"].includes(
        providerCapability(provider, providerConfig(id, provider))))
      .map((provider) => {
        const check = receiptValidity(id, provider, workspaceHash);
        const path = receiptPath(id, provider);
        const receipt = check.receipt || (existsSync(path) ? readJson(path, {}) : {});
        return {
          provider,
          capability: providerCapability(provider, providerConfig(id, provider)),
          validity: check.validity,
          status: check.status || receipt.status || null,
          observed: receipt.observed ? String(receipt.observed).slice(0, 240) : null,
          artifacts: (receipt.artifacts || []).slice(0, 5).map((value) => value.path),
          references: (receipt.references || []).slice(0, 5)
        };
      });
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
    const contractArtifacts = Object.fromEntries(reviewArtifactNames.map((name) =>
      [name, artifact(name)]).filter(([, row]) => Boolean(row)));
    const reviewArtifactManifest = reviewArtifactNames.map((name) => {
      const row = artifact(name);
      return row ? {
        repositoryId: "contract",
        path: name,
        relativePath: name,
        kind: "contract-artifact",
        sources: ["change-contract"],
        identity: row.sha256
      } : null;
    }).filter(Boolean);
    const reviewManifest = [...surfaceRows, ...reviewArtifactManifest]
      .sort((left, right) => `${left.repositoryId}/${left.path}`
        .localeCompare(`${right.repositoryId}/${right.path}`));
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
      priorReview: prior ? {
        round: prior.review?.round || null,
        status: prior.status || null,
        workspaceHash: prior.workspaceHash || null,
        observed: prior.observed ? String(prior.observed).slice(0, 240) : null,
        findings: prior.review?.findings || null,
        scope: prior.review?.scope || null
      } : null,
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
  
  
  function showPacket(id, flags = {}) {
    if (flags.phase === "review" && flags.task)
      die("review packet does not accept --task; use its scoped references");
    if (flags.phase === "build") {
      const state = loadRuntime(id);
      if (!["worktree", "copy"].includes(state.workspace?.mode))
        die(`build packet requires an isolated workspace; run claude-foundation sandbox create ${id}`);
    }
    const value = flags.phase === "review"
      ? reviewPacketValue(id)
      : packetValue(id, flags.repo || null, flags.task || null);
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
    if (flags.planDigest) value.planDigest = flags.planDigest;
    const priorDigest = value.packetDigest;
    delete value.packetDigest;
    value.packetDigest = stableHash(value);
    if (!manifest && priorDigest) value.packetDigest = priorDigest;
    const encoded = serializedJson(value, Boolean(flags.pretty));
    const bytes = Buffer.byteLength(encoded);
    const limit = Number(foundationPolicy().execution.packetBytes[value.packetType]);
    if (bytes > limit) {
      const fields = Object.entries(value).map(([field, fieldValue]) => ({
        field, bytes: Buffer.byteLength(JSON.stringify(fieldValue))
      })).sort((left, right) => right.bytes - left.bytes).slice(0, 5);
      die(`${value.packetType} packet exceeds ${limit} bytes (${bytes}); largest fields: ${
        fields.map((entry) => `${entry.field}=${entry.bytes}`).join(", ")
      }; narrow the task or inspect referenced artifacts`);
    }
    recordContextMetric(id, `packet-${value.packetType}`, bytes, {
      repositoryId: value.repository?.id || null,
      taskId: flags.task || null,
      claims: Array.isArray(value.claims) ? value.claims.length : value.claims.count,
      providers: Array.isArray(value.providers) ? value.providers.length :
        Array.isArray(value.evidence) ? value.evidence.length : value.providers?.count || 0
    });
    process.stdout.write(encoded);
  }
  

  return {
    packetValue,
    reviewPacketValue,
    showPacket
  };
}
