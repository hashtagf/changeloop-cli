import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  aggregateEvidenceStatus, evidenceResultValue, parseAssertionSummaryOutput,
  parseExecutedTestEvidence, parseGoTestJsonOutput, parseRunnerSummaryOutput
} from "./evidence-results.mjs";
import { repositoryBaseHead } from "../core/repository-binding.mjs";
import {
  environmentIdentity, readTaskCheckExecution, sameArgv, sameShellLine, taskCheckArgv,
  taskCheckExecutionPath, taskCheckReuseRefusal, writeTaskCheckExecution
} from "./task-check-evidence.mjs";
import {
  evaluationResult, providerTimeoutDetail, providerTimeoutMs
} from "./provider-catalog.mjs";
import { parseLastJsonLine } from "./evidence-results.mjs";

export function serviceStartBatch(entries, maxParallel, conflicts,
  completed = new Set()) {
  const selected = [];
  const capacity = Math.max(1, Number(maxParallel) || 1);
  for (const entry of entries.filter((candidate) =>
    (candidate.dependsOn || []).every((dependency) => completed.has(dependency)))) {
    if (selected.length >= capacity) break;
    if (selected.every((candidate) => !conflicts(candidate.resources, entry.resources)))
      selected.push(entry);
  }
  return selected;
}

export function requiredServiceNames(services = {}, names = []) {
  const required = new Set();
  const visiting = new Set();
  const include = (name) => {
    if (required.has(name)) return;
    const config = services[name];
    if (!config) throw new Error(`service '${name}' is not configured`);
    if (visiting.has(name)) throw new Error(`service dependency cycle at '${name}'`);
    visiting.add(name);
    for (const dependency of config.dependsOn || []) include(dependency);
    visiting.delete(name);
    required.add(name);
  };
  for (const name of names.filter(Boolean)) include(name);
  return [...required].sort();
}

// The receipt vocabulary, ordered. An adapter that runs more than one provider
// has to report the worst thing that happened — not the last one in the array,
// and never a word from a different vocabulary. `blocked` is deliberately
// absent: it means "waiting on something external" everywhere else in the
// harness, so returning it for a suite that ran and failed made a red test
// indistinguishable from a test that never got to run.
function normalizedCriticalCase(row) {
  return {
    id: String(row?.id || ""),
    status: String(row?.status || "").toLowerCase()
  };
}

function assertionCriticalCase(assertion) {
  const name = [assertion?.ancestorTitles?.join(" "), assertion?.title,
    assertion?.fullName].filter(Boolean).join(" ");
  return { id: name, status: String(assertion?.status || "").toLowerCase() };
}

function suiteCriticalCases(suite) {
  return (suite?.assertionResults || []).map(assertionCriticalCase);
}

function criticalCaseRows(report) {
  const explicit = report?.criticalCases || report?.foundation?.criticalCases;
  if (Array.isArray(explicit))
    return explicit.map(normalizedCriticalCase).filter((row) => row.id);
  return (report?.testResults || []).flatMap(suiteCriticalCases);
}

