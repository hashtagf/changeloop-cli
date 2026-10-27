import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  agentExecutionSummary,
  agentGraphProviderRows,
  agentPlanBlockingReasons,
  agentPlanGroupSummaries,
  agentPlanGroupView,
  agentPlanNext,
  agentPlanSummaryView,
  agentTaskExecutionRows,
  changedPlanRepositories,
  enrichAgentTasks,
  groupAgentTasks,
  invalidatedPlanTasks,
  persistedPlanOutput,
  propagateInvalidatedTasks,
  selectAgentPlanView,
  showAgentTask,
  showAgentPlan,
  taskPlanIdentity
} from "../runtime/workflow/agent-planning.mjs";

const fail = (message) => { throw new Error(message); };
const stableHash = (value) => JSON.stringify(value);
const task = (id, options = {}) => ({
  id, repository: options.repository || "root", kind: options.kind || "code",
  model: { family: options.family || "sonnet" },
  dependsOn: options.dependsOn || [], paths: options.paths || [`src/${id}.js`],
  resources: options.resources || ["workspace:root"], text: options.text || id,
  packetCommand: `packet ${id}`
});

test("task enrichment validates repositories and dependencies", () => {
  const context = {
    modelForTask: () => ({ tier: "standard", family: "sonnet" }), fail
  };
  const policy = { execution: { maxParallelAgents: 3 } };
  const repositories = [{ id: "root" }, { id: "api", dependsOn: ["root"] }];
  assert.throws(() => enrichAgentTasks(context, "change", [
    { ...task("T1"), repository: "missing", done: false }
  ], repositories, policy), /unselected repository 'missing'/);
  assert.throws(() => enrichAgentTasks(context, "change", [
    { ...task("T1"), done: false, dependsOn: ["T404"] }
  ], repositories, policy), /depends on unknown task\(s\): T404/);
});

test("task enrichment applies precise and repository dependency policy", () => {
  const context = {
    modelForTask: (_id, value) => ({ tier: value.kind === "code" ? "deep" : "fast" }),
    fail
  };
  const allTasks = [
    { ...task("T0"), done: true },
    { ...task("T1"), done: false, resources: ["db", "db"] },
    { ...task("T2"), done: false, repository: "api", dependsOn: [], resources: [] },
    { ...task("T3"), done: false, repository: "api", dependsOn: ["T0"], resources: [] }
  ];
  const result = enrichAgentTasks(context, "change", allTasks,
    [{ id: "root" }, { id: "api", dependsOn: ["root"] }], {});
  assert.deepEqual([...result.completed], ["T0"]);
  assert.deepEqual(result.tasks[1].dependsOn, ["T1"]);
  assert.deepEqual(result.tasks[2].dependsOn, ["T0"]);
  assert.deepEqual(result.tasks[0].resources, ["db", "workspace:root"]);
  assert.deepEqual(result.tasks[1].resources, ["workspace:api"]);
  assert.equal(result.tasks[0].model.tier, "deep");
  assert.equal(result.tasks[0].packetCommand,
    "claude-foundation packet change --task T1");
  assert.ok(result.tasks.every((value) => value.leaseKeys.length > 0));
});

test("task grouping respects dependencies, conflicts, and parallel limits", () => {
  const tasks = [
    { ...task("T1"), done: false },
    { ...task("T2"), done: false },
    { ...task("T3", { dependsOn: ["T1"] }), done: false }
  ];
  assert.deepEqual(groupAgentTasks(tasks, new Set(), 2,
    (left, right) => left.id === "T1" && right.id === "T2", fail),
  [["T1"], ["T2", "T3"]]);
  assert.throws(() => groupAgentTasks([
    { ...task("T1", { dependsOn: ["T2"] }), done: false },
    { ...task("T2", { dependsOn: ["T1"] }), done: false }
  ], new Set(), 2, () => false, fail), /task dependency cycle/);
});

test("execution summary selects proof, single-agent, and planned routes", () => {
  assert.equal(agentExecutionSummary([], true).recommendedExecution, "proof-ready");
  const tasks = [
    { ...task("T1"), model: { tier: "standard", family: "sonnet" } },
    { ...task("T2"), model: { tier: "deep", family: "opus" } }
  ];
  const single = agentExecutionSummary(tasks, true);
  assert.equal(single.recommendedExecution, "single-agent");
  assert.equal(single.sessionTask.id, "T2");
  assert.equal(single.sessionModel.family, "opus");
  assert.match(single.executionReason, /highest required tier is deep/);
  const planned = agentExecutionSummary(tasks, false);
  assert.equal(planned.recommendedExecution, "planned-agents");
  assert.equal(planned.sessionModel, null);
});

