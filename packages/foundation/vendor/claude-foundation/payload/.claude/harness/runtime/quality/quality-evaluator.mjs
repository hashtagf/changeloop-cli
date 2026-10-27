import { mutationSummary } from "./quality-protocol.mjs";

function functionKey(fn) { return `${fn.path}\0${fn.id}`; }

export function compatibleQualityBaseline(current, baseline) {
  if (!baseline) return false;
  return current.repository === baseline.repository && current.language === baseline.language &&
    current.tool?.name === baseline.tool?.name &&
    current.tool?.version === baseline.tool?.version &&
    current.tool?.adapterVersion === baseline.tool?.adapterVersion &&
    current.tool?.configDigest === baseline.tool?.configDigest;
}

export function globToRegExp(glob) {
  let out = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") { out += "(?:.*/)?"; index += 2; }
        else { out += ".*"; index += 1; }
      } else out += "[^/]*";
    } else if (character === "?") out += "[^/]";
    else out += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export function pathMatches(path, patterns = []) {
  return patterns.some((pattern) => globToRegExp(pattern.replace(/^\.\//, "")).test(path));
}

export function scopeViolations(changedPaths, { include = [], allowedSupportingChanges = [], exclude = [] }) {
  const allowed = [...include, ...allowedSupportingChanges];
  return changedPaths.filter((path) =>
    pathMatches(path, exclude) || !pathMatches(path, allowed));
}

function exceptionFor(exceptions, repository, target, metric, now = new Date()) {
  return exceptions.find((entry) => entry.repository === repository &&
    entry.target === target && entry.metric === metric &&
    (!entry.expires || new Date(`${entry.expires}T23:59:59.999Z`) >= now));
}

export function evaluateCrapRatchet({ current, baseline = null, changedPaths, policy, exceptions = [] }) {
  const baselineCompatible = compatibleQualityBaseline(current, baseline);
  const baseFunctions = new Map((baseline?.functions || []).map((fn) => [functionKey(fn), fn]));
  const changed = current.functions.filter((fn) => changedPaths.has(fn.path)).map((fn) => {
    const base = baseFunctions.get(functionKey(fn)) || null;
    const reasons = [];
    const target = `${fn.path}:${fn.id}`;
    const floorByClass = {
      unit: policy.coverage.unitChangedMinimum,
      integration: policy.coverage.integrationChangedMinimum,
      "critical-journey": policy.coverage.criticalJourneyMinimum
    };
    const coverageFloor = floorByClass[fn.coverageClass || "unit"];
    if (baseline && !baselineCompatible) reasons.push("quality baseline tool or configuration is incompatible");
    if (fn.coveragePercent === null && !exceptionFor(exceptions, current.repository, target, "coverage"))
      reasons.push("coverage is unmapped");
    if (fn.coveragePercent !== null && fn.coveragePercent < coverageFloor &&
        !exceptionFor(exceptions, current.repository, target, "coverage"))
      reasons.push(`${fn.coverageClass || "unit"} coverage ${fn.coveragePercent}% is below ${coverageFloor}%`);
    if (fn.complexity > policy.complexity.maximumChanged &&
        !exceptionFor(exceptions, current.repository, target, "complexity"))
      reasons.push(`complexity ${fn.complexity} exceeds ${policy.complexity.maximumChanged}`);
    if (!base && fn.crap !== null && fn.crap >= policy.crap.maximumNew &&
        !exceptionFor(exceptions, current.repository, target, "crap"))
      reasons.push(`new function CRAP ${fn.crap} is at or above ${policy.crap.maximumNew}`);
    if (base && policy.crap.rejectRegression && fn.crap !== null && base.crap !== null &&
        fn.crap > base.crap + 0.01 && !exceptionFor(exceptions, current.repository, target, "crap"))
      reasons.push(`CRAP regressed from ${base.crap} to ${fn.crap}`);
    return { ...fn, changeKind: base ? "existing" : baseline ? "new" : "unknown", baseline: base, reasons,
      status: reasons.length ? "fail" : "pass" };
  });
  return {
    repository: current.repository,
    baselineAvailable: Boolean(baseline),
    baselineCompatible,
    changedFunctions: changed,
    summary: { total: changed.length, pass: changed.filter((fn) => fn.status === "pass").length,
      fail: changed.filter((fn) => fn.status === "fail").length }
  };
}

export function classifyMutationSurfaces(report, changedPaths, dependencyPaths = new Set()) {
  return {
    ...report,
    mutants: report.mutants.map((mutant) => ({
      ...mutant,
      changedSurface: mutant.changedSurface === "semantic-required" ? "semantic-required" :
        changedPaths.has(mutant.path) ? "changed-relevant" :
          dependencyPaths.has(mutant.path) ? "dependency-relevant" : "legacy-unrelated"
    }))
  };
}

export function evaluateMutationRatchet({ current, baseline = null, policy, exceptions = [] }) {
  const effective = { ...current, mutants: current.mutants.map((mutant) =>
    exceptionFor(exceptions, current.repository, mutant.id, "mutation")
      ? { ...mutant, status: "ignored-equivalent", killedBy: [] } : mutant) };
  const currentSummary = mutationSummary(effective);
  const relevantPaths = new Set(effective.mutants.filter((mutant) =>
    ["changed-relevant", "dependency-relevant", "semantic-required"]
      .includes(mutant.changedSurface)).map((mutant) => mutant.path));
  const relevantIds = new Set(effective.mutants.filter((mutant) =>
    ["changed-relevant", "dependency-relevant", "semantic-required"]
      .includes(mutant.changedSurface)).map((mutant) => mutant.id));
  const scopedBaseline = baseline ? { ...baseline, mutants: baseline.mutants
    .filter((mutant) => relevantPaths.has(mutant.path) || relevantIds.has(mutant.id))
    .map((mutant) => ({ ...mutant, changedSurface: "changed-relevant" })) } : null;
  const baselineSummary = scopedBaseline ? mutationSummary(scopedBaseline) : null;
  const reasons = [];
  if (!baseline) reasons.push("mutation baseline is missing");
  else if (!compatibleQualityBaseline(current, baseline))
    reasons.push("mutation baseline tool or configuration is incompatible");
  if (baselineSummary && policy.mutation.rejectNewNoCoverage &&
      currentSummary.noCoverage > baselineSummary.noCoverage)
    reasons.push(`NoCoverage increased from ${baselineSummary.noCoverage} to ${currentSummary.noCoverage}`);
  if (baselineSummary && policy.mutation.rejectScoreRegression &&
      currentSummary.score !== null && baselineSummary.score !== null &&
      currentSummary.score + 0.005 < baselineSummary.score)
    reasons.push(`mutation score regressed from ${baselineSummary.score}% to ${currentSummary.score}%`);
  const targetApplies = !baselineSummary || baselineSummary.score === null ||
    baselineSummary.score >= policy.mutation.changedCodeTarget;
  if (targetApplies && currentSummary.score !== null &&
      currentSummary.score < policy.mutation.changedCodeTarget)
    reasons.push(`changed-code mutation score ${currentSummary.score}% is below ${
      policy.mutation.changedCodeTarget}%`);
  const semantic = effective.mutants.filter((mutant) =>
    mutant.changedSurface === "semantic-required" && mutant.status !== "ignored-equivalent");
  const semanticKilled = semantic.filter((mutant) => mutant.status === "killed").length;
  const semanticScore = semantic.length ? Number((semanticKilled / semantic.length * 100).toFixed(2)) : null;
  if (semanticScore !== null && semanticScore < policy.mutation.semanticKillRate)
    reasons.push(`semantic mutation kill rate ${semanticScore}% is below ${
      policy.mutation.semanticKillRate}%`);
  const baselineMutants = new Map((baseline?.mutants || []).map((mutant) => [mutant.id, mutant]));
  for (const mutant of effective.mutants.filter((item) =>
    ["changed-relevant", "dependency-relevant", "semantic-required"].includes(item.changedSurface))) {
    const previous = baselineMutants.get(mutant.id);
    if (mutant.changedSurface === "semantic-required") {
      if (previous?.status === "killed" && mutant.status !== "killed")
        reasons.push(`${mutant.id} regressed from killed to ${mutant.status}`);
    } else if (!previous && !["killed", "ignored-equivalent"].includes(mutant.status))
      reasons.push(`${mutant.id} is a new ${mutant.status} mutant on ${mutant.changedSurface}`);
    else if (previous?.status === "killed" && mutant.status !== "killed")
      reasons.push(`${mutant.id} regressed from killed to ${mutant.status}`);
  }
  return {
    repository: current.repository,
    baselineAvailable: Boolean(baseline),
    baselineCompatible: compatibleQualityBaseline(current, baseline),
    current: currentSummary,
    baseline: baselineSummary,
    semanticScore,
    status: reasons.length ? "fail" : "pass",
    reasons
  };
}

export function aggregateQualityLanes(lanes) {
  const required = lanes.filter((lane) => lane.required !== false);
  const failed = required.filter((lane) => lane.status === "fail");
  const unavailable = required.filter((lane) => lane.status === "unavailable");
  // Reduced assurance is an aggregate posture, not a blocking requirement.
  // A non-blocking unsupported lane must still prevent the summary from
  // claiming full assurance.
  const reduced = lanes.filter((lane) => String(lane.assurance || "").startsWith("reduced"));
  const status = failed.length ? "fail" : unavailable.length ? "unavailable" : reduced.length ? "reduced" : "pass";
  return {
    protocol: "foundation-quality-summary-v1", status, lanes,
    summary: { total: lanes.length, required: required.length, failed: failed.length,
      unavailable: unavailable.length, reduced: reduced.length }
  };
}