function containsCriticalCaseId(value, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:$|[^A-Za-z0-9_-])`)
    .test(value);
}

export function criticalCaseResult(report, required) {
  if (!required.length) return { status: "pass", observations: [] };
  const rows = criticalCaseRows(report);
  const observations = required.map((id) => {
    const exact = rows.find((row) => row.id === id);
    const embedded = exact || rows.find((row) =>
      containsCriticalCaseId(row.id, id));
    // A one-case provider and a one-result report have only one possible
    // binding. Requiring the model to repeat the case ID in the test title is
    // bookkeeping, not assurance, so the harness records that binding itself.
    const derived = embedded || (required.length === 1 && rows.length === 1
      ? rows[0] : null);
    return { id, status: derived?.status || "missing" };
  });
  const passWords = new Set(["pass", "passed", "success", "ok"]);
  return {
    status: observations.every((row) => passWords.has(row.status)) ? "pass" : "fail",
    observations
  };
}

// An evaluation provider passes only when its command exits 0 and its
// machine-readable result (foundation-evaluation-v1, stdout or report file)
// reports score >= threshold. The returned value names both numbers.
export function evaluationAdapterResult(result, report, config = {}) {
  const evaluation = evaluationResult(report || {}, config);
  if (result?.status !== 0 && evaluation.status === "pass")
    return { ...evaluation, status: "fail",
      observed: `${evaluation.observed}; command exited ${result?.status ?? "error"}` };
  return evaluation;
}

export function enforceCriticalCases(baseStatus, critical) {
  return baseStatus === "pass" ? critical.status : baseStatus;
}

export function mutationV2Result(report, required, mutantKillers = {}) {
  const rows = Array.isArray(report?.mutants) ? report.mutants : [];
  const observations = required.map((id) => {
    const row = rows.find((candidate) => candidate?.id === id);
    const killedBy = String(row?.killedBy || row?.killerCaseId || "");
    const expectedKiller = String(mutantKillers[id] || "");
    const killed = row?.result === "killed" || row?.killed === true;
    return {
      id,
      applied: row?.applied === true,
      compiled: row?.compiled === true,
      result: String(row?.result || (killed ? "killed" : "missing")),
      killedBy,
      expectedKiller
    };
  });
  const killerCases = [...new Set(observations.map((row) => row.expectedKiller)
    .filter(Boolean))];
  const killerResult = criticalCaseResult(report, killerCases);
  const passedKillers = new Set(killerResult.observations
    .filter((row) => ["pass", "passed", "success", "ok"].includes(row.status))
    .map((row) => row.id));
  return {
    status: observations.every((row) =>
      row.applied && row.compiled && row.result === "killed" &&
      row.expectedKiller && row.killedBy === row.expectedKiller &&
      passedKillers.has(row.expectedKiller))
      ? "pass" : "fail",
    observations,
    killerCases: killerResult.observations
  };
}

const NODE_TEST = /(?:^|[\s;&|(])node\s+(?:[^;&|]*\s)?--test(?:[\s=]|$)/;
const COUNTABLE_NODE_REPORTER = /--test-reporter(?:=|\s+)(?:tap|spec)\b/;
const SCRIPT_RUNNER = /(?:^|[\s;&|(])(npm|pnpm|yarn|bun)\s+([^;&|)]*)/;

function packageScriptName(command) {
  const match = command.match(SCRIPT_RUNNER);
  if (!match) return null;
  const [first, second] = match[2].split(/\s+/).filter((token) =>
    token && !token.startsWith("-"));
  if (["run", "run-script"].includes(first)) return second || null;
  if (["test", "t", "tst"].includes(first)) return "test";
  return match[1] === "npm" ? null : first || null;
}

function nodeTestReporterFix(command) {
  const replaced = command.replace(/--test-reporter(?:=|\s+)\S+/, "--test-reporter=tap");
  return replaced !== command ? replaced
    : command.replace(/(node\s+(?:[^;&|]*\s)?--test)(?=[\s=]|$)/, "$1 --test-reporter=tap");
}

// Discovery without a structured count stays inconclusive; this names the one
// edit that makes the same verify command countable so the agent never has to
// reverse-engineer the parser or rewire execution by hand.
export function discoveryCountRepair(command, packageScripts = null) {
  const text = (Array.isArray(command) ? command : [command])
    .map((part) => String(part ?? "")).join(" ").replace(/^sh -c /, "");
  const name = NODE_TEST.test(` ${text}`) ? null : packageScriptName(text);
  const script = name ? packageScripts?.[name] : null;
  const wrapped = typeof script === "string" && NODE_TEST.test(` ${script}`);
  const nodeCommand = wrapped ? script : NODE_TEST.test(` ${text}`) ? text : null;
  if (!nodeCommand)
    return "make the verify command print a counted result (TAP '1..N', node " +
      "'ℹ tests N', a Jest/Vitest summary, or JSON numTotalTests); for node --test add " +
      "--test-reporter=tap";
  const where = wrapped ? `package.json scripts.${name}`
    : "the task verify (through a semantic amendment)";
  if (COUNTABLE_NODE_REPORTER.test(nodeCommand))
    return `node --test already uses a countable reporter but its count never reached ` +
      `stdout; remove the pipe or redirection in ${where}`;
  return `node --test prints no countable reporter; change ${where} to ` +
    `'${nodeTestReporterFix(nodeCommand)}' so discovery can count tests`;
}

export function mutationReceiptClassification(protocol, legacyResult, configured) {
  // Receipt classification describes how the fault was exposed. The provider
  // fingerprint separately binds the result protocol and its full contract.
  return protocol === "foundation-mutation-v2"
    ? "behavioral-kill" : legacyResult || configured;
}

// The harness's own session state: the agent's workspace pin, caller cwd,
// host session, public operation, and phase. A provider command is a project
// tool, and a test that runs claude-foundation in its own fixture must not
// inherit them, or it acts on the outer session. The provider contract
// (FOUNDATION_CHANGE_ID, FOUNDATION_REPOSITORIES_FILE, …) is added afterwards.
export const PROVIDER_SESSION_ENV = Object.freeze([
  "CLAUDE_FOUNDATION_PROJECT", "FOUNDATION_WORKSPACE_ROOT", "FOUNDATION_CALLER_CWD",
  "FOUNDATION_CLAUDE_SESSION_ID", "FOUNDATION_CLAUDE_TRANSCRIPT_PATH",
  "FOUNDATION_PUBLIC_OPERATION", "FOUNDATION_ACTIVE_PHASE"
]);

export function providerExecutionEnvironment(base, additions = {}, workspacePath = null) {
  const environment = { ...base };
  // The harness may itself be pinned to a control root while executing a
  // candidate sandbox. Provider commands must discover from their own cwd;
  // leaking this pin redirects nested fixture CLIs back into the outer project.
  for (const name of PROVIDER_SESSION_ENV) delete environment[name];
  Object.assign(environment, additions);
  // Declared commands routinely name locally-installed binaries (`eslint`,
  // `vitest`, `tsc`) the way package scripts do. npm puts the workspace's
  // `node_modules/.bin` on PATH before running a script; a provider command
  // executed without that entry dies with `command not found` even though the
  // tool is installed. Prepend it only when it exists so non-Node workspaces
  // see an unchanged PATH.
  if (workspacePath) {
    const localBin = join(workspacePath, "node_modules", ".bin");
    if (existsSync(localBin)) {
      const key = Object.keys(environment).find((name) => name.toUpperCase() === "PATH") || "PATH";
      environment[key] = environment[key]
        ? `${localBin}${delimiter}${environment[key]}` : localBin;
    }
  }
  return environment;
}

export function runProviderRequest(context, id, provider, values) {
  const configured = context.providerConfig(id, provider);
  const capability = context.providerCapability(provider, configured);
  if (!capability || !context.providers.has(capability))
    context.die(`unknown provider '${provider}'`);
  if (configured && configured.adapter !== "external")
    context.die(`provider '${provider}' declares adapter '${configured.adapter}' and its own command; ` +
      "run 'proof run <change>' so the declared command is what executes");
  const split = values.indexOf("--");
  if (split < 0 || split === values.length - 1)
    context.die("run-provider requires '-- <command> [args...]'");
  const { flags, rest } = context.parseFlags(values.slice(0, split));
  if (rest.length)
    context.die(`unexpected run-provider argument(s): ${rest.join(", ")}`);
  if (!flags.claims)
    context.die("run-provider requires --claims <a,b|declared> before '--'");
  return {
    flags,
    command: values[split + 1],
    commandArgs: values.slice(split + 2)
  };
}

export function runProviderStatus(result) {
  if (result.error || result.status === null) return "error";
  return result.status === 0 ? "pass" : "fail";
}

export function runProviderOperation(context, id, provider, values) {
  const request = runProviderRequest(context, id, provider, values);
  const started = context.now();
  const startedMs = context.dateNow();
  const workspace = context.providerWorkspace(id, provider);
  const result = context.spawn(request.command, request.commandArgs, {
    cwd: workspace, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: providerExecutionEnvironment(context.environment,
      { FOUNDATION_CHANGE_ID: id }, workspace)
  });
  const logDir = join(context.logs, id);
  context.mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${provider}-${context.dateNow()}.log`);
  context.write(logPath, `${result.stdout || ""}${result.stderr || ""}`);
  context.recordReceipt(id, provider, runProviderStatus(result), {
    ...request.flags,
    started,
    command: [request.command, ...request.commandArgs].join(" "),
    log: relative(context.root, logPath),
    observed: `exit ${result.status ?? "error"}`,
    durationMs: context.dateNow() - startedMs
  }, { executed: true });
  if (result.status !== 0) context.exit(result.status || 1);
}