test("task execution preserves history and binds the current graph", () => {
  const rows = agentTaskExecutionRows([
    task("T1"), { ...task("T2"), repository: "api" }
  ], false, { taskExecution: { old: { mode: "prior" } } }, {
    revision: 4, identity: "graph-id"
  });
  assert.deepEqual(rows.old, { mode: "prior" });
  assert.deepEqual(rows.T2, {
    mode: "lease-result", repository: "api",
    graphRevision: 4, graphIdentity: "graph-id"
  });
  assert.equal(agentTaskExecutionRows([task("T1")], true, {}, {
    revision: 1, identity: "one"
  }).T1.mode, "single-agent-observed");
});

test("blocking reasons combine ambiguity and active scope conflicts", () => {
  assert.deepEqual(agentPlanBlockingReasons({ ambiguity: "clear" }, []), []);
  assert.deepEqual(agentPlanBlockingReasons({ ambiguity: "unclear" }, [{
    key: "path:root:src <> path:root:src", changeId: "other"
  }]), [
    "ambiguity requires /investigate",
    "scope path:root:src <> path:root:src is active in other"
  ]);
});

test("blocking reasons stop dispatch before unavailable authority spends model budget", () => {
  assert.deepEqual(agentPlanBlockingReasons({ ambiguity: "clear" }, [], {
    status: "NEEDS_USER_DECISION",
    blockers: [{
      kind: "configuration-required",
      code: "SIGNED_CI_CONFIGURATION_REQUIRED",
      summary: "signed CI is not configured"
    }]
  }), [
    "configuration-required:SIGNED_CI_CONFIGURATION_REQUIRED: signed CI is not configured"
  ]);
});

test("graph provider rows support contract defaults and configured providers", () => {
  const fallback = agentGraphProviderRows({
    requiredProviders: null, providerConfig: null,
    providerCapability: (provider) => provider,
    providerRepositories: null, claimsForProvider: null, stableHash
  }, "change", { providers: { test: { repository: "root" } } });
  assert.deepEqual(fallback[0].repositories, []);
  assert.equal(fallback[0].repository, "root");
  assert.equal(fallback[0].claims, null);

  const configured = agentGraphProviderRows({
    requiredProviders: () => ["test"],
    providerConfig: () => ({
      repositories: ["ignored"], dependsOn: ["lint"], resources: ["workspace-read"],
      inputSchema: "in", outputSchema: "out"
    }),
    providerCapability: () => "tests",
    providerRepositories: () => [{ id: "api" }],
    claimsForProvider: () => [{ id: "claim-1" }], stableHash
  }, "change", { providers: {} });
  assert.deepEqual(configured[0], {
    id: "test", capability: "tests", repository: null,
    repositories: ["api"], dependsOn: ["lint"], resources: ["workspace-read"],
    claims: ["claim-1"], inputSchema: "in", outputSchema: "out",
    configurationIdentity: stableHash({
      repositories: ["ignored"], dependsOn: ["lint"], resources: ["workspace-read"],
      inputSchema: "in", outputSchema: "out"
    }), required: true
  });
});

function plan(options = {}) {
  const tasks = options.tasks || [task("T1"), task("T2", { dependsOn: ["T1"] })];
  return {
    version: 1, changeId: "change", planDigest: options.planDigest || "digest",
    contractFingerprint: options.contractFingerprint || "contract",
    repositoryContractHashes: options.repositoryContractHashes || { root: "root-hash" },
    tasks, groups: options.groups || [tasks.map((row) => row.id)],
    graphRevision: 2, graphIdentity: "graph", graph: { nodes: tasks, edges: [] },
    dispatchable: options.dispatchable ?? true,
    blockingReasons: options.blockingReasons || [],
    recommendedExecution: options.recommendedExecution || "planned-agents",
    sessionModel: options.sessionModel || null, executionReason: "reason",
    repositories: options.repositories || [{ id: "root" }]
  };
}

test("task identity retains only invalidation-relevant fields", () => {
  const value = task("T1");
  assert.deepEqual(taskPlanIdentity({ ...value, model: { family: "other" } }), {
    repository: "root", kind: "code", dependsOn: [], paths: ["src/T1.js"],
    resources: ["workspace:root"], text: "T1"
  });
});

