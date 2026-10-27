import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
// Shared with drift classification: the same kinds that force a deep tier here
// are the ones a silent downgrade must block at Land.
import { DRIFT_BLOCKING_TASK_KINDS } from "../contracts/model-policy.mjs";
import {
  blockingConflictRows, compileExecutionGraph, conflictKeysForTask, conflictKeysOverlap,
  scheduleReadyBatch, singleAgentExecutionEligible
} from "../core/graph-execution.mjs";
import { findCyclePath } from "../core/graph.mjs";

export function taskIsHighRisk(state, task) {
  return state.impact === "high" ||
    (state.securityTriggers || []).length > 0 ||
    DRIFT_BLOCKING_TASK_KINDS.has(task.kind);
}

export function defaultTaskModelTier(task, highRisk) {
  if (highRisk && DRIFT_BLOCKING_TASK_KINDS.has(task.kind)) return "deep";
  if (!highRisk && ["inventory", "logs", "mechanical-docs"].includes(task.kind))
    return "fast";
  return "standard";
}

export function modelForTaskOperation(context, id, task,
  selectedPolicy = context.policy()) {
  const highRisk = taskIsHighRisk(context.loadRuntime(id), task);
  let tier = task.requestedModel;
  if (tier && !["fast", "standard", "deep"].includes(tier))
    context.fail(`task '${task.id}' model must be fast|standard|deep`);
  if (!tier) tier = defaultTaskModelTier(task, highRisk);
  if (tier === "fast" && highRisk) tier = "standard";
  const fallbackTier = selectedPolicy.models[tier].fallbackTier ?? null;
  return {
    tier,
    family: selectedPolicy.models[tier].family,
    fallbackTier,
    fallbackFamily: fallbackTier ? selectedPolicy.models[fallbackTier].family : null,
    reason: highRisk ? "risk-sensitive task" : `${task.kind} task`
  };
}

export function createModelRouter({ loadRuntime, policy, fail }) {
  const modelForTask = modelForTaskOperation.bind(null, { loadRuntime, policy, fail });
  return { modelForTask };
}

export function taskPlanIdentity(task) {
  return {
    repository: task.repository,
    kind: task.kind,
    dependsOn: task.dependsOn,
    paths: task.paths,
    resources: task.resources,
    text: task.text
  };
}

export function changedPlanRepositories(plan, prior) {
  if (!prior) return [];
  return Object.keys(plan.repositoryContractHashes).filter((repository) =>
    prior.repositoryContractHashes?.[repository] !== plan.repositoryContractHashes[repository]);
}

export function invalidatedPlanTasks(plan, prior, stableHash) {
  if (!prior) return new Set();
  const changedRepositories = changedPlanRepositories(plan, prior);
  const globalContractChanged = prior.contractFingerprint !== plan.contractFingerprint &&
    changedRepositories.length === 0;
  return new Set(plan.tasks.filter((task) => {
    const old = prior.tasks?.find((candidate) => candidate.id === task.id);
    return !old || globalContractChanged || changedRepositories.includes(task.repository) ||
      stableHash(taskPlanIdentity(old)) !== stableHash(taskPlanIdentity(task));
  }).map((task) => task.id));
}

export function propagateInvalidatedTasks(tasks, invalidated) {
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const task of tasks)
      if (!invalidated.has(task.id) &&
          task.dependsOn.some((dependency) => invalidated.has(dependency))) {
        invalidated.add(task.id);
        expanded = true;
      }
  }
  return invalidated;
}

export function persistedPlanOutput(plan, prior, invalidated) {
  return {
    ...plan,
    supersedesPlanDigest: prior?.planDigest || null,
    invalidatedTasks: [...invalidated],
    preservedTasks: prior
      ? plan.tasks.filter((task) => !invalidated.has(task.id)).map((task) => task.id)
      : []
  };
}

export function agentPlanGroupView(output, id, rawGroup, fail) {
  const group = Number(rawGroup);
  if (!Number.isInteger(group) || group < 1 || group > output.groups.length)
    fail(`agents plan --group must be 1..${output.groups.length}`);
  const ids = output.groups[group - 1];
  return {
    version: 1, changeId: id, planDigest: output.planDigest, group,
    tasks: output.tasks.filter((task) => ids.includes(task.id)).map((task) => ({
      id: task.id, repository: task.repository, kind: task.kind,
      model: task.model, dependsOn: task.dependsOn,
      resources: task.resources, packetCommand: task.packetCommand
    }))
  };
}