export function providerRepositoryManifestValue(context, id, provider, state, rows) {
  const repositories = {};
  for (const repository of rows) {
    if (!context.pathExists(repository.workspacePath))
      context.die(`provider '${provider}' repository '${repository.id}' workspace is missing`);
    const runtime = state.repositories?.[repository.id] ||
      (repository.id === "root" ? state.workspace : null) || {};
    if (runtime.setup?.status === "failed")
      context.die(`provider '${provider}' repository '${repository.id}' setup failed`);
    if (repository.mode === "read") {
      const changed = context.repositoryStatus(repository);
      if (changed)
        context.die(`provider '${provider}' read-only repository '${repository.id}' changed inside its sandbox: ${changed}`);
    }
    const baseHead = repositoryBaseHead(repository, state);
    if (repository.id !== "root" && !baseHead)
      context.die(`provider '${provider}' repository '${repository.id}' has no recorded baseHead`);
    repositories[repository.id] = {
      path: repository.workspacePath,
      access: repository.mode,
      baseHead
    };
  }
  return { version: 1, changeId: id, provider, repositories };
}

export async function startRequiredServicesOperation(context, id, nodes, proofRunId) {
  const executionValue = context.evidence(id).execution;
  const names = requiredServiceNames(executionValue.services,
    nodes.map((node) => node.config.service));
  const sessions = [];
  try {
    const pending = [...names];
    const completed = new Set();
    const readySince = new Map();
    let wave = 0;
    while (pending.length) {
      const candidates = pending.map((name) => {
        const config = executionValue.services[name];
        const resources = [...(config.resources || []),
          ...(config.port ? [`port:${config.port}`] : [])];
        return { name, config, resources, dependsOn: config.dependsOn || [] };
      });
      const observedAt = context.timestamp();
      for (const candidate of candidates)
        if (candidate.dependsOn.every((dependency) => completed.has(dependency)) &&
            !readySince.has(candidate.name)) readySince.set(candidate.name, observedAt);
      const ready = candidates.filter((candidate) => candidate.dependsOn
        .every((dependency) => completed.has(dependency)));
      const batch = serviceStartBatch(candidates, context.maxParallelServices(),
        context.serviceResourcesConflict, completed);
      if (!batch.length)
        throw new Error(`service dependency unresolvable: ${pending.join(", ")}`);
      wave += 1;
      context.recordScheduler({
        scheduler: "service", wave,
        readyNodes: ready.length, executedNodes: batch.length, reusedNodes: 0,
        queueingMs: batch.reduce((total, candidate) =>
          total + Math.max(0, observedAt - readySince.get(candidate.name)), 0),
        peakConcurrency: batch.length
      });
      const results = await Promise.allSettled(batch.map(({ name, config }) =>
        context.startServiceSession(id, name, config, proofRunId)));
      const failures = [];
      for (let index = 0; index < batch.length; index += 1) {
        pending.splice(pending.indexOf(batch[index].name), 1);
        if (results[index].status === "fulfilled") {
          sessions.push(results[index].value);
          completed.add(batch[index].name);
        } else failures.push(`${batch[index].name}: ${
          results[index].reason?.message || results[index].reason}`);
      }
      if (failures.length) throw new Error(`service startup failed: ${failures.join("; ")}`);
    }
    return sessions;
  } catch (error) {
    sessions.reverse().forEach((session) => session.stop());
    throw error;
  }
}

export function repositoryStatus(repository) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: repository.workspacePath, encoding: "utf8"
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function readOnlyRepository(repository) {
  return repository.mode === "read";
}

export function assertReadRepositoriesUnchanged(context, provider, rows) {
  for (const repository of rows.filter(readOnlyRepository)) {
    const changed = context.repositoryStatus(repository);
    if (changed)
      context.die(`provider '${provider}' modified read-only repository '${repository.id}': ${changed}`);
  }
}

