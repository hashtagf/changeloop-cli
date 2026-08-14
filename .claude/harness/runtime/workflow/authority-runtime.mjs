import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { relative, resolve } from "node:path";

export function createAuthorityRuntime({
  root,
  protocolVersion,
  ciEvidenceProtocolVersion,
  authorityStore,
  requiredProviders,
  providerCapability,
  providerConfig,
  reviewPacketValue,
  loadRuntime,
  evidence,
  resolvedAcceptance,
  relevantHash,
  validate,
  pendingTasks,
  claimsForProvider,
  stableHash,
  now,
  reviewPolicy,
  readJson,
  receiptPath,
  recordReceipt,
  receiptValidity,
  fileDigest,
  providerWorkspaceHash,
  providerRepository,
  providerWorkspace,
  gitHead,
  validateSignedCiEnvelope,
  providerClaims,
  expandList,
  listCount,
  fail
}) {
  function authorityProvider(id, type, repository = null) {
    return requiredProviders(id).find((provider) => {
      const config = providerConfig(id, provider);
      if (providerCapability(provider, config) !== type) return false;
      return repository ? config?.repository === repository : true;
    }) || (repository ? null : type);
  }

  // A review provider that names a repository is a verdict about that
  // repository, so it binds to that repository's workspace hash. Binding every
  // verdict to the composite meant an edit in *any* selected repository
  // invalidated a review already earned elsewhere — on a wide change, review
  // became a moving target.
  function authorityWorkspaceHash(id, provider) {
    const scoped = providerConfig(id, provider)?.repository;
    return scoped ? providerWorkspaceHash(id, provider) : relevantHash(id);
  }

  function authorityPacket(id, type) {
    if (type === "review") return reviewPacketValue(id);
    const state = loadRuntime(id);
    const contract = evidence(id);
    const acceptance = resolvedAcceptance(id, state, contract);
    const context = reviewPacketValue(id);
    const claims = contract.claims.filter((claim) => acceptance.claimIds.includes(claim.id))
      .map((claim) => ({
        id: claim.id,
        scenario: claim.scenario,
        impact: claim.impact,
        criterion: `Confirm the final result satisfies: ${claim.scenario}`
      }));
    return {
      version: Number(protocolVersion), packetType: "acceptance", changeId: id,
      workspaceHash: relevantHash(id), reason: acceptance.reason,
      intent: state.intent,
      claims,
      inspection: {
        workspaces: context.changedSurface?.inspection || [],
        changedSurface: context.changedSurface || null,
        decisions: context.decisions || null,
        automatedEvidence: context.evidence || []
      },
      response: {
        statuses: ["pass", "fail", "inconclusive", "error"],
        instructions: "Inspect the final workspace against every criterion. Pass only when all criteria are satisfied; otherwise reject, report uncertainty, or pause without a response.",
        requiredForPass: ["named human", "criterion observations", "durable artifact or reference"]
      },
      requiredActor: "human"
    };
  }

  function requestAuthority(id, flags = {}) {
    const type = String(flags.type || "");
    if (!["review", "acceptance"].includes(type))
      fail("authority request --type must be review|acceptance");
    validate(id, "active", { quiet: true });
    const pending = pendingTasks(id);
    if (pending.length)
      fail(`authority request requires completed implementation tasks: ${pending.map((task) => task.id).join(", ")}`);
    const repository = String(flags.repo || "").trim() || null;
    const provider = authorityProvider(id, type, repository);
    if (!provider || !requiredProviders(id).includes(provider))
      fail(repository
        ? `change '${id}' has no ${type} provider scoped to repository '${repository}'`
        : `change '${id}' does not require ${type} authority`);
    const workspaceHash = authorityWorkspaceHash(id, provider);
    const existing = authorityStore.list(id).find((entry) =>
      entry.value.type === type && entry.value.provider === provider &&
      entry.value.workspaceHash === workspaceHash &&
      ["requested", "dispatched", "pending"].includes(entry.value.status));
    if (existing) {
      console.log(JSON.stringify(existing.value, null, 2));
      return existing.value;
    }
    const packet = authorityPacket(id, type);
    const requestId = `${type}-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const request = {
      version: Number(protocolVersion), requestId, changeId: id, type, provider,
      status: "requested", workspaceHash, claimIds: claimsForProvider(id, provider).map((claim) => claim.id),
      packet, packetDigest: stableHash(packet), requestedAt: now(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      requirements: type === "review" ? reviewPolicy(id) : {
        actor: "human", acceptance: resolvedAcceptance(id)
      }
    };
    authorityStore.writeRequest(id, request);
    console.log(JSON.stringify(request, null, 2));
    return request;
  }

  function authorityStatusValue(id, requestId = null) {
    loadRuntime(id);
    const workspaceHash = relevantHash(id);
    // Scoped requests carry their own hash; status compares against the
    // composite for unscoped ones only.
    const result = authorityStore.status(id, workspaceHash, requestId,
      (request) => authorityWorkspaceHash(id, request.provider));
    if (!result.found) fail(`unknown authority request '${requestId}'`);
    return result.value;
  }

  // The response shape is a contract. Without a way to emit it, a responder
  // discovers it one rejection at a time while the person who gave the verdict
  // waits. The identity fields are prefilled because those are exactly the
  // ones `validateResponse` matches against the request.
  function responseTemplate(request) {
    // An acceptance packet carries its claims as a plain array; a review packet
    // compacts them past twelve into `{count, preview, digest}`. Only acceptance
    // reads `criterion`, but this ran before the type check, so `.map` on the
    // compact object threw for every review with more than twelve claims — the
    // template was unreachable for exactly the changes with the most to inspect.
    const claimRows = expandList(request.packet?.claims);
    const criteria = claimRows.map((claim) => claim.criterion).filter(Boolean);
    if (criteria.length && criteria.length < listCount(request.packet?.claims))
      criteria.push(`<${listCount(request.packet?.claims) - criteria.length
        } further criteria omitted from this preview; read the packet's claims>`);
    const evidence = {
      observed: "<what the responder actually saw, in their own words>",
      artifact: [],
      reference: ["<url or path the responder inspected>"]
    };
    if (request.type === "acceptance") {
      evidence.acceptor = "<name of the person who decided>";
      evidence.decision = "accept";
      evidence.criterion = criteria.length ? criteria
        : ["<criterion the responder confirmed>"];
    } else {
      // `validateResponse` forwards every key under `evidence` into the receipt
      // flags, so this is where a reviewer states provenance. Omitting these
      // fields from the template made the documented path a dead end: the
      // receipt refused the response for a missing `--subject-actor`, and
      // `authority record` does not accept that flag. Naming them here is the
      // difference between a template a responder can complete and one that
      // cannot be recorded at all.
      evidence.reviewer = "<independent reviewer identity>";
      evidence["reviewer-type"] = "human|ai";
      evidence["subject-actor"] = "<who or what implemented the change>";
      evidence["subject-session"] = "<implementation session id, omit for a human implementer>";
      evidence["subject-provider-family"] = "<implementation provider family, omit for a human implementer>";
      evidence["subject-model-family"] = "<implementation model family, omit for a human implementer>";
      evidence["subject-model"] = "<implementation model id, omit for a human implementer>";
      // Numbers, not placeholders, because the receipt parses them. A passing
      // review now has to state its blocker count rather than inherit a zero
      // from an absent flag, so the template is where the responder is asked
      // for it — the same lesson as the provenance fields above.
      evidence["unresolved-blockers"] = 0;
      evidence["verified-findings"] = 0;
    }
    return {
      version: Number(protocolVersion),
      requestId: request.requestId,
      changeId: request.changeId,
      type: request.type,
      workspaceHash: request.workspaceHash,
      status: "pass|fail|inconclusive|error",
      evidence
    };
  }

  function showAuthorityStatus(id, flags = {}) {
    const value = authorityStatusValue(id, flags.request || null);
    if (!flags.template) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    const open = value.requests.filter((request) => authorityStore.isOpen(request.status));
    if (!open.length)
      fail(`no open authority request for '${id}'; nothing to respond to`);
    console.log(JSON.stringify(open.length === 1
      ? responseTemplate(open[0]) : open.map(responseTemplate), null, 2));
  }

  function recordAuthority(id, flags = {}) {
    const requestId = String(flags.request || "");
    const responsePath = flags.response ? resolve(flags.response) : null;
    if (!requestId || !responsePath)
      fail("authority record requires --request <id> --response <file>");
    const entry = authorityStore.list(id).find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    if (!authorityStore.isOpen(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    if (request.workspaceHash !== authorityWorkspaceHash(id, request.provider))
      fail(`authority request '${requestId}' is stale`);
    if (!existsSync(responsePath)) fail(`authority response not found: ${flags.response}`);
    const response = readJson(responsePath);
    const validated = authorityStore.validateResponse(response, request, id);
    if (!validated.valid) fail(validated.reason);
    const evidenceFlags = validated.evidence;
    const priorPath = receiptPath(id, request.provider);
    const prior = existsSync(priorPath) ? readFileSync(priorPath) : null;
    recordReceipt(id, request.provider, response.status, {
      ...evidenceFlags,
      claims: request.claimIds.join(","), workspaceHash: request.workspaceHash,
      source: evidenceFlags.source || `authority-request:${requestId}`,
      "recorded-by": evidenceFlags["recorded-by"] || `authority-bridge:${requestId}`
    });
    const validity = receiptValidity(id, request.provider, request.workspaceHash);
    if (response.status === "pass" && validity.validity !== "valid") {
      if (prior) writeFileSync(priorPath, prior); else if (existsSync(priorPath)) rmSync(priorPath);
      fail(`authority response produced invalid evidence: ${validity.validity}`);
    }
    const receiptDigest = fileDigest(priorPath);
    authorityStore.complete(entry, request, response, fileDigest(responsePath), receiptDigest);
    console.log(`AUTHORITY ${requestId}: ${response.status}\n  receipt: ${relative(root, priorPath)}`);
  }

  function recordVerifiedCi(id, provider, source) {
    const config = providerConfig(id, provider);
    if (!config || config.adapter !== "external" || !config.ci?.publicKey || !config.ci?.issuer)
      fail(`provider '${provider}' requires external ci.issuer and ci.publicKey configuration`);
    const path = resolve(source || "");
    if (!source || !existsSync(path)) fail("evidence verify-ci requires a signed JSON envelope");
    const envelope = readJson(path);
    const workspaceHash = providerWorkspaceHash(id, provider);
    const repository = providerRepository(id, provider, config);
    const head = repository ? gitHead(repository.workspacePath) : gitHead(providerWorkspace(id, provider));
    const result = validateSignedCiEnvelope({
      envelope,
      protocolVersion: ciEvidenceProtocolVersion,
      issuer: config.ci.issuer,
      publicKey: config.ci.publicKey,
      changeId: id,
      provider,
      workspaceHash,
      head
    });
    if (!result.valid) fail(result.reason);
    const { payload, artifacts, status } = result;
    recordReceipt(id, provider, status, {
      claims: providerClaims(id, provider, config).join(","), workspaceHash,
      observed: String(payload.observed || `CI ${payload.status}; commit ${payload.commit || "unknown"}`),
      source: `signed-ci:${payload.issuer}`,
      reference: [payload.runUrl, ...artifacts.map((artifact) =>
        `artifact:${artifact.name}:sha256:${artifact.sha256}`)],
      "recorded-by": `evidence-verify-ci:${payload.issuer}`
    });
    console.log(`CI EVIDENCE ${id}/${provider}: ${status}\n  run: ${payload.runUrl}`);
  }

  return {
    authorityProvider,
    authorityPacket,
    requestAuthority,
    authorityStatusValue,
    showAuthorityStatus,
    recordAuthority,
    recordVerifiedCi
  };
}
