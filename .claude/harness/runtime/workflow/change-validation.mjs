import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { auditTraceability, normalizedTraceLabel } from "../evidence/traceability.mjs";
import { detectEvidenceWiring } from "../evidence/evidence-bootstrap.mjs";
import { nextAfterValidate } from "../core/next-step.mjs";
import {
  parseSpecRequirements, taskBlocks, taskMetadata
} from "./change-artifacts.mjs";

export function createChangeValidationRuntime({
  markBlocked = () => {},
  root,
  activeChangePath,
  changePath,
  walk,
  loadRuntime,
  saveRuntime,
  evidence,
  selectedRepositories,
  providerCapability,
  providerConfig,
  resolvedAcceptance,
  reviewPolicy,
  policyCapabilities,
  policyCapabilityTrigger,
  changedSurfaceResolvable,
  forecastCapabilities,
  rawExecution,
  commandExists,
  stableHash,
  knownProviders,
  writeJson,
  now,
  fail
}) {
  // `dir` is an override for the one case where the ledger is no longer at the
  // active path: an archive that moved the change directory and then failed.
  function pendingTasks(id, dir = activeChangePath(id)) {
    const path = join(dir, "tasks.md");
    if (!existsSync(path)) return [];
    return taskBlocks(readFileSync(path, "utf8")).filter((task) => !task.done);
  }

  function changeSpecScenarios(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const scenarios = [];
    if (!existsSync(specsRoot)) return scenarios;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const text = readFileSync(path, "utf8");
      const requirementAt = (index) => {
        const prefix = text.slice(0, index);
        return [...prefix.matchAll(/^### Requirement:\s*(.+?)\s*$/gm)]
          .at(-1)?.[1]?.trim() || null;
      };
      for (const match of text.matchAll(/^#### Scenario:\s*(.+?)\s*$/gm))
        scenarios.push({
          name: match[1].trim(),
          requirement: requirementAt(match.index),
          path: relative(root, path).replaceAll("\\", "/"),
          key: normalizedTraceLabel(match[1])
        });
    });
    return scenarios.sort((left, right) =>
      `${left.path}:${left.name}`.localeCompare(`${right.path}:${right.name}`));
  }

  // OpenSpec reconciles a MODIFIED requirement by replacing its scenario list
  // wholesale, so a scenario the delta stops naming reads as a deletion. That
  // is exactly what a rename looks like, and archive only discovers it after
  // the code has already landed. Report it while it is still cheap to fix.
  function droppedScenarioFindings(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const findings = [];
    if (!existsSync(specsRoot)) return findings;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const capability = relative(specsRoot, path).replaceAll("\\", "/").split("/")[0];
      const currentPath = join(root, "openspec", "specs", capability, "spec.md");
      if (!existsSync(currentPath)) return;
      const current = new Map(parseSpecRequirements(readFileSync(currentPath, "utf8"))
        .map((requirement) => [requirement.name, requirement.scenarios]));
      for (const requirement of parseSpecRequirements(readFileSync(path, "utf8"))) {
        if (!/^MODIFIED\b/i.test(requirement.section || "")) continue;
        const declared = new Set(requirement.scenarios);
        for (const scenario of current.get(requirement.name) || [])
          if (!declared.has(scenario))
            findings.push({
              capability,
              requirement: requirement.name,
              scenario,
              path: relative(root, path).replaceAll("\\", "/")
            });
      }
    });
    return findings;
  }

  // OpenSpec cannot modify or remove a requirement from a capability that has
  // no canonical specification yet. Archive catches that, but only after
  // Build and Prove have spent their work. Validate it while the contract is
  // still the only artifact that needs changing.
  function newCapabilityOperationFindings(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const findings = [];
    if (!existsSync(specsRoot)) return findings;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const capability = relative(specsRoot, path).replaceAll("\\", "/").split("/")[0];
      const currentPath = join(root, "openspec", "specs", capability, "spec.md");
      if (existsSync(currentPath)) return;
      for (const requirement of parseSpecRequirements(readFileSync(path, "utf8"))) {
        if (/^ADDED\b/i.test(requirement.section || "")) continue;
        findings.push({
          capability,
          operation: requirement.section || "an ungrouped requirement",
          requirement: requirement.name,
          path: relative(root, path).replaceAll("\\", "/")
        });
      }
    });
    return findings;
  }

  function assertNewCapabilitiesAreAdditive(id, dir = activeChangePath(id)) {
    const findings = newCapabilityOperationFindings(id, dir);
    if (!findings.length) return;
    const detail = findings.map((finding) =>
      `'${finding.operation}' for requirement '${finding.requirement}' in ${finding.capability}`
    ).join("; ");
    fail(`new capability spec delta uses a non-additive operation: ${detail}. ` +
      "A capability absent from openspec/specs/ has nothing to modify or remove; " +
      "declare every new requirement under '## ADDED Requirements'.");
  }

  // No bypass flag: OpenSpec enforces the same rule at archive time, so
  // skipping this check would only move the same failure past the point where
  // the code has already been projected into the target.
  function assertNoDroppedScenarios(id, dir = activeChangePath(id)) {
    const findings = droppedScenarioFindings(id, dir);
    if (!findings.length) return;
    const detail = findings.map((finding) =>
      `'${finding.scenario}' under requirement '${finding.requirement}' in ${finding.capability}`
    ).join("; ");
    fail(`spec delta drops ${findings.length} scenario(s) the current spec still declares: ${
      detail}. OpenSpec reads a MODIFIED block as the complete scenario list, so a renamed scenario archives as a deletion. Either keep the original scenario name, or rename the whole requirement: declare the old name under '## REMOVED Requirements' and the new name under '## ADDED Requirements' with its full scenario list. Reusing one requirement name in both sections is rejected.`);
  }

  function traceabilityAuditValue(id) {
    const state = loadRuntime(id);
    const dir = activeChangePath(id, state);
    const contract = evidence(id, dir);
    const tasks = taskBlocks(readFileSync(join(dir, "tasks.md"), "utf8"))
      .map(taskMetadata);
    const scenarios = state.schema === "foundation-standard"
      ? changeSpecScenarios(id, dir)
      : [];
    const configuredCapabilities = Object.entries(contract.providers || {})
      .map(([provider, config]) => providerCapability(provider, config))
      .filter(Boolean);
    return auditTraceability({
      id,
      state,
      contract,
      tasks,
      scenarios,
      configuredCapabilities
    });
  }

  function showTraceabilityAudit(id, flags = {}) {
    const audit = traceabilityAuditValue(id);
    if (flags.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`TRACEABILITY ${id}: ${audit.status.toUpperCase()}`);
      console.log(`  scenarios: ${audit.summary.scenarios}; claims: ${audit.summary.claims}; tasks: ${audit.summary.tasks}`);
      console.log(`  linked claims: ${audit.summary.linkedClaims}/${audit.summary.claims}; linked tasks: ${audit.summary.linkedTasks}/${audit.summary.tasks}`);
      for (const finding of audit.findings)
        console.log(`  ${finding.level.toUpperCase().padEnd(7)} ${finding.code}: ${finding.message}`);
    }
    // A failing traceability audit is a refusal, not a crash. It exits without
    // `die` because the findings are already printed above, so it declares the
    // block explicitly instead.
    if (audit.status === "error") { markBlocked(); process.exitCode = 1; }
  }

  function changeArtifactGaps(state, dir) {
    const required = state.schema === "foundation-rapid"
      ? ["proposal.md", "tasks.md", "evidence.yaml"]
      : ["proposal.md", "design.md", "tasks.md", "evidence.yaml"];
    // `repositories.yaml` sits in both schemas' `apply.requires` and is written
    // by `createChange`, but nothing checked it here: deleting the file passed
    // `change validate` and only failed later, inside Land, where the recovery
    // is expensive. Gated with `execution.yaml` because the two arrived
    // together in the version-2 packet.
    if (Number(state.version || 1) >= 2)
      required.push("execution.yaml", "repositories.yaml");
    const missing = required.filter((name) => !existsSync(join(dir, name)));
    if (state.schema === "foundation-standard") {
      let specCount = 0;
      walk(join(dir, "specs"), () => { specCount += 1; });
      if (specCount === 0) missing.push("specs/**/*.md");
    }
    return missing;
  }

  function validate(id, source = "root", options = {}) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const dir = source === "active" ? activeChangePath(id, state) : changePath(id);
    const missing = changeArtifactGaps(state, dir);
    if (missing.length) fail(`missing change artifacts: ${missing.join(", ")}`);
    if (!["low", "medium", "high"].includes(state.impact || ""))
      fail(`resolve impact for '${id}'`);
    if (!["isolated", "coupled"].includes(state.coupling || ""))
      fail(`resolve coupling for '${id}'`);
    if (state.acceptance?.decision === "undecided")
      fail(`acceptance decision is unresolved for '${id}'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required`);
    assertNewCapabilitiesAreAdditive(id, dir);
    assertNoDroppedScenarios(id, dir);

    const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
    const parsedTasks = taskBlocks(tasks);
    const taskIds = parsedTasks.map((task) => task.id).filter(Boolean);
    if (parsedTasks.length && taskIds.length !== parsedTasks.length)
      fail("every implementation task requires a stable ID such as T001");
    if (new Set(taskIds).size !== taskIds.length)
      fail("tasks.md contains duplicate task IDs");
    // The gate is about a task that names a lifecycle *command*, so the slash
    // has to start a token. Matching a bare `/land` anywhere also matched the
    // path `runtime/workflow/land-runtime.mjs`, which made every change that
    // declares that file's path in `[paths:]` unvalidatable — the guard blocked
    // work on the very code it guards.
    const lifecycleTasks = taskBlocks(tasks).filter((task) =>
      !task.done && /(?:^|[\s(`"'])\/(?:prove|land)\b/.test(task.text));
    if (lifecycleTasks.length)
      fail("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");

    const claims = evidence(id, dir).claims;
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const selectedRepositoryIds = new Set(selectedRepositories(id, state)
      .map((repository) => repository.id));
    for (const claim of claims) {
      if (!["low", "medium", "high"].includes(claim.impact || ""))
        fail(`claim '${claim.id}' requires impact low|medium|high`);
      if (claim.repositories !== undefined &&
          (!Array.isArray(claim.repositories) || claim.repositories.length === 0 ||
           claim.repositories.some((repository) => !selectedRepositoryIds.has(repository))))
        fail(`claim '${claim.id}' repositories must reference selected repositories`);
      if ((claim.repositories || []).length > 1 &&
          !claim.capabilities.includes("cross-repo-contract"))
        fail(`claim '${claim.id}' spans repositories and requires cross-repo-contract`);
    }

    let acceptance = resolvedAcceptance(id, state, { claims });
    const unknownAcceptanceClaims = acceptance.claimIds.filter((claim) => !claimById.has(claim));
    if (unknownAcceptanceClaims.length)
      fail(`acceptance references unknown claim(s): ${unknownAcceptanceClaims.join(", ")}`);
    if (acceptance.required && acceptance.claimIds.length === 0) {
      if (acceptance.version < 2) {
        acceptance = {
          ...acceptance,
          claimIds: claims.map((claim) => claim.id),
          scopeOrigin: "legacy-all"
        };
        console.error("WARNING: migrated legacy acceptance scope to all current claims");
      } else {
        // Declaring acceptance required without naming what is to be accepted
        // leaves every later command refusing the change — validate, readiness,
        // sync and Land alike. The old wording named two flags of `change
        // resolve`, a command already run by the time anything reads this, and
        // said nothing about how to get out. Both exits belong here.
        fail(`change '${id}' requires acceptance but nothing is in scope. Either name the ` +
          "claims a person is accepting:\n" +
          `  claude-foundation change resolve ${id} --impact <impact> --coupling <coupling> ` +
          "--acceptance-required --acceptance-reason <why> --acceptance-claims <ids>\n" +
          "or declare capability 'acceptance' on a claim in evidence.yaml. To withdraw the " +
          "requirement instead, re-resolve with --acceptance-not-required.");
      }
    }
    if (acceptance.required) {
      // A claim declaring capability `acceptance` outranks the resolve flag —
      // `resolvedAcceptance` ORs the two — and this rewrite then persists the
      // derived answer. Silently. So `--acceptance-not-required` appeared to
      // do nothing, forever, and the only way to learn why was to read
      // `resolvedAcceptance`. Name the claims that hold the gate open, the way
      // `policyCapabilityTrigger` names the file that pulled a capability in.
      if (acceptance.scopeOrigin === "claim-capability")
        console.error(`WARNING: acceptance stays required because claim(s) ${acceptance.claimIds.join(", ")} declare capability 'acceptance'; --acceptance-not-required cannot drop a human gate while that capability remains in evidence.yaml`);
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason: acceptance.reason || "declared evidence capability",
        claimIds: acceptance.claimIds,
        scopeOrigin: acceptance.scopeOrigin || "explicit",
        declaredAt: state.acceptance?.declaredAt || now()
      };
    }

    for (const task of parsedTasks) {
      const metadata = taskMetadata(task);
      if (metadata.claims.length > 50)
        fail(`task '${task.id}' references more than 50 claims`);
      const unknownClaims = metadata.claims.filter((claim) => !claimById.has(claim));
      if (unknownClaims.length)
        fail(`task '${task.id}' references unknown claim(s): ${unknownClaims.join(", ")}`);
      const outOfScopeClaims = metadata.claims.filter((claimId) => {
        const repositories = claimById.get(claimId)?.repositories || [];
        return repositories.length > 0 && !repositories.includes(metadata.repository);
      });
      if (outOfScopeClaims.length)
        fail(`task '${task.id}' references claim(s) outside repository '${metadata.repository}': ${outOfScopeClaims.join(", ")}`);
    }

    const selected = selectedRepositories(id, state);
    if (selected.length > 1) {
      const unscopedTasks = parsedTasks.filter((task) =>
        !/\[repo:[a-z0-9-]+\]/i.test(task.text));
      if (unscopedTasks.length)
        fail(`multi-repository tasks require [repo:<id>] scope (${unscopedTasks.map((task) => task.id).join(", ")})`);
      for (const task of parsedTasks) {
        const metadata = taskMetadata(task);
        const repository = metadata.repository;
        if (repository && !selectedRepositoryIds.has(repository))
          fail(`task '${task.id}' references unselected repository '${repository}'`);
        if (metadata.paths.some((path) =>
          isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")))
          fail(`task '${task.id}' contains an unsafe path scope`);
        if (["implementation", "migration"].includes(metadata.kind) && metadata.paths.length === 0)
          fail(`multi-repository task '${task.id}' requires [paths:<repo-relative-paths>]`);
      }
    }

    if (claims.some((claim) => claim.impact === "high")) state.reviewRequired = true;
    state.evidenceCapabilities = [...new Set(claims.flatMap((claim) => claim.capabilities))];
    // Case-insensitive and `xs`-aware: this compared against the literal "S",
    // so an atomic start's own "xs" fell through to the wide budget and the
    // check only ever passed via the impact disjunct.
    const budgets = ["xs", "s"].includes(String(state.size || "").toLowerCase())
      || state.impact === "low"
      ? { "proposal.md": 900, "design.md": 1400, "tasks.md": 900 }
      : { "proposal.md": 1600, "design.md": 2600, "tasks.md": 1600 };
    for (const [name, limit] of Object.entries(budgets)) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      const words = readFileSync(path, "utf8").trim().split(/\s+/).filter(Boolean).length;
      if (words > limit)
        console.error(`WARNING: ${name} is ${words} words (soft budget ${limit}); retain only load-bearing content`);
    }
    saveRuntime(state);
    // A declared surface predicts capabilities that the *changed* surface will
    // only reveal once files exist — by which point this contract is signed and
    // its evidence collected. Warn, never fail: the forecast is a prediction the
    // author owns, and failing here would be routed around by declaring nothing.
    if (state.declaredSurface?.length && !options.quiet) {
      const covered = new Set(requiredProviders(id).map((provider) =>
        providerCapability(provider, providerConfig(id, provider))));
      const missing = forecastCapabilities(state.declaredSurface)
        .capabilities.filter((capability) => !covered.has(capability));
      // A warning that names no action is a warning nobody acts on, and this
      // one fires at the last moment the contract is still cheap to change.
      // Say what each outcome actually is now: a wired capability is enforced,
      // an unwired one is carried as an advisory rather than becoming an
      // unsatisfiable gate at Prove — except review, which stops the loop until
      // a reviewer or a foundation.json waiver exists.
      if (missing.length) {
        console.error(`WARNING: declared surface forecasts ${missing.join(", ")} with no provider`);
        console.error(`  wire them now: claude-foundation evidence init ${id} --write`);
        console.error(`  inspect first: claude-foundation evidence doctor ${id}`);
        if (missing.includes("review"))
          console.error("  review needs an independent reviewer at Prove; a solo project sets " +
            "\"review\": {\"independence\": \"self\"} in foundation.json before Build");
        console.error("  anything left unwired is carried as a non-blocking advisory, not a gate");
      }
    }
    // Review is the one gate a change cannot wire its way out of, and the loop
    // used to reveal it at Prove — after the build is spent, and with the
    // waiver that resolves it named nowhere. A forecast only covers what is not
    // yet required; once it *is* required, saying so here is the last cheap
    // moment to find a reviewer or decide the project reviews itself.
    // Guarded for the same reason as `advisoryCapabilities`: `reviewPolicy`
    // reads the changed surface, which a multi-repository change cannot resolve
    // until its sandboxes exist. A hint must never be able to fail validate.
    if (!options.quiet && changedSurfaceResolvable(id, state)) {
      const policy = reviewPolicy(id, state, evidence(id, dir));
      if (policy.required && !policy.independenceWaived) {
        console.error("NOTE: this change requires review evidence; an independent reviewer must exist by Prove");
        console.error("  solo project: set \"review\": {\"independence\": \"self\"} in foundation.json before Build");
      }
    }
    if (!options.quiet)
      console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)\n  next: ${nextAfterValidate(state.status, id)}`);
  }

  function requiredProviders(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const providers = contract.providers || {};
    // A waiver withdraws one capability's enforcement on a recorded user
    // decision (`change waive`). The claim keeps declaring the capability —
    // that is what keeps the record honest — but nothing requires it here, so
    // the next finalize simply no longer asks for it. `waiveGate` refuses
    // `review` and `acceptance`, which own their documented routes.
    const waived = new Set((state.waivers || []).map((row) => row.capability));
    const required = new Set();
    const addCapability = (capability, repositories = []) => {
      if (waived.has(capability)) return;
      const instances = Object.entries(providers).filter(([provider, config]) => {
        if (providerCapability(provider, config) !== capability) return false;
        if (!config.repository || repositories.length === 0) return true;
        return repositories.includes(config.repository);
      }).map(([provider]) => provider);
      if (instances.length) instances.forEach((provider) => required.add(provider));
      else required.add(capability);
    };
    for (const claim of contract.claims) {
      for (const capability of claim.capabilities) {
        addCapability(capability, claim.repositories || []);
        // Discovery exists only as test's counting half; a waived test must
        // not leave a stranded discovery gate no provider will ever write.
        if (capability === "test" && !waived.has("test"))
          addCapability("discovery", claim.repositories || []);
      }
    }
    if (reviewPolicy(id, state, contract).required) addCapability("review");
    if (resolvedAcceptance(id, state, contract).required) addCapability("acceptance");
    for (const capability of policyCapabilitySplit(id, contract).enforced)
      addCapability(capability);
    return [...required].sort();
  }

  // A capability the policy infers from the *realized* diff is a risk hint, not
  // a contract the author signed. It can only appear once the files exist —
  // after Build — and an inferred capability nobody wired defaults to adapter
  // "external" (`evidence-contract`), so the required set grew past the point
  // where the contract could still be negotiated and Prove stopped on a gate
  // that had no way to pass. Enforce an inferred capability only where the
  // project actually wired a provider for it, or where the author declared the
  // same capability on a claim; otherwise carry it as an advisory that is
  // reported and recorded but does not block.
  //
  // `review` is deliberately unaffected: `reviewPolicy` reads the same inferred
  // set and adds review itself, and it owns a documented waiver
  // (`review.independence`, `review.diversity` in foundation.json). Downgrading
  // it here would drop a gate that has a way out rather than one that does not.
  function policyCapabilitySplit(id, contract = evidence(id)) {
    const configured = new Set(Object.entries(contract.providers || {})
      .map(([provider, config]) => providerCapability(provider, config)));
    const declared = new Set(contract.claims.flatMap((claim) => claim.capabilities || []));
    const enforced = [];
    const advisory = [];
    for (const capability of policyCapabilities(id))
      (configured.has(capability) || declared.has(capability) ? enforced : advisory)
        .push(capability);
    return { enforced, advisory };
  }

  // Advisories are the record that the downgrade above happened. Dropping an
  // inferred capability silently would make "the policy saw nothing" and "the
  // policy saw something nobody wired" identical in the evidence, which is
  // exactly the distinction a later reader needs.
  // Advisories are reporting, never a gate, so they must not be able to fail a
  // command. The changed surface is unresolvable in states that are not errors
  // — a multi-repository change before its sandboxes exist cannot answer "what
  // changed" yet — and that path exits the process rather than throwing, so the
  // precondition is checked instead of caught. `requiredProviders` deliberately
  // does not get this treatment: dropping an inferred capability there would
  // under-require evidence, so it must still stop.
  function advisoryCapabilities(id) {
    // Waived gates ride the same reporting channel: advisories already flow
    // into readiness, validate output, the proof record, and the archive, so a
    // landing with a withdrawn gate can never read as one that never required
    // it. Reported before the surface guard — a waiver is state, not surface,
    // and must not disappear in the states where the surface is unresolvable.
    const waived = (loadRuntime(id).waivers || []).map((row) => ({
      capability: row.capability,
      reason: "user-waived",
      detail: row.reason,
      authority: row.authority,
      recordedAt: row.recordedAt,
      next: `restore it: claude-foundation change waive ${id} --capability ${
        row.capability} --revoke --decision-ref <ref>`
    }));
    if (!changedSurfaceResolvable(id)) return waived;
    return [
      ...policyCapabilitySplit(id).advisory.map((capability) => ({
        capability,
        trigger: policyCapabilityTrigger(id, capability),
        reason: "policy-inferred-unwired",
        next: `configure a project-owned ${capability} provider in openspec/changes/${
          id}/execution.yaml, or accept the advisory`
      })),
      ...waived
    ];
  }

  // The third exit from a gate that executed and failed — beside fixing the
  // code and rewiring the provider. It withdraws the capability's enforcement
  // on a recorded host-user decision; it never lands a failing proof, because
  // proof still has to end "pass" over the reduced required set. Deliberately
  // absent from `contractFingerprint`: a waiver is subtractive and cannot
  // change what any other provider's receipt attested, so the receipts already
  // earned stay valid instead of being re-run to remove a requirement.
  function waiveGate(id, flags = {}) {
    const capability = String(flags.capability || "").trim();
    const decisionRef = String(flags["decision-ref"] || "").trim();
    const reason = String(flags.reason || "").trim();
    if (!capability) fail("change waive requires --capability <capability>");
    if (!decisionRef)
      fail("change waive requires --decision-ref <host-user-decision>; ask the user to authorize withdrawing this gate before recording it");
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const waivers = state.waivers || [];
    if (flags.revoke) {
      if (!waivers.some((row) => row.capability === capability))
        fail(`capability '${capability}' has no recorded waiver to revoke`);
      state.waivers = waivers.filter((row) => row.capability !== capability);
      saveRuntime(state);
      console.log(`WAIVER REVOKED ${id}/${capability}\n  the capability is required again\n  next: claude-foundation proof run ${id}`);
      return;
    }
    if (!reason) fail("change waive requires --reason <why>");
    // Each of these gates owns a documented route built to keep provenance a
    // generic waiver would bypass.
    if (capability === "review")
      fail("review cannot be waived here; a solo project sets \"review\": {\"independence\": \"self\"} (or {\"diversity\": \"single-model\"}) in foundation.json, which records the waiver on the receipt");
    if (capability === "acceptance")
      fail(`acceptance cannot be waived here; withdraw the requirement instead: claude-foundation change resolve ${id} --acceptance-not-required (a claim that declares capability 'acceptance' must drop it in evidence.yaml)`);
    if (waivers.some((row) => row.capability === capability))
      fail(`capability '${capability}' is already waived`);
    // Waiving what is not required would record a decision about nothing.
    const required = requiredProviders(id);
    if (!required.includes(capability) && !required.some((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === capability))
      fail(`capability '${capability}' is not required by change '${id}'; nothing to waive`);
    state.waivers = [...waivers, {
      capability,
      reason,
      authority: { kind: "host-user-decision", reference: decisionRef },
      recordedAt: now()
    }];
    saveRuntime(state);
    console.log(`GATE WAIVED ${id}/${capability}\n  reason: ${reason}\n  decision: ${decisionRef}\n  recorded in proof advisories; the claim keeps declaring it\n  next: claude-foundation proof run ${id}`);
  }

  function evidenceDetectionValue(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const repositories = selectedRepositories(id, state);
    return detectEvidenceWiring({
      id,
      root,
      contract,
      repositories,
      // Detection wires what Prove will look for *and* what it downgraded to an
      // advisory: an inferred capability with a safe project-owned script is
      // better wired than waived, and `evidence init --write` is the only thing
      // that can promote it back into the enforced set.
      required: [...new Set([
        ...requiredProviders(id),
        ...advisoryCapabilities(id).map((row) => row.capability)
      ])].sort(),
      providerConfig: (provider) => providerConfig(id, provider),
      providerCapability,
      knownProviders,
      commandExists,
      stableHash
    });
  }

  function showEvidenceDetection(id) {
    console.log(JSON.stringify(evidenceDetectionValue(id), null, 2));
  }

  function initializeEvidence(id, flags = {}) {
    const detection = evidenceDetectionValue(id);
    // `activeChangePath` points into the sandbox while one is active, which is
    // right for reading a Build packet and fatal for writing contract. `sync`
    // is one-way source → sandbox: it removes the destination, copies the
    // source over it, and merges back only `tasks.md`. Writing detected
    // providers into the sandbox therefore handed them to the next sync to
    // delete — silently, in both trees, after reporting them written. The
    // durable directory is what Land archives and what sync copies forward, so
    // it is the only placement a sync cannot destroy.
    const executionPath = join(changePath(id), "execution.yaml");
    // Build still has to see the wiring without paying for a sync, which would
    // bump `revision` and drop `provenHash`. The mirror is the identical value,
    // and the next sync overwrites it from the same source.
    const activePath = activeChangePath(id);
    const mirrorPath = activePath === changePath(id)
      ? null : join(activePath, "execution.yaml");
    const current = rawExecution(id);
    const additions = {};
    for (const candidate of detection.candidates.filter((row) => row.recommended && row.config)) {
      if (current.providers[candidate.provider] || additions[candidate.provider]) continue;
      additions[candidate.provider] = candidate.config;
    }
    const preview = {
      version: 1,
      changeId: id,
      write: Boolean(flags.write),
      path: relative(root, executionPath).replaceAll("\\", "/"),
      additions,
      skipped: detection.candidates
        .filter((row) => !row.recommended || !row.config)
        .map((row) => ({
          provider: row.provider,
          confidence: row.confidence,
          detail: row.detail
        }))
    };
    if (flags.write && Object.keys(additions).length) {
      const next = {
        ...current,
        providers: { ...current.providers, ...additions }
      };
      writeJson(executionPath, next);
      if (mirrorPath) writeJson(mirrorPath, next);
      preview.written = Object.keys(additions).sort();
    } else {
      preview.written = [];
    }
    console.log(JSON.stringify(preview, null, 2));
  }

  function showEvidenceDoctor(id) {
    const detection = evidenceDetectionValue(id);
    console.log(`EVIDENCE DOCTOR ${id}: ${detection.status}`);
    for (const row of detection.configured)
      console.log(`  OK       ${row.provider}: ${row.adapter} (${row.repository})`);
    for (const row of detection.candidates)
      console.log(`  ${row.recommended ? "CANDIDATE" : "REVIEW   "} ${row.provider}: ${row.source}${row.detail ? `; ${row.detail}` : ""}`);
    for (const row of detection.unresolved)
      console.log(`  BLOCKED  ${row.provider}: ${row.reason}; next: ${row.next}`);
    for (const row of detection.unavailable)
      console.log(`  BLOCKED  ${row.provider}: ${row.reason}; next: ${row.next}`);
    for (const row of detection.warnings)
      console.log(`  WARNING  ${row.source}: ${row.reason}; ${row.detail}`);
    if (detection.candidates.some((row) => row.recommended))
      console.log(`  next: claude-foundation evidence init ${id} --write`);
  }

  return {
    advisoryCapabilities,
    assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeArtifactGaps,
    changeSpecScenarios,
    droppedScenarioFindings,
    evidenceDetectionValue,
    initializeEvidence,
    newCapabilityOperationFindings,
    pendingTasks,
    requiredProviders,
    showEvidenceDetection,
    showEvidenceDoctor,
    showTraceabilityAudit,
    taskBlocks,
    taskMetadata,
    traceabilityAuditValue,
    validate,
    waiveGate
  };
}
