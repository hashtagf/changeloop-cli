import { createHash } from "node:crypto";
import { canonicalJson, verifySignedPayload } from "../core/trust.mjs";

export const SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION = "1";

export function semanticAcceptanceCases(config) {
  return [...(config?.acceptanceCases || [])].map((row) => ({
    id: String(row.id || "").trim(),
    claimId: String(row.claimId || "").trim(),
    partition: String(row.partition || "").trim(),
    required: row.required !== false,
    requiresFailToPass: row.requiresFailToPass === true,
    sourceProvider: row.sourceProvider || null,
    criticalCaseId: row.criticalCaseId || null
  })).sort((left, right) => left.id.localeCompare(right.id));
}

export function validateSemanticAcceptanceEnvelope({
  envelope, config, changeId, provider, workspaceHash
}) {
  const payload = envelope?.payload;
  if (String(envelope?.version) !== SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION ||
      !payload || typeof envelope.signature !== "string")
    return { valid: false, reason: "semantic acceptance envelope is malformed" };
  if (String(payload.version) !== SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION ||
      payload.changeId !== changeId || payload.provider !== provider ||
      payload.workspaceHash !== workspaceHash)
    return { valid: false, reason: "semantic acceptance verdict does not match the provider workspace" };
  if (payload.issuer !== config?.semanticAcceptance?.issuer)
    return { valid: false, reason: "semantic acceptance issuer does not match provider configuration" };
  if (!verifySignedPayload(payload, envelope.signature,
    config?.semanticAcceptance?.publicKey))
    return { valid: false, reason: "semantic acceptance signature is invalid" };
  if (!Array.isArray(payload.cases))
    return { valid: false, reason: "semantic acceptance verdict requires case results" };
  const expected = semanticAcceptanceCases(config);
  const byId = new Map();
  for (const row of payload.cases) {
    const id = String(row?.id || "").trim();
    if (!id || byId.has(id))
      return { valid: false, reason: "semantic acceptance case IDs must be non-empty and unique" };
    if (!["pass", "fail", "skipped", "error"].includes(row.status))
      return { valid: false, reason: `semantic acceptance case '${id}' has an invalid status` };
    if (!/^[a-f0-9]{64}$/i.test(String(row.observationDigest || "")))
      return { valid: false, reason: `semantic acceptance case '${id}' requires an observation digest` };
    byId.set(id, row);
  }
  const unknown = [...byId.keys()].filter((id) => !expected.some((row) => row.id === id));
  if (unknown.length)
    return { valid: false, reason: `semantic acceptance verdict contains undeclared case(s): ${unknown.join(", ")}` };
  for (const declared of expected) {
    const actual = byId.get(declared.id);
    if (!actual && declared.required)
      return { valid: false, reason: `semantic acceptance is missing required case '${declared.id}'` };
    if (!actual) continue;
    if (actual.claimId !== declared.claimId || actual.partition !== declared.partition)
      return { valid: false, reason: `semantic acceptance case '${declared.id}' does not match its declared claim/partition` };
    if (declared.requiresFailToPass &&
        !(actual.transition?.beforeStatus === "fail" &&
          actual.transition?.afterStatus === "pass" &&
          /^[a-f0-9]{64}$/i.test(String(actual.transition?.beforeDigest || "")) &&
          /^[a-f0-9]{64}$/i.test(String(actual.transition?.afterDigest || ""))))
      return { valid: false, reason: `semantic acceptance case '${declared.id}' requires content-bound FAIL-to-PASS evidence` };
  }
  const cases = [...byId.values()].map((row) => ({
    id: row.id,
    claimId: row.claimId,
    partition: row.partition,
    status: row.status,
    observationDigest: row.observationDigest,
    ...(row.transition ? { transition: {
      beforeStatus: row.transition.beforeStatus,
      afterStatus: row.transition.afterStatus,
      beforeDigest: row.transition.beforeDigest,
      afterDigest: row.transition.afterDigest
    } } : {})
  })).sort((left, right) => left.id.localeCompare(right.id));
  const verdictDigest = createHash("sha256").update(canonicalJson({
    version: SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION,
    changeId, provider, workspaceHash, issuer: payload.issuer, cases
  })).digest("hex");
  return {
    valid: true,
    status: cases.some((row) => row.status === "fail") ? "fail"
      : cases.some((row) => row.status === "error") ? "error"
        : cases.some((row) => row.status === "skipped") ? "inconclusive" : "pass",
    issuer: payload.issuer,
    cases,
    verdictDigest,
    payload,
    signature: envelope.signature
  };
}
