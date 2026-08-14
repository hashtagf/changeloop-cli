import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// The receipt vocabulary, ordered. An adapter that runs more than one provider
// has to report the worst thing that happened — not the last one in the array,
// and never a word from a different vocabulary. `blocked` is deliberately
// absent: it means "waiting on something external" everywhere else in the
// harness, so returning it for a suite that ran and failed made a red test
// indistinguishable from a test that never got to run.
const STATUS_SEVERITY = { pass: 0, inconclusive: 1, fail: 2, error: 3 };
const worstStatus = (...values) => values
  .filter((value) => value in STATUS_SEVERITY)
  .reduce((worst, value) =>
    STATUS_SEVERITY[value] > STATUS_SEVERITY[worst] ? value : worst, "pass");

export function createAdapterRuntime({
  ROOT, LOGS, PROVIDERS,
  providerCapability, providerConfig, parseFlags, providerWorkspace,
  recordReceipt, startServiceSession, evidence, resultAdapterResources,
  loadRuntime, providerRepository, repositoryById, configuredCommand,
  fileDigest, pathInside, stableHash, runCommand,
  providerWorkspaceHash, providerClaims, parseJsonOutput, parseTapOutput,
  numericReportValue, playwrightReportSummary, requiredProviders,
  mutationProtocolResult, now, die
}) {
  function runProvider(id, provider, values) {
    const configured = providerConfig(id, provider);
    const capability = providerCapability(provider, configured);
    if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
    // The provider already declares what it runs. Letting an ad-hoc command
    // stand in for it would produce a genuinely-executed receipt for something
    // other than the declared evidence.
    if (configured && configured.adapter !== "external")
      die(`provider '${provider}' declares adapter '${configured.adapter}' and its own command; ` +
        "run 'proof run <change>' so the declared command is what executes");
    const split = values.indexOf("--");
    if (split < 0 || split === values.length - 1) die("run-provider requires '-- <command> [args...]'");
    const { flags, rest } = parseFlags(values.slice(0, split));
    if (rest.length) die(`unexpected run-provider argument(s): ${rest.join(", ")}`);
    if (!flags.claims) die("run-provider requires --claims <a,b|declared> before '--'");
    const command = values[split + 1];
    const commandArgs = values.slice(split + 2);
    const started = now();
    const startedMs = Date.now();
    // Same 64 MB ceiling as the git helper: the default 1 MB maxBuffer kills a
    // verbose green suite with ENOBUFS and records the run as an infrastructure
    // error.
    const result = spawnSync(command, commandArgs, {
      cwd: providerWorkspace(id, provider), encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, FOUNDATION_CHANGE_ID: id }
    });
    const logDir = join(LOGS, id);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${provider}-${Date.now()}.log`);
    writeFileSync(logPath, `${result.stdout || ""}${result.stderr || ""}`);
    // A spawn failure (missing binary, signal death) is infrastructure, not a
    // failing check: `error` steers recovery toward restoring the provider,
    // where `fail` steers it toward changing code.
    recordReceipt(id, provider,
      result.error || result.status === null
        ? "error" : result.status === 0 ? "pass" : "fail", {
      ...flags,
      started, command: [command, ...commandArgs].join(" "),
      log: relative(ROOT, logPath), observed: `exit ${result.status ?? "error"}`,
      durationMs: Date.now() - startedMs
    }, { executed: true });
    if (result.status !== 0) process.exit(result.status || 1);
  }
  
  async function startRequiredServices(id, nodes, proofRunId) {
    const executionValue = evidence(id).execution;
    const names = [...new Set(nodes.map((node) => node.config.service).filter(Boolean))];
    const sessions = [];
    try {
      for (const name of names)
        sessions.push(await startServiceSession(
          id, name, executionValue.services[name], proofRunId
        ));
      return sessions;
    } catch (error) {
      sessions.reverse().forEach((session) => session.stop());
      throw error;
    }
  }
  
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
    return { provider, status };
  }

  async function executeAdapter(id, provider, config, proofRunId, commandCache) {
    if (config.adapter === "contract-digest")
      return executeContractDigest(id, provider, config, proofRunId);
    const state = loadRuntime(id);
    const repository = providerRepository(id, provider, config);
    const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
    const built = configuredCommand(provider, config);
    const envFrom = Object.fromEntries((config.envFrom || [])
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]));
    const dedupKey = stableHash({
      cwd, command: built.command, args: built.args,
      env: config.env || {},
      // Part of the receipt's envFingerprint, so it has to be part of the
      // identity of the execution being reused. Omitting it let a deduped
      // receipt name a variable absent from the process that actually ran.
      envFrom: [...(config.envFrom || [])].sort(),
      resolvedEnvFrom: Object.keys(envFrom).sort(),
      timeoutMs: Number(config.timeoutMs || 120000),
      readiness: config.readiness || null
    });
    if (!commandCache.has(dedupKey)) {
      const commandExecutionId = `command-${Date.now()}-${commandCache.size + 1}`;
      const executionEnv = {
        ...process.env,
        ...envFrom,
        ...(config.env || {}),
        FOUNDATION_CHANGE_ID: id,
        FOUNDATION_CONTROL_ROOT: ROOT,
        FOUNDATION_REPOSITORY_ID: repository?.id || "root",
        FOUNDATION_PROOF_RUN_ID: proofRunId,
        FOUNDATION_COMMAND_EXECUTION_ID: commandExecutionId,
        FOUNDATION_EXECUTION_ID: commandExecutionId
      };
      commandCache.set(dedupKey, {
        commandExecutionId,
        result: runCommand(built.command, built.args, {
          cwd, timeoutMs: config.timeoutMs, env: executionEnv,
          readiness: config.readiness
        })
      });
    }
    const cached = commandCache.get(dedupKey);
    const result = await cached.result;
    const commandExecutionId = cached.commandExecutionId;
    const logArtifact = executionLog(id, provider, commandExecutionId, result);
    const artifacts = [logArtifact];
    // A report left over from an earlier run is not evidence that this one
    // produced anything. Reading it regardless let a stale file satisfy the
    // discovery floor — the guard whose whole purpose is catching a suite that
    // stopped running tests.
    const configuredReport = config.report ? resolve(cwd, config.report) : null;
    const runStartedMs = Date.parse(result.startedAt) || 0;
    const reportIsFresh = Boolean(configuredReport) && existsSync(configuredReport) &&
      statSync(configuredReport).mtimeMs >= runStartedMs - 1000;
    if (configuredReport && existsSync(configuredReport) && !reportIsFresh)
      console.error(
        `WARNING: ignoring '${relative(ROOT, configuredReport)}': it predates this run, so it is not its output`);
    if (reportIsFresh)
      artifacts.push({
        path: relative(ROOT, configuredReport), type: "structured-report", required: true
      });
    const jsonReport = reportIsFresh
      ? parseJsonOutput(readFileSync(configuredReport, "utf8"))
      : parseJsonOutput(result.stdout);
    const tapReport = ["tap", "auto"].includes(config.reportFormat || "auto")
      ? parseTapOutput(
        reportIsFresh ? readFileSync(configuredReport, "utf8") : result.stdout
      )
      : null;
    const report = jsonReport || tapReport;
    const baseFlags = {
      config, adapter: config.adapter, proofRunId, commandExecutionId,
      workspaceHash: providerWorkspaceHash(
        id, provider, state.activeProofRun?.workspaceHash
      ),
      claims: providerClaims(id, provider, config).join(","),
      command: built.display, started: result.startedAt,
      observed: result.timedOut ? `timeout after ${result.durationMs}ms` :
        result.error ? result.error.message :
        `exit ${result.status}; ${result.durationMs}ms; readiness ${result.readinessObserved ? "observed" : "not-observed"}`,
      durationMs: result.durationMs,
      log: logArtifact.path, artifacts,
      environment: config.environment || null, project: config.project || null
    };
  
    // A provider that declares readiness is asserting the suite ran against
    // something specific. Not observing it means the suite ran against
    // whatever occupied the port — or against nothing — so it cannot pass,
    // whichever adapter produced it.
    const readinessMissed = Boolean(config.readiness?.url) && !result.readinessObserved;

    if (config.adapter === "test-discovery") {
      const testProvider = provider;
      const discoveryProvider = config.discoveryProvider || "discovery";
      const discoveryConfig = providerConfig(id, discoveryProvider) || config;
      const testStatus = result.timedOut || result.error || readinessMissed ? "error" :
        result.status === 0 ? "pass" : "fail";
      recordReceipt(id, testProvider, testStatus, {
        ...baseFlags, claims: providerClaims(id, testProvider, config).join(",")
      }, { executed: true });
      const discovered = numericReportValue(report, [
        "numTotalTests", "totalTests", "tests", "testCount", "expected"
      ]);
      const minimum = Number(config.minimum || 1);
      const discoveryStatus = result.timedOut || result.error || readinessMissed ? "error" :
        discovered === null ? "inconclusive" :
        discovered >= minimum ? "pass" : "fail";
      recordReceipt(id, discoveryProvider, discoveryStatus, {
        ...baseFlags, config: discoveryConfig,
        claims: providerClaims(id, discoveryProvider, discoveryConfig).join(","),
        // Not `?? 0`: this line runs precisely when the count could not be read,
        // so a zero here would state "the suite found no tests" in the same
        // receipt whose `observed` says the count was unavailable.
        discovered, minimum,
        observed: discovered === null ? "structured test count unavailable" :
          `${discovered} discovered; minimum ${minimum}`
      }, { executed: true });
      return { provider, status: worstStatus(testStatus, discoveryStatus) };
    }
  
    if (config.adapter === "playwright") {
      const summary = report ? playwrightReportSummary(report) : null;
      for (const attachment of summary?.attachments || []) {
        const attachmentPath = isAbsolute(attachment) ? attachment : resolve(cwd, attachment);
        if (existsSync(attachmentPath))
          artifacts.push({
            path: relative(ROOT, attachmentPath),
            type: "playwright-attachment", required: false
          });
      }
      const outputs = [...new Set([provider, ...(config.outputs || [])])]
        .filter((output) => requiredProviders(id).includes(output));
      let aggregateStatus = "pass";
      for (const output of outputs) {
        const requiredClaims = providerClaims(id, output, config);
        const missingClaims = summary
          ? requiredClaims.filter((claim) => !summary.claims.includes(claim))
          : requiredClaims;
        const status = result.timedOut || result.error || readinessMissed ? "error" :
          result.status !== 0 || (summary?.failed || 0) > 0 ? "fail" :
          !summary || missingClaims.length ? "inconclusive" : "pass";
        aggregateStatus = worstStatus(aggregateStatus, status);
        recordReceipt(id, output, status, {
          ...baseFlags,
          claims: requiredClaims.join(","),
          "input-mode": providerCapability(output, providerConfig(id, output)) === "browser"
            ? config.inputMode || "browser-automation" : config.inputMode || null,
          "foreground-required": config.foregroundRequired ? "yes" : "no",
          "foreground-available": config.foregroundAvailable ? "yes" : "no",
          observed: summary
            ? `${summary.tests} tests; ${summary.failed} failed; ${summary.skipped} skipped; covered claims ${requiredClaims.length - missingClaims.length}/${requiredClaims.length}; observed annotations ${summary.claims.length}` +
              (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "") +
              (summary.skippedClaims.length
                ? `; claimed only by skipped tests ${summary.skippedClaims.join(",")}` : "")
            : "Playwright JSON report unavailable"
        }, { executed: true });
      }
      return { provider, status: aggregateStatus };
    }
  
    const capability = providerCapability(provider, config);
    const mutationResult = capability === "mutation" &&
        config.resultProtocol === "foundation-mutation-v1"
      ? mutationProtocolResult(result.stdout) : null;
    const status = result.timedOut || result.error || readinessMissed ? "error" :
      capability === "mutation" && config.resultProtocol === "foundation-mutation-v1"
        ? ["behavioral-kill", "test-failure"].includes(mutationResult)
          ? "pass"
          : ["crash", "timeout", "not-applied"].includes(mutationResult)
            ? "error" : "fail"
        : result.status === 0 ? "pass" : "fail";
    recordReceipt(id, provider, status, {
      ...baseFlags,
      "input-mode": config.inputMode || null,
      "foreground-required": config.foregroundRequired ? "yes" : "no",
      "foreground-available": config.foregroundAvailable ? "yes" : "no",
      classification: mutationResult || config.classification,
      observed: mutationResult
        ? `mutation result ${mutationResult}; ${baseFlags.observed}`
        : baseFlags.observed
    }, { executed: true });
    return { provider, status };
  }

  return {
    runProvider,
    startRequiredServices,
    executionLog,
    adapterResources,
    executeAdapter
  };
}
