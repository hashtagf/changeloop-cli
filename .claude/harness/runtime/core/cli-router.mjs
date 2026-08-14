import { LIFECYCLE_PHASES } from "./lifecycle-phase.mjs";

export async function routeRuntimeCommand(command, values, api) {
  const {
    parseFlags, parseStrictCommandFlags, fail, createChange, rapidStartTemplate,
    startAtomic, resolveChange, abandonChange, waiveGate, showChanges, showProviders, showRepositories,
    foundationPolicy, showAgentPlan, showAgentTask, acquireAgentLease,
    releaseAgentLease, prepareClaudeTelemetry, recordPhaseContext, showPacket,
    showMetrics, execObserved, continueBudget, doctor, validate, showTraceabilityAudit,
    relevantHash, providerWorkspaceHash, proofPlan, proofReadiness, proofRun, proofCollect,
    proofPreflight, proofExecute, proofAudit, showEvidenceDetection,
    initializeEvidence, showEvidenceDoctor, recordVerifiedCi, requestAuthority,
    showAuthorityStatus, recordAuthority, upgradeEvidence, recordReceipt,
    runProvider, prove, landCheck, recoverLand, showLandPlan, recordRepositoryLand,
    stageRootPointers, resumeLand, createAttestationChallenge,
    showSandboxInspection, createSandbox, syncSandbox, applySandbox, archive,
    recordEvent, syncClaudeTelemetry, importTelemetry, importHostExecution, migrate, usage,
    describeCommand, runtimeApiVersion, version
  } = api;
  const die = fail;
  switch (command) {
    case "new": {
      const { flags, rest } = parseFlags(values);
      if (!rest.length) die("new requires an intent");
      createChange(rest.join(" "), flags); break;
    }
    case "start": {
      const { flags, rest } = parseStrictCommandFlags(values, "start", {
        boolean: ["template"]
      });
      if (flags.template) {
        if (rest.length) die("start --template takes no draft path");
        console.log(JSON.stringify(rapidStartTemplate(), null, 2));
      } else {
        if (rest.length !== 1) die("start requires exactly one draft JSON path");
        startAtomic(rest[0]);
      }
      break;
    }
    case "resolve": {
      // Strict: the lenient parser silently dropped a misspelled acceptance
      // flag, so `validate` kept failing with the identical message and the
      // typo was invisible.
      const { flags, rest } = parseStrictCommandFlags(values, "change resolve", {
        boolean: ["review", "acceptance-required", "acceptance-not-required"],
        value: [
          "impact", "coupling", "security", "size", "ambiguity", "surface",
          "acceptance-reason", "acceptance-claims"
        ]
      });
      if (rest.length !== 1) die("change resolve requires exactly one change");
      resolveChange(rest[0], flags); break;
    }
    case "abandon": {
      const { flags, rest } = parseStrictCommandFlags(values, "change abandon", {
        value: ["reason", "decision-ref", "applied"]
      });
      if (rest.length !== 1) die("change abandon requires exactly one change");
      abandonChange(rest[0], flags); break;
    }
    case "waive": {
      const { flags, rest } = parseStrictCommandFlags(values, "change waive", {
        boolean: ["revoke"],
        value: ["capability", "reason", "decision-ref"]
      });
      if (rest.length !== 1) die("change waive requires exactly one change");
      waiveGate(rest[0], flags); break;
    }
    case "describe":
      describeCommand(values.find((value) => !value.startsWith("-")) || null,
        { json: values.includes("--json") });
      break;
    case "changes": showChanges(); break;
    case "providers": showProviders(); break;
    case "repos": showRepositories(values[0] || null); break;
    case "models": console.log(JSON.stringify(foundationPolicy().models, null, 2)); break;
    case "agent-plan": {
      const { flags, rest } = parseStrictCommandFlags(values, "agents plan", {
        boolean: ["full", "pretty"], value: ["group"]
      });
      showAgentPlan(rest[0], flags); break;
    }
    case "agent-task": {
      const { flags, rest } = parseFlags(values);
      showAgentTask(rest[0], rest[1], flags); break;
    }
    case "agent-acquire": {
      // Only `--owner`. Takeover belongs to `release`, which frees the resource
      // so the next acquire can win it fairly; `acquire` reads nothing but the
      // owner. This spec was copied from `release` and accepted `--force` and
      // `--decision-ref` in silence, so a caller reaching for a takeover here
      // got a plain contended acquire and an exit code that looked deliberate.
      const { flags, rest } = parseStrictCommandFlags(values, "agents acquire", {
        value: ["owner"]
      });
      acquireAgentLease(rest[0], rest[1], flags); break;
    }
    case "agent-release": {
      const { flags, rest } = parseStrictCommandFlags(values, "agents release", {
        boolean: ["force"], value: ["owner", "decision-ref"]
      });
      releaseAgentLease(rest[0], rest[1], flags); break;
    }
    case "packet": {
      const { flags, rest } = parseFlags(values);
      if (flags.phase && !["change", "build", "prove", "review", "land"].includes(flags.phase))
        die("packet --phase must be change|build|prove|review|land");
      if (flags.phase && flags.phase !== "review") {
        prepareClaudeTelemetry(rest[0], flags.phase);
        recordPhaseContext(rest[0], flags.phase);
      }
      if (flags.task && !flags.phase && !flags.repo)
        showAgentTask(rest[0], flags.task, flags);
      else showPacket(rest[0], flags);
      break;
    }
    case "metrics": showMetrics(values[0]); break;
    case "exec": {
      // Everything after `--` belongs to the external command, including its
      // own flags, so the separator is honored before any flag parsing.
      const separator = values.indexOf("--");
      const own = separator === -1 ? values : values.slice(0, separator);
      const commandArgs = separator === -1 ? [] : values.slice(separator + 1);
      const { flags, rest } = parseStrictCommandFlags(own, "exec", {
        value: ["phase"]
      });
      if (!rest.length) die("exec requires a change id");
      // The registry advertises this as an enum but nothing checked it, so
      // `--phase buidl` wrote a `buidl` bucket straight into `metrics.phases`
      // and the typo looked like a phase.
      if (flags.phase !== undefined && !LIFECYCLE_PHASES.includes(flags.phase))
        die(`exec --phase must be ${LIFECYCLE_PHASES.join("|")}`);
      process.exitCode = execObserved(rest[0], commandArgs, { phase: flags.phase });
      break;
    }
    case "budget-continue": {
      const { flags, rest } = parseStrictCommandFlags(values, "budget continue", {
        value: ["reason", "run", "decision-ref"]
      });
      if (rest.length !== 1) die("budget continue requires exactly one change");
      continueBudget(rest[0], flags); break;
    }
    case "doctor": {
      const { flags, rest } = parseStrictCommandFlags(values, "doctor", {
        boolean: ["require-archive", "unattended", "json"],
        value: ["stage", "change", "attestation"]
      });
      if (rest.length) die(`unexpected doctor argument(s): ${rest.join(", ")}`);
      doctor(flags); break;
    }
    case "validate": validate(values[0]); break;
    case "audit-change": {
      const { flags, rest } = parseStrictCommandFlags(values, "change audit", {
        boolean: ["json"]
      });
      if (rest.length !== 1) die("change audit requires exactly one change");
      showTraceabilityAudit(rest[0], flags); break;
    }
    // With a provider, the hash *that provider's* receipt binds — which is what
    // an external system signing evidence has to state. Without one, the change's
    // workspace hash, as before.
    case "hash": console.log(values[1]
      ? providerWorkspaceHash(values[0], values[1])
      : relevantHash(values[0])); break;
    case "proof-plan": proofPlan(values[0]); break;
    case "proof-readiness": proofReadiness(values[0]); break;
    case "proof-run": await proofRun(values[0]); break;
    case "proof-collect": await proofCollect(values[0]); break;
    case "proof-preflight": proofPreflight(values[0]); break;
    case "proof-execute": await proofExecute(values[0]); break;
    case "proof-audit": {
      const audit = proofAudit(values[0]);
      if (!audit.valid) die(`proof audit failed: ${audit.reason}`);
      break;
    }
    case "evidence-detect": {
      const { flags, rest } = parseStrictCommandFlags(values, "evidence detect");
      if (Object.keys(flags).length || rest.length !== 1)
        die("evidence detect requires exactly one change");
      showEvidenceDetection(rest[0]); break;
    }
    case "evidence-init": {
      const { flags, rest } = parseStrictCommandFlags(values, "evidence init", {
        boolean: ["write"]
      });
      if (rest.length !== 1) die("evidence init requires exactly one change");
      initializeEvidence(rest[0], flags); break;
    }
    case "evidence-doctor": {
      const { flags, rest } = parseStrictCommandFlags(values, "evidence doctor");
      if (Object.keys(flags).length || rest.length !== 1)
        die("evidence doctor requires exactly one change");
      showEvidenceDoctor(rest[0]); break;
    }
    case "evidence-verify-ci": {
      if (values.length !== 3)
        die("evidence verify-ci requires <change> <provider> <signed.json>");
      recordVerifiedCi(values[0], values[1], values[2]); break;
    }
    case "authority-request": {
      const { flags, rest } = parseStrictCommandFlags(values, "authority request", {
        value: ["type", "repo"]
      });
      if (rest.length !== 1) die("authority request requires exactly one change");
      requestAuthority(rest[0], flags); break;
    }
    case "authority-status": {
      const { flags, rest } = parseStrictCommandFlags(values, "authority status", {
        value: ["request"], boolean: ["template"]
      });
      if (rest.length !== 1) die("authority status requires exactly one change");
      showAuthorityStatus(rest[0], flags); break;
    }
    case "authority-record": {
      const { flags, rest } = parseStrictCommandFlags(values, "authority record", {
        value: ["request", "response"]
      });
      if (rest.length !== 1) die("authority record requires exactly one change");
      recordAuthority(rest[0], flags); break;
    }
    case "evidence-upgrade": upgradeEvidence(values[0]); break;
    case "receipt": {
      const [id, provider, status, ...tail] = values;
      const { flags } = parseFlags(tail); recordReceipt(id, provider, status, flags); break;
    }
    case "run-provider": runProvider(values[0], values[1], values.slice(2)); break;
    case "prove": prove(values[0]); break;
    case "land-check": landCheck(values[0]); break;
    case "land-recover": {
      const { flags, rest } = parseStrictCommandFlags(values, "land recover", {
        value: ["decision-ref"]
      });
      recoverLand(rest[0], flags); break;
    }
    case "land-plan": showLandPlan(values[0]); break;
    case "land-record": {
      // Strict, and --ci-required declared boolean: the lenient parser
      // consumed the next positional as its value, so `--ci-required pass`
      // stored the string "pass" and any falsy-looking token disabled the
      // requirement it was meant to assert.
      const { flags, rest } = parseStrictCommandFlags(values, "land record", {
        boolean: ["ci-required"],
        value: ["repo", "commit", "ci", "ci-attestation", "decision-ref"]
      });
      recordRepositoryLand(rest[0], flags); break;
    }
    case "land-pointers": stageRootPointers(values[0]); break;
    case "land-resume": resumeLand(values[0]); break;
    case "sandbox":
      if (values[0] === "challenge") {
        const { flags, rest } = parseStrictCommandFlags(values.slice(1), "sandbox challenge");
        if (Object.keys(flags).length || rest.length !== 1)
          die("sandbox challenge requires exactly one change");
        createAttestationChallenge(rest[0]);
      }
      else if (values[0] === "inspect") {
        const { flags, rest } = parseStrictCommandFlags(
          values.slice(1), "sandbox inspect", {
            boolean: ["json", "unattended"], value: ["attestation"]
          }
        );
        if (rest.length !== 1) die("sandbox inspect requires exactly one change");
        showSandboxInspection(rest[0], flags);
      }
      else if (values[0] === "create") {
        const { flags, rest } = parseStrictCommandFlags(
          values.slice(1), "sandbox create", {
            boolean: ["all", "unattended"], value: ["attestation"]
          }
        );
        if (rest.length !== 1) die("sandbox create requires exactly one change");
        createSandbox(rest[0], flags);
      }
      else if (values[0] === "sync") {
        const { flags, rest } = parseStrictCommandFlags(
          values.slice(1), "sandbox sync", { value: ["resolve"] });
        if (rest.length !== 1) die("sandbox sync requires exactly one change");
        syncSandbox(rest[0], flags);
      }
      else if (values[0] === "apply") {
        // Strict, like every other authority command: `controlPlane` is an
        // internal argument that defeats the multi-repository guard, and
        // `refresh` has no caller. Loose parsing handed both to the CLI.
        const { flags, rest } = parseStrictCommandFlags(values.slice(1), "sandbox apply");
        if (Object.keys(flags).length || rest.length !== 1)
          die("sandbox apply requires exactly one change");
        applySandbox(rest[0], flags);
      }
      else die("sandbox requires challenge|inspect|create|sync|apply <change>");
      break;
    case "archive": archive(values[0]); break;
    case "event": {
      const { flags, rest } = parseFlags(values);
      recordEvent(rest[0], flags); break;
    }
    case "telemetry-sync":
      syncClaudeTelemetry(values[0], { source: values[1] || null }); break;
    case "telemetry-import": importTelemetry(values[0], values.slice(1)); break;
    case "host-execution-import": {
      if (values.length !== 2)
        die("telemetry host-import requires <change> <result.json>");
      importHostExecution(values[0], values[1]); break;
    }
    case "migrate": migrate(values); break;
    case "api-version": console.log(runtimeApiVersion); break;
    case "version": console.log(version); break;
    default: usage(); if (command) process.exit(1);
  }
}