export function agentPlanGroupSummaries(groups, stableHash) {
  return groups.map((ids, index) => ({
    group: index + 1,
    taskCount: ids.length,
    taskIds: ids.length <= 12 ? ids : null,
    taskDigest: ids.length > 12 ? stableHash(ids) : null
  }));
}

export function agentPlanNext(output, id) {
  if (!output.dispatchable) return "resolve blockingReasons before dispatch";
  if (output.recommendedExecution === "proof-ready")
    return `claude-foundation proof readiness ${id}`;
  if (output.recommendedExecution === "single-agent")
    return `claude-foundation packet ${id} --task ${output.tasks[0].id}`;
  return `claude-foundation agents plan ${id} --group 1`;
}

export function agentPlanSummaryView(context, id, path, output) {
  const modelCounts = output.tasks.reduce((counts, task) => {
    counts[task.model.family] = (counts[task.model.family] || 0) + 1;
    return counts;
  }, {});
  const groupSummaries = agentPlanGroupSummaries(output.groups, context.stableHash);
  return {
    version: Number(context.schemaVersion),
    changeId: id,
    planDigest: output.planDigest,
    graphRevision: output.graphRevision,
    graphIdentity: output.graphIdentity,
    graphNodes: output.graph.nodes.length,
    graphEdges: output.graph.edges.length,
    planPath: relative(context.root, path).replaceAll("\\", "/"),
    dispatchable: output.dispatchable,
    blockingReasons: context.compactStrings(output.blockingReasons, 10),
    // Scope shared with another active change is information, not a block:
    // name it so the session knows a later landing will synchronize.
    overlaps: context.compactStrings((output.overlaps || []).map((row) =>
      `${row.changeId}: ${row.key}`), 10),
    recommendedExecution: output.recommendedExecution,
    sessionModel: output.sessionModel,
    executionReason: output.executionReason,
    repositoryCount: output.repositories.length,
    repositories: context.compactStrings(
      output.repositories.map((repository) => repository.id), 20),
    taskCount: output.tasks.length,
    modelCounts,
    groupCount: groupSummaries.length,
    scheduling: output.scheduling,
    groups: groupSummaries.length <= 20 ? groupSummaries : {
      preview: groupSummaries.slice(0, 10),
      count: groupSummaries.length,
      digest: context.stableHash(groupSummaries)
    },
    invalidatedTasks: output.invalidatedTasks.length <= 20
      ? output.invalidatedTasks
      : { count: output.invalidatedTasks.length, digest: context.stableHash(output.invalidatedTasks) },
    next: agentPlanNext(output, id)
  };
}

export function selectAgentPlanView(context, id, path, output, flags = {}) {
  if (flags.full) return { view: "full", visible: output };
  if (flags.group !== undefined)
    return {
      view: "group",
      visible: agentPlanGroupView(output, id, flags.group, context.fail)
    };
  return {
    view: "summary",
    visible: agentPlanSummaryView(context, id, path, output)
  };
}

export function showAgentPlan(context, id, flags = {}) {
  const plan = context.planValue(id);
  const path = join(context.plans, `${id}.json`);
  const prior = existsSync(path) ? context.readJson(path, {}) : null;
  const invalidated = propagateInvalidatedTasks(
    plan.tasks, invalidatedPlanTasks(plan, prior, context.stableHash));
  const output = persistedPlanOutput(plan, prior, invalidated);
  context.writeJson(path, output);
  const { view, visible } = selectAgentPlanView(context, id, path, output, flags);
  visible.version = Number(context.schemaVersion);
  const encoded = context.serializedJson(visible, Boolean(flags.pretty));
  const limit = view === "summary"
    ? Number(context.policy().execution.planSummaryBytes)
    : Number(context.policy().execution.packetBytes.repository);
  if (Buffer.byteLength(encoded) > limit)
    context.fail(`agent ${view} exceeds ${limit} bytes; inspect the persisted plan by digest`);
  context.recordContextMetric(id, `agent-plan-${view}`, Buffer.byteLength(encoded), {
    tasks: output.tasks.length, repositories: output.repositories.length
  });
  if (context.write) context.write(encoded);
  else process.stdout.write(encoded);
}

