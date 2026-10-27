import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const EXECUTION_PREPARATION_VERSION = 1;

function repositoryRuntime(state, repository) {
  if (repository.id === "root") return {
    ...(state?.workspace || {}),
    ...(state?.repositories?.root || {})
  };
  return state?.repositories?.[repository.id] || {};
}

export class ExecutionPreparationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExecutionPreparationError";
    this.code = "EXECUTION_PREPARATION_FAILED";
    this.owner = "harness";
    this.boundary = "resource";
    this.details = details;
  }
}

export function foundationToolPaths(root, pathExists = existsSync) {
  return [
    join(root, ".foundation", "tools", "node_modules", ".bin"),
    join(root, "node_modules", ".bin")
  ].filter(pathExists);
}

export function prependFoundationToolPath(root, env = process.env,
  pathExists = existsSync) {
  const additions = foundationToolPaths(root, pathExists);
  const current = String(env.PATH || "").split(delimiter).filter(Boolean);
  env.PATH = [...new Set([...additions, ...current])].join(delimiter);
  return additions;
}

export function executionPreparationIdentity({
  state, repositories = [], providers = [], stableHash
}) {
  return stableHash({
    version: EXECUTION_PREPARATION_VERSION,
    revisions: {
      change: Number(state?.revision || 0),
      contract: Number(state?.contractRevision || 0),
      execution: Number(state?.executionRevision || 0)
    },
    repositories: repositories.map((repository) => {
      const runtime = repositoryRuntime(state, repository);
      return {
        id: repository.id,
        mode: repository.mode || runtime.access || "write",
        baseHead: runtime.baseHead || null,
        setupCommand: repository.setupCommand || null,
        setupStatus: runtime.setup?.status || null
      };
    }).sort((left, right) => left.id.localeCompare(right.id)),
    providers: providers.map((provider) => ({
      id: provider.id,
      repository: provider.repository || null,
      adapter: provider.adapter || null,
      command: provider.command || null
    })).sort((left, right) => left.id.localeCompare(right.id))
  });
}

export function executionPreparationValue({
  id, state, repositories = [], providers = [], openSpec, stableHash, prior = null,
  now = () => new Date().toISOString()
}) {
  const identity = executionPreparationIdentity({
    state, repositories, providers, stableHash
  });
  const repositoryRows = repositories.map((repository) => {
    const runtime = repositoryRuntime(state, repository);
    return {
      id: repository.id,
      mode: repository.mode || runtime.access || "write",
      workspace: runtime.path || repository.workspacePath || null,
      // The root workspace's command may come from foundation.json or from the
      // lockfile install the harness detected; both are recorded on the run.
      setupCommand: repository.setupCommand || runtime.setup?.command || null,
      setupSource: runtime.setup?.source ||
        (repository.setupCommand || runtime.setup?.command ? "configured" : null),
      setupStatus: runtime.setup?.status ||
        (repository.setupCommand ? "pending" : "not-required"),
      setupExitCode: runtime.setup?.exitCode ?? null,
      setupLog: runtime.setup?.logTail || null
    };
  });
  const issues = repositoryRows.filter((row) => row.setupStatus === "failed")
    .map((row) => ({
      code: "REPOSITORY_SETUP_FAILED",
      owner: "harness",
      repository: row.id,
      summary: `isolated setup failed for repository '${row.id}'`,
      handoff: {
        step: `sandbox setup for repository '${row.id}'`,
        command: row.setupCommand,
        cwd: row.workspace,
        log: row.setupLog
      }
    }));
  // OpenSpec validates and archives the agreement: Prove and Land need it,
  // Build does not. A Build-time absence is deferred, never a stop.
  if (openSpec?.level === "error") issues.push({
    code: "OPENSPEC_UNAVAILABLE",
    owner: "harness",
    summary: openSpec.detail
  });
  return {
    version: EXECUTION_PREPARATION_VERSION,
    changeId: id,
    status: issues.length ? "REPAIR_REQUIRED" : "READY",
    identity,
    reused: prior?.status === "READY" && prior?.identity === identity,
    repositories: repositoryRows,
    providers,
    tools: [{
      id: "openspec",
      requiredBy: ["change-validation", "archive"],
      status: openSpec?.level === "error" ? "unavailable"
        : openSpec?.level === "deferred" ? "deferred" : "ready",
      ...(openSpec?.level === "deferred" ? { deferredTo: openSpec.deferredTo } : {}),
      version: openSpec?.version || null,
      source: openSpec?.source || null
    }],
    issues,
    preparedAt: now()
  };
}

export function ensureProjectOpenSpec({
  root, status, spawn, prependPath = prependFoundationToolPath, stage = "prove"
}) {
  prependPath(root);
  let observed = status(root);
  if (observed.level !== "error") return { ...observed, source: "path" };
  // Only Prove onward runs OpenSpec. Build neither installs nor stops for it;
  // the first Prove prepares it and keeps the existing HANDOFF on failure.
  if (stage === "build") return {
    level: "deferred", version: null, source: null, deferredTo: "prove",
    detail: `OpenSpec CLI is not on PATH; it is prepared at Prove (${observed.detail || "missing"})`
  };
  const toolRoot = join(root, ".foundation", "tools");
  const installed = spawn("npm", [
    "install", "--prefix", toolRoot, "--ignore-scripts", "--no-audit",
    "--no-fund", "--save-exact", "@fission-ai/openspec@1.7.0"
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024
  });
  prependPath(root);
  observed = status(root);
  if (installed.error || installed.status !== 0 || observed.level === "error") {
    const detail = `${installed.stderr || installed.error?.message || ""}`.trim();
    throw new ExecutionPreparationError(
      "Harness could not prepare its project-local OpenSpec runtime", {
        tool: "openspec",
        installExitCode: installed.status ?? null,
        detail: detail.slice(-2000),
        observed,
        handoff: {
          step: "prepare the pinned OpenSpec CLI",
          command: "npm install --prefix .foundation/tools --ignore-scripts --no-audit " +
            "--no-fund --save-exact @fission-ai/openspec@1.7.0",
          cwd: root,
          log: detail.slice(-2000) || null
        }
      });
  }
  return { ...observed, source: ".foundation/tools" };
}

export function assertExecutionPreparationReady(plan) {
  if (plan.status === "READY") return plan;
  throw new ExecutionPreparationError(
    plan.issues.map((issue) => issue.summary).join("; ") ||
      "execution preparation is not ready",
    { plan, handoff: plan.issues.find((issue) => issue.handoff?.command)?.handoff || null }
  );
}
