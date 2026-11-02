const sortedUnique = (values) => [...new Set(values)].sort();

function providerList(value, path, findings) {
  if (!Array.isArray(value)) {
    findings.push({
      code: "INVALID_PROVIDER_LIST", path,
      message: `${path} must be an array of provider ids`
    });
    return [];
  }
  const providers = value.map((provider) => String(provider || "").trim());
  if (providers.some((provider) => !provider)) findings.push({
    code: "INVALID_PROVIDER_ID", path,
    message: `${path} contains an empty provider id`
  });
  if (new Set(providers).size !== providers.length) findings.push({
    code: "DUPLICATE_PROVIDER_ID", path,
    message: `${path} contains a duplicate provider id`
  });
  return sortedUnique(providers.filter(Boolean));
}

function bindingRows(value, path, findings) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object")
    return Object.entries(value).map(([provider, binding]) => ({
      ...(binding && typeof binding === "object" ? binding : {}), provider
    }));
  findings.push({
    code: "INVALID_BINDINGS", path,
    message: `${path} must be an object or array`
  });
  return [];
}

function bindingIndex(value, path, findings) {
  const index = new Map();
  for (const [position, row] of bindingRows(value, path, findings).entries()) {
    const provider = String(row?.provider || "").trim();
    if (!provider) {
      findings.push({
        code: "MISSING_BINDING_PROVIDER", path: `${path}[${position}].provider`,
        message: "binding requires a provider id"
      });
      continue;
    }
    if (index.has(provider)) {
      findings.push({
        code: "AMBIGUOUS_PROVIDER_BINDING", path,
        provider, message: `provider '${provider}' has more than one binding`
      });
      index.set(provider, null);
      continue;
    }
    index.set(provider, row);
  }
  return index;
}

