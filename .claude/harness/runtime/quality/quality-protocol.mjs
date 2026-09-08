import { createHash } from "node:crypto";

export const QUALITY_PROTOCOLS = Object.freeze({
  capabilities: "foundation-quality-capabilities-v1",
  crap: "foundation-crap-v1",
  automatedMutation: "foundation-automated-mutation-v1",
  semanticMutation: "foundation-mutation-v2"
});

export const CAPABILITY_STATES = new Set([
  "available", "unsupported", "unavailable", "unmapped", "not-applicable", "failed"
]);

export const MUTANT_STATES = new Set([
  "killed", "survived", "no-coverage", "timeout", "compile-error",
  "runtime-error", "ignored-equivalent", "unavailable"
]);

export const MUTANT_SURFACES = new Set([
  "changed-relevant", "dependency-relevant", "legacy-unrelated",
  "semantic-required", "unknown"
]);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function configDigest(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function crapScore(complexity, coveragePercent) {
  if (!Number.isFinite(complexity) || complexity < 1)
    throw new Error("complexity must be a finite number >= 1");
  if (!Number.isFinite(coveragePercent) || coveragePercent < 0 || coveragePercent > 100)
    throw new Error("coveragePercent must be between 0 and 100");
  const uncovered = 1 - coveragePercent / 100;
  return complexity ** 2 * uncovered ** 3 + complexity;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function assertTool(tool) {
  assertObject(tool, "tool");
  for (const field of ["name", "version", "adapterVersion", "configDigest"])
    assertString(tool[field], `tool.${field}`);
  if (!/^sha256:[0-9a-f]{64}$/.test(tool.configDigest))
    throw new Error("tool.configDigest must be a sha256 digest");
}

function assertEvidenceBinding(report) {
  if (report.repositoryCommit !== null) assertString(report.repositoryCommit, "repositoryCommit");
  assertString(report.workspaceDigest, "workspaceDigest");
  if (!/^sha256:[0-9a-f]{64}$/.test(report.workspaceDigest))
    throw new Error("workspaceDigest must be a sha256 digest");
}

export function validateCapabilityReport(report) {
  assertObject(report, "quality capability report");
  if (report.protocol !== QUALITY_PROTOCOLS.capabilities)
    throw new Error(`quality capability report requires protocol '${QUALITY_PROTOCOLS.capabilities}'`);
  assertString(report.repository, "repository");
  if (!Array.isArray(report.languages) || !Array.isArray(report.profiles))
    throw new Error("quality capability report requires languages and profiles arrays");
  assertObject(report.capabilities, "capabilities");
  for (const [name, capability] of Object.entries(report.capabilities)) {
    assertObject(capability, `capability '${name}'`);
    if (!CAPABILITY_STATES.has(capability.status))
      throw new Error(`capability '${name}' has invalid status '${capability.status}'`);
    if (capability.status !== "available" && !capability.reason)
      throw new Error(`capability '${name}' status '${capability.status}' requires a reason`);
  }
  return report;
}

export function normalizeCrapReport(report) {
  assertObject(report, "CRAP report");
  if (report.protocol !== QUALITY_PROTOCOLS.crap)
    throw new Error(`CRAP report requires protocol '${QUALITY_PROTOCOLS.crap}'`);
  assertString(report.repository, "repository");
  assertString(report.language, "language");
  assertEvidenceBinding(report);
  assertTool(report.tool);
  if (!Array.isArray(report.functions)) throw new Error("CRAP report requires a functions array");
  const seen = new Set();
  const functions = report.functions.map((fn, index) => {
    assertObject(fn, `functions[${index}]`);
    for (const field of ["id", "path", "mapping"]) assertString(fn[field], `functions[${index}].${field}`);
    const key = `${fn.path}\0${fn.id}\0${fn.line}`;
    if (seen.has(key)) throw new Error(`duplicate CRAP function '${fn.id}' at ${fn.path}:${fn.line}`);
    seen.add(key);
    if (!Number.isFinite(fn.complexity) || fn.complexity < 1)
      throw new Error(`functions[${index}].complexity must be >= 1`);
    const unavailable = fn.coveragePercent === null;
    if (!unavailable && (!Number.isFinite(fn.coveragePercent) || fn.coveragePercent < 0 || fn.coveragePercent > 100))
      throw new Error(`functions[${index}].coveragePercent must be null or 0..100`);
    const score = unavailable ? null : Number(crapScore(fn.complexity, fn.coveragePercent).toFixed(2));
    if (unavailable && fn.mapping !== "unmapped")
      throw new Error(`functions[${index}] missing coverage must use mapping 'unmapped'`);
    return { ...fn, crap: score };
  });
  return { ...report, functions };
}

export function normalizeMutationReport(report) {
  assertObject(report, "automated mutation report");
  if (report.protocol !== QUALITY_PROTOCOLS.automatedMutation)
    throw new Error(`automated mutation report requires protocol '${QUALITY_PROTOCOLS.automatedMutation}'`);
  assertString(report.repository, "repository");
  assertString(report.language, "language");
  assertEvidenceBinding(report);
  assertTool(report.tool);
  if (!Array.isArray(report.mutants)) throw new Error("automated mutation report requires a mutants array");
  const seen = new Set();
  const mutants = report.mutants.map((mutant, index) => {
    assertObject(mutant, `mutants[${index}]`);
    for (const field of ["id", "path", "operator"])
      assertString(mutant[field], `mutants[${index}].${field}`);
    if (seen.has(mutant.id)) throw new Error(`duplicate mutant id '${mutant.id}'`);
    seen.add(mutant.id);
    if (!MUTANT_STATES.has(mutant.status))
      throw new Error(`mutant '${mutant.id}' has invalid status '${mutant.status}'`);
    if (!MUTANT_SURFACES.has(mutant.changedSurface))
      throw new Error(`mutant '${mutant.id}' has invalid changedSurface '${mutant.changedSurface}'`);
    if (!Array.isArray(mutant.killedBy)) throw new Error(`mutant '${mutant.id}' requires killedBy array`);
    if (mutant.status !== "killed" && mutant.killedBy.length)
      throw new Error(`mutant '${mutant.id}' is not killed but declares killers`);
    if (mutant.status === "ignored-equivalent" &&
        (typeof mutant.reason !== "string" || !mutant.reason.trim()))
      throw new Error(`equivalent mutant '${mutant.id}' requires a reason`);
    return mutant;
  });
  return { ...report, mutants };
}

export function mutationSummary(report, { includeLegacy = false } = {}) {
  const eligible = report.mutants.filter((mutant) => includeLegacy || mutant.changedSurface !== "legacy-unrelated");
  const count = (status) => eligible.filter((mutant) => mutant.status === status).length;
  const killed = count("killed");
  const survived = count("survived");
  const noCoverage = count("no-coverage");
  const timeout = count("timeout");
  const compileError = count("compile-error");
  const runtimeError = count("runtime-error");
  const unavailable = count("unavailable");
  const denominator = killed + survived + noCoverage + timeout + compileError + runtimeError + unavailable;
  return {
    total: eligible.length,
    killed,
    survived,
    noCoverage,
    timeout,
    compileError,
    runtimeError,
    unavailable,
    score: denominator ? Number((killed / denominator * 100).toFixed(2)) : null
  };
}