export function showAgentTask(context, id, taskId, flags = {}) {
  const plan = context.planValue(id);
  if (!plan.dispatchable)
    context.fail(`change '${id}' is not dispatchable: ${plan.blockingReasons.join("; ")}`);
  const task = plan.tasks.find((candidate) =>
    candidate.id === String(taskId || "").toUpperCase());
  if (!task) context.fail(`unknown pending task '${taskId || ""}'`);
  context.showPacket(id, {
    repo: task.repository, task: task.id,
    pretty: flags.pretty, planDigest: plan.planDigest,
    graphRevision: plan.graphRevision,
    graphIdentity: plan.graphIdentity,
    graphNode: plan.graph.nodes.find((node) => node.id === `task:${task.id}`) || null
  });
}

const PROOF_RUN_STALE_MS = 2 * 60 * 60 * 1000;

export function runtimeEntryIsJsonFile(entry) {
  return entry.isFile() && entry.name.endsWith(".json");
}

export function readRuntimeDirectory(path) {
  return readdirSync(path, { withFileTypes: true });
}

export function conflictChangeIsEligible(other, id) {
  return Boolean(other.id && other.id !== id && other.status !== "archived");
}

export function activeProofRunIsCurrent(other, nowMs = Date.now()) {
  const startedAt = Date.parse(other.activeProofRun?.startedAt || "");
  return Boolean(other.activeProofRun && Number.isFinite(startedAt) &&
    nowMs - startedAt <= PROOF_RUN_STALE_MS);
}

export function repositoryConflictRows(other, wanted, held, overlap) {
  const conflicts = [];
  for (const requestedKey of wanted) {
    for (const heldKey of held) {
      if (!overlap(requestedKey, heldKey)) continue;
      conflicts.push({
        changeId: other.id,
        repository: requestedKey.match(/^(?:repo|path):([^:]+)/)?.[1] || null,
        key: `${requestedKey} <> ${heldKey}`,
        status: other.status
      });
      break;
    }
  }
  return conflicts;
}

export function enrichAgentTasks(context, id, allTasks, repositories, selectedPolicy) {
  const repositoryMap = new Map(repositories.map((repository) => [repository.id, repository]));
  const tasks = allTasks.filter((task) => !task.done);
  const ids = new Set(allTasks.map((task) => task.id));
  const completed = new Set(allTasks.filter((task) => task.done).map((task) => task.id));
  for (const task of tasks) {
    if (!repositoryMap.has(task.repository))
      context.fail(`task '${task.id}' references unselected repository '${task.repository}'`);
    const unknown = task.dependsOn.filter((dependency) => !ids.has(dependency));
    if (unknown.length)
      context.fail(`task '${task.id}' depends on unknown task(s): ${unknown.join(", ")}`);
    const repository = repositoryMap.get(task.repository);
    // A task-level dependency is precise enough to replace the repository's
    // coarse dependency edge. Without it every task in the dependency repo
    // would unnecessarily serialize this task.
    if (task.dependsOn.length === 0)
      for (const dependencyRepository of repository.dependsOn || [])
        for (const dependencyTask of tasks.filter((candidate) =>
          candidate.repository === dependencyRepository))
          if (!task.dependsOn.includes(dependencyTask.id))
            task.dependsOn.push(dependencyTask.id);
    task.resources = [...new Set([`workspace:${task.repository}`, ...task.resources])].sort();
    task.leaseKeys = conflictKeysForTask(task);
    task.model = context.modelForTask(id, task, selectedPolicy);
    task.packetCommand = `claude-foundation packet ${id} --task ${task.id}`;
  }
  return { tasks, completed };
}

