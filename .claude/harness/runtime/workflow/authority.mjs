import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OPEN_STATUSES = new Set(["requested", "dispatched", "pending"]);
const RESPONSE_STATUSES = new Set(["pass", "fail", "inconclusive", "error"]);
const MULTI_VALUE_EVIDENCE = [
  "artifact", "artifacts", "reference", "criterion", "scope-path", "subject-provenance"
];

export function authorityResponseProblems(response, request, changeId, protocolVersion) {
  const problems = [];
  const expect = (field, actual, expected) => {
    if (actual !== expected)
      problems.push(`${field}: expected ${JSON.stringify(expected)}, ` +
        `got ${JSON.stringify(actual ?? null)}`);
  };
  expect("version", String(response?.version ?? ""), protocolVersion);
  expect("requestId", response?.requestId ?? null, request.requestId);
  expect("changeId", response?.changeId ?? null, changeId);
  expect("type", response?.type ?? null, request.type);
  expect("workspaceHash", response?.workspaceHash ?? null, request.workspaceHash);
  if (!RESPONSE_STATUSES.has(response?.status))
    problems.push(`status: expected one of ${[...RESPONSE_STATUSES].join("|")}, ` +
      `got ${JSON.stringify(response?.status ?? null)}`);
  return problems;
}

export function normalizeAuthorityEvidence(value) {
  const evidence = value && typeof value === "object" ? { ...value } : {};
  for (const key of MULTI_VALUE_EVIDENCE)
    if (evidence[key] !== undefined && !Array.isArray(evidence[key]))
      evidence[key] = [evidence[key]];
  return evidence;
}

export function validateAuthorityResponseOperation({ protocolVersion }, response, request, changeId) {
  const problems = authorityResponseProblems(response, request, changeId, protocolVersion);
  if (problems.length)
    return {
      valid: false,
      reason: `authority response does not match the request and workspace\n  ${
        problems.join("\n  ")}`
    };
  return {
    valid: true,
    status: response.status,
    evidence: normalizeAuthorityEvidence(response.evidence)
  };
}

function openAuthorityStatus(value, workspaceHash, expectedHashFor, now) {
  const expected = expectedHashFor ? expectedHashFor(value) : workspaceHash;
  if (value.workspaceHash !== expected) return "stale";
  if (Date.parse(value.expiresAt || "") <= now()) return "expired";
  return value.status;
}

function healedAuthorityStatus(value, expectedHashFor, now) {
  if (value.status !== "stale" || !expectedHashFor) return value.status;
  if (value.workspaceHash !== expectedHashFor(value)) return value.status;
  if (Date.parse(value.expiresAt || "") <= now()) return value.status;
  return "requested";
}

export function authorityStatusValue(entry, workspaceHash, expectedHashFor = null, now = Date.now) {
  const value = { ...entry.value };
  value.status = OPEN_STATUSES.has(value.status)
    ? openAuthorityStatus(value, workspaceHash, expectedHashFor, now)
    : healedAuthorityStatus(value, expectedHashFor, now);
  return value;
}

export function createAuthorityStore({ root, protocolVersion, readJson, writeJson, now }) {
  const requestRoot = (id) => join(root, id);

  function list(id) {
    const directory = requestRoot(id);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => ({
        path: join(directory, entry.name),
        value: readJson(join(directory, entry.name), {})
      }))
      .filter((entry) => String(entry.value.version) === protocolVersion)
      .sort((left, right) =>
        String(left.value.requestedAt).localeCompare(String(right.value.requestedAt)));
  }

  function writeRequest(id, request) {
    const path = join(requestRoot(id), `${request.requestId}.json`);
    writeJson(path, request);
    return path;
  }

  function replace(entry, request) {
    writeJson(entry.path, request);
    return request;
  }

  // `expectedHashFor` resolves the hash a given request is bound to: a
  // repository-scoped request carries its repository's hash, not the composite,
  // so comparing every request against the composite marked scoped requests
  // permanently stale the moment status was checked.
  function status(id, workspaceHash, requestId = null, expectedHashFor = null) {
    const rows = list(id)
      .filter((entry) => !requestId || entry.value.requestId === requestId)
      // Heal values in memory only. Status is deliberately side-effect free;
      // request transitions are serialized by the authority mutation lock.
      .map((entry) => authorityStatusValue(entry, workspaceHash, expectedHashFor));
    return {
      found: !requestId || rows.length > 0,
      value: {
        version: Number(protocolVersion), changeId: id, workspaceHash, requests: rows
      }
    };
  }

  const validateResponse = validateAuthorityResponseOperation.bind(null, { protocolVersion });

  function complete(entry, request, response, responseDigest, receiptDigest) {
    writeJson(entry.path, {
      ...request,
      status: response.status === "pass" ? "completed" : "rejected",
      responseDigest,
      receiptDigest,
      completedAt: now()
    });
  }

  return {
    list, writeRequest, replace, status, validateResponse, complete,
    isOpen: (statusValue) => OPEN_STATUSES.has(statusValue)
  };
}
