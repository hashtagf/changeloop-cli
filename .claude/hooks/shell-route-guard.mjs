#!/usr/bin/env node

// Two shell shapes always end in a host permission prompt, which an unattended
// run turns into a denied call. Refuse them with the runnable equivalent:
//   cd <dir> && git …          → git -C <dir> …
//   npm test (direct, Build)   → claude-foundation exec <change> [--repo <id>] -- npm test
// A matching Bash allow rule, bypassPermissions, or an unparseable command
// passes through.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { recordedPhaseContext } from "./phase-state.mjs";

const SAFE_ARGUMENT = /^[A-Za-z0-9_./:@%+=,-]+$/;
const display = (value) => SAFE_ARGUMENT.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
const PIPE_FILTERS = new Set(["tail", "head", "grep"]);
const TEST_COMMAND = new RegExp("^(?:" + [
  "npm (?:test|t|run(?:-script)? test(?::\\S+)?)",
  "(?:pnpm|yarn|bun)(?: run)? test(?::\\S+)?",
  "npx (?:jest|vitest|mocha|playwright test)",
  "node --test", "deno test",
  "(?:python3? -m )?pytest", "go test", "cargo test", "make (?:test|check)",
  "mvn(?:w)? test", "(?:\\./)?gradlew? test", "(?:bundle exec )?rspec"
].join("|") + ")(?:\\s|$)");
const BUILD_STATUSES = new Set(["building", "proven"]);

function within(target, root) {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Top-level command segments with the operator that follows each, quote-aware.
// A heredoc or an unclosed quote makes the command unparseable (null).
export function topLevelSegments(command) {
  const text = String(command || "");
  const segments = [];
  let start = 0;
  let quote = "";
  const push = (end, op, next) => {
    if (text.slice(start, end).trim()) segments.push({ text: text.slice(start, end).trim(), start, end, op });
    start = next;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\" && quote === "\"") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\\") { index += 1; continue; }
    if (char === "'" || char === "\"") { quote = char; continue; }
    if (char === "<" && text[index + 1] === "<") return null;
    const two = text.slice(index, index + 2);
    if (two === "&&" || two === "||") { push(index, two, index + 2); index += 1; continue; }
    if (char === "&" && (text[index - 1] === ">" || text[index + 1] === ">")) continue;
    if (char === "|" && text[index - 1] === ">") continue;
    if (char === ";" || char === "\n" || char === "|" || char === "&") push(index, char === "\n" ? ";" : char, index + 1);
  }
  if (quote) return null;
  push(text.length, null, text.length);
  return segments;
}

// Plain whitespace-separated words, or null when quoting or expansion would
// make the hook guess the shell's value.
const plainWords = (segment) => /['"\\$`]/.test(segment) ? null : segment.split(/\s+/).filter(Boolean);

// Claude Code Bash rule shapes: `Bash`, `Bash(*)`, `Bash(npm test)`,
// `Bash(npm test:*)`, and `*` globs such as `Bash(npm *)`.
export function bashRuleAllows(rule, command) {
  const match = /^Bash(?:\(([\s\S]*)\))?$/.exec(String(rule || ""));
  if (!match) return false;
  const pattern = match[1];
  if (pattern === undefined || pattern === "" || pattern === "*") return true;
  const candidates = [command, command.replace(/\s*\d?>&\d\s*$/, "").trim()];
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return candidates.some((value) => value === prefix || value.startsWith(`${prefix} `));
  }
  const glob = new RegExp(`^${pattern.split("*").map((part) =>
    part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s");
  return candidates.some((value) => glob.test(value));
}

// A test command alone, optionally piped through tail/head/grep.
function testCommand(segments) {
  const [first, ...filters] = segments;
  if (!first || !TEST_COMMAND.test(first.text)) return false;
  let op = first.op;
  for (const filter of filters) {
    if (op !== "|" || !PIPE_FILTERS.has(filter.text.split(/\s+/)[0])) return false;
    op = filter.op;
  }
  return op === null;
}

// Pure decision. `context`: cwd, change ({ id, repositories: [{ id, path,
// targetPath }] } | null), ambiguousChanges (ids when no single change
// applies), allowed(segmentText) -> bool.
export function shellRoute(command, context) {
  const segments = topLevelSegments(command);
  if (!segments?.length) return null;
  const allowed = context.allowed || (() => false);
  const first = plainWords(segments[0].text);
  if (first?.[0] === "cd" && first.length === 2 && !first[1].startsWith("~") && first[1] !== "-" &&
      (segments[0].op === "&&" || segments[0].op === ";") && segments.length > 1) {
    const directory = resolve(context.cwd, first[1]);
    const rest = segments.slice(1);
    if (/^git(?:\s|$)/.test(rest[0].text)) {
      // The git command keeps its own pipeline (`| head`); later commands
      // become separate calls.
      let last = 0;
      while (rest[last].op === "|" && rest[last + 1]) last += 1;
      const gitText = String(command).slice(rest[0].start, rest[last].end).trim();
      const more = rest.length > last + 1 ? " Run the other commands as separate calls with absolute paths." : "";
      return { shape: "cd-git", reason: "Shell route: the host asks approval for `cd … && git`. " +
        `Run \`git -C ${display(directory)} ${gitText.replace(/^git\s*/, "")}\` instead ` +
        `(or \`cd\` alone first, then plain \`git …\`).${more}` };
    }
    return testCommand(rest) && !allowed(rest[0].text)
      ? testRoute(String(command).slice(rest[0].start).trim(), directory, context) : null;
  }
  return testCommand(segments) && !allowed(segments[0].text)
    ? testRoute(String(command).trim(), context.cwd, context) : null;
}

