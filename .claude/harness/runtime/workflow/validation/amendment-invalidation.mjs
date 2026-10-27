const stringList = (value) => Array.isArray(value)
  ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];

const sortedUnique = (values) => [...new Set(values)].sort();

const WHOLE_PACKET_CAPABILITIES = new Set([
  "review", "acceptance", "semantic-acceptance"
]);

function providerRows(providers, findings) {
  const rows = Array.isArray(providers)
    ? providers
    : providers && typeof providers === "object"
      ? Object.entries(providers).map(([id, config]) => ({ ...config, id }))
      : [];
  if (!Array.isArray(providers) && (!providers || typeof providers !== "object"))
    findings.push({ code: "INVALID_PROVIDERS", path: "providers",
      message: "providers must be an object or array" });
  return rows;
}

function normalizedDelta(coverageDelta, findings) {
  if (!coverageDelta || typeof coverageDelta !== "object" ||
      Array.isArray(coverageDelta)) {
    findings.push({ code: "INVALID_COVERAGE_DELTA", path: "coverageDelta",
      message: "coverageDelta must be an object" });
    return { added: [], changed: [], removed: [], rows: [] };
  }
  const fields = ["addedClaimIds", "changedClaimIds", "removedClaimIds"];
  for (const field of fields) {
    if (coverageDelta[field] !== undefined && !Array.isArray(coverageDelta[field]))
      findings.push({ code: "INVALID_COVERAGE_DELTA", path: `coverageDelta.${field}`,
        message: `${field} must be an array` });
  }
  if (coverageDelta.coverageChanges !== undefined &&
      !Array.isArray(coverageDelta.coverageChanges))
    findings.push({ code: "INVALID_COVERAGE_DELTA",
      path: "coverageDelta.coverageChanges",
      message: "coverageChanges must be an array" });
  const rows = Array.isArray(coverageDelta.coverageChanges)
    ? coverageDelta.coverageChanges : [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        !String(row.dimension || "").trim())
      findings.push({ code: "INVALID_COVERAGE_CHANGE",
        path: `coverageDelta.coverageChanges[${index}]`,
        message: "coverage change requires a dimension" });
    if (row?.claimIds !== undefined && !Array.isArray(row.claimIds))
      findings.push({ code: "INVALID_COVERAGE_CHANGE",
        path: `coverageDelta.coverageChanges[${index}].claimIds`,
        message: "coverage change claimIds must be an array" });
  }
  return {
    added: stringList(coverageDelta.addedClaimIds),
    changed: stringList(coverageDelta.changedClaimIds),
    removed: stringList(coverageDelta.removedClaimIds),
    rows
  };
}

function claimIdsForProvider(provider, claims) {
  const explicit = stringList(provider.claims);
  if (provider.claims !== undefined) return explicit;
  const capability = String(provider.capability || "").trim();
  return claims.filter((claim) => {
    const capabilities = stringList(claim.capabilities);
    return capabilities.includes(capability) ||
      (capability === "discovery" && capabilities.includes("test"));
  }).map((claim) => claim.id);
}

function propagateProviders(rows, seeds) {
  const affected = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (affected.has(row.id)) continue;
      if (stringList(row.dependsOn).some((dependency) => affected.has(dependency))) {
        affected.add(row.id);
        changed = true;
      }
    }
  }
  return affected;
}

/**
 * Plan the selective invalidation caused by a semantic amendment.
 *
 * Provider rows must already contain their resolved capability and may contain
 * explicit `claims`; otherwise claim coverage is derived from capabilities.
 * This keeps policy/provider resolution outside this pure planner.
 */