test("repository and direct task invalidation classify every change source", () => {
  const current = plan();
  assert.deepEqual(changedPlanRepositories(current, null), []);
  assert.deepEqual(changedPlanRepositories(current, {
    repositoryContractHashes: { root: "old" }
  }), ["root"]);
  assert.deepEqual(changedPlanRepositories(current, {
    repositoryContractHashes: { root: "root-hash" }
  }), []);
  assert.deepEqual([...invalidatedPlanTasks(current, null, stableHash)], []);

  const unchangedPrior = { ...current, tasks: current.tasks.map((row) => ({ ...row })) };
  assert.deepEqual([...invalidatedPlanTasks(current, unchangedPrior, stableHash)], []);
  assert.deepEqual([...invalidatedPlanTasks(current, {
    ...unchangedPrior, contractFingerprint: "old-contract"
  }, stableHash)], ["T1", "T2"]);
  assert.deepEqual([...invalidatedPlanTasks(current, {
    ...unchangedPrior, repositoryContractHashes: { root: "old" }
  }, stableHash)], ["T1", "T2"]);
  assert.deepEqual([...invalidatedPlanTasks(current, {
    ...unchangedPrior, tasks: [unchangedPrior.tasks[0]]
  }, stableHash)], ["T2"]);
  assert.deepEqual([...invalidatedPlanTasks(current, {
    ...unchangedPrior,
    tasks: [{ ...unchangedPrior.tasks[0], text: "changed" }, unchangedPrior.tasks[1]]
  }, stableHash)], ["T1"]);
});

test("dependency invalidation expands transitively and terminates", () => {
  const tasks = [
    task("T1"), task("T2", { dependsOn: ["T1"] }),
    task("T3", { dependsOn: ["T2"] }), task("T4")
  ];
  assert.deepEqual([...propagateInvalidatedTasks(tasks, new Set(["T1"]))],
    ["T1", "T2", "T3"]);
  assert.deepEqual([...propagateInvalidatedTasks(tasks, new Set())], []);
});

test("persisted output records supersession, invalidation, and preservation", () => {
  const current = plan();
  assert.deepEqual(persistedPlanOutput(current, null, new Set()).preservedTasks, []);
  const output = persistedPlanOutput(current, {
    planDigest: "prior", tasks: current.tasks
  }, new Set(["T1"]));
  assert.equal(output.supersedesPlanDigest, "prior");
  assert.deepEqual(output.invalidatedTasks, ["T1"]);
  assert.deepEqual(output.preservedTasks, ["T2"]);
});

test("group view validates bounds and projects dispatch fields", () => {
  const output = plan();
  const view = agentPlanGroupView(output, "change", "1", fail);
  assert.equal(view.group, 1);
  assert.deepEqual(view.tasks.map((row) => row.id), ["T1", "T2"]);
  assert.deepEqual(Object.keys(view.tasks[0]), [
    "id", "repository", "kind", "model", "dependsOn", "resources", "packetCommand"
  ]);
  for (const value of [0, 2, 1.5, "bad"])
    assert.throws(() => agentPlanGroupView(output, "change", value, fail), /must be 1\.\.1/);
});

test("group summaries inline small groups and digest large groups", () => {
  const summaries = agentPlanGroupSummaries([
    ["T1"], Array.from({ length: 13 }, (_, index) => `T${index}`)
  ], stableHash);
  assert.deepEqual(summaries[0], {
    group: 1, taskCount: 1, taskIds: ["T1"], taskDigest: null
  });
  assert.equal(summaries[1].taskIds, null);
  assert.match(summaries[1].taskDigest, /T12/);
});

test("next command covers blocked, proof, single, and planned routes", () => {
  assert.equal(agentPlanNext(plan({ dispatchable: false }), "change"),
    "resolve blockingReasons before dispatch");
  assert.equal(agentPlanNext(plan({ recommendedExecution: "proof-ready" }), "change"),
    "claude-foundation proof readiness change");
  assert.equal(agentPlanNext(plan({ recommendedExecution: "single-agent" }), "change"),
    "claude-foundation packet change --task T1");
  assert.equal(agentPlanNext(plan(), "change"),
    "claude-foundation agents plan change --group 1");
});

function summaryContext(root = "/repo") {
  return {
    root, schemaVersion: 3, stableHash,
    compactStrings: (values, limit) => values.length <= limit ? values : values.slice(0, limit)
  };
}

