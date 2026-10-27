import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { measuredNumber } from "../core/measured-number.mjs";

// Cross-change outcomes: a read-only rollup of every archived change. Nothing
// here writes under .foundation or syncs telemetry; a value the store does not
// record is null with its availability, never 0. Cohorts group changes by
// work type × impact × risk signals, and each cohort rate is computed over the
// known values only, with its denominator and unknown count.
export const OUTCOMES_SCHEMA_VERSION = 1;

const CHANGE_ID = /^[a-z0-9][a-z0-9-]*$/;

function directoryEntries(path) {
  try { return existsSync(path) ? readdirSync(path, { withFileTypes: true }) : []; }
  catch { return []; }
}

// Rows of a JSONL file; an unparseable line is skipped, a missing file is null.
export function jsonLines(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  return text.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

// Every runtime state, parsed, or a skip reason. `.prev` and temporary
// siblings are not states.
export function runtimeStates(runtimeDir) {
  return directoryEntries(runtimeDir)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((id) => CHANGE_ID.test(id)).sort()
    .map((id) => {
      try {
        const state = JSON.parse(readFileSync(join(runtimeDir, `${id}.json`), "utf8"));
        return state && typeof state === "object" && !Array.isArray(state)
          ? { id, state } : { id, reason: "runtime-state-not-an-object" };
      } catch { return { id, reason: "runtime-state-unparseable" }; }
    });
}

// Ids with any recorded runtime state, log, or evidence directory.
export function recordedChangeIds({ runtimeDir, evidenceDir, logsDir }) {
  const ids = new Set(runtimeStates(runtimeDir).map((row) => row.id));
  for (const dir of [evidenceDir, logsDir])
    for (const entry of directoryEntries(dir))
      if (entry.isDirectory() && CHANGE_ID.test(entry.name)) ids.add(entry.name);
  return [...ids].sort();
}

// The recorded result of a review attempt: `resultStatus` for completed
// attempts, `status` for version 1 records.
export function reviewAttemptResult(attempt) {
  const result = attempt?.resultStatus ?? attempt?.status;
  return ["pass", "fail", "inconclusive"].includes(result) ? result : null;
}

// Operator proof runs use `proof-<ts>` roots; the advance route collects under
// `collect-<ts>`. Each root is one proof run.
const PROOF_RUN_PREFIXES = ["proof-", "collect-"];

function proofRunCount(evidenceDir, id) {
  const dir = join(evidenceDir, id);
  if (!existsSync(dir)) return null;
  return directoryEntries(dir).filter((entry) => entry.isDirectory() &&
    PROOF_RUN_PREFIXES.some((prefix) => entry.name.startsWith(prefix))).length;
}

function knownCost(logsDir, id) {
  const events = jsonLines(join(logsDir, id, "events.jsonl"));
  const values = (events || []).map((row) => measuredNumber(row?.cost))
    .filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

const count = (value) => (Array.isArray(value) ? value.length : 0);
const round = (value, places = 4) => Number(value.toFixed(places));

function cohortParts(state, workTypes) {
  const workType = [...new Set(workTypes)].sort().join("+") || "unknown";
  const impact = typeof state.impact === "string" && state.impact ? state.impact : "unknown";
  const riskSignals = [...new Set(Array.isArray(state.riskSignals)
    ? state.riskSignals.filter((signal) => typeof signal === "string") : [])].sort();
  return {
    workType, impact, riskSignals,
    cohort: `${workType}|${impact}|${riskSignals.join("+") || "none"}`
  };
}

// Rate of true over known booleans.
export function knownRate(values) {
  const known = values.filter((value) => value !== null);
  return {
    rate: known.length ? round(known.filter(Boolean).length / known.length) : null,
    denominator: known.length,
    unknownCount: values.length - known.length
  };
}

// Total and mean over known numbers.
export function knownSummary(values) {
  const known = values.filter((value) => value !== null);
  const total = known.reduce((sum, value) => sum + value, 0);
  return {
    total: known.length ? round(total, 6) : null,
    mean: known.length ? round(total / known.length) : null,
    denominator: known.length,
    unknownCount: values.length - known.length
  };
}

export function outcomeCohorts(changes) {
  const groups = new Map();
  for (const change of changes) {
    if (!groups.has(change.cohort)) groups.set(change.cohort, []);
    groups.get(change.cohort).push(change);
  }
  return [...groups.entries()].sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, rows]) => ({
      key, workType: rows[0].workType, impact: rows[0].impact,
      riskSignals: rows[0].riskSignals, changes: rows.length,
      firstProofPass: knownRate(rows.map((row) => row.firstProofPass)),
      userDecisions: knownSummary(rows.map((row) => row.userDecisions)),
      cost: knownSummary(rows.map((row) => row.cost)),
      escapedDefects: knownSummary(rows.map((row) => row.escapedDefects))
    }));
}

