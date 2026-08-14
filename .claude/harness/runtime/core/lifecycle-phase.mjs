// Which change-loop phase a runtime command belongs to.
//
// This table used to exist twice: as a `case` grammar in `cli.sh`, which
// exported the answer as FOUNDATION_PUBLIC_OPERATION, and as a `telemetryPhase`
// object literal inside `foundation.mjs`. The two disagreed on seven commands
// (`new`, `start`, `validate`, `abandon`, and the three `agent-*` forms), so
// the operations log recorded a phase only when the call arrived through the
// CLI. A direct `node foundation.mjs <command>` — what an agent runs — wrote
// `phase: null`, and `metrics` then bucketed that row under the command name
// while the matching host events bucketed under the phase. One change produced
// two disjoint halves of a phase rollup: operations with no tokens, tokens with
// no operations.
//
// The CLI wrapper is shell and cannot import this module, so the two are kept
// in lockstep by the repository's single-source table checks. Keep them in
// step, or those checks fail.
//
// `meta` covers commands that act on a change without belonging to a phase of
// its construction — budget extension, telemetry ingestion, event recording.
// They get an explicit bucket rather than a phantom phase named after whichever
// command happened to run.

export const LIFECYCLE_PHASES = ["change", "build", "prove", "land"];

export const PHASE_BY_COMMAND = {
  new: "change",
  start: "change",
  resolve: "change",
  validate: "change",
  abandon: "change",
  waive: "change",
  "audit-change": "change",
  "evidence-detect": "change",
  "evidence-init": "change",
  "evidence-doctor": "change",
  "evidence-upgrade": "change",

  sandbox: "build",
  "agent-plan": "build",
  "agent-acquire": "build",
  "agent-release": "build",

  "proof-plan": "prove",
  "proof-readiness": "prove",
  "proof-run": "prove",
  "proof-collect": "prove",
  "proof-preflight": "prove",
  "proof-execute": "prove",
  "proof-audit": "prove",
  "authority-request": "prove",
  "authority-status": "prove",
  "authority-record": "prove",
  "evidence-verify-ci": "prove",
  receipt: "prove",
  "run-provider": "prove",
  prove: "prove",

  "land-check": "land",
  "land-recover": "land",
  "land-plan": "land",
  "land-record": "land",
  "land-pointers": "land",
  "land-resume": "land",
  archive: "land",

  "budget-continue": "meta",
  event: "meta",
  "telemetry-sync": "meta",
  "telemetry-import": "meta"
};

// The bucket an operations row is filed under. `meta` is a real answer here.
export function phaseForCommand(command) {
  return PHASE_BY_COMMAND[command] || null;
}

// Telemetry binds a host session to a phase of the change's construction, so
// `meta` does not qualify: importing events under "budget-continue" would
// attribute a whole cursor chunk to a command that built nothing.
export function telemetryPhaseForCommand(command) {
  const phase = phaseForCommand(command);
  return LIFECYCLE_PHASES.includes(phase) ? phase : null;
}
