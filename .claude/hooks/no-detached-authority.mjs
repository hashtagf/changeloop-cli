#!/usr/bin/env node

// A configured reviewer is owned by `authority run` and completes
// synchronously. Detaching that command lets a headless Claude turn exit,
// kills the reviewer with the session, and leaves a false-success envelope.

import { pathToFileURL } from "node:url";

export function detachedAuthorityCommand(command) {
  const stripped = String(command || "").replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  if (!/\b(?:claude-foundation|foundation\.mjs)\s+authority(?:-|\s+)run\b/.test(stripped))
    return false;
  return /(^|[;&|()]\s*)nohup\b/.test(stripped) ||
    /&\s*(?:[;)]|$)/m.test(stripped) ||
    /\b(?:disown|setsid)\b/.test(stripped);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let event = {};
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== "Bash" ||
      !detachedAuthorityCommand(event.tool_input?.command)) process.exit(0);
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: "BLOCKED: authority run owns a synchronous reviewer and must stay in the foreground. Run it without &, nohup, setsid, or disown; wait for its durable completion before replying."
  }));
}
