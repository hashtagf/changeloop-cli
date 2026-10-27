#!/usr/bin/env node

// A configured reviewer is owned by `authority run` and completes
// synchronously. Detaching that command lets a headless Claude turn exit,
// kills the reviewer with the session, and leaves a false-success envelope,
// so a detached spelling is rewritten to run attached.

import { pathToFileURL } from "node:url";

export function detachedAuthorityCommand(command) {
  const stripped = String(command || "").replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  if (!/\b(?:claude-foundation|foundation\.mjs)\s+authority(?:-|\s+)run\b/.test(stripped))
    return false;
  return /(^|[;&|()]\s*)nohup\b/.test(stripped) ||
    /&\s*(?:[;)]|$)/m.test(stripped) ||
    /\b(?:disown|setsid)\b/.test(stripped);
}

// The reviewer only has to stay in the foreground, so the harness runs the
// command attached instead of refusing it: drop `nohup`/`setsid`, background
// `&`, and `disown`, and keep everything else as written.
export function attachedAuthorityCommand(command) {
  return String(command || "")
    .replace(/\b(?:nohup|setsid(?:\s+-\S+)*)\s+/g, "")
    .replace(/\s*(?:;|&&)?\s*\bdisown\b[^;&|\n]*/g, "")
    .replace(/(?<!&)&(?!&)\s*(?=[;)]|$)/gm, "")
    .trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let event = {};
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== "Bash" ||
      !detachedAuthorityCommand(event.tool_input?.command)) process.exit(0);
  const attached = attachedAuthorityCommand(event.tool_input.command);
  if ((process.env.FOUNDATION_GUARDRAIL_MODE || "").toLowerCase() === "block" ||
      detachedAuthorityCommand(attached)) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "BLOCKED: authority run owns a synchronous reviewer and must stay in the foreground. Run it without &, nohup, setsid, or disown; wait for its durable completion before replying."
    }));
  } else {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...event.tool_input, command: attached },
      additionalContext: "authority run now runs in the foreground: a detached reviewer dies with the " +
        "session and leaves a false success. Wait for its completion before replying."
    } }));
  }
}