export function groupAgentTasks(tasks, completed, maxParallelAgents, resourcesConflict, fail,
  recordWave = () => {}) {
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const groups = [];
  const initialCycle = findCyclePath(new Map(tasks.map((task) =>
    [task.id, task.dependsOn.filter((dependency) => pending.has(dependency))])));
  if (initialCycle) fail(`task dependency cycle: ${initialCycle.join(" -> ")}`);
  while (pending.size) {
    const { ready, selected: group } = scheduleReadyBatch([...pending.values()], completed, {
      maxParallel: maxParallelAgents,
      conflicts: resourcesConflict
    });
    if (!ready.length) {
      const cycle = findCyclePath(new Map([...pending.values()].map((task) =>
        [task.id, task.dependsOn.filter((dependency) => pending.has(dependency))])));
      fail(cycle
        ? `task dependency cycle: ${cycle.join(" -> ")}`
        : `task dependency deadlock: ${[...pending.keys()].join(", ")}`);
    }
    if (!group.length) group.push(ready[0]);
    recordWave({
      wave: groups.length + 1,
      readyNodes: ready.length,
      executedNodes: group.length
    });
    groups.push(group.map((task) => task.id));
    for (const task of group) {
      pending.delete(task.id);
      completed.add(task.id);
    }
  }
  return groups;
}

export function agentExecutionSummary(tasks, singleAgent) {
  const tierRank = { fast: 0, standard: 1, deep: 2 };
  const sessionTask = tasks.reduce((highest, task) =>
    !highest || tierRank[task.model.tier] > tierRank[highest.model.tier] ? task : highest, null);
  if (tasks.length === 0) return {
    sessionTask: null,
    recommendedExecution: "proof-ready",
    sessionModel: null,
    executionReason: "all implementation tasks are complete"
  };
  if (singleAgent) return {
    sessionTask,
    recommendedExecution: "single-agent",
    sessionModel: sessionTask.model,
    executionReason: `one repository; highest required tier is ${sessionTask.model.tier}`
  };
  return {
    sessionTask,
    recommendedExecution: "planned-agents",
    sessionModel: null,
    executionReason: "independent dependency/resource groups require planned dispatch"
  };
}

export function agentTaskExecutionRows(tasks, singleAgent, priorPlan, graph) {
  const execution = { ...(priorPlan.taskExecution || {}) };
  for (const task of tasks) execution[task.id] = {
    mode: singleAgent ? "single-agent-observed" : "lease-result",
    repository: task.repository,
    graphRevision: graph.revision,
    graphIdentity: graph.identity
  };
  return execution;
}

export function agentPlanBlockingReasons(state, conflicts, authority = null) {
  return [
    ...(state.ambiguity === "unclear" ? ["ambiguity requires /investigate"] : []),
    ...(authority && authority.status !== "READY"
      ? authority.blockers.map((blocker) =>
        `${blocker.kind || "authority"}:${blocker.code}: ${blocker.summary}`)
      : []),
    ...conflicts.map((conflict) =>
      `scope ${conflict.key} is active in ${conflict.changeId}`)
  ];
}

export function agentGraphProviderRows(context, id, contract) {
  const providers = context.requiredProviders
    ? context.requiredProviders(id)
    : Object.keys(contract.providers || {});
  return providers.map((provider) => {
    const config = context.providerConfig?.(id, provider) ||
      contract.providers?.[provider] || {};
    return {
      id: provider,
      capability: context.providerCapability(provider, config),
      repository: config.repository || null,
      repositories: context.providerRepositories
        ? context.providerRepositories(id, provider, config).map((repository) => repository.id)
        : config.repositories || [],
      dependsOn: config.dependsOn || [],
      ...(config.service ? { service: config.service } : {}),
      resources: config.resources || [],
      claims: context.claimsForProvider
        ? context.claimsForProvider(id, provider).map((claim) => claim.id)
        : null,
      inputSchema: config.inputSchema || null,
      outputSchema: config.outputSchema || null,
      configurationIdentity: context.stableHash(config),
      required: true
    };
  });
}

export function activeRepositoryConflictsOperation(
  context, id, repositories, { executing = false } = {}
) {
  const current = context.loadRuntime(id);
  const wanted = context.changeConflictKeys(id, current, repositories);
  const conflicts = [];
  if (!context.exists(context.runtime)) return conflicts;
  for (const entry of context.readDirectory(context.runtime)) {
    if (!runtimeEntryIsJsonFile(entry)) continue;
    const other = context.readJson(join(context.runtime, entry.name), {});
    if (!conflictChangeIsEligible(other, id)) continue;
    if (executing && !activeProofRunIsCurrent(other, context.nowMs())) continue;
    let selected;
    try { selected = context.safeSelectedRepositories(other.id, other); }
    catch { continue; }
    if (!selected) continue;
    const held = context.changeConflictKeys(other.id, other, selected);
    conflicts.push(...repositoryConflictRows(
      other, wanted, held, context.conflictKeysOverlap));
  }
  return conflicts;
}

