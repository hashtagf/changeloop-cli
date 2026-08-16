import { existsSync } from "node:fs";
import { join } from "node:path";
import { acquireProcessLock } from "../core/process-lock.mjs";

const TIMINGS = new Set(["pre-land", "post-land"]);
const ACTIVATIONS = new Set(["safe-before-activation", "activation-coupled"]);
const EVIDENCE_TYPES = new Set([
  "tracking-reference", "apply-result", "deployment-health",
  "secret-reference", "operator-attestation"
]);
const RECORD_STATUSES = new Set(["accepted", "completed", "rejected"]);
const SECRET_FIELD = /(?:password|passwd|privatekey|secretvalue|credential|accesstoken|refreshtoken|apikey|accesskey|secretkey)$/i;
const SECRET_VALUE = /(?:AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{16,}|https?:\/\/[^\s/:@]+:[^\s@]+@)/i;

function cleanString(value) {
  return String(value || "").trim();
}

function safeId(value, pattern, label, fail) {
  const id = cleanString(value).toUpperCase();
  if (!pattern.test(id)) fail(`${label} must match ${pattern}`);
  return id;
}

function assertNoSecretMaterial(value, label, fail, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSecretMaterial(entry, label, fail, [...path, String(index)]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_FIELD.test(key.replace(/[^a-z0-9]/gi, "")))
        fail(`${label} cannot contain secret-valued field '${[...path, key].join(".")}'`);
      assertNoSecretMaterial(entry, label, fail, [...path, key]);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE.test(value))
    fail(`${label} appears to contain credential material at '${path.join(".") || "value"}'`);
}