export function planAmendmentInvalidation({
  claims, tasks, providers, coverageDelta, priorClaims
} = {}) {
  const findings = [];
  if (!Array.isArray(claims)) findings.push({ code: "INVALID_CLAIMS", path: "claims",
    message: "claims must be an array" });
  if (!Array.isArray(tasks)) findings.push({ code: "INVALID_TASKS", path: "tasks",
    message: "tasks must be an array" });
  const claimRows = Array.isArray(claims) ? claims : [];
  const taskRows = Array.isArray(tasks) ? tasks : [];
  const providersNormalized = providerRows(providers, findings);
  const delta = normalizedDelta(coverageDelta, findings);

  const claimIds = new Set();
  for (const [index, claim] of claimRows.entries()) {
    const id = String(claim?.id || "").trim();
    if (!id) findings.push({ code: "INVALID_CLAIM", path: `claims[${index}].id`,
      message: "claim requires an id" });
    else if (claimIds.has(id)) findings.push({ code: "DUPLICATE_CLAIM", path: `claims[${index}].id`,
      message: `duplicate claim '${id}'` });
    else claimIds.add(id);
    if (!Array.isArray(claim?.capabilities))
      findings.push({ code: "INVALID_CLAIM_CAPABILITIES",
        path: `claims[${index}].capabilities`,
        message: `claim '${id || index}' requires capabilities` });
  }

  const removed = new Set(delta.removed);
  const direct = new Set([...delta.added, ...delta.changed, ...delta.removed]);
  let globalCoverageChange = false;
  for (const row of delta.rows) {
    const scoped = stringList(row?.claimIds);
    if (!scoped.length) globalCoverageChange = true;
    for (const id of scoped) direct.add(id);
  }
  if (globalCoverageChange) for (const id of claimIds) direct.add(id);
  if (!direct.size)
    findings.push({ code: "EMPTY_COVERAGE_DELTA", path: "coverageDelta",
      message: "coverageDelta must identify at least one claim or coverage change" });

  for (const id of direct) {
    if (!claimIds.has(id) && !removed.has(id))
      findings.push({ code: "UNKNOWN_AFFECTED_CLAIM", path: "coverageDelta",
        message: `coverage delta references unknown claim '${id}'` });
  }
  for (const id of delta.added)
    if (!claimIds.has(id)) findings.push({ code: "MISSING_ADDED_CLAIM", path: "claims",
      message: `added claim '${id}' is missing from claims` });
  // Removal is planned against the pre-amendment claims: they are the only
  // record of which providers once bound a claim that no longer exists.
  const priorRows = Array.isArray(priorClaims) ? priorClaims : null;
  const priorIds = new Set((priorRows || []).map((claim) => String(claim?.id || "").trim()));
  for (const id of delta.removed) {
    if (!priorRows) findings.push({ code: "REMOVED_CLAIM_HISTORY_REQUIRED",
      path: "coverageDelta.removedClaimIds",
      message: `removed claim '${id}' requires prior claim and provider bindings; ` +
        "removal cannot be planned from the post-amendment contract alone" });
    else if (!priorIds.has(id)) findings.push({ code: "UNKNOWN_REMOVED_CLAIM",
      path: "coverageDelta.removedClaimIds",
      message: `removed claim '${id}' is not in the prior agreement` });
    else if (claimIds.has(id)) findings.push({ code: "REMOVED_CLAIM_STILL_PRESENT",
      path: "coverageDelta.removedClaimIds",
      message: `removed claim '${id}' is still present after the amendment` });
  }

  const taskIds = new Set();
  const affectedTasks = [];
  const implemented = new Set();
  for (const [index, task] of taskRows.entries()) {
    const id = String(task?.id || "").trim();
    const bound = stringList(task?.claims);
    if (!id || taskIds.has(id)) findings.push({
      code: id ? "DUPLICATE_TASK" : "INVALID_TASK",
      path: `tasks[${index}].id`, message: id ? `duplicate task '${id}'` : "task requires an id"
    });
    else taskIds.add(id);
    if (!Array.isArray(task?.claims)) findings.push({ code: "MISSING_TASK_CLAIMS",
      path: `tasks[${index}].claims`, message: `task '${id || index}' requires claims` });
    for (const claimId of bound) {
      if (!claimIds.has(claimId)) findings.push({ code: "UNKNOWN_TASK_CLAIM",
        path: `tasks[${index}].claims`,
        message: `task '${id || index}' references unknown claim '${claimId}'` });
      if (direct.has(claimId) && !removed.has(claimId)) implemented.add(claimId);
    }
    if (bound.some((claimId) => direct.has(claimId))) affectedTasks.push(id);
  }
  for (const id of direct)
    if (!removed.has(id) && claimIds.has(id) && !implemented.has(id))
      findings.push({ code: "UNIMPLEMENTED_AFFECTED_CLAIM", path: "tasks",
        message: `affected claim '${id}' has no task binding` });

  const providerIds = new Set();
  const providerClaims = new Map();
  for (const [index, provider] of providersNormalized.entries()) {
    const id = String(provider?.id || "").trim();
    const capability = String(provider?.capability || "").trim();
    if (!id || providerIds.has(id)) findings.push({
      code: id ? "DUPLICATE_PROVIDER" : "INVALID_PROVIDER",
      path: `providers[${index}].id`,
      message: id ? `duplicate provider '${id}'` : "provider requires an id"
    });
    else providerIds.add(id);
    if (!capability) findings.push({ code: "UNRESOLVED_PROVIDER_CAPABILITY",
      path: `providers[${index}].capability`,
      message: `provider '${id || index}' requires a resolved capability` });
    if (provider?.claims !== undefined && !Array.isArray(provider.claims))
      findings.push({ code: "INVALID_PROVIDER_CLAIMS",
        path: `providers[${index}].claims`,
        message: `provider '${id || index}' claims must be an array` });
    const bound = claimIdsForProvider(provider, claimRows);
    providerClaims.set(id, bound);
    for (const claimId of bound)
      if (!claimIds.has(claimId)) findings.push({ code: "UNKNOWN_PROVIDER_CLAIM",
        path: `providers[${index}].claims`,
        message: `provider '${id || index}' references unknown claim '${claimId}'` });
    for (const dependency of stringList(provider?.dependsOn))
      if (!providersNormalized.some((candidate) => candidate.id === dependency))
        findings.push({ code: "UNKNOWN_PROVIDER_DEPENDENCY",
          path: `providers[${index}].dependsOn`,
          message: `provider '${id || index}' depends on unknown provider '${dependency}'` });
  }

  // A removed claim may already be gone from an explicit provider claim list,
  // so its prior capability binding is matched conservatively as well.
  const removedPriorClaims = (priorRows || []).filter((claim) =>
    removed.has(String(claim?.id || "").trim()));
  const providerSeeds = providersNormalized.filter((provider) =>
    WHOLE_PACKET_CAPABILITIES.has(provider.capability) ||
    (providerClaims.get(provider.id) || []).some((id) => direct.has(id)) ||
    claimIdsForProvider({ capability: provider.capability }, removedPriorClaims).length > 0)
    .map((provider) => provider.id);
  const affectedProviderSet = propagateProviders(providersNormalized, providerSeeds);
  const affectedProviders = sortedUnique([...affectedProviderSet]);
  const preservedProviders = sortedUnique(providersNormalized
    .map((provider) => provider.id).filter((id) => id && !affectedProviderSet.has(id)));
  const affectedClaims = sortedUnique([...direct]);
  const dimensions = sortedUnique(delta.rows.map((row) => row?.dimension).filter(Boolean));
  const invalidate = direct.size > 0;

  return {
    version: 1,
    status: findings.length ? "BLOCKED" : "READY",
    findings: findings.sort((left, right) =>
      `${left.path}\0${left.code}\0${left.message}`.localeCompare(
        `${right.path}\0${right.code}\0${right.message}`)),
    affectedClaims,
    affectedTasks: sortedUnique(affectedTasks.filter(Boolean)),
    affectedProviders,
    preservedProviders,
    approval: {
      invalidate,
      reasons: invalidate ? ["semantic-coverage-changed"] : []
    },
    proof: {
      invalidate,
      reasons: invalidate ? ["agreement-revision-changed"] : [],
      invalidateReceipts: affectedProviders,
      preserveReceipts: preservedProviders
    },
    coverage: { global: globalCoverageChange, dimensions }
  };
}