test("summary view counts models and keeps bounded collections inline", () => {
  const output = {
    ...plan(), invalidatedTasks: ["T1"],
    tasks: [task("T1"), task("T2"), task("T3", { family: "opus" })]
  };
  output.graph.nodes = output.tasks;
  const view = agentPlanSummaryView(
    summaryContext(), "change", "/repo/plans/change.json", output);
  assert.equal(view.planPath, "plans/change.json");
  assert.deepEqual(view.modelCounts, { sonnet: 2, opus: 1 });
  assert.deepEqual(view.invalidatedTasks, ["T1"]);
  assert.equal(view.next, "claude-foundation agents plan change --group 1");
});

test("summary view compacts oversized group and invalidation collections", () => {
  const tasks = Array.from({ length: 21 }, (_, index) => task(`T${index}`));
  const output = {
    ...plan({ tasks, groups: tasks.map((row) => [row.id]) }),
    invalidatedTasks: tasks.map((row) => row.id)
  };
  const view = agentPlanSummaryView(
    summaryContext(), "change", "/repo/plans/change.json", output);
  assert.equal(view.groups.count, 21);
  assert.equal(view.groups.preview.length, 10);
  assert.equal(view.invalidatedTasks.count, 21);
});

test("view selection supports full, group, and summary outputs", () => {
  const context = { ...summaryContext(), fail };
  const output = { ...plan(), invalidatedTasks: [] };
  assert.equal(selectAgentPlanView(context, "change", "/repo/p", output, { full: true }).view,
    "full");
  assert.equal(selectAgentPlanView(context, "change", "/repo/p", output, { group: 1 }).view,
    "group");
  assert.equal(selectAgentPlanView(context, "change", "/repo/p", output).view, "summary");
});

function showFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-plan-view-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plans = join(root, "plans");
  const calls = { metrics: [], writes: [] };
  const context = {
    root, plans, schemaVersion: 3,
    policy: () => ({ execution: {
      planSummaryBytes: options.limit || 100000,
      packetBytes: { repository: options.limit || 100000 }
    } }),
    stableHash,
    readJson: (path, fallback) => {
      try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
    },
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    compactStrings: (values) => values,
    serializedJson: (value, pretty) => JSON.stringify(value, null, pretty ? 2 : 0),
    recordContextMetric: (...args) => calls.metrics.push(args),
    fail,
    planValue: () => options.plan || plan(),
    write: (value) => calls.writes.push(value)
  };
  return { root, plans, calls, context };
}

test("show agent plan persists, measures, and emits selected views", (t) => {
  const f = showFixture(t);
  showAgentPlan(f.context, "change");
  assert.equal(f.calls.metrics[0][1], "agent-plan-summary");
  assert.equal(JSON.parse(f.calls.writes[0]).version, 3);
  const persisted = JSON.parse(readFileSync(join(f.plans, "change.json"), "utf8"));
  assert.deepEqual(persisted.invalidatedTasks, []);
  showAgentPlan(f.context, "change", { full: true, pretty: true });
  assert.equal(f.calls.metrics[1][1], "agent-plan-full");
  showAgentPlan(f.context, "change", { group: 1 });
  assert.equal(f.calls.metrics[2][1], "agent-plan-group");
});

test("show agent plan enforces view-specific output limits after persistence", (t) => {
  const f = showFixture(t, { limit: 1 });
  assert.throws(() => showAgentPlan(f.context, "change"), /agent summary exceeds 1 bytes/);
  assert.ok(readFileSync(join(f.plans, "change.json"), "utf8").length > 1);
});

test("show agent task validates dispatch and projects the selected graph node", () => {
  const calls = [];
  const output = {
    ...plan({ tasks: [task("T1"), task("T2")] }),
    graph: { nodes: [{ id: "task:T1", kind: "task" }], edges: [] }
  };
  const context = {
    planValue: () => output,
    showPacket: (...args) => calls.push(args),
    fail
  };

  output.dispatchable = false;
  output.blockingReasons = ["scope is active", "decision required"];
  assert.throws(() => showAgentTask(context, "change", "T1"),
    /scope is active; decision required/);

  output.dispatchable = true;
  output.blockingReasons = [];
  showAgentTask(context, "change", "t1", { pretty: true });
  assert.deepEqual(calls[0], ["change", {
    repo: "root", task: "T1", pretty: true,
    planDigest: "digest", graphRevision: 2, graphIdentity: "graph",
    graphNode: { id: "task:T1", kind: "task" }
  }]);
  showAgentTask(context, "change", "T2");
  assert.equal(calls[1][1].graphNode, null);
  assert.equal(calls[1][1].pretty, undefined);
  assert.throws(() => showAgentTask(context, "change", "missing"), /unknown pending task/);
  assert.throws(() => showAgentTask(context, "change", null), /unknown pending task ''/);
});