const cell = (value) => (value === null || value === undefined ? "unknown" : String(value));

function table(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)));
  const line = (values) => values.map((value, index) => value.padEnd(widths[index])).join("  ")
    .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)]
    .join("\n");
}

export function outcomesText(value) {
  const sections = [`Outcomes: ${value.changes.length} archived change(s)`];
  if (value.changes.length)
    sections.push(table(["change", "cohort", "proofRuns", "reviewRepairs", "firstProofPass",
      "userDecisions", "cost", "escapedDefects"], value.changes.map((row) => [
      row.id, row.cohort, cell(row.proofRuns), cell(row.reviewRepairRounds),
      cell(row.firstProofPass), cell(row.userDecisions), cell(row.cost),
      cell(row.escapedDefects)])));
  if (value.cohorts.length)
    sections.push(table(["cohort", "changes", "firstProofPassRate", "known", "unknown",
      "meanCost", "meanUserDecisions"], value.cohorts.map((row) => [
      row.key, String(row.changes), cell(row.firstProofPass.rate),
      String(row.firstProofPass.denominator), String(row.firstProofPass.unknownCount),
      cell(row.cost.mean), cell(row.userDecisions.mean)])));
  if (value.skipped.length)
    sections.push(`Skipped: ${value.skipped.map((row) => `${row.id} (${row.reason})`).join(", ")}`);
  sections.push("escapedDefects counts later changes that declared 'fixes' (declared-only).");
  return sections.join("\n\n");
}

export function createOutcomesRuntime({
  runtimeDir, evidenceDir, logsDir,
  // (id, state) => string[]: the change's declared work types.
  changeWorkTypes,
  // (id) => review attempt records, read only.
  reviewAttemptRecords
}) {
  function outcomesValue() {
    const rows = runtimeStates(runtimeDir);
    const skipped = rows.filter((row) => row.reason)
      .map(({ id, reason }) => ({ id, reason }));
    const states = rows.filter((row) => row.state);
    const fixedBy = new Map();
    for (const { id, state } of states)
      for (const target of new Set(Array.isArray(state.fixes) ? state.fixes : []))
        if (typeof target === "string" && target !== id)
          fixedBy.set(target, [...(fixedBy.get(target) || []), id]);
    const changes = states.filter(({ state }) => state.status === "archived")
      .map(({ id, state }) => {
        let workTypes = [];
        try { workTypes = changeWorkTypes(id, state) || []; } catch { workTypes = []; }
        const proofRuns = proofRunCount(evidenceDir, id);
        let attempts = [];
        try { attempts = reviewAttemptRecords(id) || []; } catch { attempts = []; }
        const reviewRepairRounds = proofRuns === null ? null
          : attempts.filter((attempt) => reviewAttemptResult(attempt) === "fail").length;
        return {
          id,
          archivedAt: state.archivedAt || null,
          ...cohortParts(state, workTypes),
          proofRuns,
          reviewRepairRounds,
          firstProofPass: proofRuns === null ? null
            : proofRuns === 1 && reviewRepairRounds === 0,
          amendments: count(state.amendments),
          userDecisions: count(state.advanceRecovery?.answers) + count(state.waivers) +
            count(state.groundingReopens),
          cost: knownCost(logsDir, id),
          escapedDefects: (fixedBy.get(id) || []).length,
          fixedBy: [...(fixedBy.get(id) || [])].sort()
        };
      });
    return {
      version: OUTCOMES_SCHEMA_VERSION,
      availability: {
        escapedDefects: "declared-only",
        cost: "known-events-only",
        firstProofPass: "evidence-directory"
      },
      changes,
      cohorts: outcomeCohorts(changes),
      skipped
    };
  }

  function showOutcomes(flags = {}) {
    const value = outcomesValue();
    console.log(flags.pretty ? outcomesText(value) : JSON.stringify(value, null, 2));
    return value;
  }

  return { outcomesValue, showOutcomes };
}
