export const AGENT_DISPATCH_SCHEMA_VERSION = 1;

function taskById(plan, id) {
  return plan.tasks.find((task) => task.id === id);
}

function command(value) {
  return `claude-foundation ${value}`;
}

export function createAgentDispatchRuntime({
  agentPlanValue,
  activeChangeLeases,
  stableHash,
  policy,
  serializedJson = (value, pretty) => JSON.stringify(value, null, pretty ? 2 : 0),
  fail
}) {
  function dispatchValue(id) {
    if (!id) fail("agents dispatch requires <change>");
    const plan = agentPlanValue(id);
    const active = activeChangeLeases(id)
      .sort((left, right) => String(left.taskId).localeCompare(String(right.taskId)));
    const base = {
      version: AGENT_DISPATCH_SCHEMA_VERSION,
      changeId: id,
      graphRevision: plan.graphRevision,
      graphIdentity: plan.graphIdentity,
      planDigest: plan.planDigest,
      contractRevision: plan.contractRevision,
      workspaceHash: plan.workspaceHash,
      maxParallelAgents: plan.maxParallelAgents
    };

    // A native host restart cannot distinguish a slow live worker from an
    // abandoned one. Never fill spare slots beside authority issued by an
    // earlier host session; the existing lease remains the single owner until
    // it completes, expires, or an explicit recovery releases it.
    if (active.length) return {
      ...base,
      action: "wait",
      reason: "one or more task leases are still active",
      activeWorkers: active.map((lease) => ({
        taskId: lease.taskId,
        owner: lease.owner,
        leaseId: lease.leaseId || null,
        fencingGeneration: lease.fencingGeneration ?? null,
        executionAttempt: lease.executionAttempt ?? null,
        expiresAt: lease.expiresAt
      })),
      nextCommand: command(`agents dispatch ${id}`)
    };

    if (!plan.dispatchable) return {
      ...base,
      action: "blocked",
      reasons: {
        count: plan.blockingReasons.length,
        preview: plan.blockingReasons.slice(0, 10),
        digest: stableHash(plan.blockingReasons)
      },
      nextCommand: command(`agents plan ${id} --pretty`)
    };

    if (plan.recommendedExecution === "proof-ready") return {
      ...base,
      action: "build-complete",
      reason: plan.executionReason,
      nextCommand: command(`proof readiness ${id}`)
    };

    if (plan.recommendedExecution === "single-agent") return {
      ...base,
      action: "run-in-session",
      reason: plan.executionReason,
      pendingTaskCount: plan.tasks.length,
      pendingTaskIds: plan.tasks.slice(0, 20).map((task) => task.id),
      pendingTaskIdsTruncated: plan.tasks.length > 20,
      model: plan.sessionModel,
      packetCommand: command(`packet ${id} --phase build`),
      nextCommand: command(`agents dispatch ${id}`)
    };

    const readyIds = plan.groups[0] || [];
    const selected = readyIds.slice(0, plan.maxParallelAgents)
      .map((taskId) => taskById(plan, taskId))
      .filter(Boolean);
    if (!selected.length) fail(`change '${id}' has no dispatchable task group`);
    const workers = selected.map((task) => {
      const owner = `dispatch-${task.id.toLowerCase()}-${stableHash({
        changeId: id,
        graphRevision: plan.graphRevision,
        taskId: task.id
      }).slice(0, 12)}`;
      return {
        taskId: task.id,
        repository: task.repository,
        model: task.model,
        owner,
        acquireCommand: command(`agents acquire ${id} ${task.id} --owner ${owner}`),
        packetCommand: command(`packet ${id} --task ${task.id}`),
        releaseCommand: command(`agents release ${id} ${task.id} --owner ${owner}`)
      };
    });
    return {
      ...base,
      action: "spawn-group",
      reason: plan.executionReason,
      group: 1,
      workerCount: workers.length,
      workers,
      contextPolicy: {
        source: "leased-task-packet",
        parentTranscript: "excluded",
        acquireBeforePacket: true
      },
      nextCommand: command(`agents dispatch ${id}`)
    };
  }

  function showDispatch(id, flags = {}) {
    let value = dispatchValue(id);
    const pretty = Boolean(flags.pretty);
    const limit = Number(policy().execution.planSummaryBytes);
    let encoded = serializedJson(value, pretty);
    if (Buffer.byteLength(encoded) > limit && value.action === "spawn-group") {
      const allWorkers = value.workers;
      for (let count = allWorkers.length - 1; count >= 1; count -= 1) {
        value = {
          ...value,
          workerCount: count,
          totalReadyWorkerCount: allWorkers.length,
          workersTruncated: true,
          workersDigest: stableHash(allWorkers),
          workers: allWorkers.slice(0, count)
        };
        encoded = serializedJson(value, pretty);
        if (Buffer.byteLength(encoded) <= limit) break;
      }
    }
    if (Buffer.byteLength(encoded) > limit && value.action === "wait") {
      const allWorkers = value.activeWorkers;
      for (let count = allWorkers.length - 1; count >= 1; count -= 1) {
        value = {
          ...value,
          activeWorkerCount: allWorkers.length,
          activeWorkersTruncated: true,
          activeWorkersDigest: stableHash(allWorkers),
          activeWorkers: allWorkers.slice(0, count)
        };
        encoded = serializedJson(value, pretty);
        if (Buffer.byteLength(encoded) <= limit) break;
      }
    }
    if (Buffer.byteLength(encoded) > limit) {
      value = {
        version: AGENT_DISPATCH_SCHEMA_VERSION,
        changeId: id,
        graphRevision: value.graphRevision,
        planDigest: value.planDigest,
        action: "blocked",
        reason: `agent dispatch ${value.action} decision exceeds ${limit} bytes`,
        decisionDigest: stableHash(value),
        nextCommand: command(`agents plan ${id} --pretty`)
      };
      encoded = serializedJson(value, pretty);
    }
    if (Buffer.byteLength(encoded) > limit)
      fail(`agent dispatch recovery decision exceeds ${limit} bytes`);
    process.stdout.write(encoded);
  }

  return { dispatchValue, showDispatch };
}