export function createAdapterRuntime({
  ROOT, LOGS, PROVIDERS,
  providerCapability, providerConfig, parseFlags, providerWorkspace,
  recordReceipt, startServiceSession, evidence, resultAdapterResources,
  loadRuntime, providerRepository, repositoryById, configuredCommand,
  providerRepositories,
  fileDigest, pathInside, stableHash, runCommand,
  providerWorkspaceHash, providerClaims, parseJsonOutput, parseTapOutput,
  parseNodeTestSpecOutput,
  numericReportValue, playwrightReportSummary, requiredProviders,
  mutationProtocolResult, now, die,
  serviceResourcesConflict,
  maxParallelServices,
  recordScheduler,
  timestamp,
  // (request) => Promise<{ status, benchmark, results, observed }>; the
  // alternating base/head measurement of benchmark-runtime.mjs.
  measureBenchmark,
  clearSnapshotCache = null,
  spawnCommandSync = spawnSync
}) {
  function providerRepositoryManifest(id, provider, config, proofRunId, failWith = die) {
    const state = loadRuntime(id);
    const rows = providerRepositories(id, provider, config);
    const value = providerRepositoryManifestValue({
      pathExists: existsSync, repositoryStatus, die: failWith
    }, id, provider, state, rows);
    const path = join(LOGS, id, `${proofRunId}-${provider}-repositories.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({
      ...value, proofRunId
    }, null, 2)}\n`, { mode: 0o600 });
    return { path, rows };
  }

  const assertReadRepositories = assertReadRepositoriesUnchanged.bind(null, {
    repositoryStatus, die
  });

  const runProvider = runProviderOperation.bind(null, {
    root: ROOT, logs: LOGS, providers: PROVIDERS,
    providerCapability, providerConfig, parseFlags, providerWorkspace,
    recordReceipt, now, die,
    dateNow: Date.now, environment: process.env, spawn: spawnSync,
    mkdir: mkdirSync, write: writeFileSync, exit: process.exit.bind(process)
  });
  
  const startRequiredServices = startRequiredServicesOperation.bind(null, {
    evidence, startServiceSession, serviceResourcesConflict, maxParallelServices,
    recordScheduler, timestamp
  });
  
  function executionLog(id, provider, executionId, result) {
    const logPath = join(LOGS, id, `${executionId}-${provider}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath,
      `status=${result.status ?? "error"} signal=${result.signal || ""} timedOut=${result.timedOut}\n` +
      `durationMs=${result.durationMs}\n\n${result.stdout || ""}${result.stderr || ""}`);
    return {
      path: relative(ROOT, logPath), type: "command-log", required: true
    };
  }
  
  function adapterResources(provider, config) {
    return resultAdapterResources(provider, config, providerCapability);
  }
  
  // Hash the same declared contract artifact on every side and pass only when
  // the bytes match. Nothing else in the harness compared a producer to a
  // consumer: `cross-repo-contract` forced a claim to declare the capability
  // and a provider to exist, and then accepted a free-text receipt asserting
  // that somebody had checked.
  function executeContractDigest(id, provider, config, proofRunId) {
    const started = now();
    const startedMs = Date.now();
    const sides = Object.entries(config.contract).sort(([left], [right]) =>
      left.localeCompare(right));
    const observations = sides.map(([repositoryId, relativePath]) => {
      const repository = repositoryById(id, repositoryId);
      const absolute = resolve(repository.workspacePath, relativePath);
      if (!pathInside(repository.workspacePath, absolute))
        die(`provider '${provider}' contract path '${relativePath}' escapes repository '${repositoryId}'`);
      return {
        repositoryId,
        path: relativePath,
        absolute,
        digest: existsSync(absolute) && statSync(absolute).isFile()
          ? fileDigest(absolute) : null
      };
    });
    const missing = observations.filter((row) => row.digest === null);
    const digests = [...new Set(observations.map((row) => row.digest))];
    const status = missing.length ? "error" : digests.length === 1 ? "pass" : "fail";
    const observed = missing.length
      ? `contract artifact missing in ${missing.map((row) =>
        `${row.repositoryId}:${row.path}`).join(", ")}`
      : digests.length === 1
        ? `contract digest ${digests[0].slice(0, 16)} agrees across ${
          observations.map((row) => row.repositoryId).join(", ")}`
        : `contract digests disagree: ${observations.map((row) =>
          `${row.repositoryId}=${row.digest.slice(0, 16)}`).join(", ")}`;
    const logPath = join(LOGS, id, `${proofRunId}-${provider}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, `${observed}\n\n${observations.map((row) =>
      `${row.repositoryId}\t${row.path}\t${row.digest || "missing"}`).join("\n")}\n`);
    const artifacts = [
      { path: relative(ROOT, logPath), type: "command-log", required: true },
      ...observations.filter((row) => row.digest !== null).map((row) => ({
        path: relative(ROOT, row.absolute), type: "contract-artifact", required: true
      }))
    ];
    recordReceipt(id, provider, status, {
      config, adapter: "contract-digest", proofRunId,
      workspaceHash: providerWorkspaceHash(id, provider, loadRuntime(id).activeProofRun?.workspaceHash),
      claims: providerClaims(id, provider, config).join(","),
      command: `contract-digest ${sides.map(([repositoryId, path]) =>
        `${repositoryId}:${path}`).join(" ")}`,
      started, observed, durationMs: Date.now() - startedMs,
      log: relative(ROOT, logPath), artifacts,
      environment: config.environment || null, project: config.project || null
    }, { executed: true });
    return evidenceResultValue({
      provider, status,
      observations: observations.map(({ repositoryId, path, digest }) => ({
        repositoryId, path, digest
      }))
    });
  }

  function repositoryExecutionRows(state, manifest) {
    return manifest.rows.map((row) => ({
      id: row.id, access: row.mode,
      baseHead: state.repositories?.[row.id]?.baseHead || row.baseHead || null
    }));
  }

  function resolvedEnvironmentVariables(config) {
    return Object.fromEntries((config.envFrom || [])
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]));
  }

  function adapterExecutionKey(cwd, built, repository, scope, config, envFrom) {
    return stableHash({
      cwd, command: built.command, args: built.args,
      repositoryId: repository?.id || "root", repositories: scope,
      env: config.env || {}, envFrom: [...(config.envFrom || [])].sort(),
      resolvedEnvFrom: Object.keys(envFrom).sort(),
      timeoutMs: providerTimeoutMs(config), readiness: config.readiness || null
    });
  }

  function adapterEnvironment(id, context, config, proofRunId, commandExecutionId) {
    const { repository, repositoryManifest, cwd, envFrom } = context;
    return providerExecutionEnvironment(process.env, {
      ...envFrom, ...(config.env || {}),
      FOUNDATION_CHANGE_ID: id, FOUNDATION_CONTROL_ROOT: ROOT,
      FOUNDATION_REPOSITORY_ID: repository?.id || "root",
      FOUNDATION_REPOSITORIES_FILE: repositoryManifest.path,
      FOUNDATION_PROOF_RUN_ID: proofRunId,
      FOUNDATION_COMMAND_EXECUTION_ID: commandExecutionId,
      FOUNDATION_EXECUTION_ID: commandExecutionId
    }, cwd);
  }

  // A Build task check that ran this exact execution on this exact content
  // stands in for running it again; its captured output is parsed and
  // receipted below exactly like a fresh run's.
  function preparedTaskCheckExecution(id, context, config) {
    const { provider } = context;
    if (taskCheckReuseRefusal(config, providerCapability(provider, config))) return null;
    const environment = environmentIdentity(
      adapterEnvironment(id, context, config, "", ""), stableHash);
    const record = readTaskCheckExecution(
      taskCheckExecutionPath(LOGS, id, context.dedupKey), {
        dedupKey: context.dedupKey, environment,
        workspaceHash: providerWorkspaceHash(
          id, provider, context.state.activeProofRun?.workspaceHash)
      }, stableHash);
    return record ? {
      commandExecutionId: record.commandExecutionId,
      reusedTaskCheck: record.taskId,
      result: Promise.resolve({ ...record.result, error: null })
    } : null;
  }

  function cachedAdapterExecution(id, proofRunId, context, config, commandCache) {
    const { cwd, built, dedupKey } = context;
    if (!commandCache.has(dedupKey)) {
      const prepared = preparedTaskCheckExecution(id, context, config);
      if (prepared) {
        commandCache.set(dedupKey, prepared);
        return prepared;
      }
      const commandExecutionId = `command-${Date.now()}-${commandCache.size + 1}`;
      const executionEnv = adapterEnvironment(id, context, config, proofRunId, commandExecutionId);
      commandCache.set(dedupKey, {
        commandExecutionId,
        result: runCommand(built.command, built.args, {
          cwd, timeoutMs: providerTimeoutMs(config), env: executionEnv,
          readiness: config.readiness
        })
      });
    }
    return commandCache.get(dedupKey);
  }

  function adapterExecutionContext(id, provider, config, proofRunId, commandCache) {
    const state = loadRuntime(id);
    const repository = providerRepository(id, provider, config);
    const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
    const repositoryManifest = providerRepositoryManifest(id, provider, config, proofRunId);
    const scope = repositoryExecutionRows(state, repositoryManifest);
    const built = configuredCommand(provider, config);
    const envFrom = resolvedEnvironmentVariables(config);
    const context = {
      provider, state, repository, cwd, repositoryManifest, built, envFrom,
      dedupKey: adapterExecutionKey(cwd, built, repository, scope, config, envFrom)
    };
    return {
      ...context,
      cached: cachedAdapterExecution(id, proofRunId, context, config, commandCache)
    };
  }

  function freshProviderHash(id, provider) {
    if (!clearSnapshotCache) return null;
    clearSnapshotCache(id);
    return providerWorkspaceHash(id, provider);
  }

  // The required provider whose execution a task check's command is, or null.
  function taskCheckProvider(id, check, state) {
    const argv = taskCheckArgv(check.command);
    const taskCwd = state.repositories?.[check.repository]?.path ||
      (check.repository === "root" ? state.workspace?.path : null);
    if (!taskCwd) return null;
    for (const provider of requiredProviders(id)) {
      const config = providerConfig(id, provider);
      if (!Array.isArray(config?.command) ||
          taskCheckReuseRefusal(config, providerCapability(provider, config))) continue;
      const built = configuredCommand(provider, config);
      if (!sameArgv(argv, built) && !sameShellLine(check.command, built)) continue;
      const repository = providerRepository(id, provider, config);
      const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
      if (resolve(cwd) === resolve(taskCwd)) return { provider, config, repository, cwd, built };
    }
    return null;
  }

  function taskCheckContext(id, check, state, executionId) {
    const matched = taskCheckProvider(id, check, state);
    if (!matched) return null;
    const { provider, config, repository, cwd, built } = matched;
    const repositoryManifest = providerRepositoryManifest(id, provider, config, executionId,
      (message) => { throw new Error(message); });
    const envFrom = resolvedEnvironmentVariables(config);
    const scope = repositoryExecutionRows(state, repositoryManifest);
    return {
      provider, config, state, repository, cwd, repositoryManifest, built, envFrom,
      dedupKey: adapterExecutionKey(cwd, built, repository, scope, config, envFrom),
      before: freshProviderHash(id, provider)
    };
  }

  // Build: a task check that is exactly a required provider's command runs the
  // provider's way, and a clean pass on content it did not change is kept for
  // Prove. Returns null when no provider matches (or the match cannot be
  // established), so the caller runs the plain shell check instead.
  function runTaskCheckAsEvidence(id, check) {
    const executionId = `taskcheck-${Date.now()}`;
    let context;
    try {
      context = taskCheckContext(id, check, loadRuntime(id), executionId);
    } catch {
      return null;
    }
    if (!context) return null;
    const { provider, config, cwd, built } = context;
    const env = adapterEnvironment(id, context, config, executionId, executionId);
    const startedAt = now();
    const startedMs = Date.now();
    const spawned = spawnCommandSync(built.command, built.args, {
      cwd, env, encoding: "utf8", timeout: providerTimeoutMs(config),
      maxBuffer: 64 * 1024 * 1024
    });
    const result = {
      status: spawned.status ?? null, signal: spawned.signal || null, error: null,
      stdout: spawned.stdout || "", stderr: spawned.stderr || "",
      timedOut: false, readinessObserved: true,
      startedAt, finishedAt: now(), durationMs: Date.now() - startedMs
    };
    // A spawn failure or timeout is not a verdict on the task: the caller's
    // plain check (with its own budget) decides instead.
    if (spawned.error) return null;
    const passed = result.status === 0;
    let after = null;
    try { after = passed ? freshProviderHash(id, provider) : null; } catch { after = null; }
    if (passed && context.before && context.before === after)
      writeTaskCheckExecution(taskCheckExecutionPath(LOGS, id, context.dedupKey), {
        changeId: id, taskId: check.taskId, provider, dedupKey: context.dedupKey,
        environment: environmentIdentity(env, stableHash), workspaceHash: after,
        commandExecutionId: executionId, result
      }, stableHash);
    return {
      status: passed ? "pass" : "fail", exitCode: result.status, provider,
      output: result.stdout + result.stderr
    };
  }

  function freshConfiguredReport(config, cwd, result) {
    const path = config.report ? resolve(cwd, config.report) : null;
    const runStartedMs = Date.parse(result.startedAt) || 0;
    const fresh = Boolean(path) && existsSync(path) &&
      statSync(path).mtimeMs >= runStartedMs - 1000;
    if (path && existsSync(path) && !fresh)
      console.error(
        `WARNING: ignoring '${relative(ROOT, path)}': it predates this run, so it is not its output`);
    return { path, fresh };
  }

  function parsedAdapterReport(config, configuredReport, result) {
    const content = configuredReport.fresh
      ? readFileSync(configuredReport.path, "utf8") : result.stdout;
    const json = parseJsonOutput(content);
    const tap = ["tap", "auto"].includes(config.reportFormat || "auto")
      ? parseTapOutput(content) : null;
    const command = Array.isArray(config.command) ? config.command : [];
    const builtInNodeTest = command.some((part) => part === "--test" ||
      String(part).startsWith("--test="));
    const auto = (config.reportFormat || "auto") === "auto";
    // `npm test` wrapping `node --test` hides the flag from the command, so
    // auto also accepts the node spec footer (`ℹ tests N`) on its own.
    const spec = !tap && (builtInNodeTest || auto) &&
      ["tap", "spec", "auto"].includes(config.reportFormat || "auto")
      ? parseNodeTestSpecOutput(content) : null;
    const assertions = auto ? parseAssertionSummaryOutput(content) : null;
    // Some runners (Python unittest) print their summary on stderr.
    const runner = auto && !assertions ? parseRunnerSummaryOutput(
      configuredReport.fresh ? content : `${content}\n${result.stderr || ""}`) : null;
    // `go test -json` is one event per line, so the whole-text JSON parse fails.
    const goTest = auto && !json ? parseGoTestJsonOutput(content) : null;
    return json || goTest || tap || spec || assertions || runner;
  }

  function adapterEvidence(id, provider, config, execution) {
    const logArtifact = executionLog(
      id, provider, execution.commandExecutionId, execution.result);
    const artifacts = [logArtifact];
    const configuredReport = freshConfiguredReport(config, execution.cwd, execution.result);
    if (configuredReport.fresh)
      artifacts.push({
        path: relative(ROOT, configuredReport.path),
        type: "structured-report", required: true
      });
    const report = parsedAdapterReport(config, configuredReport, execution.result);
    const criticalCaseReport = config.adapter === "playwright" && report
      ? { criticalCases: playwrightReportSummary(report).criticalCases }
      : report;
    return {
      logArtifact, artifacts, report,
      critical: criticalCaseResult(criticalCaseReport, config.criticalCases || [])
    };
  }

  function adapterBaseFlags(id, provider, config, proofRunId, execution, suppliedEvidence) {
    const { state, built, result, commandExecutionId, reusedTaskCheck } = execution;
    const reused = reusedTaskCheck
      ? `; reused Build task check ${reusedTaskCheck} (same command, cwd, environment, content)` : "";
    return {
      config, adapter: config.adapter, proofRunId, commandExecutionId,
      workspaceHash: providerWorkspaceHash(
        id, provider, state.activeProofRun?.workspaceHash),
      claims: providerClaims(id, provider, config).join(","),
      command: built.display, started: result.startedAt,
      observed: result.timedOut ? `timeout after ${result.durationMs}ms` :
        result.error ? result.error.message :
        `exit ${result.status}; ${result.durationMs}ms; readiness ${
          result.readinessObserved ? "observed" : "not-observed"}${reused}`,
      durationMs: result.durationMs,
      log: suppliedEvidence.logArtifact.path, artifacts: suppliedEvidence.artifacts,
      environment: config.environment || null, project: config.project || null
    };
  }

  function workspacePackageScripts(cwd) {
    try {
      const scripts = JSON.parse(readFileSync(join(cwd || ROOT, "package.json"), "utf8")).scripts;
      return scripts && typeof scripts === "object" ? scripts : null;
    } catch { return null; }
  }

  function adapterInfrastructureFailed(result, readinessMissed) {
    return Boolean(result.timedOut || result.error || readinessMissed);
  }

  function recordTestDiscoveryAdapter(id, provider, config, execution, evidenceRow,
    baseFlags, readinessMissed) {
    const { result } = execution;
    const testProvider = provider;
    const discoveryProvider = config.discoveryProvider || "discovery";
    const discoveryConfig = providerConfig(id, discoveryProvider) || config;
    const testBaseStatus = adapterInfrastructureFailed(result, readinessMissed)
      ? "error" : result.status !== 0 ? "fail" : "pass";
    const testStatus = enforceCriticalCases(testBaseStatus, evidenceRow.critical);
    recordReceipt(id, testProvider, testStatus, {
      ...baseFlags, claims: providerClaims(id, testProvider, config).join(","),
      observed: `${baseFlags.observed}; critical cases ${
        evidenceRow.critical.observations.length
          ? evidenceRow.critical.observations.map((row) =>
            `${row.id}=${row.status}`).join(", ") : "not declared"}`,
      criticalCases: evidenceRow.critical.observations
    }, { executed: true });
    const discovered = numericReportValue(evidenceRow.report, [
      "numTotalTests", "totalTests", "tests", "testCount", "expected"
    ]);
    const minimum = Number(config.minimum || 1);
    const infrastructureFailed = adapterInfrastructureFailed(result, readinessMissed);
    // Rapid lane only: a clean exit plus a line only an executed test prints
    // proves minimum 1, recorded as exit-code measurement with no count.
    const executedEvidence = discovered === null && !infrastructureFailed &&
      result.status === 0 && minimum === 1 && execution.state?.schema === "foundation-rapid"
      ? parseExecutedTestEvidence(`${result.stdout || ""}\n${result.stderr || ""}`) : null;
    const countMeasurement = executedEvidence ? "exit-code" : discovered === null ? null : "count";
    const discoveryStatus = infrastructureFailed
      ? "error" : executedEvidence ? "pass" : discovered === null ? "inconclusive"
        : discovered >= minimum ? "pass" : "fail";
    recordReceipt(id, discoveryProvider, discoveryStatus, {
      ...baseFlags, config: discoveryConfig,
      claims: providerClaims(id, discoveryProvider, discoveryConfig).join(","),
      discovered, minimum, countMeasurement,
      observed: executedEvidence
        ? `test count unavailable; exit 0 with executed-test marker ${
          executedEvidence.marker} ('${executedEvidence.line}'); rapid lane accepts minimum 1` :
        discovered === null
        ? `structured test count unavailable: provider '${testProvider}' output had no JSON, TAP, ` +
          `node spec, or runner summary; ${discoveryCountRepair(
            config.command, workspacePackageScripts(execution.cwd))}` :
        `${discovered} discovered; minimum ${minimum}`
    }, { executed: true });
    return evidenceResultValue({
      provider,
      status: aggregateEvidenceStatus([testStatus, discoveryStatus]),
      observations: [
        ...evidenceRow.critical.observations.map((row) => ({
          kind: "critical-case", ...row
        })),
        { kind: "discovery", provider: discoveryProvider, status: discoveryStatus,
          discovered, minimum, countMeasurement }
      ]
    });
  }

  function playwrightAttachments(summary, cwd, artifacts) {
    for (const attachment of summary?.attachments || []) {
      const path = isAbsolute(attachment) ? attachment : resolve(cwd, attachment);
      if (existsSync(path))
        artifacts.push({
          path: relative(ROOT, path), type: "playwright-attachment", required: false
        });
    }
  }

  function playwrightOutputStatus(result, summary, missingClaims, critical, readinessMissed) {
    const base = adapterInfrastructureFailed(result, readinessMissed) ? "error" :
      result.status !== 0 || (summary?.failed || 0) > 0 ? "fail" :
        !summary || !Number.isInteger(summary.tests) ||
          summary.tests - summary.skipped - (summary.inconclusive || 0) <= 0 ||
          summary.inconclusive > 0 || missingClaims.length ? "inconclusive" : "pass";
    return enforceCriticalCases(base, critical);
  }

  function playwrightObservation(summary, requiredClaims, missingClaims) {
    if (!summary) return "Playwright JSON report unavailable";
    return `${summary.tests} tests; ${summary.failed} failed; ${summary.skipped} skipped; ` +
      `${summary.inconclusive || 0} inconclusive; ` +
      `covered claims ${requiredClaims.length - missingClaims.length}/${requiredClaims.length}; ` +
      `observed annotations ${summary.claims.length}` +
      (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "") +
      (summary.inconclusive > 0 || summary.tests === summary.skipped
        ? "; repair the project JSON reporter/test selection and rerun this provider" : "") +
      (summary.skippedClaims.length
        ? `; claimed only by skipped tests ${summary.skippedClaims.join(",")}` : "");
  }

  function recordPlaywrightAdapter(id, provider, config, execution, evidenceRow,
    baseFlags, readinessMissed) {
    const summary = evidenceRow.report
      ? playwrightReportSummary(evidenceRow.report) : null;
    playwrightAttachments(summary, execution.cwd, evidenceRow.artifacts);
    const outputs = [...new Set([provider, ...(config.outputs || [])])]
      .filter((output) => requiredProviders(id).includes(output));
    const outputResults = [];
    for (const output of outputs) {
      const requiredClaims = providerClaims(id, output, config);
      const missingClaims = summary
        ? requiredClaims.filter((claim) => !summary.claims.includes(claim))
        : requiredClaims;
      const status = playwrightOutputStatus(
        execution.result, summary, missingClaims, evidenceRow.critical, readinessMissed);
      outputResults.push({ output, status, missingClaims });
      const outputCapability = providerCapability(output, providerConfig(id, output));
      recordReceipt(id, output, status, {
        ...baseFlags, claims: requiredClaims.join(","),
        "input-mode": outputCapability === "browser"
          ? config.inputMode || "browser-automation" : config.inputMode || null,
        "foreground-required": config.foregroundRequired ? "yes" : "no",
        "foreground-available": config.foregroundAvailable ? "yes" : "no",
        observed: playwrightObservation(summary, requiredClaims, missingClaims),
        criticalCases: evidenceRow.critical.observations
      }, { executed: true });
    }
    return evidenceResultValue({
      provider,
      status: aggregateEvidenceStatus(outputResults.map((row) => row.status)),
      observations: outputResults.map((row) => ({
        kind: "output", provider: row.output, status: row.status,
        missingClaims: row.missingClaims
      }))
    });
  }

  function adapterMutationResults(provider, config, result, report) {
    const capability = providerCapability(provider, config);
    const v2 = capability === "mutation" &&
        config.resultProtocol === "foundation-mutation-v2"
      ? mutationV2Result(report || parseJsonOutput(result.stdout) || {},
        config.requiredMutants || [], config.mutantKillers || {}) : null;
    const legacy = capability === "mutation" &&
        config.resultProtocol === "foundation-mutation-v1"
      ? mutationProtocolResult(result.stdout) : null;
    const evaluation = capability === "evaluation"
      ? evaluationAdapterResult(result, report || parseLastJsonLine(result.stdout), config) : null;
    return { capability, v2, legacy, evaluation };
  }

  function genericAdapterStatus(config, result, mutation, readinessMissed) {
    if (adapterInfrastructureFailed(result, readinessMissed)) return "error";
    if (mutation.evaluation) return mutation.evaluation.status;
    if (mutation.capability !== "mutation") return result.status === 0 ? "pass" : "fail";
    if (config.resultProtocol === "foundation-mutation-v2") return mutation.v2.status;
    if (config.resultProtocol !== "foundation-mutation-v1")
      return result.status === 0 ? "pass" : "fail";
    if (["behavioral-kill", "test-failure"].includes(mutation.legacy)) return "pass";
    return ["crash", "timeout", "not-applied"].includes(mutation.legacy) ? "error" : "fail";
  }

  function genericAdapterObservation(baseFlags, mutation, critical, report = null) {
    if (report?.protocol === "foundation-quality-summary-v1")
      return `consumer quality ${report.status}; lanes ${report.summary?.total ?? 0}; ` +
        `failed ${report.summary?.failed ?? 0}; unavailable ${report.summary?.unavailable ?? 0}; ` +
        `reduced assurance ${report.summary?.reduced ?? 0}; ${baseFlags.observed}`;
    if (mutation.v2)
      return `mutation v2 ${mutation.v2.observations.map((row) =>
        `${row.id}=${row.result}/applied:${row.applied}/compiled:${row.compiled}/killedBy:${
          row.killedBy || "none"}`).join(", ")}; ${baseFlags.observed}`;
    if (mutation.evaluation)
      return `${mutation.evaluation.observed}; ${baseFlags.observed}`;
    if (mutation.legacy)
      return `mutation result ${mutation.legacy}; ${baseFlags.observed}`;
    return `${baseFlags.observed}; critical cases ${critical.observations.length
      ? critical.observations.map((row) => `${row.id}=${row.status}`).join(", ")
      : "not declared"}`;
  }

  function recordGenericAdapter(id, provider, config, execution, evidenceRow,
    baseFlags, readinessMissed) {
    const mutation = adapterMutationResults(
      provider, config, execution.result, evidenceRow.report);
    const baseStatus = genericAdapterStatus(
      config, execution.result, mutation, readinessMissed);
    const status = enforceCriticalCases(baseStatus, evidenceRow.critical);
    recordReceipt(id, provider, status, {
      ...baseFlags,
      "input-mode": config.inputMode || null,
      "foreground-required": config.foregroundRequired ? "yes" : "no",
      "foreground-available": config.foregroundAvailable ? "yes" : "no",
      classification: mutationReceiptClassification(
        config.resultProtocol, mutation.legacy, config.classification),
      observed: genericAdapterObservation(baseFlags, mutation, evidenceRow.critical,
        evidenceRow.report),
      criticalCases: evidenceRow.critical.observations
    }, { executed: true });
    return evidenceResultValue({
      provider, status,
      observations: [
        ...(mutation.evaluation ? [{ kind: "evaluation", status: mutation.evaluation.status,
          score: mutation.evaluation.score, threshold: mutation.evaluation.threshold }] : []),
        ...evidenceRow.critical.observations.map((row) => ({
          kind: "critical-case", ...row
        }))
      ]
    });
  }

  // The same command on base and head, alternating, in one environment. It
  // never shares the command cache: its runs are measurements, and another
  // provider's single run of the same argv is not one.
  async function executeBenchmark(id, provider, config, proofRunId) {
    const state = loadRuntime(id);
    const repository = providerRepository(id, provider, config);
    const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
    const repositoryManifest = providerRepositoryManifest(id, provider, config, proofRunId);
    const built = configuredCommand(provider, config);
    const commandExecutionId = `benchmark-${Date.now()}`;
    const env = adapterEnvironment(id, {
      repository, repositoryManifest, cwd, envFrom: resolvedEnvironmentVariables(config)
    }, config, proofRunId, commandExecutionId);
    const started = now();
    const startedMs = Date.now();
    const measured = await measureBenchmark({
      config, workspace: cwd, baseHead: repositoryBaseHead(repository || { id: "root" }, state),
      command: built.command, args: built.args, env, timeoutMs: providerTimeoutMs(config)
    });
    assertReadRepositories(provider, repositoryManifest.rows);
    const last = measured.results.at(-1) || {};
    const durationMs = Date.now() - startedMs;
    const log = executionLog(id, provider, commandExecutionId, {
      status: last.status, signal: last.signal, timedOut: Boolean(last.timedOut), durationMs,
      stdout: `${measured.observed}\n\n${last.stdout || ""}`, stderr: last.stderr || ""
    });
    recordReceipt(id, provider, measured.status, {
      config, adapter: "benchmark", proofRunId, commandExecutionId,
      workspaceHash: providerWorkspaceHash(id, provider, state.activeProofRun?.workspaceHash),
      claims: providerClaims(id, provider, config).join(","),
      command: built.display, started, observed: measured.observed, durationMs,
      log: log.path, artifacts: [log],
      environment: config.environment || null, project: config.project || null,
      benchmark: measured.benchmark
    }, { executed: true });
    return evidenceResultValue({
      provider, status: measured.status,
      observations: [{ kind: "benchmark", ...measured.benchmark.comparison }]
    });
  }

  async function executeAdapter(id, provider, config, proofRunId, commandCache) {
    if (config.adapter === "contract-digest")
      return executeContractDigest(id, provider, config, proofRunId);
    if (config.adapter === "benchmark")
      return executeBenchmark(id, provider, config, proofRunId);
    const execution = adapterExecutionContext(
      id, provider, config, proofRunId, commandCache);
    execution.result = await execution.cached.result;
    execution.commandExecutionId = execution.cached.commandExecutionId;
    execution.reusedTaskCheck = execution.cached.reusedTaskCheck || null;
    assertReadRepositories(provider, execution.repositoryManifest.rows);
    const evidenceRow = adapterEvidence(id, provider, config, execution);
    const baseFlags = adapterBaseFlags(
      id, provider, config, proofRunId, execution, evidenceRow);
  
    // A provider that declares readiness is asserting the suite ran against
    // something specific. Not observing it means the suite ran against
    // whatever occupied the port — or against nothing — so it cannot pass,
    // whichever adapter produced it.
    const readinessMissed = Boolean(config.readiness?.url) &&
      !execution.result.readinessObserved;

    const record = config.adapter === "test-discovery" ? recordTestDiscoveryAdapter
      : config.adapter === "playwright" ? recordPlaywrightAdapter : recordGenericAdapter;
    const outcome = record(
      id, provider, config, execution, evidenceRow, baseFlags, readinessMissed);
    // A timeout is infrastructure, not a test result: name it and its limit so
    // the failure summary says what to change instead of only "error".
    return execution.result.timedOut
      ? { ...outcome, detail: providerTimeoutDetail(provider, config) } : outcome;
  }

  return {
    runProvider,
    startRequiredServices,
    executionLog,
    adapterResources,
    executeAdapter,
    runTaskCheckAsEvidence
  };
}
