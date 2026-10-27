// Commands that take `<change>` may omit it when exactly one change is active.
// Only lifecycle reads and `advance` below Land: anything that applies, undoes,
// restores, or approves keeps requiring the explicit id. `value` lists the
// flags that consume the following token, so a flag's value is not mistaken
// for the change id.
const ADVANCE_VALUE_FLAGS = ["host-result", "through", "decision", "decision-fingerprint",
  "decision-ref", "reason", "restore-target", "recover-apply", "role"];

const IMPLIED_CHANGE = {
  advance: { value: ADVANCE_VALUE_FLAGS, explicit: advanceNeedsExplicitChange },
  packet: { value: ["phase", "task", "repo"] },
  metrics: { value: [] },
  feedback: { value: [] },
  package: { value: [] },
  "audit-change": { value: [] },
  "authority-status": { value: ["decision-ref"] },
  "handoff-status": { value: [] },
  "evidence-detect": { value: [] },
  "evidence-doctor": { value: [] }
};

function flagValue(values, name) {
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === `--${name}`) return values[index + 1] ?? true;
    if (token.startsWith(`--${name}=`)) return token.slice(name.length + 3);
  }
  return undefined;
}

// Land, undo, restore, recovery and approval carry the user's authority; the
// agent must name the change it means rather than have one inferred.
function advanceNeedsExplicitChange(values) {
  return ["undo-land", "restore-target", "recover-apply", "approve-spec"]
    .some((flag) => flagValue(values, flag) !== undefined) ||
    flagValue(values, "through") === "archived";
}

function hasChangeId(values, valueFlags) {
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) return true;
    if (!token.includes("=") && valueFlags.includes(token.slice(2))) index += 1;
  }
  return false;
}

// Returns the values to run with: unchanged unless the change id was omitted and
// one change is active. Several active changes, or an authority flag without an
// id, is a refusal that names the way forward.
export function impliedChangeValues(command, values, listActive, fail) {
  const rule = IMPLIED_CHANGE[command];
  if (!rule || hasChangeId(values, rule.value)) return values;
  let active = [];
  try { active = listActive(); } catch { return values; }
  if (!active.length) return values;
  if (rule.explicit?.(values))
    fail(`${command} with these flags requires an explicit change id; it is never inferred` +
      `${active.length ? `\n  active: ${active.join(", ")}` : ""}`);
  if (active.length > 1)
    fail(`${command} needs a change id; ${active.length} changes are active: ${active.join(", ")}\n` +
      "  pass one, or run `claude-foundation current` to see which is active");
  return [active[0], ...values];
}
