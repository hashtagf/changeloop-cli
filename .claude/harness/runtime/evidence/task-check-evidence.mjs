import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// A Build task check whose `verify:` command is exactly an evidence
// provider's command runs the provider's way (argv, cwd, environment, timeout,
// log capture) and, when it passes on unchanged content, is kept as a prepared
// execution. Prove seeds its per-run command cache from it instead of running
// the same suite again; the adapter still parses the captured output and
// records the receipt, so claims, counts, and critical cases are derived the
// same way. Anything not provably identical is not reused: unknown = rerun.
export const TASK_CHECK_EXECUTION_VERSION = 1;

// Run-scoped identifiers and harness invocation metadata. Every other
// variable of the provider environment must match exactly.
const VOLATILE_ENVIRONMENT = new Set([
  "FOUNDATION_PROOF_RUN_ID", "FOUNDATION_COMMAND_EXECUTION_ID",
  "FOUNDATION_EXECUTION_ID", "FOUNDATION_REPOSITORIES_FILE",
  "FOUNDATION_PUBLIC_OPERATION", "FOUNDATION_TELEMETRY"
]);

const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;

// The argv a shell would run for a plain command line, or null when the line
// uses any shell syntax (quotes, expansion, redirection, pipes, assignments).
export function taskCheckArgv(command) {
  const tokens = String(command || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !tokens.every((token) => SAFE_TOKEN.test(token)) ||
      tokens[0].includes("=")) return null;
  return tokens;
}

export function sameArgv(argv, built) {
  const expected = [built?.command, ...(built?.args || [])];
  return Array.isArray(argv) && argv.length === expected.length &&
    argv.every((token, index) => token === expected[index]);
}

// A compiled draft's provider command is `sh -c <verify>`, the very command line
// the task check runs under `sh -c`. Identical lines are the identical
// execution, with or without shell syntax in them.
export function sameShellLine(line, built) {
  const args = built?.args || [];
  return built?.command === "sh" && args.length === 2 && args[0] === "-c" &&
    typeof line === "string" && line.length > 0 && args[1] === line;
}

// Why a provider's result cannot come from a captured task check, or null.
// Reuse needs everything the adapter reads to be in stdout/stderr and the exit.
export function taskCheckReuseRefusal(config, capability) {
  if (!config) return "unconfigured";
  if (!["command", "test-discovery"].includes(config.adapter)) return "adapter";
  if (["review", "acceptance", "semantic-acceptance", "browser", "mutation"]
    .includes(capability)) return "capability";
  if (config.report) return "report-file";
  if (config.readiness || config.service) return "service";
  if ((config.dependsOn || []).length) return "depends-on";
  if (config.repositories) return "multi-repository";
  return null;
}

export function environmentIdentity(environment, stableHash) {
  return stableHash(Object.fromEntries(Object.entries(environment || {})
    .filter(([name]) => !VOLATILE_ENVIRONMENT.has(name))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))));
}

export function taskCheckExecutionPath(logs, id, dedupKey) {
  return join(logs, id, "task-check-executions", `${dedupKey}.json`);
}

export function writeTaskCheckExecution(path, record, stableHash) {
  const value = { version: TASK_CHECK_EXECUTION_VERSION, ...record };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...value, digest: stableHash(value) })}\n`,
    { mode: 0o600 });
}

// The prepared execution for exactly this command identity, environment, and
// content, or null. A record that is unreadable, altered, from another
// version, not a clean pass, or bound to other content is never used.
export function readTaskCheckExecution(path, expected, stableHash) {
  if (!existsSync(path)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
  const { digest, ...value } = parsed || {};
  if (!digest || stableHash(value) !== digest) return null;
  const result = value.result || {};
  if (value.version !== TASK_CHECK_EXECUTION_VERSION ||
      value.dedupKey !== expected.dedupKey ||
      value.environment !== expected.environment ||
      !value.workspaceHash || value.workspaceHash !== expected.workspaceHash ||
      result.status !== 0 || result.timedOut || result.error) return null;
  return value;
}