export function createHandoffRuntime({
  root,
  handoffsRoot,
  activeChangePath,
  loadRuntime,
  readJson,
  writeJson,
  stableHash,
  now,
  fail
}) {
  function contractPath(id, state = loadRuntime(id)) {
    return join(activeChangePath(id, state), "handoffs.yaml");
  }

  function recordPath(id, operationId) {
    return join(handoffsRoot, id, `${operationId}.json`);
  }

  function normalizeOperation(raw, index, context = {}) {
    const label = `${context.id || "change"}/handoffs.yaml operations[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      fail(`${label} must be an object`);
    assertNoSecretMaterial(raw, label, fail);
    const id = safeId(raw.id, /^H\d{3,}$/, `${label}.id`, fail);
    const string = (name) => {
      const value = cleanString(raw[name]);
      if (!value) fail(`${label}.${name} is required`);
      if (value.length > 1000) fail(`${label}.${name} is too long`);
      return value;
    };
    const timing = string("timing");
    if (!TIMINGS.has(timing)) fail(`${label}.timing must be pre-land|post-land`);
    const activation = string("activation");
    if (!ACTIVATIONS.has(activation))
      fail(`${label}.activation must be safe-before-activation|activation-coupled`);
    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0 ||
        raw.evidence.some((entry) => !EVIDENCE_TYPES.has(entry)))
      fail(`${label}.evidence must contain supported evidence types`);
    const claimIds = [...new Set(raw.claimIds || [])].sort();
    const taskIds = [...new Set((raw.taskIds || []).map((value) =>
      cleanString(value).toUpperCase()))].sort();
    if (!claimIds.length) fail(`${label}.claimIds must be non-empty`);
    if (claimIds.some((value) => !cleanString(value)))
      fail(`${label}.claimIds must contain non-empty strings`);
    if (taskIds.some((value) => !/^T\d{3,}$/.test(value)))
      fail(`${label}.taskIds must contain stable task IDs`);
    const activationProof = raw.activationProof || null;
    if (activation === "safe-before-activation") {
      if (!activationProof || typeof activationProof !== "object" ||
          !cleanString(activationProof.claimId) || !cleanString(activationProof.condition))
        fail(`${label}.activationProof requires claimId and condition for safe-before-activation`);
      if (!claimIds.includes(cleanString(activationProof.claimId)))
        fail(`${label}.activationProof.claimId must be listed in claimIds`);
    } else if (activationProof !== null)
      fail(`${label}.activationProof is only valid for safe-before-activation`);
    if (context.claimIds) {
      const unknown = claimIds.filter((value) => !context.claimIds.has(value));
      if (unknown.length) fail(`${label} references unknown claim(s): ${unknown.join(", ")}`);
    }
    if (context.taskIds) {
      const unknown = taskIds.filter((value) => !context.taskIds.has(value));
      if (unknown.length) fail(`${label} references unknown task(s): ${unknown.join(", ")}`);
    }
    const operation = {
      id,
      owner: string("owner"),
      environment: string("environment"),
      authority: string("authority"),
      operation: string("operation"),
      timing,
      activation,
      evidence: [...new Set(raw.evidence)].sort(),
      runbook: string("runbook"),
      rollback: string("rollback"),
      claimIds,
      taskIds,
      ...(activationProof ? {
        activationProof: {
          claimId: cleanString(activationProof.claimId),
          condition: cleanString(activationProof.condition)
        }
      } : {})
    };
    return operation;
  }

  function handoffContract(id, options = {}) {
    const state = options.state || loadRuntime(id);
    const path = contractPath(id, state);
    if (!existsSync(path)) return { version: 1, operations: [], present: false, path };
    const value = readJson(path);
    if (!value || value.version !== 1 || !Array.isArray(value.operations))
      fail(`${id}/handoffs.yaml requires version 1 and an operations array`);
    assertNoSecretMaterial(value, `${id}/handoffs.yaml`, fail);
    const operations = value.operations.map((row, index) =>
      normalizeOperation(row, index, { id, ...options }));
    const duplicates = operations.map((row) => row.id)
      .filter((value, index, all) => all.indexOf(value) !== index);
    if (duplicates.length)
      fail(`${id}/handoffs.yaml has duplicate operation id(s): ${[...new Set(duplicates)].join(", ")}`);
    return { version: 1, operations, present: true, path };
  }

  function operationDigest(operation) {
    return stableHash({ version: 1, operation });
  }

  function readRecord(id, operation) {
    const path = recordPath(id, operation.id);
    const record = existsSync(path) ? readJson(path, {}) : null;
    if (!record) return { validity: "missing", status: "pending", record: null };
    if (record.version !== 1 || record.changeId !== id ||
        record.operationId !== operation.id)
      return { validity: "invalid", status: record.status || "invalid", record };
    if (record.operationDigest !== operationDigest(operation))
      return { validity: "stale", status: record.status || "stale", record };
    if (!RECORD_STATUSES.has(record.status) || !cleanString(record.actor) ||
        !cleanString(record.reference))
      return { validity: "invalid", status: record.status || "invalid", record };
    if (record.status === "completed" &&
        (!Array.isArray(record.evidenceReferences) || !record.evidenceReferences.length))
      return { validity: "invalid", status: record.status, record };
    if (record.status === "rejected" && !cleanString(record.reason))
      return { validity: "invalid", status: record.status, record };
    return { validity: "valid", status: record.status, record };
  }

  function handoffReadiness(id, options = {}) {
    const contract = handoffContract(id, options);
    const operations = contract.operations.map((operation) => {
      const check = readRecord(id, operation);
      const safeTracked = operation.timing === "post-land" &&
        operation.activation === "safe-before-activation" &&
        check.validity === "valid" && check.status === "accepted";
      const completed = check.validity === "valid" && check.status === "completed";
      return {
        ...operation,
        operationDigest: operationDigest(operation),
        status: check.status,
        validity: check.validity,
        actor: check.record?.actor || null,
        reference: check.record?.reference || null,
        evidenceReferences: check.record?.evidenceReferences || [],
        landBlocking: !(completed || safeTracked),
        landDisposition: completed ? "completed"
          : safeTracked ? "tracked-post-land" : "waiting-external"
      };
    });
    const blocking = operations.filter((row) => row.landBlocking);
    const tracked = operations.filter((row) => row.landDisposition === "tracked-post-land");
    return {
      version: 1,
      changeId: id,
      status: blocking.length ? "WAITING_EXTERNAL"
        : tracked.length ? "READY_WITH_TRACKED_HANDOFF" : "COMPLETE",
      operations,
      blocking: blocking.map((row) => row.id),
      tracked: tracked.map((row) => row.id)
    };
  }

  function withLock(id, callback) {
    const lock = acquireProcessLock(
      join(handoffsRoot, id, ".mutation.lock"), { now });
    if (!lock.acquired)
      fail(`handoff mutation already active for '${id}' (pid ${lock.owner?.pid || "unknown"})`);
    try { return callback(); }
    finally { lock.release(); }
  }

  function recordHandoff(id, flags = {}) {
    return withLock(id, () => {
      const contract = handoffContract(id);
      const operationId = cleanString(flags.id).toUpperCase();
      const operation = contract.operations.find((row) => row.id === operationId);
      if (!operation) fail(`unknown handoff operation '${operationId || "(missing)"}'`);
      const status = cleanString(flags.status);
      if (!RECORD_STATUSES.has(status))
        fail("handoff record --status must be accepted|completed|rejected");
      const actor = cleanString(flags.actor);
      const reference = cleanString(flags.reference);
      const reason = cleanString(flags.reason);
      const evidenceReferences = cleanString(flags.evidence).split(",")
        .map((value) => value.trim()).filter(Boolean);
      if (!actor || !reference)
        fail("handoff record requires --actor <named-operator> and --reference <tracking-reference>");
      if (status === "completed" && !evidenceReferences.length)
        fail("completed handoff requires --evidence <reference[,reference]>");
      if (status === "rejected" && !reason)
        fail("rejected handoff requires --reason <why>");
      const material = { actor, reference, reason, evidenceReferences };
      assertNoSecretMaterial(material, `${id}/${operationId} handoff record`, fail);
      const previousPath = recordPath(id, operation.id);
      const previous = existsSync(previousPath) ? readJson(previousPath, {}) : {};
      if (previous.operationDigest === operationDigest(operation) &&
          previous.status === "completed" && status !== "completed")
        fail(`completed handoff '${operation.id}' cannot be downgraded`);
      const event = {
        status, actor, reference,
        evidenceReferences: status === "completed" ? evidenceReferences : [],
        reason: status === "rejected" ? reason : null,
        recordedAt: now()
      };
      const record = {
        version: 1,
        changeId: id,
        operationId: operation.id,
        operationDigest: operationDigest(operation),
        contractRevision: Number(loadRuntime(id).contractRevision || 0),
        ...event,
        history: [...(previous.history || []), event].slice(-50)
      };
      writeJson(previousPath, record);
      console.log(`HANDOFF ${operation.id} ${status.toUpperCase()}\n  owner: ${operation.owner}\n  actor: ${actor}\n  reference: ${reference}\n  next: claude-foundation handoff status ${id}`);
      return record;
    });
  }

  function handoffPacketValue(id, operationId = null) {
    const readiness = handoffReadiness(id);
    const selected = operationId
      ? readiness.operations.filter((row) => row.id === cleanString(operationId).toUpperCase())
      : readiness.operations;
    if (operationId && !selected.length) fail(`unknown handoff operation '${operationId}'`);
    return {
      version: 1,
      packetType: "external-operation-handoff",
      changeId: id,
      status: readiness.status,
      operations: selected.map((row) => ({
        id: row.id,
        owner: row.owner,
        environment: row.environment,
        authority: row.authority,
        operation: row.operation,
        timing: row.timing,
        activation: row.activation,
        evidence: row.evidence,
        runbook: row.runbook,
        rollback: row.rollback,
        activationProof: row.activationProof || null,
        claimIds: row.claimIds,
        taskIds: row.taskIds,
        status: row.status,
        validity: row.validity,
        reference: row.reference,
        next: row.status === "completed" && row.validity === "valid" ? null
          : `claude-foundation handoff record ${id} --id ${row.id} --status accepted|completed|rejected --actor <name> --reference <ticket-or-run> [--evidence <reference>]`
      }))
    };
  }

  function showHandoffPacket(id, flags = {}) {
    console.log(JSON.stringify(handoffPacketValue(id, flags.id || null), null, 2));
  }

  function showHandoffStatus(id) {
    console.log(JSON.stringify(handoffReadiness(id), null, 2));
  }

  return {
    handoffContract,
    operationDigest,
    handoffReadiness,
    handoffPacketValue,
    showHandoffPacket,
    showHandoffStatus,
    recordHandoff
  };
}
