import { verifySignedPayload } from "../core/trust.mjs";

export function validateSignedCiEnvelope({
  envelope, protocolVersion, issuer, publicKey, changeId, provider,
  workspaceHash, head = null
}) {
  const payload = envelope?.payload;
  if (String(envelope?.version) !== protocolVersion || !payload ||
      typeof envelope.signature !== "string")
    return { valid: false, reason: "CI evidence envelope is malformed" };
  if (payload.issuer !== issuer)
    return { valid: false, reason: "CI evidence issuer does not match provider configuration" };
  if (!verifySignedPayload(payload, envelope.signature, publicKey))
    return { valid: false, reason: "CI evidence signature is invalid" };
  if (String(payload.version) !== protocolVersion || payload.changeId !== changeId ||
      payload.provider !== provider || payload.workspaceHash !== workspaceHash)
    return { valid: false, reason: "CI evidence does not match the provider workspace" };
  if (!["pass", "fail", "pending", "error"].includes(payload.status))
    return { valid: false, reason: "CI evidence status must be pass|fail|pending|error" };
  if (payload.commit && head && payload.commit !== head)
    return {
      valid: false,
      reason: `CI commit '${payload.commit}' does not match provider workspace HEAD '${head}'`
    };
  if (!payload.runUrl || !/^https?:\/\//.test(payload.runUrl))
    return { valid: false, reason: "CI evidence requires an http(s) runUrl" };
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  if (payload.status === "pass" && !artifacts.length)
    return {
      valid: false,
      reason: "passing CI evidence requires at least one signed artifact digest"
    };
  for (const artifact of artifacts)
    if (!artifact || !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || "")) ||
        !String(artifact.name || "").trim())
      return {
        valid: false,
        reason: "CI artifact entries require name and SHA-256 digest"
      };
  return {
    valid: true,
    payload,
    artifacts,
    status: payload.status === "pending" ? "inconclusive" : payload.status
  };
}
