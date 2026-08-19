import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
// Shared with drift classification: the same kinds that force a deep tier here
// are the ones a silent downgrade must block at Land.
import { DRIFT_BLOCKING_TASK_KINDS } from "../contracts/model-policy.mjs";
import {
  compileExecutionGraph, conflictKeysForTask, conflictKeysOverlap,
  singleAgentExecutionEligible
} from "../core/graph-execution.mjs";
import { findCyclePath } from "../core/graph.mjs";

export function createModelRouter({ loadRuntime, policy, fail }) {
  function modelForTask(id, task, selectedPolicy = policy()) {
    const state = loadRuntime(id);
    const highRisk = state.impact === "high" ||
      (state.securityTriggers || []).length > 0 ||
      DRIFT_BLOCKING_TASK_KINDS.has(task.kind);
    let tier = task.requestedModel;
    if (tier && !["fast", "standard", "deep"].includes(tier))
      fail(`task '${task.id}' model must be fast|standard|deep`);
    if (!tier) {
      if (highRisk && DRIFT_BLOCKING_TASK_KINDS.has(task.kind)) tier = "deep";
      else if (!highRisk && ["inventory", "logs", "mechanical-docs"].includes(task.kind))
        tier = "fast";
      else tier = "standard";
    }
    if (tier === "fast" && highRisk) tier = "standard";
    const fallbackTier = selectedPolicy.models[tier].fallbackTier ?? null;
    return {
      tier, family: selectedPolicy.models[tier].family,
      fallbackTier,
      fallbackFamily: fallbackTier ? selectedPolicy.models[fallbackTier].family : null,
      reason: highRisk ? "risk-sensitive task" : `${task.kind} task`
    };
  }
  return { modelForTask };
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
  readJson, writeJson, compactStrings, serializedJson, recordContextMetric,
  recordInstructionManifest, modelForTask, showPacket, fail
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

  // A proof run that no process is behind any more must not block forever:
  // a hard kill can leave the marker set, and the normal paths that clear it
  // cannot run. Anything older than this is treated as abandoned.
  const PROOF_RUN_STALE_MS = 2 * 60 * 60 * 1000;

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

  // `executing` narrows the scan to changes with a proof run in flight. Plan
  // time wants every change holding write scope; proof time wants only the
  // ones that would actually be running commands against the repository at the
  // same moment, or a project with two open changes could never prove either.
  function activeRepositoryConflicts(id, repositories, { executing = false } = {}) {
    const current = loadRuntime(id);
    const wanted = changeConflictKeys(id, current, repositories);
    const conflicts = [];
    if (!existsSync(runtime)) return conflicts;
    for (const entry of readdirSync(runtime, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const other = readJson(join(runtime, entry.name), {});
      if (!other.id || other.id === id || other.status === "archived") continue;
      if (executing) {
        const startedAt = Date.parse(other.activeProofRun?.startedAt || "");
        if (!other.activeProofRun ||
            !Number.isFinite(startedAt) ||
            Date.now() - startedAt > PROOF_RUN_STALE_MS) continue;
      }
      // selectedRepositories reports a bad topology by exiting the process, so
      // this catch never fired: one change with a stale repositories.yaml
      // reference blocked planning and lease acquisition for every unrelated
      // change. A change we cannot read cannot be shown to conflict, so skip it
      // — its own commands still surface the error.
      let selected;
      try { selected = safeSelectedRepositories(other.id, other); }
      catch { continue; }
      if (!selected) continue;
      const held = changeConflictKeys(other.id, other, selected);
      for (const requestedKey of wanted)
        for (const heldKey of held)
          if (conflictKeysOverlap(requestedKey, heldKey)) {
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

  function planValue(id) {
    validate(id, "active", { quiet: true });
    const state = loadRuntime(id);
    const selectedPolicy = policy();
    const repositories = selectedRepositories(id, state);
    const repositoryMap = new Map(repositories.map((repository) => [repository.id, repository]));
    const allTasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
      .map((task) => ({
        ...taskMetadata(task),
        authorityDigest: stableHash(task.text.replace(/\s+/g, " ").trim())
      }));
    const tasks = allTasks.filter((task) => !task.done);
    const ids = new Set(allTasks.map((task) => task.id));
    const completed = new Set(allTasks.filter((task) => task.done).map((task) => task.id));
    for (const task of tasks) {
      if (!repositoryMap.has(task.repository))
        fail(`task '${task.id}' references unselected repository '${task.repository}'`);
      const unknown = task.dependsOn.filter((dependency) => !ids.has(dependency));
      if (unknown.length)
        fail(`task '${task.id}' depends on unknown task(s): ${unknown.join(", ")}`);
      const repository = repositoryMap.get(task.repository);
      // Repo-level `dependsOn` is a blunt instrument: it makes every task here
      // wait for every task there. That is the safe default when the author has
      // said nothing, but a task that declares its own `[depends:]` has said
      // precisely what it needs — adding the coarse edges on top would
      // serialize work the author already sequenced.
      const authorSequenced = task.dependsOn.length > 0;
      if (!authorSequenced)
        for (const dependencyRepository of repository.dependsOn || [])
          for (const dependencyTask of tasks.filter((candidate) =>
            candidate.repository === dependencyRepository))
            if (!task.dependsOn.includes(dependencyTask.id)) task.dependsOn.push(dependencyTask.id);
      task.resources = [...new Set([`workspace:${task.repository}`, ...task.resources])].sort();
      task.leaseKeys = conflictKeysForTask(task);
      task.model = modelForTask(id, task, selectedPolicy);
      task.packetCommand = `claude-foundation packet ${id} --task ${task.id}`;
    }
    const pending = new Map(tasks.map((task) => [task.id, task]));
    const groups = [];
    while (pending.size) {
      const ready = [...pending.values()].filter((task) =>
        task.dependsOn.every((dependency) => completed.has(dependency)));
      if (!ready.length) {
        // Unknown dependencies already failed above and done tasks are in
        // `completed`, so a stuck graph here can only be a cycle among the
        // pending tasks — name one concrete cycle instead of every pending id.
        const cycle = findCyclePath(new Map([...pending.values()].map((task) =>
          [task.id, task.dependsOn.filter((dependency) => pending.has(dependency))])));
        fail(cycle
          ? `task dependency cycle: ${cycle.join(" -> ")}`
          : `task dependency deadlock: ${[...pending.keys()].join(", ")}`);
      }
      const group = [];
      for (const task of ready) {
        const conflicts = group.some((selected) => taskResourcesConflict(selected, task));
        if (!conflicts && group.length < selectedPolicy.execution.maxParallelAgents) group.push(task);
      }
      if (!group.length) group.push(ready[0]);
      groups.push(group.map((task) => task.id));
      for (const task of group) {
        pending.delete(task.id);
        completed.add(task.id);
      }
    }
    const contract = evidence(id);
    const claims = contract.claims;
    const singleAgent = singleAgentExecutionEligible(tasks, claims);
    const priorPlanPath = join(plans, `${id}.json`);
    const priorPlan = existsSync(priorPlanPath) ? readJson(priorPlanPath, {}) : {};
    const taskExecution = { ...(priorPlan.taskExecution || {}) };
    for (const task of tasks) taskExecution[task.id] = {
      mode: singleAgent ? "single-agent-observed" : "lease-result",
      repository: task.repository
    };
    const tierRank = { fast: 0, standard: 1, deep: 2 };
    const sessionTask = tasks.reduce((highest, task) =>
      !highest || tierRank[task.model.tier] > tierRank[highest.model.tier] ? task : highest, null);
    const conflicts = activeRepositoryConflicts(id, repositories);
    const blockingReasons = [
      ...(state.ambiguity === "unclear" ? ["ambiguity requires /investigate"] : []),
      ...conflicts.map((conflict) =>
        `scope ${conflict.key} is active in ${conflict.changeId}`)
    ];
    const instructionManifest = recordInstructionManifest?.(id, "build", {
      scope: "plan",
      requestedModel: singleAgent ? sessionTask?.model?.tier || null : null
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
      providers: (requiredProviders ? requiredProviders(id) : Object.keys(contract.providers || {}))
        .map((provider) => {
        const config = providerConfig?.(id, provider) || contract.providers?.[provider] || {};
        return {
        id: provider,
        capability: providerCapability(provider, config),
        repository: config.repository || null,
        repositories: providerRepositories
          ? providerRepositories(id, provider, config).map((repository) => repository.id)
          : config.repositories || [],
        dependsOn: config.dependsOn || [],
        resources: config.resources || [],
        claims: claimsForProvider ? claimsForProvider(id, provider).map((claim) => claim.id) : null,
        inputSchema: config.inputSchema || null,
        outputSchema: config.outputSchema || null,
        configurationIdentity: stableHash(config),
        required: true
        };
      }),
      stableHash
    });
    for (const task of tasks) taskExecution[task.id] = {
      ...taskExecution[task.id],
      graphRevision: graph.revision,
      graphIdentity: graph.identity
    };
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
      recommendedExecution: tasks.length === 0
        ? "proof-ready" : singleAgent ? "single-agent" : "planned-agents",
      sessionModel: singleAgent ? sessionTask.model : null,
      executionReason: tasks.length === 0
        ? "all implementation tasks are complete"
        : singleAgent
          ? `one repository; highest required tier is ${sessionTask.model.tier}`
          : "independent dependency/resource groups require planned dispatch",
      conflicts,
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

  function showPlan(id, flags = {}) {
    const plan = planValue(id);
    const path = join(plans, `${id}.json`);
    const prior = existsSync(path) ? readJson(path, {}) : null;
    const changedRepositories = prior
      ? Object.keys(plan.repositoryContractHashes).filter((repository) =>
        prior.repositoryContractHashes?.[repository] !== plan.repositoryContractHashes[repository])
      : [];
    const globalContractChanged = Boolean(prior &&
      prior.contractFingerprint !== plan.contractFingerprint && changedRepositories.length === 0);
    const directlyInvalidated = new Set(prior
      ? plan.tasks.filter((task) => {
        const old = prior.tasks?.find((candidate) => candidate.id === task.id);
        return !old || globalContractChanged || changedRepositories.includes(task.repository) ||
          stableHash({
            repository: old.repository, kind: old.kind, dependsOn: old.dependsOn,
            paths: old.paths, resources: old.resources, text: old.text
          }) !== stableHash({
            repository: task.repository, kind: task.kind, dependsOn: task.dependsOn,
            paths: task.paths, resources: task.resources, text: task.text
          });
      }).map((task) => task.id)
      : []);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const task of plan.tasks)
        if (!directlyInvalidated.has(task.id) &&
            task.dependsOn.some((dependency) => directlyInvalidated.has(dependency))) {
          directlyInvalidated.add(task.id);
          expanded = true;
        }
    }
    const output = {
      ...plan,
      supersedesPlanDigest: prior?.planDigest || null,
      invalidatedTasks: [...directlyInvalidated],
      preservedTasks: prior
        ? plan.tasks.filter((task) => !directlyInvalidated.has(task.id)).map((task) => task.id)
        : []
    };
    writeJson(path, output);
    let visible;
    let view = "summary";
    if (flags.full) {
      visible = output;
      view = "full";
    } else if (flags.group !== undefined) {
      const groupNumber = Number(flags.group);
      if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > output.groups.length)
        fail(`agents plan --group must be 1..${output.groups.length}`);
      const ids = output.groups[groupNumber - 1];
      visible = {
        version: 1, changeId: id, planDigest: output.planDigest, group: groupNumber,
        tasks: output.tasks.filter((task) => ids.includes(task.id)).map((task) => ({
          id: task.id, repository: task.repository, kind: task.kind,
          model: task.model, dependsOn: task.dependsOn,
          resources: task.resources, packetCommand: task.packetCommand
        }))
      };
      view = "group";
    } else {
      const modelCounts = output.tasks.reduce((counts, task) => {
        counts[task.model.family] = (counts[task.model.family] || 0) + 1;
        return counts;
      }, {});
      const groupSummaries = output.groups.map((ids, index) => ({
        group: index + 1,
        taskCount: ids.length,
        taskIds: ids.length <= 12 ? ids : null,
        taskDigest: ids.length > 12 ? stableHash(ids) : null
      }));
      visible = {
        version: Number(schemaVersion),
        changeId: id,
        planDigest: output.planDigest,
        graphRevision: output.graphRevision,
        graphIdentity: output.graphIdentity,
        graphNodes: output.graph.nodes.length,
        graphEdges: output.graph.edges.length,
        planPath: relative(root, path).replaceAll("\\", "/"),
        dispatchable: output.dispatchable,
        blockingReasons: compactStrings(output.blockingReasons, 10),
        recommendedExecution: output.recommendedExecution,
        sessionModel: output.sessionModel,
        executionReason: output.executionReason,
        repositoryCount: output.repositories.length,
        repositories: compactStrings(output.repositories.map((repository) => repository.id), 20),
        taskCount: output.tasks.length,
        modelCounts,
        groupCount: groupSummaries.length,
        groups: groupSummaries.length <= 20 ? groupSummaries : {
          preview: groupSummaries.slice(0, 10),
          count: groupSummaries.length,
          digest: stableHash(groupSummaries)
        },
        invalidatedTasks: output.invalidatedTasks.length <= 20
          ? output.invalidatedTasks
          : { count: output.invalidatedTasks.length, digest: stableHash(output.invalidatedTasks) },
        next: !output.dispatchable
          ? "resolve blockingReasons before dispatch"
          : output.recommendedExecution === "proof-ready"
            ? `claude-foundation proof readiness ${id}`
            : output.recommendedExecution === "single-agent"
              ? `claude-foundation packet ${id} --task ${output.tasks[0].id}`
              : `claude-foundation agents plan ${id} --group 1`
      };
    }
    visible.version = Number(schemaVersion);
    const encoded = serializedJson(visible, Boolean(flags.pretty));
    const limit = view === "summary"
      ? Number(policy().execution.planSummaryBytes)
      : Number(policy().execution.packetBytes.repository);
    if (Buffer.byteLength(encoded) > limit)
      fail(`agent ${view} exceeds ${limit} bytes; inspect the persisted plan by digest`);
    recordContextMetric(id, `agent-plan-${view}`, Buffer.byteLength(encoded), {
      tasks: output.tasks.length, repositories: output.repositories.length
    });
    process.stdout.write(encoded);
  }

  function showTask(id, taskId, flags = {}) {
    const plan = planValue(id);
    if (!plan.dispatchable)
      fail(`change '${id}' is not dispatchable: ${plan.blockingReasons.join("; ")}`);
    const task = plan.tasks.find((candidate) =>
      candidate.id === String(taskId || "").toUpperCase());
    if (!task) fail(`unknown pending task '${taskId || ""}'`);
    showPacket(id, {
      repo: task.repository, task: task.id,
      pretty: flags.pretty, planDigest: plan.planDigest,
      graphRevision: plan.graphRevision,
      graphIdentity: plan.graphIdentity,
      graphNode: plan.graph.nodes.find((node) => node.id === `task:${task.id}`) || null
    });
  }

  return { planValue, showPlan, showTask, activeRepositoryConflicts };
}
