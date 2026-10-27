import { verify as verifySignature } from "node:crypto";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function verifySignedPayload(payload, signature, publicKey) {
  if (!payload || typeof signature !== "string" || typeof publicKey !== "string")
    return false;
  try {
    return verifySignature(null, Buffer.from(canonicalJson(payload)),
      publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
