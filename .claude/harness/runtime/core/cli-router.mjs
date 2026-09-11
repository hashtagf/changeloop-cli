import { LIFECYCLE_PHASES } from "./lifecycle-phase.mjs";
export async function routeRuntimeCommand(command, values, api) {
  const {
    parseFlags,
    parseStrictCommandFlags,
    fail,
    createChange,
    rapidStartTemplate,
    startAtomic,
    amendChange,
    resolveChange,
    abandonChange,
    waiveGate,
    showChanges,
    showProviders,
    showRepositories,
    foundationPolicy,
    showAgentPlan,
    showAgentDispatch,
    showAgentTask,
    acquireAgentLease,
    releaseAgentLease,
    prepareClaudeTelemetry,
    recordPhaseContext,
    showPacket,
    showMetrics,
    showAdvance,
    showFeedback,
    execObserved,
    checkpointBudget,
    continueBudget,
    doctor,
    validate,
    showTraceabilityAudit,
    relevantHash,
    providerWorkspaceHash,
    proofPlan,
    proofReadiness,
    proofAdvance,
    proofRun,
    proofCollect,
    proofPreflight,
    proofExecute,
    proofAudit,
    proofFinalize,
    showEvidenceDetection,
    initializeEvidence,
    showEvidenceDoctor,
    recordVerifiedCi,
    requestAuthority,
    dispatchAuthority,
    runAuthorityReviewer,
    abortAuthority,
    resetInfrastructureAuthority,
    resetBaseMoveAuthority,
    showAuthorityStatus,
    recordAuthority,
    upgradeEvidence,
    recordReceipt,
    runProvider,
    prove,
    landCheck,
    grantLand,
    advanceLand,
    recoverLand,
    showLandPlan,
    recordRepositoryLand,
    stageRootPointers,
    resumeLand,
    createAttestationChallenge,
    showHandoffStatus,
    showHandoffPacket,
    recordHandoff,
    showSandboxInspection,
    createSandbox,
    syncSandbox,
    applySandbox,
    archive,
    recordEvent,
    syncClaudeTelemetry,
    importTelemetry,
    importHostExecution,
    migrate,
    usage,
    describeCommand,
    runtimeApiVersion,
    version,
    showQualityDiscovery,
    initializeQuality,
    qualityDoctor,
    runQuality,
    showQualityReport,
    updateQualityBaseline,
    showQualityDebt
  } = api;
  const die = fail;
  const handlers = {
    "new": async () => {
      const {
        flags,
        rest
      } = parseFlags(values);
      if (!rest.length) die("new requires an intent");
      createChange(rest.join(" "), flags);
    },
    "start": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "start", {
        boolean: ["template", "consume-draft"]
      });
      if (flags.template) {
        if (rest.length) die("start --template takes no draft path");
        console.log(JSON.stringify(rapidStartTemplate(), null, 2));
      } else {
        if (rest.length !== 1) die("start requires exactly one draft JSON path");
        startAtomic(rest[0], { consumeDraft: flags["consume-draft"] });
      }
    },
    "resolve": async () => {
      // Strict: the lenient parser silently dropped a misspelled acceptance
      // flag, so `validate` kept failing with the identical message and the
      // typo was invisible.
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "change resolve", {
        boolean: ["review", "acceptance-required", "acceptance-not-required", "reopen-grounding", "ci-not-required", "approve-spec", "continue-review"],
        value: ["impact", "coupling", "security", "size", "ambiguity", "surface", "acceptance-reason", "acceptance-claims", "decision-ref", "reopen-reason"]
      });
      if (rest.length !== 1) die("change resolve requires exactly one change id");
      resolveChange(rest[0], flags);
    },
    "amend": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "change amend", {
        boolean: ["consume-amendment"]
      });
      if (rest.length !== 2)
        die("change amend requires <change> <amendment.json>");
      amendChange(rest[0], rest[1], {
        consumeAmendment: flags["consume-amendment"]
      });
    },
    "abandon": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "change abandon", {
        value: ["reason", "decision-ref", "applied"]
      });
      if (rest.length !== 1) die("change abandon requires exactly one change id");
      abandonChange(rest[0], flags);
    },
    "waive": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "change waive", {
        boolean: ["revoke"],
        value: ["capability", "reason", "decision-ref"]
      });
      if (rest.length !== 1) die("change waive requires exactly one change id");
      waiveGate(rest[0], flags);
    },
    "describe": async () => {
      describeCommand(values.find(value => !value.startsWith("-")) || null, {
        json: values.includes("--json")
      });
    },
    "changes": async () => {
      showChanges();
    },
    "providers": async () => {
      showProviders();
    },
    "repos": async () => {
      showRepositories(values[0] || null);
    },
    "models": async () => {
      console.log(JSON.stringify(foundationPolicy().models, null, 2));
    },
    "quality-discover": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality discover", { value: ["change"] });
      if (rest.length) die(`unexpected quality discover argument(s): ${rest.join(", ")}`);
      showQualityDiscovery(flags);
    },
    "quality-init": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality init", {
        boolean: ["write", "force"], value: ["change", "ci"]
      });
      if (rest.length) die(`unexpected quality init argument(s): ${rest.join(", ")}`);
      initializeQuality(flags);
    },
    "quality-doctor": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality doctor", {
        boolean: ["enforce"], value: ["change"]
      });
      if (rest.length) die(`unexpected quality doctor argument(s): ${rest.join(", ")}`);
      qualityDoctor(flags);
    },
    "quality-run": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality run", {
        boolean: ["enforce", "full"],
        value: ["change", "repo", "capability", "shard-index", "shard-count"]
      });
      if (rest.length) die(`unexpected quality run argument(s): ${rest.join(", ")}`);
      try {
        await runQuality({ ...flags, repository: flags.repo });
      } catch (error) {
        if (!error.foundationBlocked) throw error;
        // The complete report has already been printed. A forced exit here
        // drops buffered pipe output (often at 64 KiB), destroying evidence.
        console.error(`BLOCKED: ${error.message}`);
        process.exitCode = error.exitCode || 1;
      }
    },
    "quality-report": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality report");
      if (Object.keys(flags).length || rest.length) die("quality report takes no arguments");
      showQualityReport();
    },
    "quality-baseline": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality baseline", {
        boolean: ["write"], value: ["repo", "capability", "decision-ref", "reason"]
      });
      if (rest.length) die(`unexpected quality baseline argument(s): ${rest.join(", ")}`);
      updateQualityBaseline({ ...flags, repository: flags.repo });
    },
    "quality-debt": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "quality debt");
      if (Object.keys(flags).length || rest.length) die("quality debt takes no arguments");
      showQualityDebt();
    },
    "agent-plan": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "agents plan", {
        boolean: ["full", "pretty"],
        value: ["group"]
      });
      showAgentPlan(rest[0], flags);
    },
    "agent-dispatch": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "agents dispatch", {
        boolean: ["pretty"]
      });
      if (rest.length !== 1) die("agents dispatch requires exactly one change id");
      showAgentDispatch(rest[0], flags);
    },
    "agent-task": async () => {
      const {
        flags,
        rest
      } = parseFlags(values);
      showAgentTask(rest[0], rest[1], flags);
    },
    "agent-acquire": async () => {
      // Only `--owner`. Takeover belongs to `release`, which frees the resource
      // so the next acquire can win it fairly; `acquire` reads nothing but the
      // owner. This spec was copied from `release` and accepted `--force` and
      // `--decision-ref` in silence, so a caller reaching for a takeover here
      // got a plain contended acquire and an exit code that looked deliberate.
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "agents acquire", {
        value: ["owner"]
      });
      acquireAgentLease(rest[0], rest[1], flags);
    },
    "agent-release": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "agents release", {
        boolean: ["force"],
        value: ["owner", "decision-ref", "lease-id"]
      });
      releaseAgentLease(rest[0], rest[1], flags);
    },
    "packet": async () => {
      const {
        flags,
        rest
      } = parseFlags(values);
      if (flags.resume && (flags.phase || flags.task || flags.repo))
        die("packet --resume cannot be combined with phase, task or repo");
      if (flags.phase && !["change", "build", "prove", "review", "land"].includes(flags.phase)) die("packet --phase must be change|build|prove|review|land");
      if (flags.phase && flags.phase !== "review") {
        prepareClaudeTelemetry(rest[0], flags.phase);
        recordPhaseContext(rest[0], flags.phase);
      }
      if (flags.task && !flags.phase && !flags.repo) showAgentTask(rest[0], flags.task, flags);else showPacket(rest[0], flags);
    },
    "metrics": async () => {
      showMetrics(values[0]);
    },
    "feedback": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "feedback", {
        boolean: ["pretty", "diagnostics"]
      });
      if (rest.length !== 1) die("feedback requires exactly one change id");
      showFeedback(rest[0], flags);
    },
    "advance": async () => {
      const { flags, rest } = parseStrictCommandFlags(values, "advance", {
        boolean: ["pretty", "inspect"],
        value: ["host-result", "through"]
      });
      if (rest.length !== 1) die("advance requires exactly one change id");
      if (flags.inspect && (flags.through || flags["host-result"]))
        die("advance --inspect cannot be combined with through or host-result");
      if (flags.through && !["build", "proven", "archived"].includes(flags.through))
        die("advance --through must be build|proven|archived");
      if (flags["host-result"])
        importHostExecution(rest[0], flags["host-result"]);
      await showAdvance(rest[0], flags);
    },
    "exec": async () => {
      // Everything after `--` belongs to the external command, including its
      // own flags, so the separator is honored before any flag parsing.
      const separator = values.indexOf("--");
      const own = separator === -1 ? values : values.slice(0, separator);
      const commandArgs = separator === -1 ? [] : values.slice(separator + 1);
      const {
        flags,
        rest
      } = parseStrictCommandFlags(own, "exec", {
        value: ["phase"]
      });
      if (!rest.length) die("exec requires a change id");
      // The registry advertises this as an enum but nothing checked it, so
      // `--phase buidl` wrote a `buidl` bucket straight into `metrics.phases`
      // and the typo looked like a phase.
      if (flags.phase !== undefined && !LIFECYCLE_PHASES.includes(flags.phase)) die(`exec --phase must be ${LIFECYCLE_PHASES.join("|")}`);
      process.exitCode = execObserved(rest[0], commandArgs, {
        phase: flags.phase
      });
    },
    "budget-continue": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "budget continue", {
        value: ["reason", "run", "decision-ref"]
      });
      if (rest.length !== 1) die("budget continue requires exactly one change id");
      continueBudget(rest[0], flags);
    },
    "budget-checkpoint": async () => {
      const { rest } = parseStrictCommandFlags(values, "budget checkpoint", {});
      if (rest.length !== 1) die("budget checkpoint requires exactly one change id");
      checkpointBudget(rest[0]);
    },
    "doctor": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "doctor", {
        boolean: ["require-archive", "unattended", "json"],
        value: ["stage", "change", "attestation"]
      });
      if (rest.length) die(`unexpected doctor argument(s): ${rest.join(", ")}`);
      doctor(flags);
    },
    "validate": async () => {
      validate(values[0]);
    },
    "audit-change": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "change audit", {
        boolean: ["json"]
      });
      if (rest.length !== 1) die("change audit requires exactly one change id");
      showTraceabilityAudit(rest[0], flags);
    },
    "hash": async () => {
      console.log(values[1] ? providerWorkspaceHash(values[0], values[1]) : relevantHash(values[0]));
    },
    "proof-plan": async () => {
      proofPlan(values[0]);
    },
    "proof-readiness": async () => {
      proofReadiness(values[0]);
    },
    "proof-advance": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "proof advance", {
        boolean: ["retry-indeterminate"],
        value: ["decision-ref"]
      });
      if (rest.length !== 1) die("proof advance requires exactly one change id");
      await proofAdvance(rest[0], flags);
    },
    "proof-run": async () => {
      await proofRun(values[0]);
    },
    "proof-collect": async () => {
      await proofCollect(values[0]);
    },
    "proof-preflight": async () => {
      proofPreflight(values[0]);
    },
    "proof-execute": async () => {
      await proofExecute(values[0]);
    },
    "proof-audit": async () => {
      const audit = proofAudit(values[0]);
      if (!audit.valid) die(`proof audit failed: ${audit.reason}`);
    },
    "evidence-detect": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "evidence detect");
      if (Object.keys(flags).length || rest.length !== 1) die("evidence detect requires exactly one change id");
      showEvidenceDetection(rest[0]);
    },
    "evidence-init": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "evidence init", {
        boolean: ["write"]
      });
      if (rest.length !== 1) die("evidence init requires exactly one change id");
      initializeEvidence(rest[0], flags);
    },
    "evidence-doctor": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "evidence doctor");
      if (Object.keys(flags).length || rest.length !== 1) die("evidence doctor requires exactly one change id");
      showEvidenceDoctor(rest[0]);
    },
    "evidence-verify-ci": async () => {
      if (values.length !== 3) die("evidence verify-ci requires <change> <provider> <signed.json>");
      await recordVerifiedCi(values[0], values[1], values[2]);
    },
    "authority-request": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority request", {
        value: ["type", "repo"]
      });
      if (rest.length !== 1) die("authority request requires exactly one change id");
      await requestAuthority(rest[0], flags);
    },
    "authority-dispatch": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority dispatch", {
        value: ["request", "scope", "base-attempt", "reviewer-type", "reviewer-identity", "reviewer-provider-family", "reviewer-model-family", "reviewer-model", "reviewer-session"]
      });
      if (rest.length !== 1) die("authority dispatch requires exactly one change id");
      await dispatchAuthority(rest[0], flags);
    },
    "authority-run": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority run", {
        value: ["request", "reviewer", "subject-actor", "subject-session", "subject-provider-family", "subject-model-family", "subject-model", "main-session-identity", "main-session-id", "main-session-provider-family", "main-session-model-family", "main-session-model"]
      });
      if (rest.length !== 1) die("authority run requires exactly one change id");
      await runAuthorityReviewer(rest[0], flags);
    },
    "authority-abort": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority abort", {
        value: ["request", "reason"]
      });
      if (rest.length !== 1) die("authority abort requires exactly one change id");
      await abortAuthority(rest[0], flags);
    },
    "authority-status": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority status", {
        value: ["request"],
        boolean: ["template"]
      });
      if (rest.length !== 1) die("authority status requires exactly one change id");
      await showAuthorityStatus(rest[0], flags);
    },
    "authority-reset-infra": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority reset-infra", {
        value: ["decision-ref", "reviewer"]
      });
      if (rest.length !== 1) die("authority reset-infra requires exactly one change id");
      await resetInfrastructureAuthority(rest[0], flags);
    },
    "authority-reset-base-move": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority reset-base-move", {
        value: ["decision-ref"]
      });
      if (rest.length !== 1) die("authority reset-base-move requires exactly one change id");
      await resetBaseMoveAuthority(rest[0], flags);
    },
    "authority-record": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "authority record", {
        value: ["request", "response"]
      });
      if (rest.length !== 1) die("authority record requires exactly one change id");
      await recordAuthority(rest[0], flags);
    },
    "evidence-upgrade": async () => {
      upgradeEvidence(values[0]);
    },
    "receipt": async () => {
      const [id, provider, status, ...tail] = values;
      const {
        flags
      } = parseFlags(tail);
      await recordReceipt(id, provider, status, flags);
    },
    "run-provider": async () => {
      await runProvider(values[0], values[1], values.slice(2));
    },
    "prove": async () => {
      await proofFinalize(values[0]);
    },
    "handoff-status": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "handoff status");
      if (Object.keys(flags).length || rest.length !== 1) die("handoff status requires exactly one change id");
      showHandoffStatus(rest[0]);
    },
    "handoff-packet": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "handoff packet", {
        value: ["id"]
      });
      if (rest.length !== 1) die("handoff packet requires exactly one change id");
      showHandoffPacket(rest[0], flags);
    },
    "handoff-record": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "handoff record", {
        value: ["id", "status", "actor", "reference", "evidence", "reason"]
      });
      if (rest.length !== 1) die("handoff record requires exactly one change id");
      recordHandoff(rest[0], flags);
    },
    "land-check": async () => {
      landCheck(values[0]);
    },
    "land-advance": async () => {
      if (grantLand) grantLand(values[0]);
      await advanceLand(values[0]);
    },
    "land-recover": async () => {
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "land recover", {
        value: ["decision-ref", "resolution"]
      });
      recoverLand(rest[0], flags);
    },
    "land-plan": async () => {
      showLandPlan(values[0]);
    },
    "land-record": async () => {
      // Strict, and --ci-required declared boolean: the lenient parser
      // consumed the next positional as its value, so `--ci-required pass`
      // stored the string "pass" and any falsy-looking token disabled the
      // requirement it was meant to assert.
      const {
        flags,
        rest
      } = parseStrictCommandFlags(values, "land record", {
        boolean: ["ci-required"],
        value: ["repo", "commit", "ci", "ci-attestation", "decision-ref"]
      });
      recordRepositoryLand(rest[0], flags);
    },
    "land-pointers": async () => {
      stageRootPointers(values[0]);
    },
    "land-resume": async () => {
      resumeLand(values[0]);
    },
    "sandbox": async () => {
      if (values[0] === "challenge") {
        const {
          flags,
          rest
        } = parseStrictCommandFlags(values.slice(1), "sandbox challenge");
        if (Object.keys(flags).length || rest.length !== 1) die("sandbox challenge requires exactly one change id");
        createAttestationChallenge(rest[0]);
      } else if (values[0] === "inspect") {
        const {
          flags,
          rest
        } = parseStrictCommandFlags(values.slice(1), "sandbox inspect", {
          boolean: ["json", "unattended"],
          value: ["attestation"]
        });
        if (rest.length !== 1) die("sandbox inspect requires exactly one change id");
        showSandboxInspection(rest[0], flags);
      } else if (values[0] === "create") {
        const {
          flags,
          rest
        } = parseStrictCommandFlags(values.slice(1), "sandbox create", {
          boolean: ["all", "unattended"],
          value: ["attestation"]
        });
        if (rest.length !== 1) die("sandbox create requires exactly one change id");
        createSandbox(rest[0], flags);
      } else if (values[0] === "sync") {
        const {
          flags,
          rest
        } = parseStrictCommandFlags(values.slice(1), "sandbox sync", {
          value: ["resolve"]
        });
        if (rest.length !== 1) die("sandbox sync requires exactly one change id");
        syncSandbox(rest[0], flags);
      } else if (values[0] === "apply") {
        // Strict, like every other authority command: `controlPlane` is an
        // internal argument that defeats the multi-repository guard, so it
        // stays unparseable. `--refresh` is the sanctioned recovery for a
        // target that legitimately moved after apply.
        const {
          flags,
          rest
        } = parseStrictCommandFlags(values.slice(1), "sandbox apply", {
          boolean: ["refresh"]
        });
        if (rest.length !== 1) die("sandbox apply requires exactly one change id");
        if (grantLand) grantLand(rest[0]);
        applySandbox(rest[0], flags);
      } else die("sandbox requires challenge|inspect|create|sync|apply <change>");
    },
    "archive": async () => {
      if (grantLand) grantLand(values[0]);
      archive(values[0]);
    },
    "event": async () => {
      const {
        flags,
        rest
      } = parseFlags(values);
      recordEvent(rest[0], flags);
    },
    "telemetry-sync": async () => {
      syncClaudeTelemetry(values[0], {
        source: values[1] || null
      });
    },
    "telemetry-import": async () => {
      importTelemetry(values[0], values.slice(1));
    },
    "host-execution-import": async () => {
      if (values.length !== 2) die("telemetry host-import requires <change> <result.json>");
      importHostExecution(values[0], values[1]);
    },
    "migrate": async () => {
      migrate(values);
    },
    "api-version": async () => {
      console.log(runtimeApiVersion);
    },
    "version": async () => {
      console.log(version);
    }
  };
  const handler = handlers[command];
  if (!handler) {
    usage();
    if (command) process.exit(1);
    return;
  }
  await handler();
}
