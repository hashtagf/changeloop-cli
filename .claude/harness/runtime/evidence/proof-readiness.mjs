import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dependentClosure } from "../core/graph-execution.mjs";

export function createProofReadinessRuntime({
  markBlocked = () => {},
  evidence,
  loadRuntime,
  taskBlocks,
  activeChangePath,
  taskMetadata,
  canonicalChangedSurface,
  selectedRepositories,
  providerCapability,
  providerConfig,
  providerRepositories = (id, provider, config = providerConfig(id, provider)) =>
    config?.repository
      ? selectedRepositories(id).filter((repository) => repository.id === config.repository)
      : selectedRepositories(id),
  requiredProviders = (id) => Object.keys(evidence(id).providers || {}),
  git = () => ({ status: 0, stdout: "", stderr: "" }),
  advisoryCapabilities,
  evidenceDetectionValue,
  validate,
  relevantHash,
  executionNodes,
  pendingTasks,
  handoffReadiness = (id) => ({
    version: 1, changeId: id, status: "COMPLETE",
    operations: [], blocking: [], tracked: []
  }),
  activeChangeLeases,
  activeRepositoryConflicts,
  agentPlanValue = null,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  fail
}) {
  function repositoryInfrastructureIssues(id) {
    const state = loadRuntime(id);
    const issues = [];
    for (const provider of requiredProviders(id)) {
      const config = providerConfig(id, provider) || {};
      for (const repository of providerRepositories(id, provider, config)) {
        const runtime = state.repositories?.[repository.id] ||
          (repository.id === "root" ? state.workspace : null) || {};
        if (!existsSync(repository.workspacePath)) {
          issues.push(`provider '${provider}' repository '${repository.id}' workspace is missing`);
          continue;
        }
        if (repository.mode === "read" && runtime.mode === "reference")
          issues.push(`provider '${provider}' repository '${repository.id}' is a live reference, not an isolated workspace`);
        if (runtime.setup?.status === "failed")
          issues.push(`provider '${provider}' repository '${repository.id}' setup failed`);
        if (repository.mode === "read" && runtime.mode === "worktree") {
          const changed = git(["status", "--porcelain"], repository.workspacePath);
          if (changed.status !== 0 || changed.stdout.trim())
            issues.push(`provider '${provider}' read-only repository '${repository.id}' changed: ${
              changed.stdout.trim() || changed.stderr.trim() || "git status failed"}`);
        }
      }
    }
    return [...new Set(issues)];
  }

  function topologyIssues(id) {
    const contract = evidence(id);
    const providers = contract.providers || {};
    const issues = [];
    const visiting = new Set();
    const visited = new Set();
    function visit(provider, trail = []) {
      if (visiting.has(provider)) {
        issues.push(`provider dependency cycle: ${[...trail, provider].join(" -> ")}`);
        return;
      }
      if (visited.has(provider) || !providers[provider]) return;
      visiting.add(provider);
      for (const dependency of providers[provider].dependsOn || [])
        visit(dependency, [...trail, provider]);
      visiting.delete(provider);
      visited.add(provider);
    }
    Object.keys(providers).forEach((provider) => visit(provider));

    const reportOwners = new Map();
    for (const [provider, config] of Object.entries(providers)) {
      if (config.report) {
        const key = config.report.replaceAll("\\", "/");
        const owner = reportOwners.get(key);
        const command = JSON.stringify(config.command || []);
        if (owner && owner.command !== command)
          issues.push(`structured report collision: ${key} (${owner.provider}, ${provider})`);
        else reportOwners.set(key, { provider, command });
      }
      if (config.readiness?.url && !config.readiness.expectBody &&
          !config.readiness.expectHeader)
        issues.push(`provider '${provider}' readiness lacks an identity body/header`);
    }

    const serviceResources = new Map();
    for (const [service, config] of Object.entries(contract.execution?.services || {})) {
      let port = null;
      try {
        port = new URL(config.readiness.url).port || null;
      } catch {}
      const resources = [...(config.resources || []), ...(port ? [`port:${port}`] : [])];
      for (const resource of resources) {
        const owner = serviceResources.get(resource);
        if (owner && owner !== service)
          issues.push(`service resource collision: ${resource} (${owner}, ${service})`);
        else serviceResources.set(resource, service);
      }
    }
    return issues;
  }

  // `details`, when supplied, collects `{ repositoryId, paths }` per blocked
  // repository so the recovery can render a paste-ready annotation. The string
  // return stays as-is — proof-runtime consumes it verbatim.
  function changedSurfaceIssues(id, details = null) {
    const state = loadRuntime(id);
    const tasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
      .map(taskMetadata);
    const generatedReports = Object.keys(evidence(id).providers || {}).map((provider) => {
      const config = providerConfig(id, provider) || {};
      return { repository: config.repository || "root", path: config.report || null };
    }).filter((row) => row.path);
    const issues = [];
    const surface = canonicalChangedSurface(id, state);
    for (const repository of selectedRepositories(id, state)) {
      if (repository.mode !== "write") continue;
      const allowed = tasks.filter((task) => task.repository === repository.id)
        .flatMap((task) => task.paths);
      const repositoryWide = tasks.some((task) => task.repository === repository.id &&
        (!(task.paths || []).length || task.paths.includes("*")));
      const changed = surface.filter((row) => row.repositoryId === repository.id)
        .map((row) => row.path);
      const outside = repositoryWide ? [] : changed.filter((path) =>
        !generatedReports.some((report) => report.repository === repository.id &&
          report.path === path) && !allowed.some((scope) => {
        const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
      }));
      if (outside.length) {
        issues.push(`repository '${repository.id}' changed outside task paths: ${outside.join(", ")}`);
        details?.push({ repositoryId: repository.id, paths: outside });
      }
    }
    return issues;
  }

  // An unconfigured provider is not always a person-shaped problem: when the
  // project already owns a safe command for that capability, the fix is a write
  // to execution.yaml, not a wait for a human. Detection knows which providers
  // those are, so the recovery names the wiring route first instead of routing
  // every unconfigured provider through an external-evidence decision that most
  // of them never needed.
  function wiringChoice(id, provider) {
    let detection;
    try { detection = evidenceDetectionValue(id); }
    catch { return null; }
    const candidate = (detection.candidates || []).find((row) =>
      row.provider === provider && row.recommended && row.config);
    if (!candidate) return null;
    return {
      kind: "configure-provider",
      command: `claude-foundation evidence init ${id} --write`,
      source: candidate.source,
      instruction: `Wire provider '${provider}' from the project-owned command detected at ${
        candidate.source}, then re-run proof.`,
      verify: `claude-foundation proof readiness ${id}`
    };
  }

  function externalEvidenceRecovery(id, provider) {
    const capability = providerCapability(provider, providerConfig(id, provider));
    if (capability === "review") return {
      provider,
      kind: "user-decision",
      request: {
        command: `claude-foundation authority request ${id} --type review`,
        packet: `claude-foundation packet ${id} --phase review`
      },
      decision: {
        kind: "independent-review",
        summary: "Automated evidence is ready, but an independent reviewer must inspect the current implementation before proof can finish.",
        options: [
          { id: "prepare-for-user", outcome: "Prepare a bounded review packet for the user to inspect." },
          { id: "prepare-for-reviewer", outcome: "Run the configured fresh reviewer. A Codex-only or Claude-Code-only project may commit review.diversity='single-model' while keeping identity/session independence required." },
          // A project driven from one session has no second session to open, so
          // the reviewer gate had no reachable end state and the loop stopped
          // here for good. The waiver already existed in `reviewPolicy`; it was
          // simply never named at the point where somebody needs it.
          { id: "waive-independence", outcome: "Only if the project deliberately accepts the same reviewer identity/session, set review.independence='self'; the receipt records that independence was not observed." },
          { id: "pause", outcome: "Keep the change pending without recording a review result." }
        ],
        recommended: "prepare-for-reviewer",
        responseStatuses: ["pass", "fail", "inconclusive", "error"]
      }
    };
    if (capability === "acceptance") {
      // `validate` has already normalized acceptance onto the state, so the
      // scope is read rather than re-derived here. Without it, the one gate in
      // the loop that can only be cleared by a named human refused to say
      // which claim was holding it, and the origin — an explicit decision, or
      // a capability declared on a claim — was invisible entirely.
      const acceptance = loadRuntime(id).acceptance || {};
      const claimIds = acceptance.claimIds || [];
      const origin = acceptance.scopeOrigin || "explicit";
      return {
        provider,
        kind: "user-decision",
        request: {
          command: `claude-foundation authority request ${id} --type acceptance`
        },
        decision: {
          kind: "human-acceptance",
          summary: `A named person must inspect the final result and decide whether the declared acceptance criteria are satisfied${
            claimIds.length ? ` for claim(s) ${claimIds.join(", ")}` : ""}.`,
          scope: {
            claims: claimIds,
            origin,
            reason: acceptance.reason || null,
            detail: origin === "claim-capability"
              ? "These claims declare capability 'acceptance' in evidence.yaml; that declaration, not the resolve flag, is what requires a human here."
              : "This gate was recorded by an explicit --acceptance-required decision."
          },
          options: [
            { id: "inspect", outcome: "Inspect the final result and then accept, reject, or report uncertainty." },
            { id: "request-changes", outcome: "Reject the current result and describe what must change." },
            // Acceptance is the one gate with no waiver — a self-attested human
            // acceptance would be a false record, so the escape is to withdraw
            // the requirement, not to fake satisfying it. Which command does
            // that depends on where the requirement came from, and getting that
            // wrong is why this gate read as permanent: clearing the flag has
            // no effect while a claim still declares the capability.
            origin === "claim-capability"
              ? { id: "withdraw-requirement", outcome: `Drop capability 'acceptance' from claim(s) ${claimIds.join(", ") || "in evidence.yaml"}, then re-run 'claude-foundation change validate ${id}'. Clearing the resolve flag alone will not lift this gate while the claim declares it.` }
              : { id: "withdraw-requirement", outcome: `Withdraw the requirement: claude-foundation change resolve ${id} --acceptance-not-required` },
            { id: "pause", outcome: "Keep the change pending without an acceptance decision." }
          ],
          recommended: "inspect",
          responseStatuses: ["pass", "fail", "inconclusive", "error"]
        }
      };
    }
    const wiring = wiringChoice(id, provider);
    return {
      provider,
      kind: "user-decision",
      ...(wiring ? { wiring } : {}),
      decision: {
        kind: "external-evidence",
        summary: wiring
          ? `Provider '${provider}' has no adapter yet, but this project already owns a command that can prove it (${wiring.source}).`
          : `Provider '${provider}' needs verifiable evidence from outside the local harness.`,
        options: [
          // The command itself is carried on `wiring`, which every renderer
          // prints; repeating it here made the rendered recovery echo itself.
          ...(wiring ? [{ id: "wire-provider", outcome: `Wire the project-owned command detected at ${wiring.source}.` }] : []),
          { id: "provide-evidence", outcome: "Provide a real external result and durable reference." },
          { id: "configure-provider", outcome: "Configure an equivalent project-owned executable provider." },
          { id: "pause", outcome: "Keep the change pending without claiming a result." }
        ],
        recommended: wiring ? "wire-provider" : "provide-evidence",
        responseStatuses: ["pass", "fail", "inconclusive", "error"]
      }
    };
  }

  function unavailableProviderRecovery(id, unavailable) {
    const separator = unavailable.indexOf(":");
    const provider = separator === -1 ? unavailable : unavailable.slice(0, separator);
    const reason = separator === -1 ? "environment-unavailable" : unavailable.slice(separator + 1);
    const external = externalEvidenceRecovery(id, provider);
    return {
      provider,
      reason,
      choices: [
        {
          kind: "diagnose",
          command: `claude-foundation doctor --stage prove --change ${id}`
        },
        {
          kind: "retry",
          command: `claude-foundation proof run ${id}`
        },
        {
          kind: "external-evidence",
          ...external
        },
        {
          kind: "reconfigure",
          file: `openspec/changes/${id}/execution.yaml`,
          instruction: `Configure provider '${provider}' with an available project-owned command that proves the same declared claims.`,
          verify: `claude-foundation proof readiness ${id}`
        }
      ]
    };
  }

  function codeChangeRecovery(id, pending) {
    return [{
      kind: "resume-build",
      agentCommand: `/build ${id}`,
      inspect: `claude-foundation agents plan ${id} --pretty`,
      pendingTasks: pending.map((task) => task.id || task.text)
    }];
  }

  function configurationRecovery(id, issues, surfaceFixits = []) {
    return [
      // The changed-surface blocker already names every offending path; this
      // entry restates them in the exact form `tasks.md` accepts, so clearing
      // the block is a paste instead of a reconstruction.
      ...(surfaceFixits.length ? [{
        kind: "declare-surface",
        reason: `append each listed annotation to the owning task's [paths:] in openspec/changes/${id}/tasks.md, then rerun readiness`,
        choices: surfaceFixits.map((fixit) => ({
          instruction: `repository '${fixit.repositoryId}': [paths:${fixit.paths.join(",")}]`
        }))
      }] : []),
      {
        kind: "diagnose",
        command: `claude-foundation doctor --stage prove --change ${id}`
      },
      {
        kind: "revise-configuration",
        agentCommand: `/change ${id}`,
        files: [
          `openspec/changes/${id}/evidence.yaml`,
          `openspec/changes/${id}/execution.yaml`,
          `openspec/changes/${id}/repositories.yaml`
        ],
        issues,
        verify: `claude-foundation change validate ${id}`
      }
    ];
  }

  function activeWorkRecovery(id, leases, repositoryConflicts = []) {
    return [{
      kind: "wait-for-active-work",
      instruction: "The host must wait for active workers or release stale leases; do not spend model budget while ownership is unresolved.",
      leases: leases.map((lease) => ({
        taskId: lease.taskId, owner: lease.owner, expiresAt: lease.expiresAt || null
      })),
      // Another change holding write scope on a repository this proof would
      // execute in. Naming it is the difference between "wait" and "wait for
      // what": nothing else in the output identifies the other change.
      repositoryConflicts: repositoryConflicts.map((conflict) => ({
        changeId: conflict.changeId,
        repository: conflict.repository,
        status: conflict.status,
        note: "Land or retire that change before proving this one; both would execute against the same repository."
      })),
      // Telling the host to release a stale lease is only actionable if the
      // release it can actually run is named: a crashed worker never comes back
      // to release its own.
      choices: leases.map((lease) => ({
        kind: "release-stale-lease",
        taskId: lease.taskId,
        expiresAt: lease.expiresAt || null,
        command: `claude-foundation agents release ${id} ${lease.taskId} --owner ${lease.owner} --force`,
        note: "A lease that has not expired also requires --decision-ref, because the worker holding it may still be running."
      })),
      verify: `claude-foundation proof readiness ${id}`
    }];
  }

  function readinessBudgetPolicy(status) {
    if (["NEEDS_CODE_CHANGE", "CONFIGURATION_ERROR"].includes(status))
      return {
        eligible: true,
        class: "model-fix",
        reason: "required model-completable work remains"
      };
    if (status === "BLOCKED_BY_ACTIVE_WORK")
      return {
        eligible: false,
        class: "active-work",
        reason: "host-owned work or leases must finish first"
      };
    if (status === "NEEDS_USER_DECISION")
      return {
        eligible: false,
        class: "external-authority",
        reason: "external evidence cannot be produced with model budget"
      };
    if (status === "INFRASTRUCTURE_ERROR")
      return {
        eligible: false,
        class: "infrastructure",
        reason: "provider infrastructure must recover first"
      };
    return {
      eligible: false,
      class: "deterministic",
      reason: "run the ready deterministic operation"
    };
  }

  function proofReadinessValue(id, stage = "prove") {
    validate(id, "active", { quiet: true });
    const issues = topologyIssues(id);
    const surfaceFixits = [];
    if (stage === "prove") issues.push(...changedSurfaceIssues(id, surfaceFixits));
    const hash = relevantHash(id);
    const { unconfigured, unavailable } = executionNodes(id, hash);
    const repositoryIssues = stage === "prove" ? repositoryInfrastructureIssues(id) : [];
    const pending = pendingTasks(id);
    const plan = agentPlanValue?.(id) || null;
    const pendingNodeIds = pending.map((task) => `task:${task.id}`).filter((nodeId) =>
      plan?.graph?.nodes?.some((node) => node.id === nodeId));
    const blockedNodes = plan?.graph ? dependentClosure(plan.graph, pendingNodeIds) : [];
    const completedTaskNodes = (plan?.graph?.nodes || []).filter((node) =>
      node.kind === "task" && !pendingNodeIds.includes(node.id)).map((node) => node.id);
    const externalOperations = handoffReadiness(id);
    const leases = stage === "prove" ? activeChangeLeases(id) : [];
    // The cross-change guard reached dispatch and lease acquisition but never
    // the proof path, so two changes could execute providers against the same
    // repository at once — sharing ports, databases and the working tree.
    // `activeChangeLeases` only sees this change's own leases, so it cannot
    // stand in for it.
    const repositoryConflicts = activeRepositoryConflicts(
      id, selectedRepositories(id), { executing: true });
    const status = pending.length ? "NEEDS_CODE_CHANGE"
      : issues.length ? "CONFIGURATION_ERROR"
        : leases.length || repositoryConflicts.length ? "BLOCKED_BY_ACTIVE_WORK"
          : unavailable.length || repositoryIssues.length ? "INFRASTRUCTURE_ERROR"
          : unconfigured.length ? "NEEDS_USER_DECISION" : "READY";
    return {
      version: 1,
      changeId: id,
      stage,
      status,
      workspaceHash: hash,
      pendingTasks: pending.map((task) => task.id || task.text),
      externalOperations: {
        ...externalOperations,
        proofBlocking: false,
        note: "External operations are handed off during Prove and are evaluated at Land by timing and activation safety."
      },
      externalProviders: unconfigured,
      unavailableProviders: unavailable,
      repositoryIssues,
      activeLeases: leases.map((lease) => ({
        taskId: lease.taskId, owner: lease.owner, expiresAt: lease.expiresAt || null
      })),
      repositoryConflicts,
      graph: plan?.graph ? {
        version: plan.graph.version,
        revision: plan.graph.revision,
        identity: plan.graph.identity,
        nodeCount: plan.graph.nodes.length,
        edgeCount: plan.graph.edges.length,
        pendingNodes: pendingNodeIds,
        affectedNodes: blockedNodes,
        preservedNodes: completedTaskNodes.filter((node) => !blockedNodes.includes(node))
      } : null,
      issues,
      // Reported, never counted into `status`: these are the capabilities the
      // policy inferred from the diff and the project never wired. They are the
      // record that a gate was downgraded rather than silently dropped.
      advisories: advisoryCapabilities(id),
      budget: readinessBudgetPolicy(status),
      next: status === "NEEDS_CODE_CHANGE"
        ? codeChangeRecovery(id, pending)
        : status === "CONFIGURATION_ERROR"
          ? configurationRecovery(id, issues, surfaceFixits)
          : status === "BLOCKED_BY_ACTIVE_WORK"
            ? activeWorkRecovery(id, leases, repositoryConflicts)
            : status === "NEEDS_USER_DECISION"
              ? unconfigured.map((provider) => externalEvidenceRecovery(id, provider))
              : status === "INFRASTRUCTURE_ERROR"
                ? unavailable.map((provider) => unavailableProviderRecovery(id, provider))
                : []
    };
  }

  function proofReadiness(id, stage = "prove") {
    const value = proofReadinessValue(id, stage);
    console.log(JSON.stringify(value, null, 2));
    // A non-ready readiness is a typed lifecycle stop, so it says so rather
    // than leaving the exit handler to infer it from the exit code.
    if (value.status !== "READY") { markBlocked(); process.exitCode = 2; }
    return value;
  }

  // `proofReadinessValue` has always carried a full recovery under `next`, and
  // every caller that stopped on it threw the recovery away and printed the
  // blocker list alone. That is the whole reason a blocked Prove read as a dead
  // end: the way out was computed, then discarded one frame before the person
  // who needed it. Render it as prose here — `/prove` is told not to expose raw
  // readiness JSON, so JSON is not a substitute for saying the next command.
  function recoveryLines(next = []) {
    const lines = [];
    for (const entry of next) {
      if (!entry) continue;
      const heading = entry.provider ? `${entry.provider}: ` : "";
      if (entry.decision?.summary) lines.push(`  ${heading}${entry.decision.summary}`);
      else if (entry.reason) lines.push(`  ${heading}${entry.reason}`);
      const commands = [
        entry.wiring?.command,
        entry.request?.command,
        entry.request?.packet,
        entry.verify,
        ...(entry.choices || []).map((choice) => choice.command || choice.verify)
      ].filter(Boolean);
      for (const command of [...new Set(commands)]) lines.push(`    ${command}`);
      for (const option of entry.decision?.options || [])
        if (option?.outcome) lines.push(`    - ${option.outcome}`);
      for (const choice of entry.choices || [])
        if (choice?.instruction) lines.push(`    - ${choice.instruction}`);
    }
    return lines;
  }

  function proofPreflight(id, stage = "prove", quiet = false) {
    const value = proofReadinessValue(id, stage);
    const blockers = [
      ...value.issues,
      ...value.externalProviders.map((provider) =>
        `provider '${provider}' has no executable adapter or valid external receipt`),
      ...value.unavailableProviders.map((provider) => `provider unavailable: ${provider}`)
    ];
    if (value.pendingTasks.length)
      blockers.push(`${value.pendingTasks.length} implementation task(s) remain unchecked`);
    if (blockers.length) {
      const recovery = recoveryLines(value.next);
      fail(`proof preflight failed: ${blockers.join("; ")}${
        recovery.length ? `\n\nhow to clear this (${value.status}):\n${recovery.join("\n")}` : ""
      }\n\nfull detail: claude-foundation proof readiness ${id}`);
    }
    if (!quiet) {
      console.log(`PROOF PREFLIGHT ${id}: ready\n  stage: ${stage}\n  workspace: ${value.workspaceHash}`);
      for (const advisory of value.advisories || [])
        console.error(advisory.reason === "user-waived"
          ? `  WAIVED ${advisory.capability}: withdrawn by ${
            advisory.authority?.reference || "user decision"}${
            advisory.detail ? ` — ${advisory.detail}` : ""}; not blocking`
          : `  ADVISORY ${advisory.capability}: inferred from ${
            advisory.trigger || "the changed surface"} with no provider wired; not blocking`);
    }
    return true;
  }

  function upgradeEvidence(id) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const path = join(changePath(id), "evidence.yaml");
    const value = readJson(path);
    if (![1, 2].includes(value.version))
      fail(`cannot upgrade unknown evidence version '${value.version}'`);
    if (value.version === 1) value.version = 2;
    const executionPath = join(changePath(id), "execution.yaml");
    const currentExecution = existsSync(executionPath)
      ? readJson(executionPath) : { version: 1, providers: {}, services: {} };
    currentExecution.providers = {
      ...(value.providers || {}),
      ...(currentExecution.providers || {})
    };
    delete value.providers;
    writeJson(path, value);
    writeJson(executionPath, currentExecution);
    state.version = 2;
    state.revision = Number(state.revision || 0) + 1;
    state.executionRevision = Number(state.executionRevision || 0) + 1;
    if (existsSync(proofPath(id))) rmSync(proofPath(id));
    saveRuntime(state);
    console.log(`EVIDENCE ${id}: contract and execution wiring separated\n  configure execution.yaml before proof execute`);
  }

  return {
    activeWorkRecovery,
    changedSurfaceIssues,
    codeChangeRecovery,
    configurationRecovery,
    externalEvidenceRecovery,
    proofPreflight,
    proofReadiness,
    proofReadinessValue,
    recoveryLines,
    readinessBudgetPolicy,
    topologyIssues,
    unavailableProviderRecovery,
    upgradeEvidence
  };
}