function testRoute(commandText, directory, context) {
  const change = context.change;
  if (!change && !context.ambiguousChanges?.length) return null;
  const repository = (change?.repositories || []).find((row) => row.id !== "root" &&
    [row.path, row.targetPath].some((root) => typeof root === "string" && within(directory, root)))?.id;
  const suggestion = `claude-foundation exec ${change?.id || "<change>"}` +
    `${repository ? ` --repo ${repository}` : ""} -- ${commandText}`;
  const choose = change ? "" : ` (<change> is one of: ${context.ambiguousChanges.join(", ")})`;
  return { shape: "direct-test", reason: "Shell route: a direct test run asks the host for approval; " +
    `the harness route is pre-allowed. Run \`${suggestion}\`${choose}; add \`--task <id>\` for a task's verify.` };
}

// ---- host shell: read the event and the project facts the decision needs ----

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function projectContext(event, projectRoot) {
  const cwd = resolve(typeof event.cwd === "string" && isAbsolute(event.cwd) ? event.cwd : projectRoot);
  const allowRules = [join(projectRoot, ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.local.json"), join(homedir(), ".claude", "settings.json")]
    .map(readJson).flatMap((row) => Array.isArray(row?.permissions?.allow) ? row.permissions.allow : []);
  const changesDir = join(projectRoot, "openspec", "changes");
  const active = existsSync(changesDir) ? readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive").map((entry) => entry.name).sort() : [];
  const at = (path) => typeof path === "string" ? resolve(projectRoot, path) : null;
  const building = active.map((id) => {
    const state = readJson(join(projectRoot, ".foundation", "runtime", `${id}.json`)) || {};
    return {
      id, status: String(state.status || ""), workspace: at(state.workspace?.path),
      repositories: Object.entries(state.repositories || {}).map(([repository, record]) => ({
        id: repository, path: at(record?.path || record?.workspacePath), targetPath: at(record?.targetPath) }))
    };
  }).filter((row) => BUILD_STATUSES.has(row.status));
  // The change whose sandbox the shell is in, else this session's recorded
  // change, else the only change in Build.
  const recorded = recordedPhaseContext({
    projectRoot, sessionId: event.session_id || process.env.FOUNDATION_CLAUDE_SESSION_ID || null,
    freshnessMs: 12 * 60 * 60 * 1000, pathExists: existsSync,
    readDirectory: (path) => readdirSync(path, { withFileTypes: true }), readText: readFileSync, nowMs: Date.now
  });
  const change = building.find((row) => [row.workspace, ...row.repositories.map((repo) => repo.path)]
    .some((root) => root && within(cwd, root))) ||
    building.find((row) => row.id === recorded?.changeId) ||
    (building.length === 1 ? building[0] : null);
  return {
    cwd, change, ambiguousChanges: change ? [] : building.map((row) => row.id),
    allowed: (text) => allowRules.some((rule) => bashRuleAllows(rule, text))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = (process.env.FOUNDATION_GUARDRAIL_MODE || "auto").toLowerCase();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const event = JSON.parse(raw);
    if (mode === "off" || event.tool_name !== "Bash" || event.permission_mode === "bypassPermissions")
      process.exit(0);
    const projectRoot = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const route = shellRoute(String(event.tool_input?.command || ""), projectContext(event, projectRoot));
    if (!route) process.exit(0);
    // Audit mode records instead of refusing; here that means advice only.
    process.stdout.write(JSON.stringify(mode === "audit"
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: route.reason } }
      : { decision: "block", reason: route.reason }));
  } catch { /* a broken guide never stops the agent */ }
}
