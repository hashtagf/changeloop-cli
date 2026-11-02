// What the user's own words authorize. One rule for every host surface
// (AGENT.md "Authority"): a direct instruction or an approval reply to the
// question just asked is authority for exactly what was asked; urgency alone
// ("ด่วน", "รีบ demo") is not; a negated request ("don't push") never is.
// These classifiers read text only; they never widen an authority the
// command itself does not already carry.

import { mutatingShellOperations } from "../harness/runtime/core/shell-mutation-policy.mjs";

// A negation shortly before the phrase, in the same clause, cancels it.
const NEGATION = /(?:\b(?:don'?t|do\s+not|never|no|not|without|avoid|stop)\b|อย่า|ไม่ต้อง|ไม่|ห้าม|ยังไม่)[^.!?\n,;]{0,24}$/i;

const APPROVAL = /(?:\b(?:yes|yep|yeah|ok(?:ay)?|sure|approved?|go\s+ahead|go\s+for\s+it|do\s+it|proceed|lgtm|ship\s+it)\b|ลุยเลย|ลุย|ทำเลย|ทำไปเลย|เอาเลย|ได้เลย|จัดไป|อนุมัติ|โอเค|ตกลง|ใช่)/gi;

const DELIVERY = /(?:\b(?:open|create|make|raise|submit|file|send|put\s+up)\s+(?:(?:a|an|the|new|my|our)\s+)*(?:pull[\s-]?request|PR)s?\b|\bdeliver\b|(?:เปิด|สร้าง|ทำ|ส่ง|ยิง|ขึ้น)\s*(?:PR|pr|พีอาร์|pull\s*request))/gi;

const COMMIT = /(?:\bcommit\b|คอมมิต|คอมมิท)/gi;
const PUSH = /(?:\bpush\b|พุช|พุซ)/gi;

function affirmed(text, pattern) {
  const value = String(text || "");
  for (const match of value.matchAll(pattern))
    if (!NEGATION.test(value.slice(Math.max(0, match.index - 40), match.index))) return true;
  return false;
}

// "ลุยเลย", "ทำไปเลย", "go ahead", "approve" in reply to the question asked.
export function isApprovalReply(text) {
  return affirmed(text, APPROVAL);
}

// "เปิด PR ให้เลย", "open a PR", "deliver it" — the request /deliver serves.
export function promptRequestsDelivery(text) {
  return affirmed(text, DELIVERY);
}

// The Git publication the user directly asked for. Pushing needs a commit,
// so a push request covers the commit it publishes; a commit request never
// covers a push.
export function requestedGitPublication(text) {
  const push = affirmed(text, PUSH);
  return { commit: push || affirmed(text, COMMIT), push };
}

export function gitPublicationOperations(command) {
  return mutatingShellOperations(command).filter((operation) =>
    operation === "git commit" || operation === "git push");
}

function promptText(row) {
  if (row.type !== "user" || row.isMeta) return "";
  const content = row.message?.content;
  const text = typeof content === "string" ? content
    : Array.isArray(content) && !content.some((part) => part?.type === "tool_result")
      ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
      : "";
  const command = text.match(/<command-name>\s*(\/[\w:-]+)\s*<\/command-name>/);
  if (command) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return args ? `${command[1]} ${args}` : command[1];
  }
  return text.trim() && !/^<(?:local-command|system-reminder)/.test(text.trim()) ? text.trim() : "";
}

// The prompt the user typed last, and the transcript text of the turn before
// it — where a question the hook asked (an `ASK_USER:` line) is visible, so a
// bare "yes" can be read as the answer to that question and nothing else.
// Claude Code appends `last-prompt` rows late; one repeating the current
// prompt is not a new turn.
export function promptExchange(source) {
  let latest = "";
  let previousTurn = [];
  let currentTurn = [];
  for (const line of String(source || "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const typed = row.type === "last-prompt" && typeof row.lastPrompt === "string"
      ? row.lastPrompt.trim() : promptText(row);
    if (typed && typed !== latest) {
      latest = typed;
      previousTurn = currentTurn;
      currentTurn = [];
      continue;
    }
    if (!typed) currentTurn.push(line);
  }
  return { latest, previousTurn: previousTurn.join("\n") };
}
