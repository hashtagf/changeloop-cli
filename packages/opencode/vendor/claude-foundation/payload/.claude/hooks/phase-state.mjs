import { join } from "node:path";

// Logs outlive their change. An archived, abandoned, deleted, or fixture change
// leaves its last phase row behind, and the newest row used to govern whoever
// opened the next session: one leftover fixture stuck at `building` with no
// workspace put every session in its repository into a phase nobody was running
// and refused every mutation for the whole freshness window. A row is eligible
// only while its change is still an active OpenSpec change — the same fact
// `changes` already reports as `missing-active-change`.
function activeChange(context, changeId) {
  return Boolean(changeId) && context.pathExists(
    join(context.projectRoot, "openspec", "changes", changeId));
}

export function recordedPhaseContext(context) {
  try {
    const logs = join(context.projectRoot, ".foundation", "logs");
    if (!context.pathExists(logs)) return "";
    let newest = null;
    let newestForSession = null;
    for (const entry of context.readDirectory(logs)) {
      if (!entry.isDirectory()) continue;
      const path = join(logs, entry.name, "phase-context.jsonl");
      if (!context.pathExists(path)) continue;
      const last = context.readText(path, "utf8").split("\n").filter(Boolean).at(-1);
      if (!last) continue;
      let row;
      try { row = JSON.parse(last); } catch { continue; }
      const at = Date.parse(row?.timestamp || "");
      if (!Number.isFinite(at)) continue;
      // The log directory is the change id; the row repeats it. Either one
      // identifies the change a row belongs to.
      const changeId = String(row.changeId || entry.name);
      if (!activeChange(context, changeId)) continue;
      if (!newest || at > newest.at) newest = { at, phase: String(row.phase || ""), changeId };
      if (context.sessionId && row.sessionId === context.sessionId &&
          (!newestForSession || at > newestForSession.at))
        newestForSession = { at, phase: String(row.phase || ""), changeId };
    }
    if (context.sessionId) newest = newestForSession;
    if (!newest || context.nowMs() - newest.at > context.freshnessMs) return "";
    return newest;
  } catch {
    return null;
  }
}

export function recordedPhase(context) {
  return recordedPhaseContext(context)?.phase || "";
}
