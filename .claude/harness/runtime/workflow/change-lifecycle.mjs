import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { nextCommand } from "../core/next-step.mjs";

export function createChangeLifecycle({
  root,
  policy,
  securityTerms,
  fail,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId,
  initialBudget,
  gitHead,
  preexistingDirty,
  now,
  bindClaudeSession,
  validate,
  createSandbox,
  showPacket
}) {
  const workflowPolicy = () => typeof policy === "function" ? policy() : policy;
  function templateDir(schema) {
    return join(root, "openspec", "schemas", schema, "templates");
  }

  function instantiate(path, title) {
    return readFileSync(path, "utf8")
      .replaceAll("<title>", title)
      .replaceAll("replace-with-stable-claim-id", `${slugify(title)}-outcome`);
  }

  function loadDraft(draftPath) {
    const source = resolve(root, draftPath);
    if (!pathInside(root, source) || !existsSync(source))
      fail("new --draft requires a JSON file inside the project");
    const draft = readJson(source);
    const requiredStrings = ["why", "currentState", "compatibility"];
    for (const field of requiredStrings)
      if (!String(draft[field] || "").trim())
        fail(`draft requires non-empty '${field}'`);
    for (const field of ["changes", "nonGoals", "decisions", "risks", "tasks", "claims", "specs"])
      if (!Array.isArray(draft[field]) || draft[field].length === 0)
        fail(`draft requires a non-empty '${field}' array`);
    if (workflowPolicy().workflow.grounding === "required" &&
        draft.grounding?.version !== 2)
      fail("draft requires grounding.version 2 from the single Decision Sheet");
    if (draft.externalOperations !== undefined && !Array.isArray(draft.externalOperations))
      fail("draft externalOperations must be an array");
    let warnedLegacySpecOperation = false;
    for (const [index, spec] of draft.specs.entries()) {
      const label = `draft specs[${index}]`;
      for (const field of ["name", "requirement", "description"])
        if (!String(spec?.[field] || "").trim()) fail(`${label}.${field} is required`);
      const operation = String(spec.operation || "added").toLowerCase();
      if (!spec.operation && !warnedLegacySpecOperation) {
        console.error("WARNING: legacy draft specs without operation are treated as added; declare added|modified|removed after comparing the canonical spec");
        warnedLegacySpecOperation = true;
      }
      if (!["added", "modified", "removed"].includes(operation))
        fail(`${label}.operation must be added|modified|removed`);
      const scenarios = Array.isArray(spec.scenarios)
        ? spec.scenarios
        : (spec.scenario || spec.when || spec.then)
          ? [{ name: spec.scenario, when: spec.when, then: spec.then }]
          : [];
      if (operation !== "removed" && scenarios.length === 0)
        fail(`${label}.scenarios must be non-empty for ${operation}`);
      for (const [scenarioIndex, scenario] of scenarios.entries())
        for (const field of ["name", "when", "then"])
          if (!String(scenario?.[field] || "").trim())
            fail(`${label}.scenarios[${scenarioIndex}].${field} is required`);
      if (operation === "removed" && !String(spec.migration || "").trim())
        fail(`${label}.migration is required for removed requirements`);
    }
    return draft;
  }

  function normalizedDraftScenarios(spec) {
    if (Array.isArray(spec.scenarios)) return spec.scenarios;
    return (spec.scenario || spec.when || spec.then)
      ? [{ name: spec.scenario, when: spec.when, then: spec.then }]
      : [];
  }

  function renderDraftRequirement(spec) {
    const scenarios = normalizedDraftScenarios(spec).map((scenario) =>
      `#### Scenario: ${scenario.name}\n\n- **WHEN** ${scenario.when}\n` +
      `- **THEN** ${scenario.then}`
    ).join("\n\n");
    const migration = String(spec.operation || "added").toLowerCase() === "removed"
      ? `\n\n**Migration:** ${spec.migration}`
      : "";
    return `### Requirement: ${spec.requirement}\n\n${spec.description}${migration}` +
      (scenarios ? `\n\n${scenarios}` : "");
  }

  function materializeDraft(id, draft) {
    const state = loadRuntime(id);
    const title = draft.title || state.intent;
    const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
    writeFileSync(join(changePath(id), "proposal.md"),
      `# Change: ${title}\n\n## Why\n\n${draft.why}\n\n` +
      `## What changes\n\n${bullets(draft.changes)}\n\n## Impact\n\n` +
      `- **Impact:** ${draft.impact || state.impact || "medium"}\n` +
      `- **Coupling:** ${draft.coupling || state.coupling || "coupled"}\n` +
      `- **Affected surfaces:** ${(draft.surfaces || ["code"]).join(", ")}\n` +
      `- **Security triggers:** ${(draft.securityTriggers || ["none"]).join(", ")}\n\n` +
      `## Non-goals\n\n${bullets(draft.nonGoals)}\n`);
    if (state.schema === "foundation-standard")
      writeFileSync(join(changePath(id), "design.md"),
        `# Design\n\n## Current state\n\n${draft.currentState}\n\n## Decisions\n\n` +
        draft.decisions.map((decision) =>
          `- **Decision:** ${decision.choice}\n  - **Why:** ${decision.why}\n` +
          `  - **Rejected:** ${decision.rejected || "none"}`).join("\n") +
        `\n\n## Compatibility and migration\n\n${draft.compatibility}\n\n## Risks\n\n` +
        `| Risk | Mitigation | Evidence owner |\n|---|---|---|\n` +
        draft.risks.map((risk) =>
          `| ${risk.risk} | ${risk.mitigation} | ${risk.owner} |`).join("\n") + "\n");
    if (state.groundingRequired && draft.grounding)
      writeJson(join(changePath(id), "grounding.yaml"), draft.grounding);
    writeFileSync(join(changePath(id), "tasks.md"),
      `# Tasks\n\n> This is the sole implementation ledger.\n\n` +
      draft.tasks.map((task, index) => {
        const taskId = task.id || `T${String(index + 1).padStart(3, "0")}`;
        const metadata = [
          task.repository ? `[repo:${task.repository}]` : "",
          task.kind ? `[kind:${task.kind}]` : "",
          task.paths?.length ? `[paths:${task.paths.join(",")}]` : "",
          task.dependsOn?.length ? `[depends:${task.dependsOn.join(",")}]` : ""
        ].filter(Boolean).join(" ");
        return `- [ ] **${taskId}** ${task.outcome} ${metadata} — verify: \`${task.verify}\``;
      }).join("\n") + "\n");
    const contract = readJson(join(changePath(id), "evidence.yaml"));
    contract.claims = draft.claims;
    writeJson(join(changePath(id), "evidence.yaml"), contract);
    if (draft.execution) writeJson(join(changePath(id), "execution.yaml"), draft.execution);
    writeJson(join(changePath(id), "handoffs.yaml"), {
      version: 1,
      operations: draft.externalOperations || []
    });
    if (draft.repositories) writeJson(join(changePath(id), "repositories.yaml"), {
      version: 1,
      repositories: draft.repositories
    });
    if (state.schema === "foundation-standard") {
      rmSync(join(changePath(id), "specs"), { recursive: true, force: true });
      const byCapability = new Map();
      for (const spec of draft.specs) {
        const capability = slugify(spec.name);
        const entries = byCapability.get(capability) || [];
        byCapability.set(capability, [...entries, spec]);
      }
      const operationOrder = ["added", "modified", "removed"];
      for (const [capability, specs] of byCapability) {
        const specDir = join(changePath(id), "specs", capability);
        mkdirSync(specDir, { recursive: true });
        const sections = operationOrder.flatMap((operation) => {
          const requirements = specs.filter((spec) =>
            String(spec.operation || "added").toLowerCase() === operation);
          if (!requirements.length) return [];
          return [`## ${operation.toUpperCase()} Requirements\n\n` +
            requirements.map(renderDraftRequirement).join("\n\n")];
        });
        writeFileSync(join(specDir, "spec.md"),
          `# ${specs[0].name}\n\n${sections.join("\n\n")}\n`);
      }
    }
  }

  // The artifacts the standard schema adds over the rapid one. Written only
  // when absent, so an upgrade never overwrites work already done.
  function materializeStandardArtifacts(id, intent) {
    const source = templateDir("foundation-standard");
    const target = changePath(id);
    const design = join(target, "design.md");
    if (!existsSync(design))
      writeFileSync(design, instantiate(join(source, "design.md"), intent));
    const grounding = join(target, "grounding.yaml");
    if (workflowPolicy().workflow.grounding === "required" && !existsSync(grounding))
      writeFileSync(grounding, instantiate(join(source, "grounding.yaml"), intent));
    const spec = join(target, "specs", "change", "spec.md");
    if (!existsSync(spec)) {
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(spec, instantiate(join(source, "spec.md"), intent));
    }
    // The rapid marker declared skip_specs; keeping it beside the specs/ this
    // upgrade just materialized makes the packet self-contradictory and fails
    // OpenSpec strict validation.
    writeFileSync(join(target, ".openspec.yaml"), "schema: foundation-standard\n");
  }

  function createChange(intent, flags) {
    const id = slugify(flags.id || intent);
    setOperationChangeId(id);
    if (existsSync(changePath(id))) fail(`change already exists: ${id}`);
    // An archived change keeps its runtime state, receipts, and evidence vault
    // as history. A new change reusing the id would inherit them — review
    // rounds it never ran, receipts bound to another workspace — so the id is
    // refused rather than quietly adopted.
    const residue = [
      join(root, ".foundation", "runtime", `${id}.json`),
      join(root, ".foundation", "receipts", id),
      join(root, ".foundation", "evidence", id),
      join(root, ".foundation", "handoffs", id)
    ].filter((path) => existsSync(path));
    if (residue.length)
      fail(`change id '${id}' was used before and its recorded history remains ` +
        `(${residue.map((path) => path.slice(root.length + 1)).join(", ")}); pick a new id`);
    const draft = flags.draft ? loadDraft(flags.draft) : null;
    const schema = flags.rapid ? "foundation-rapid" : "foundation-standard";
    const source = templateDir(schema);
    const target = changePath(id);
    mkdirSync(target, { recursive: true });
    // The rapid schema declares no spec artifact, so a rapid change never has
    // deltas to find. OpenSpec reads that absence as an error — every rapid
    // change was invalid to `openspec validate`, and Land printed five lines of
    // raw validator text at the user for a lane whose whole point is small work.
    // `skip_specs` is the flag OpenSpec's own message names for exactly this.
    writeFileSync(join(target, ".openspec.yaml"), schema === "foundation-rapid"
      ? `schema: ${schema}\nskip_specs: true\n`
      : `schema: ${schema}\n`);
    for (const name of [
      "proposal.md", "tasks.md", "evidence.yaml", "execution.yaml",
      "repositories.yaml", "handoffs.yaml"
    ])
      writeFileSync(join(target, name), instantiate(join(source, name), intent));
    if (workflowPolicy().workflow.grounding === "required")
      writeFileSync(join(target, "grounding.yaml"), instantiate(join(source, "grounding.yaml"), intent));
    if (schema === "foundation-standard") {
      writeFileSync(join(target, "design.md"), instantiate(join(source, "design.md"), intent));
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(join(target, "specs", "change", "spec.md"), instantiate(join(source, "spec.md"), intent));
    }
    const state = {
      version: 2, id, intent, schema, status: "change", ambiguity: "clear",
      groundingRequired: workflowPolicy().workflow.grounding === "required",
      groundingVersion: workflowPolicy().workflow.grounding === "required" ? 2 : null,
      externalOperationsVersion: 1,
      graphExecutionVersion: 1,
      revision: 0, contractRevision: 0, executionRevision: 0,
      impact: schema === "foundation-rapid" ? "low" : null,
      coupling: schema === "foundation-rapid" ? "isolated" : null,
      securityTriggers: [], reviewRequired: false, evidenceCapabilities: [],
      acceptance: {
        version: 2,
        decision: schema === "foundation-rapid" ? "not-required" : "undecided",
        required: false, reason: null, claimIds: [], declaredAt: null
      },
      reviewHistory: { version: 1, aiAttempts: 0, totalAttempts: 0, chainHead: null },
      // Recorded now, before the change writes anything, so the surface can
      // later tell what this change did from what the tree already carried.
      workspace: {
        mode: "current", path: root, baseHead: gitHead(root),
        preexisting: preexistingDirty(root)
      },
      budget: initialBudget(schema, id),
      createdAt: now(), updatedAt: now()
    };
    saveRuntime(state);
    if (draft) materializeDraft(id, draft);
    bindClaudeSession(id, "change");
    console.log(`CREATED ${id}\n  schema: ${schema}\n  next: complete artifacts, then /build ${id}`);
    return id;
  }

  function rapidStartTemplate() {
    return {
      version: 1,
      intent: "Describe one low-impact isolated outcome",
      why: "Explain the user-visible reason",
      currentState: "Describe the bounded current behavior",
      compatibility: "No public compatibility or migration impact",
      changes: ["Describe the intended behavior"],
      nonGoals: ["Name one explicit non-goal"],
      decisions: [{ choice: "Use the smallest isolated change", why: "Minimize risk", rejected: "Broader redesign" }],
      risks: [{ risk: "Behavior regression", mitigation: "Focused deterministic test", owner: "implementation" }],
      acceptance: { required: false, reason: null, claimIds: [] },
      tasks: [{ id: "T001", outcome: "Implement the bounded outcome", kind: "implementation", paths: ["replace-with-owned-path"], verify: "replace-with-focused-command" }],
      claims: [{ id: "replace-with-stable-claim-id", scenario: "Observable outcome passes", impact: "low", capabilities: ["test"] }],
      specs: [{
        name: "unused-by-rapid",
        operation: "added",
        requirement: "Bounded outcome",
        description: "The system SHALL provide the outcome.",
        scenarios: [{
          name: "Focused behavior",
          when: "the bounded input occurs",
          then: "the expected result is returned"
        }]
      }],
      execution: {
        version: 1,
        providers: {
          test: {
            adapter: "test-discovery",
            command: ["replace-with-project-test-command"],
            report: "replace-with-structured-test-report.json",
            minimum: 1,
            timeoutMs: 120000
          }
        },
        services: {}
      },
      externalOperations: [],
      grounding: {
        version: 2,
        decisionBatch: {
          status: "locked",
          source: "user-batch",
          reference: "replace-with-durable-decision-reference",
          mode: "single-batch",
          lockedAt: "replace-with-ISO-8601-timestamp",
          decisions: [{
            id: "replace-with-stable-decision-id",
            question: "replace-with-material-question-or-default-reviewed",
            answer: "replace-with-locked-answer",
            source: "user-batch"
          }]
        },
        risk: {
          tier: "low",
          classes: ["none"],
          rationale: "Low-impact isolated draft with no discovered operated boundary"
        },
        productionEntry: {
          status: "applicable",
          sourceReason: "The focused production entry must be named before start",
          paths: ["replace-with-production-entry"]
        },
        realWire: {
          status: "not-applicable",
          sourceReason: "No wire boundary is present in the isolated draft",
          contracts: []
        },
        activationSemantics: {
          status: "not-applicable",
          sourceReason: "The isolated draft activates no dormant legacy path",
          activatedPaths: [],
          failureSemanticChanges: []
        },
        serviceInteractions: {
          status: "not-applicable",
          sourceReason: "The isolated draft has no cross-service interaction",
          rows: []
        },
        observability: {
          status: "not-applicable",
          sourceReason: "The isolated draft creates no operated runtime boundary",
          rows: []
        },
        readSet: [{
          repository: "root",
          path: "replace-with-relevant-file",
          role: "requirement",
          mode: "full",
          sha256: "replace-with-file-sha256"
        }],
        claims: [{
          id: "replace-with-stable-claim-id",
          productionPath: [{
            repository: "root",
            path: "replace-with-entrypoint-or-observable-surface"
          }],
          failurePaths: [{
            repository: "root",
            path: "replace-with-path-containing-failure-branch",
            failure: "replace-with-branch-input-class-or-dependency-stage"
          }],
          evidenceClass: ["test"],
          testDoubleGap: "none"
        }],
        criticalCases: [],
        mutants: [],
        derivedFacts: []
      }
    };
  }

  function resolveChange(id, flags) {
    const state = loadRuntime(id);
    if (flags["reopen-grounding"]) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      const reason = String(flags["reopen-reason"] || "").trim();
      if (!decisionRef || !reason)
        fail("--reopen-grounding requires --decision-ref and --reopen-reason");
      if (state.groundingReopenPending)
        fail("grounding already has an open revision; complete and validate that batch first");
      if (!state.groundingDigest)
        fail("--reopen-grounding requires a currently locked grounding ledger");
      if ((state.groundingReopens || []).some((row) => row.decisionRef === decisionRef))
        fail("--decision-ref was already used for a grounding reopen");
      state.groundingReopenPending = {
        version: 1,
        decisionRef,
        reason,
        priorDigest: state.groundingDigest,
        priorLockedAt: state.groundingLockedAt || null,
        openedAt: now()
      };
      delete state.groundingDigest;
      delete state.groundingLockedAt;
      state.contractRevision = Number(state.contractRevision || 0) + 1;
    } else if (flags["decision-ref"] || flags["reopen-reason"])
      fail("--decision-ref and --reopen-reason require --reopen-grounding");
    // The only consumer gates on strict equality with "unclear", so an
    // unvalidated value silently defeats the /investigate blocker it feeds.
    if (flags.ambiguity && !["clear", "unclear"].includes(flags.ambiguity))
      fail("--ambiguity must be clear|unclear");
    for (const key of ["ambiguity", "impact", "coupling"])
      if (flags[key]) state[key] = flags[key];
    // Sizes are stored lowercase and validated. `--size` was accepted verbatim
    // with no enum, so `--size medium` or `--size 5` persisted happily, and the
    // one place that read it compared against the literal "S" — which
    // `startAtomic`'s own "xs" could never match. Now that size scales the
    // request budget, an unrecognized value would silently take the default
    // lane instead of the one the author asked for.
    if (flags.size) {
      const size = String(flags.size).toLowerCase();
      if (!["xs", "s", "m", "l"].includes(size)) fail("--size must be xs|s|m|l");
      state.size = size;
    }
    // The paths the author expects to touch, declared before they exist. Policy
    // infers capabilities from the *changed* surface, which at change time is
    // empty — so a `.tsx` file pulls `accessibility` only once it is written,
    // by which point the contract is signed and the evidence is collected.
    // Declaring nothing keeps that behavior exactly; this is advisory input to
    // a forecast, never an input to enforcement.
    if (flags.surface !== undefined) {
      const globs = String(flags.surface).split(",")
        .map((value) => value.trim()).filter(Boolean);
      if (!globs.length) fail("--surface requires at least one path or glob");
      state.declaredSurface = [...new Set(globs)].sort();
    }
    const semanticText = `${state.intent} ${flags.security || ""}`.toLowerCase();
    // Word boundaries, not substrings. `includes("access")` fired on
    // "accessibility" and `includes("migration")` on "migration guide", so
    // routine work acquired external review it did not need — while the
    // trigger the docs promise ("semantic, not syntax") went unmet either way.
    const inferred = securityTerms.filter((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(semanticText);
    });
    const explicitSecurity = String(flags.security || "").split(",")
      .map((value) => value.trim()).filter((value) => value && value.toLowerCase() !== "none");
    state.securityTriggers = [...new Set([
      ...(state.securityTriggers || []).filter((value) =>
        String(value).trim().toLowerCase() !== "none"),
      ...inferred, ...explicitSecurity
    ])];
    // Coupling alone no longer summons a reviewer. `coupled` means the change
    // spans components, which earns the standard schema's design.md and specs/
    // below — but at low impact there is nothing for an independent reader to
    // protect, and the cross-repository cases that do matter are caught
    // separately: reviewPolicy raises `multi-repository-claim` for any claim
    // above low impact that spans repositories, without consulting this flag.
    state.reviewRequired = state.impact === "high" ||
      (state.coupling === "coupled" && state.impact !== "low") ||
      state.securityTriggers.length > 0 || Boolean(flags.review);
    if (flags["acceptance-required"] && flags["acceptance-not-required"])
      fail("resolve cannot combine --acceptance-required and --acceptance-not-required");
    if ((flags["acceptance-reason"] || flags["acceptance-claims"]) &&
        !flags["acceptance-required"])
      fail("--acceptance-reason and --acceptance-claims require --acceptance-required");
    if (flags["acceptance-required"]) {
      const reason = String(flags["acceptance-reason"] || "").trim();
      if (!reason) fail("--acceptance-required requires --acceptance-reason");
      const acceptanceClaims = String(flags["acceptance-claims"] || "").split(",")
        .map((value) => value.trim()).filter(Boolean);
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason,
        claimIds: acceptanceClaims,
        scopeOrigin: "explicit",
        declaredAt: now()
      };
    } else if (flags["acceptance-not-required"])
      state.acceptance = {
        version: 2, decision: "not-required", required: false,
        reason: null, claimIds: [], declaredAt: now()
      };
    let upgraded = false;
    if (state.schema === "foundation-rapid" &&
        (state.impact !== "low" || state.coupling !== "isolated" || state.reviewRequired ||
         state.acceptance?.required)) {
      state.schema = "foundation-standard";
      state.upgradedFrom = "foundation-rapid";
      state.groundingRequired = workflowPolicy().workflow.grounding === "required";
      upgraded = true;
      // The rapid packet has no design.md and no specs/, which the standard
      // schema requires. Leaving them absent made `validate` refuse a change
      // whose only listed next command was `validate` — a dead end that had to
      // be guessed out of. Instantiate them here, with the upgrade.
      materializeStandardArtifacts(id, state.intent);
    }
    saveRuntime(state);
    // The surface line appears only when one was declared, so a change that
    // never used the flag keeps producing the output it produced before it
    // existed.
    const surfaceLine = state.declaredSurface?.length
      ? `\n  surface: ${state.declaredSurface.join(", ")}` : "";
    console.log(`RESOLVED ${id}\n  impact: ${state.impact}\n  coupling: ${state.coupling}\n  review: ${state.reviewRequired ? "required" : "not required"}\n  acceptance: ${state.acceptance?.decision || (state.acceptance?.required ? "required" : "legacy-not-required")}\n  security: ${state.securityTriggers.join(", ") || "none"}${surfaceLine}\n  schema: ${state.schema}${upgraded ? " (upgraded from foundation-rapid; design.md and specs/ added)" : ""}\n  next: ${nextCommand(state.status, id)}`);
  }

  function startAtomic(draftPath) {
    const draft = loadDraft(draftPath);
    if (draft.version !== 1) fail("start draft requires version 1");
    if (!String(draft.intent || "").trim()) fail("start draft requires non-empty 'intent'");
    const impact = draft.impact || "low";
    const coupling = draft.coupling || "isolated";
    const securityTriggers = draft.securityTriggers || [];
    if (!draft.acceptance || typeof draft.acceptance.required !== "boolean")
      fail("start draft requires acceptance.required true|false from an explicit user-facing decision");
    // Validated here, with everything else, rather than inside resolveChange:
    // createChange has already persisted by then, so a late refusal leaves a
    // half-created change whose only exit is `change abandon --decision-ref`,
    // a flag the error does not mention. `start` is meant to be atomic.
    if (draft.acceptance.required && !String(draft.acceptance.reason || "").trim())
      fail("start draft requires acceptance.reason when acceptance.required is true");
    // The converse direction, for the same reason: resolveChange refuses a
    // reason or claims without required, and by then the change exists.
    if (!draft.acceptance.required &&
        (String(draft.acceptance.reason || "").trim() ||
         (draft.acceptance.claimIds || []).length))
      fail("start draft acceptance.reason and acceptance.claimIds require acceptance.required true");
    if (!["low", "medium", "high"].includes(impact))
      fail("start draft impact must be low|medium|high");
    if (!["isolated", "coupled"].includes(coupling))
      fail("start draft coupling must be isolated|coupled");
    if (!Array.isArray(securityTriggers) ||
        securityTriggers.some((trigger) => typeof trigger !== "string" || !trigger.trim()))
      fail("start draft securityTriggers must be an array of non-empty strings");
    if (!draft.execution || draft.execution.version !== 1 ||
        !draft.execution.providers || Object.keys(draft.execution.providers).length === 0)
      fail("start draft requires executable evidence wiring");
    const rapid = impact === "low" && coupling === "isolated" &&
      securityTriggers.filter((trigger) => trigger.toLowerCase() !== "none").length === 0 &&
      !draft.reviewRequired && !draft.acceptance?.required;
    if (workflowPolicy().workflow.grounding === "required" &&
        (!draft.grounding || draft.grounding.version !== 2))
      fail("start draft requires grounding.version 2 after the initial Decision Sheet");
    const id = createChange(draft.intent, { rapid, draft: draftPath, id: draft.id });
    resolveChange(id, {
      impact,
      coupling,
      size: String(draft.size || (rapid ? "xs" : "s")).toLowerCase(),
      security: securityTriggers.join(","),
      review: Boolean(draft.reviewRequired),
      "acceptance-required": Boolean(draft.acceptance?.required),
      "acceptance-not-required": !draft.acceptance?.required,
      "acceptance-reason": draft.acceptance?.reason || undefined,
      "acceptance-claims": (draft.acceptance?.claimIds || []).join(",") || undefined
    });
    materializeDraft(id, draft);
    validate(id, "root", { quiet: true });
    createSandbox(id);
    showPacket(id, { phase: "build" });
  }

  return {
    templateDir,
    instantiate,
    loadDraft,
    materializeDraft,
    createChange,
    rapidStartTemplate,
    startAtomic,
    resolveChange
  };
}