export function createAgentPlanner({
  root, plans, runtime, schemaVersion, validate, loadRuntime, policy,
  selectedRepositories, safeSelectedRepositories, taskBlocks, taskMetadata,
  activeChangePath, evidence,
  providerCapability = (provider) => provider,
  claimsForProvider = null,
  requiredProviders = null,
  providerConfig = null,
  providerRepositories = null,
  resourcesConflict, relevantHash, contractFingerprint, stableHash, now,
  authorityPreflight = () => ({ status: "READY", blockers: [] }),
  executionContract = null,
  readJson, writeJson, compactStrings, serializedJson, recordContextMetric,
  recordInstructionManifest, modelForTask, showPacket, fail,
  recordScheduler
}) {
  // Build resources are repo-qualified (`workspace:api`); evidence resources
  // are a different vocabulary (`workspace-read`, `dev-server`). Judging build
  // tasks with the evidence comparator made every pair of tasks in one
  // repository conflict, so a single-repository change never planned more than
  // one agent and maxParallelAgents did nothing. Two tasks in one repository
  // are independent when their declared paths are disjoint — which is what
  // `[paths:]` is for. An undeclared scope is still treated as the whole tree.
  function pathScope(value) {
    return String(value).replace(/[*?[].*$/, "").replace(/\/+$/, "");
  }

  function pathsOverlap(left, right) {
    if (!left.length || !right.length) return true;
    return left.some((one) => right.some((other) => {
      const a = pathScope(one);
      const b = pathScope(other);
      if (!a || !b) return true;
      return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    }));
  }

  function taskResourcesConflict(left, right) {
    const shared = left.resources.filter((resource) => right.resources.includes(resource));
    if (!shared.length) return false;
    if (shared.some((resource) => !resource.startsWith("workspace:"))) return true;
    return pathsOverlap(left.paths || [], right.paths || []);
  }

  function changeConflictKeys(changeId, state, repositories) {
    const writable = new Set(repositories.filter((repository) => repository.mode === "write")
      .map((repository) => repository.id));
    const path = join(activeChangePath(changeId, state), "tasks.md");
    if (!existsSync(path)) return [...writable].map((repository) => `repo:${repository}`);
    const tasks = taskBlocks(readFileSync(path, "utf8")).map(taskMetadata)
      .filter((task) => writable.has(task.repository));
    if (!tasks.length) return [...writable].map((repository) => `repo:${repository}`);
    return [...new Set(tasks.flatMap(conflictKeysForTask))].sort();
  }

  // `executing` narrows the scan to changes with a live proof run. Plan time
  // still considers every change holding write scope.
  const activeRepositoryConflicts = activeRepositoryConflictsOperation.bind(null, {
    runtime, loadRuntime, changeConflictKeys,
    exists: existsSync,
    readDirectory: readRuntimeDirectory,
    readJson, safeSelectedRepositories, conflictKeysOverlap,
    nowMs: Date.now
  });

  function planValue(id, options = {}) {
    validate(id, "active", { quiet: true, inspect: options.inspect === true });
    const state = loadRuntime(id);
    const selectedPolicy = policy();
    const repositories = selectedRepositories(id, state);
    const allTasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
      .map((task) => ({
        ...taskMetadata(task),
        authorityDigest: stableHash(task.text.replace(/\s+/g, " ").trim())
      }));
    const { tasks, completed } = enrichAgentTasks({ modelForTask, fail },
      id, allTasks, repositories, selectedPolicy);
    const schedulingWaves = [];
    const groups = groupAgentTasks(tasks, completed,
      selectedPolicy.execution.maxParallelAgents, taskResourcesConflict, fail,
      (wave) => schedulingWaves.push(wave));
    const contract = evidence(id);
    const claims = contract.claims;
    const singleAgent = singleAgentExecutionEligible(tasks, claims);
    const priorPlanPath = join(plans, `${id}.json`);
    const priorPlan = existsSync(priorPlanPath) ? readJson(priorPlanPath, {}) : {};
    const activeConflicts = activeRepositoryConflicts(id, repositories);
    const conflicts = blockingConflictRows(activeConflicts);
    // Scope overlaps with other active changes are reported, never enforced:
    // the later landing synchronizes onto the moved target and re-proves.
    const overlaps = activeConflicts.filter((row) => !conflicts.includes(row)).map((row) => ({
      ...row,
      note: "another active change touches this scope; whichever lands later synchronizes with `sandbox sync`, resolves any double edit, and re-proves"
    }));
    const compiledContract = executionContract?.(id) || null;
    const authority = compiledContract?.authority || authorityPreflight(id);
    const blockingReasons = agentPlanBlockingReasons(state, conflicts, authority);
    const execution = agentExecutionSummary(tasks, singleAgent);
    const instructionManifest = options.inspect ? null : recordInstructionManifest?.(id, "build", {
      scope: "plan",
      requestedModel: singleAgent ? execution.sessionTask?.model?.tier || null : null
    });
    const workspaceHash = relevantHash(id);
    const graph = compileExecutionGraph({
      changeId: id,
      contractRevision: Number(state.contractRevision || 0),
      workspaceHash,
      repositories,
      tasks: allTasks.map((task) => ({
        ...task,
        resources: [...new Set([`workspace:${task.repository}`, ...(task.resources || [])])]
      })),
      claims,
      providers: agentGraphProviderRows({
        requiredProviders, providerConfig, providerCapability,
        providerRepositories, claimsForProvider, stableHash
      }, id, contract),
      services: Object.entries(contract.execution?.services || {}).map(([serviceId, config]) => ({
        id: serviceId,
        dependsOn: config.dependsOn || [],
        resources: config.resources || [],
        port: config.port || null,
        command: config.command || null
      })),
      stableHash
    });
    const taskExecution = agentTaskExecutionRows(tasks, singleAgent, priorPlan, graph);
    schedulingWaves.forEach((wave, index) => recordScheduler({
      scheduler: "build-task-plan", wave: wave.wave,
      readyNodes: wave.readyNodes, executedNodes: wave.executedNodes,
      reusedNodes: index === 0 ? allTasks.length - tasks.length : 0,
      queueingMs: null, peakConcurrency: wave.executedNodes
    }));
    const basePlan = {
      version: Number(schemaVersion),
      changeId: id,
      revision: Number(state.revision || 0),
      contractRevision: Number(state.contractRevision || 0),
      workspaceHash,
      graph,
      graphVersion: graph.version,
      graphRevision: graph.revision,
      graphIdentity: graph.identity,
      taskExecution,
      maxParallelAgents: selectedPolicy.execution.maxParallelAgents,
      repositories: repositories.map((repository) => ({
        id: repository.id, mode: repository.mode, workspacePath: repository.workspacePath,
        dependsOn: repository.dependsOn || []
      })),
      tasks,
      groups,
      scheduling: {
        strategy: "critical-path-resource-aware",
        capacity: selectedPolicy.execution.maxParallelAgents,
        readyConcurrency: groups[0]?.length || 0
      },
      recommendedExecution: execution.recommendedExecution,
      sessionModel: execution.sessionModel,
      executionReason: execution.executionReason,
      conflicts,
      overlaps,
      authorityPreflight: authority,
      executionContract: compiledContract,
      blockingReasons,
      dispatchable: blockingReasons.length === 0,
      instructionProvenance: instructionManifest ? {
        schemaVersion: instructionManifest.schemaVersion,
        manifestDigest: instructionManifest.manifestDigest,
        requestedModel: instructionManifest.execution?.requestedModel || null
      } : null,
      contractFingerprint: contractFingerprint(id),
      repositoryContractHashes: Object.fromEntries(repositories.map((repository) => [
        repository.id,
        stableHash(claims.filter((claim) =>
          !claim.repositories || claim.repositories.includes(repository.id)))
      ])),
      modelPolicy: {
        fast: selectedPolicy.models.fast.family,
        standard: selectedPolicy.models.standard.family,
        deep: selectedPolicy.models.deep.family
      }
    };
    return { ...basePlan, planDigest: stableHash(basePlan), createdAt: now() };
  }

  const showTask = showAgentTask.bind(null, { planValue, showPacket, fail });

  const showPlan = showAgentPlan.bind(null, {
    root, plans, schemaVersion, policy, stableHash, readJson, writeJson,
    compactStrings, serializedJson, recordContextMetric, fail, planValue
  });

  return { planValue, showPlan, showTask, activeRepositoryConflicts };
}