function revision(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function bindingRevision(row) {
  return revision(row?.binding?.contractRevision ?? row?.contractRevision);
}

function identity(row) {
  const binding = row?.binding && typeof row.binding === "object"
    ? row.binding : row || {};
  return {
    provider: String(binding.providerFingerprint || binding.providerIdentity || "").trim(),
    claims: String(binding.claimsFingerprint || binding.claimFingerprint ||
      binding.claimIdentity || "").trim(),
    inputs: String(binding.inputFingerprint || binding.inputIdentity?.fingerprint ||
      binding.inputIdentity || "").trim(),
    inputMode: String(binding.inputMode || binding.inputIdentity?.mode || "").trim()
  };
}

function validity(row) {
  return String(row?.validity?.validity || row?.validity || "").trim();
}

function status(row) {
  return String(row?.status || row?.validity?.status || "").trim();
}

function preservationDecision(provider, receipt, current, priorRevision, currentRevision) {
  if (!receipt || !current) return {
    preserve: false, code: "MISSING_PROVIDER_BINDING",
    reason: `provider '${provider}' lacks an unambiguous receipt or current binding`
  };
  const receiptRevision = bindingRevision(receipt);
  const currentBindingRevision = bindingRevision(current);
  if (receiptRevision === null || currentBindingRevision === null) return {
    preserve: false, code: "MISSING_CONTRACT_REVISION",
    reason: `provider '${provider}' binding requires an integer contractRevision`
  };
  if (currentBindingRevision !== currentRevision) return {
    preserve: false, code: "CURRENT_BINDING_REVISION_MISMATCH",
    reason: `provider '${provider}' current binding is revision ${currentBindingRevision}, expected ${currentRevision}`
  };
  if (![priorRevision, currentRevision].includes(receiptRevision)) return {
    preserve: false, code: "RECEIPT_REVISION_MISMATCH",
    reason: `provider '${provider}' receipt is bound to revision ${receiptRevision}, expected ${priorRevision} or ${currentRevision}`
  };
  if (status(receipt) !== "pass") return {
    preserve: false, code: "RECEIPT_NOT_PASSING",
    reason: `provider '${provider}' has no passing receipt`
  };
  const receiptIdentity = identity(receipt);
  const currentIdentity = identity(current);
  const missing = Object.entries(currentIdentity)
    .filter(([key, value]) => key !== "inputMode" && !value).map(([key]) => key);
  const receiptMissing = Object.entries(receiptIdentity)
    .filter(([key, value]) => key !== "inputMode" && !value).map(([key]) => key);
  if (missing.length || receiptMissing.length) return {
    preserve: false, code: "INCOMPLETE_PROVIDER_IDENTITY",
    reason: `provider '${provider}' binding lacks ${sortedUnique([...missing, ...receiptMissing]).join(", ")} identity`
  };
  if (["provider", "claims", "inputs"].some((key) =>
    receiptIdentity[key] !== currentIdentity[key])) return {
    preserve: false, code: "PROVIDER_IDENTITY_CHANGED",
    reason: `provider '${provider}' provider, claim, or input identity changed`
  };
  if (receiptRevision === currentRevision) {
    if (validity(receipt) !== "valid") return {
      preserve: false, code: "CURRENT_RECEIPT_INVALID",
      reason: `provider '${provider}' current-revision receipt is '${validity(receipt) || "unknown"}'`
    };
    return { preserve: true, reason: "current-valid-binding" };
  }
  if (!["valid", "contract-stale"].includes(validity(receipt))) return {
    preserve: false, code: "RECEIPT_INVALID_BEYOND_CONTRACT",
    reason: `provider '${provider}' receipt is '${validity(receipt) || "unknown"}', not solely contract-stale`
  };
  if (!["declared", "declared-inputs"].includes(receiptIdentity.inputMode) ||
      !["declared", "declared-inputs"].includes(currentIdentity.inputMode)) return {
    preserve: false, code: "UNSCOPED_PROVIDER_INPUTS",
    reason: `provider '${provider}' lacks declared-input scope across the contract revision`
  };
  return { preserve: true, reason: "unchanged-declared-binding" };
}

/**
 * Refine semantic amendment invalidation into a safe provider execution plan.
 *
 * Cross-revision preservation requires exact provider, claim, and declared-input
 * identities. A contract-stale receipt is reusable only when the contract is
 * the sole invalidation reason. Everything uncertain is routed to proof again.
 */
export function planSelectiveProofRecovery({
  changeId, invalidation, requiredProviders, receiptBindings, currentBindings,
  priorContractRevision, currentContractRevision
} = {}) {
  const findings = [];
  const id = String(changeId || "").trim();
  if (!id) findings.push({ code: "MISSING_CHANGE_ID", path: "changeId",
    message: "changeId is required for an exact recovery route" });
  const required = providerList(requiredProviders, "requiredProviders", findings);
  const priorRevision = revision(priorContractRevision);
  const currentRevision = revision(currentContractRevision);
  if (priorRevision === null || currentRevision === null ||
      currentRevision !== priorRevision + 1) findings.push({
    code: "AMBIGUOUS_CONTRACT_REVISION", path: "currentContractRevision",
    message: "selective preservation requires one explicit contract revision step"
  });
  const affected = providerList(
    invalidation?.proof?.invalidateReceipts, "invalidation.proof.invalidateReceipts", findings);
  const candidates = providerList(
    invalidation?.proof?.preserveReceipts, "invalidation.proof.preserveReceipts", findings);
  if (!invalidation || invalidation.status !== "READY") findings.push({
    code: "INVALID_INVALIDATION_PLAN", path: "invalidation.status",
    message: "selective proof planning requires a READY amendment invalidation plan"
  });
  const overlap = affected.filter((provider) => candidates.includes(provider));
  if (overlap.length) findings.push({
    code: "AMBIGUOUS_INVALIDATION", path: "invalidation.proof",
    message: `providers appear in both invalidation sets: ${overlap.join(", ")}`
  });
  const unknown = [...affected, ...candidates]
    .filter((provider) => !required.includes(provider));
  if (unknown.length) findings.push({
    code: "UNKNOWN_INVALIDATION_PROVIDER", path: "invalidation.proof",
    message: `invalidation references non-required providers: ${sortedUnique(unknown).join(", ")}`
  });
  const unclassified = required.filter((provider) =>
    !affected.includes(provider) && !candidates.includes(provider));
  if (unclassified.length) findings.push({
    code: "UNCLASSIFIED_REQUIRED_PROVIDER", path: "invalidation.proof",
    message: `required providers are not classified: ${unclassified.join(", ")}`
  });

  const receipts = bindingIndex(receiptBindings, "receiptBindings", findings);
  const current = bindingIndex(currentBindings, "currentBindings", findings);
  // Structural findings make every preservation decision ambiguous. Findings
  // discovered while evaluating one candidate, however, are provider-local:
  // fail closed for that provider without throwing away independently valid
  // receipts from the same amendment.
  const structuralFindingCount = findings.length;
  const preserved = [];
  const rerun = new Set([...affected, ...unclassified]);
  const decisions = affected.map((provider) => ({
    provider, action: "rerun", reason: "semantic-amendment-affected"
  }));
  const revisionSafe = priorRevision !== null && currentRevision === priorRevision + 1;
  const invalidationSafe = invalidation?.status === "READY" &&
    !overlap.length && !unknown.length && !unclassified.length;
  for (const provider of candidates) {
    const decision = revisionSafe && invalidationSafe
      ? preservationDecision(provider, receipts.get(provider), current.get(provider),
        priorRevision, currentRevision)
      : !revisionSafe
        ? { preserve: false, code: "AMBIGUOUS_CONTRACT_REVISION",
          reason: `provider '${provider}' cannot be preserved across an ambiguous revision` }
        : { preserve: false, code: "INVALID_INVALIDATION_PLAN",
          reason: `provider '${provider}' cannot be preserved from an incomplete invalidation partition` };
    if (decision.preserve) {
      preserved.push(provider);
      decisions.push({ provider, action: "preserve", reason: decision.reason });
    } else {
      rerun.add(provider);
      decisions.push({ provider, action: "rerun", reason: decision.code });
      findings.push({
        code: decision.code, path: `receiptBindings.${provider}`,
        provider, message: decision.reason
      });
    }
  }

  const rerunProviders = sortedUnique([...rerun].filter((provider) =>
    required.includes(provider)));
  const preservedProviders = sortedUnique(preserved.filter((provider) =>
    !rerun.has(provider) && required.includes(provider)));
  const command = id ? `claude-foundation advance ${id} --through proven` : null;
  const sortedFindings = findings.sort((left, right) =>
    `${left.path}\0${left.code}\0${left.message}`.localeCompare(
      `${right.path}\0${right.code}\0${right.message}`));
  return {
    version: 1,
    status: structuralFindingCount > 0 ? "BLOCKED" : "READY",
    findings: sortedFindings,
    contract: { fromRevision: priorRevision, toRevision: currentRevision },
    providers: {
      preserved: preservedProviders,
      rerun: rerunProviders
    },
    decisions: decisions.sort((left, right) => left.provider.localeCompare(right.provider)),
    recovery: {
      mode: structuralFindingCount > 0 ? "fail-closed-rerun" : "selective-rerun",
      command,
      resume: command,
      instruction: recoveryInstruction(structuralFindingCount > 0,
        preservedProviders.length, rerunProviders.length)
    }
  };
}

function recoveryInstruction(blocked, preservedCount, rerunCount) {
  if (blocked)
    return "Do not trust ambiguous preservation. Re-enter Prove so the harness recomputes every invalid binding and preserves only receipts it can validate.";
  return rerunCount
    ? `Re-enter Prove; the harness may retain ${preservedCount} bound receipt(s) and rerun ${rerunCount}.`
    : "All required receipts remain bound; re-enter Prove to finalize against the current packet.";
}

/** Move one preserved provider to rerun, keeping lists, decisions, and the instruction consistent. */
export function demoteSelectivePreservation(plan, provider, code) {
  if (!plan.providers.preserved.includes(provider))
    throw new Error(`provider '${provider}' is not preserved in this plan`);
  const preserved = plan.providers.preserved.filter((row) => row !== provider);
  const rerun = sortedUnique([...plan.providers.rerun, provider]);
  return {
    ...plan,
    providers: { preserved, rerun },
    decisions: plan.decisions.map((row) => row.provider === provider
      ? { provider, action: "rerun", reason: code } : row),
    recovery: { ...plan.recovery,
      instruction: recoveryInstruction(plan.status !== "READY", preserved.length, rerun.length) }
  };
}

/** Build the only receipt mutation authorized by a READY selective plan. */
export function rebindSelectiveProofReceipt({
  receipt, provider, plan, fromContractFingerprint, toContractFingerprint, reboundAt
} = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    throw new TypeError("selective proof rebind requires a receipt");
  const id = String(provider || "").trim();
  if (plan?.status !== "READY" || !plan.providers?.preserved?.includes(id))
    throw new Error(`provider '${id || "(missing)"}' is not authorized for selective preservation`);
  if (receipt.status !== "pass")
    throw new Error(`provider '${id}' receipt must be passing before selective preservation`);
  const from = String(fromContractFingerprint || "").trim();
  const to = String(toContractFingerprint || "").trim();
  if (!from || !to || from === to || receipt.contractFingerprint !== from)
    throw new Error(`provider '${id}' contract fingerprint transition is invalid`);
  if (!String(reboundAt || "").trim())
    throw new Error("selective proof rebind requires a timestamp");
  return {
    ...receipt,
    contractFingerprint: to,
    contractRebind: {
      version: 1,
      reason: "unaffected-semantic-amendment",
      fromContractRevision: plan.contract.fromRevision,
      toContractRevision: plan.contract.toRevision,
      fromContractFingerprint: from,
      toContractFingerprint: to,
      reboundAt
    }
  };
}
