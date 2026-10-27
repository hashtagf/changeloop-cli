// Signals the agent must act on that do not change the lifecycle action:
// restored agreement drift, a budget warning, an archive that was already
// complete. Each keeps its human-readable line on the stream it always used
// and is also recorded here, so `advance` carries it in the JSON envelope the
// agent reads (`signals[]`) instead of only in stderr or a log.
//
// One process runs one command, so the process is the signal's lifetime:
// recorded once (deduplicated, bounded) and drained by the envelope that
// reports it. Signals raised before the command body — telemetry sync in the
// command prologue — are therefore still reported.

const MAX_SIGNALS = 20;
const pending = [];

const PREFIX = /^(?:NOTICE|WARNING):\s*/;

export function recordSignal(code, message) {
  const text = String(message ?? "").replace(PREFIX, "").trim();
  if (typeof code !== "string" || !code || !text || pending.length >= MAX_SIGNALS) return;
  if (pending.some((row) => row.code === code && row.message === text)) return;
  pending.push({ code, message: text });
}

// Writes the unchanged line, then records it.
export function emitSignal(code, line, write = (value) => console.error(value)) {
  write(line);
  recordSignal(code, line);
}

export function drainSignals() {
  return pending.splice(0);
}
