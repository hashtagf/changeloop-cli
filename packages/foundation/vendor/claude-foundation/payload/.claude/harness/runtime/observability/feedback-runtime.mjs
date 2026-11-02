import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { diagnosticExport } from "./diagnostic-export.mjs";

export const FEEDBACK_SCHEMA_VERSION = 4;

export function readinessProjection(packet) {
  const providers = Array.isArray(packet.providers) ? packet.providers :
    packet.providers?.preview || [];
  return {
    availability: "available",
    status: packet.status,
    delivered: packet.status === "archived",
    revision: packet.revision,
    contractRevision: packet.contractRevision,
    executionRevision: packet.executionRevision,
    workspaceHash: packet.compositeWorkspaceHash || packet.workspaceHash,
    pendingTaskCount: packet.pendingTaskCount,
    providers: providers.map(({ provider, status, validity }) => ({ provider, status, validity })),
    providersTruncated: !Array.isArray(packet.providers) &&
      Number(packet.providers?.count || 0) > providers.length,
    basis: packet.evidenceAvailability === "retained-archive"
      ? "retained-archive" : "current-runtime-receipt-validity"
  };
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function reviewRepairIntervals(operations = [], attempts = []) {
  const dated = (value) => timestamp(value) ?? Number.POSITIVE_INFINITY;
  const orderedOperations = [...operations].sort((left, right) =>
    dated(left.startedAt) - dated(right.startedAt));
  const orderedAttempts = [...attempts].sort((left, right) =>
    dated(left.completedAt || left.timestamp) - dated(right.completedAt || right.timestamp));
  return orderedAttempts.flatMap((attempt, index) => {
    if (attempt.status !== "completed" || attempt.resultStatus !== "fail") return [];
    const findingIds = (attempt.findings || [])
      .filter((finding) => ["blocker", "major"].includes(finding.severity))
      .map((finding) => finding.id).filter(Boolean).sort();
    if (!findingIds.length) return [];
    const laterChanged = orderedAttempts.slice(index + 1).find((candidate) =>
      candidate.status === "completed" && candidate.workspaceHash &&
      candidate.workspaceHash !== attempt.workspaceHash);
    if (!laterChanged) return [];
    const fromMs = timestamp(attempt.completedAt);
    const nextReviewMs = timestamp(laterChanged.timestamp);
    const resumed = orderedOperations.find((operation) =>
      ["advance", "proof-advance"].includes(operation.operation) &&
      timestamp(operation.startedAt) > fromMs &&
      (nextReviewMs === null || timestamp(operation.startedAt) <= nextReviewMs));
    const toMs = timestamp(resumed?.startedAt);
    if (fromMs === null || toMs === null || toMs <= fromMs) return [];
    return [{
      kind: "review-repair",
      from: attempt.completedAt,
      to: resumed.startedAt,
      durationMs: toMs - fromMs,
      sourceAttemptDigest: attempt.digest || null,
      findingIds,
      basis: "failed-review-to-proof-resume-with-later-changed-workspace"
    }];
  });
}

// Durations are intervals, not counters: nested operations and duplicate
// attempts must not count the same wall-clock time twice.
export function intervalDuration(intervals) {
  const ordered = intervals.map(({ from, to }) => [timestamp(from), timestamp(to)])
    .filter(([from, to]) => from !== null && to !== null && to >= from)
    .sort((left, right) => left[0] - right[0]);
  if (!ordered.length) return null;
  let total = 0;
  let [start, end] = ordered[0];
  for (const [from, to] of ordered.slice(1)) {
    if (from > end) { total += end - start; start = from; }
    end = Math.max(end, to);
  }
  return total + end - start;
}

function unattributedDuration(metrics, repairs, operations) {
  if (metrics.unattributedWaitMs === null || metrics.unattributedWaitMs === undefined)
    return null;
  // Historical totals without boundaries cannot be safely subtracted from
  // repair: the same human wait can be inside that repair interval.
  if (metrics.humanWaitMs > 0 && !metrics.humanWaitSpans?.length) return null;
  const attributed = [...repairs, ...(metrics.humanWaitSpans || [])];
  const active = operations.map((row) => ({ from: row.startedAt, to: row.finishedAt }))
    .filter((row) => timestamp(row.from) !== null && timestamp(row.to) !== null);
  const outsideActive = (intervalDuration([...active, ...attributed]) ?? 0) -
    (intervalDuration(active) ?? 0);
  return Math.max(0, metrics.unattributedWaitMs - outsideActive);
}

export function operationCauseCoverage(operations = []) {
  const blocked = operations.filter((row) => row.status === "blocked");
  return {
    blocked: blocked.length,
    typed: blocked.filter((row) => row.blocker?.code).length,
    legacyUnavailable: blocked.filter((row) =>
      Number(row.version || 0) < 3 && !row.blocker?.code).length,
    untypedCurrent: blocked.filter((row) =>
      Number(row.version || 0) >= 3 && !row.blocker?.code).length
  };
}

export function feedbackSnapshotValue({
  changeId, metrics, operations = [], inspections = [], reviewAttempts = [], nextAction,
  readiness = null, observedAt = null
}) {
  const repairIntervals = reviewRepairIntervals(operations, reviewAttempts);
  const repairMs = intervalDuration(repairIntervals);
  const reviewDurations = reviewAttempts.flatMap((row) => {
    const from = timestamp(row.timestamp);
    const to = timestamp(row.completedAt);
    return from !== null && to !== null && to >= from ? [to - from] : [];
  });
  return {
    version: FEEDBACK_SCHEMA_VERSION,
    changeId,
    sourceCohort: metrics.sourceCohort || null,
    observedAt,
    readiness,
    timing: {
      wallTimeMs: metrics.wallTimeMs ?? null,
      activeTimeMs: metrics.activeTimeMs ?? null,
      reviewerExecutionMs: reviewDurations.length
        ? reviewDurations.reduce((sum, duration) => sum + duration, 0) : null,
      reviewerTimingAvailability: !reviewDurations.length ? "unavailable" :
        reviewDurations.length === reviewAttempts.length ? "complete" : "partial",
      repairMs,
      repairTimingAvailability: repairMs === null ? "unavailable" : "derived",
      repairIntervals,
      humanWaitMs: metrics.humanWaitMs ?? null,
      unattributedMs: unattributedDuration(metrics, repairIntervals, operations),
      basis: "operations+review-attempts+verified-human-transitions"
    },
    guards: {
      lifecycle: operationCauseCoverage(operations),
      inspection: operationCauseCoverage(inspections),
      unexpectedFailures: operations.filter((row) => row.status === "failed").length
    },
    evidenceReuse: metrics.evidenceReuse || { count: 0, byReason: {} },
    evidenceObservationGroups: metrics.evidenceObservationGroups || [],
    usageAvailability: metrics.usageAvailability || null,
    nextAction,
    measurement: "read-only-retained-state-projection"
  };
}

export function createFeedbackRuntime({
  inspectSnapshots = (operation) => operation(),
  logs, evidenceVault, readJson, readJsonLines, metricsValue, nextAction,
  packetValue = null,
  output = console.log
}) {
  function reviewAttempts(id) {
    const directory = join(evidenceVault, id, "review-attempts");
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => name.endsWith(".json"))
      .map((name) => readJson(join(directory, name), null)).filter(Boolean);
  }

  function readFeedbackValue(id) {
    let resolvedNextAction;
    try { resolvedNextAction = nextAction(id); }
    catch {
      resolvedNextAction = {
        version: 1, changeId: id, action: "UNAVAILABLE",
        boundary: "inspection", reason: "next-action-unavailable",
        command: `claude-foundation doctor --change ${id}`
      };
    }
    let readiness;
    try { readiness = packetValue ? readinessProjection(packetValue(id)) : null; }
    catch { readiness = { availability: "unavailable", providers: [] }; }
    return feedbackSnapshotValue({
      changeId: id,
      metrics: metricsValue(id),
      operations: readJsonLines(join(logs, id, "operations.jsonl")),
      inspections: readJsonLines(join(logs, id, "inspections.jsonl")),
      reviewAttempts: reviewAttempts(id),
      nextAction: resolvedNextAction,
      readiness,
      observedAt: new Date().toISOString()
    });
  }

  function feedbackValue(id) {
    return inspectSnapshots(() => readFeedbackValue(id));
  }

  function showFeedback(id, flags = {}) {
    const feedback = feedbackValue(id);
    const value = flags.diagnostics ? diagnosticExport(feedback) : feedback;
    output(JSON.stringify(value, null, flags.pretty ? 2 : 0));
    return value;
  }

  return { feedbackValue, showFeedback };
}
