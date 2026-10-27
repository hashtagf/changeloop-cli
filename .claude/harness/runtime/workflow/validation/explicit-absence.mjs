// A required field may always be answered honestly: "none: <reason>" or
// "unknown: <reason>" (Thai: "ไม่มี:" or "ไม่ทราบ:") counts as present. This keeps
// a new required field from becoming a dead end when the fact does not exist
// or is not yet known, and the approval page shows the reason instead of
// hiding the gap. A bare "unknown" with no reason is not an answer.

const ABSENCE = /^\s*(none|unknown|ไม่มี|ไม่ทราบ)\s*(?::\s*([\s\S]*))?$/i;

// "reasoned" for `none: why`, "bare" for `none` or `none:` alone, else null
// (including text that merely starts with the word, such as "none in changelog").
export function absenceKind(value) {
  if (typeof value !== "string") return null;
  const match = value.match(ABSENCE);
  if (!match) return null;
  return match[2] !== undefined && match[2].trim() !== "" ? "reasoned" : "bare";
}

export const isReasonedAbsence = (value) => absenceKind(value) === "reasoned";

// The reason an absence answer carries, for display.
export function absenceReason(value) {
  return isReasonedAbsence(value) ? value.match(ABSENCE)[2].trim() : null;
}

// One repair issue for an absence answer that gives no reason.
export function bareAbsenceIssue(value, path) {
  return absenceKind(value) === "bare"
    ? `${path} says none or unknown without a reason; write 'unknown: <reason>' or 'none: <reason>'`
    : null;
}
