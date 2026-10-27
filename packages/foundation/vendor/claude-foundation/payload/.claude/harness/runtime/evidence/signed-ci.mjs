import { verifySignedPayload } from "../core/trust.mjs";

export function signedCiShapeReason(envelope, protocolVersion) {
  const payload = envelope?.payload;
  return String(envelope?.version) !== protocolVersion || !payload ||
    typeof envelope.signature !== "string"
    ? "CI evidence envelope is malformed" : null;
}

export function signedCiWorkspaceReason(payload, {
  protocolVersion, changeId, provider, workspaceHash
}) {
  return String(payload.version) !== protocolVersion || payload.changeId !== changeId ||
    payload.provider !== provider || payload.workspaceHash !== workspaceHash
    ? "CI evidence does not match the provider workspace" : null;
}

export function signedCiRunReason(payload, head) {
  if (!["pass", "fail", "pending", "error"].includes(payload.status))
    return "CI evidence status must be pass|fail|pending|error";
  if (payload.commit && head && payload.commit !== head)
    return `CI commit '${payload.commit}' does not match provider workspace HEAD '${head}'`;
  if (!payload.runUrl || !/^https?:\/\//.test(payload.runUrl))
    return "CI evidence requires an http(s) runUrl";
  return null;
}

export function signedCiArtifactReason(payload, artifacts) {
  if (payload.status === "pass" && !artifacts.length)
    return "passing CI evidence requires at least one signed artifact digest";
  for (const artifact of artifacts)
    if (!artifact || !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || "")) ||
        !String(artifact.name || "").trim())
      return "CI artifact entries require name and SHA-256 digest";
  return null;
}

export function validateSignedCiEnvelope({
  envelope, protocolVersion, issuer, publicKey, changeId, provider,
  workspaceHash, head = null
}) {
  const payload = envelope?.payload;
  const shapeReason = signedCiShapeReason(envelope, protocolVersion);
  if (shapeReason) return { valid: false, reason: shapeReason };
  if (payload.issuer !== issuer)
    return { valid: false, reason: "CI evidence issuer does not match provider configuration" };
  if (!verifySignedPayload(payload, envelope.signature, publicKey))
    return { valid: false, reason: "CI evidence signature is invalid" };
  const workspaceReason = signedCiWorkspaceReason(payload, {
    protocolVersion, changeId, provider, workspaceHash
  });
  if (workspaceReason) return { valid: false, reason: workspaceReason };
  const runReason = signedCiRunReason(payload, head);
  if (runReason) return { valid: false, reason: runReason };
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const artifactReason = signedCiArtifactReason(payload, artifacts);
  if (artifactReason) return { valid: false, reason: artifactReason };
  return {
    valid: true,
    payload,
    artifacts,
    status: payload.status === "pending" ? "inconclusive" : payload.status
  };
}
