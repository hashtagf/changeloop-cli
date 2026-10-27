import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync,
  rmSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireProcessLock } from "./process-lock.mjs";

export const UPDATE_CACHE_VERSION = 1;
export const UPDATE_NOTIFICATION_STATE_VERSION = 1;
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 1200;
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/Maximumsoft-Co-LTD/claude-foundation/releases/latest";
export const UPDATE_BOUNDARY_COMMANDS = Object.freeze(new Set([
  "investigate", "change", "build"
]));

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = resolve(HERE, "../../../..");

export function defaultUpdateCachePath(env = process.env) {
  const cacheRoot = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheRoot, "claude-foundation", "update-status.json");
}

export function defaultUpdateNotificationStatePath(env = process.env) {
  const cacheRoot = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheRoot, "claude-foundation", "update-notifications.json");
}

export function stableVersion(value) {
  const match = String(value || "").trim().match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/
  );
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function compareVersions(left, right) {
  const a = stableVersion(left);
  const b = stableVersion(right);
  if (!a || !b) return null;
  const aa = a.split(".").map(Number);
  const bb = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (aa[index] < bb[index]) return -1;
    if (aa[index] > bb[index]) return 1;
  }
  return 0;
}

function validCache(value) {
  return value?.version === UPDATE_CACHE_VERSION &&
    Boolean(stableVersion(value.latestVersion)) &&
    Number.isFinite(Date.parse(value.checkedAt));
}

export function readUpdateCache(path = defaultUpdateCachePath()) {
  try {
    if (!existsSync(path)) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return validCache(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeUpdateCache(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function updateActions(status) {
  const actions = [];
  if (["cli-update-available", "both-outdated"].includes(status))
    actions.push({
      type: "upgrade-cli",
      command: "brew update && brew upgrade claude-foundation"
    });
  if (["project-refresh-required", "both-outdated"].includes(status))
    actions.push({
      type: "refresh-project",
      command: "claude-foundation init . --yes"
    });
  return actions;
}

export function updateStatus(installed, project, latest) {
  if (installed && latest) {
    const cliAhead = compareVersions(installed, latest) > 0;
    const cliBehind = compareVersions(installed, latest) < 0;
    const projectBehind = Boolean(project && compareVersions(project, installed) < 0);
    const projectLatestBehind = Boolean(project && compareVersions(project, latest) < 0);
    if (cliAhead && projectBehind) return "project-refresh-required";
    if (cliAhead) return "head-installation";
    if (cliBehind && projectLatestBehind) return "both-outdated";
    if (cliBehind) return "cli-update-available";
    if (projectBehind) return "project-refresh-required";
    return "current";
  }
  if (installed && project && compareVersions(project, installed) < 0)
    return "project-refresh-required";
  return "unknown";
}

export function advisoryFromVersions({
  installedVersion, projectVersion = null, latestVersion = null,
  checkedAt = null, freshness = "unavailable", source = "none", reason = null
}) {
  const installed = stableVersion(installedVersion);
  const project = projectVersion === null ? null : stableVersion(projectVersion);
  const latest = latestVersion === null ? null : stableVersion(latestVersion);
  const status = updateStatus(installed, project, latest);
  return {
    status,
    installedVersion: installed || String(installedVersion || "unknown"),
    ...(projectVersion !== null
      ? { projectVersion: project || String(projectVersion || "unknown") } : {}),
    latestVersion: latest,
    checkedAt,
    freshness,
    source,
    blocking: false,
    reason,
    actions: updateActions(status)
  };
}

export function cachedUpdateAdvisory(options = {}) {
  const env = options.env || process.env;
  const installedVersion = options.installedVersion || "unknown";
  const projectVersion = options.projectVersion ?? null;
  if (env.FOUNDATION_UPDATE_CHECK === "0") return {
    status: "disabled",
    installedVersion: stableVersion(installedVersion) || String(installedVersion),
    ...(projectVersion !== null
      ? { projectVersion: stableVersion(projectVersion) || String(projectVersion) } : {}),
    latestVersion: null,
    checkedAt: null,
    freshness: "unavailable",
    source: "disabled",
    blocking: false,
    reason: "disabled-by-environment",
    actions: []
  };
  const now = options.now ?? Date.now();
  const cache = readUpdateCache(options.cachePath || defaultUpdateCachePath(env));
  if (!cache) return advisoryFromVersions({
    installedVersion, projectVersion, reason: "cache-unavailable"
  });
  const age = now - Date.parse(cache.checkedAt);
  const fresh = age >= 0 && age <= (options.ttlMs ?? UPDATE_CACHE_TTL_MS);
  return advisoryFromVersions({
    installedVersion,
    projectVersion,
    latestVersion: cache.latestVersion,
    checkedAt: cache.checkedAt,
    freshness: fresh ? "fresh" : "stale",
    source: "cache",
    reason: fresh ? null : "cache-expired"
  });
}

function readNotificationState(path) {
  try {
    if (!existsSync(path)) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.version === UPDATE_NOTIFICATION_STATE_VERSION &&
      value.sessions && typeof value.sessions === "object" ? value : null;
  } catch {
    return null;
  }
}

export function baseUpdateNotificationDirective(advisory, trigger) {
  const actionable = Array.isArray(advisory?.actions) && advisory.actions.length > 0;
  const version = stableVersion(advisory?.latestVersion) || null;
  return {
    actionable,
    directive: {
      surface: actionable,
      kind: trigger === "build" ? "update-reminder" : "update-available",
      timing: trigger === "build" ? "before-build" : "phase-entry",
      dedupeKey: version ? `foundation-update:${version}` : null,
      blocking: false,
      reason: actionable ? null : "no-update-action"
    }
  };
}

export function notificationSessionId(options) {
  return String(options.sessionId || options.env?.FOUNDATION_SESSION_ID ||
    process.env.FOUNDATION_SESSION_ID || "").trim();
}

export function acquireNotificationLock(path, timeoutMs) {
  const deadline = Date.now() + Number(timeoutMs ?? 250);
  let lock;
  do {
    lock = acquireProcessLock(`${path}.lock`);
    if (lock.acquired) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  } while (Date.now() < deadline);
  return lock;
}

export function nextNotificationState(state, sessionId, directive, trigger, now) {
  const sessions = Object.fromEntries(Object.entries({
    ...state.sessions,
    [sessionId]: {
      dedupeKey: directive.dedupeKey,
      trigger,
      notifiedAt: new Date(now ?? Date.now()).toISOString()
    }
  }).sort(([, left], [, right]) => String(right?.notifiedAt || "")
    .localeCompare(String(left?.notifiedAt || ""))).slice(0, 100));
  return { version: UPDATE_NOTIFICATION_STATE_VERSION, sessions };
}

export function updateNotificationDirective(advisory, trigger, options = {}) {
  const { actionable, directive } = baseUpdateNotificationDirective(advisory, trigger);
  const sessionId = notificationSessionId(options);
  if (!actionable || trigger === "build") return directive;
  if (!sessionId) return { ...directive, reason: "session-unavailable" };

  const path = options.notificationStatePath ||
    defaultUpdateNotificationStatePath(options.env || process.env);
  let lock;
  try {
    lock = acquireNotificationLock(path, options.notificationLockTimeoutMs);
    if (!lock?.acquired)
      return { ...directive, surface: false, reason: "notification-state-busy" };

    const state = readNotificationState(path) || {
      version: UPDATE_NOTIFICATION_STATE_VERSION,
      sessions: {}
    };
    const previous = state.sessions[sessionId];
    if (previous?.dedupeKey === directive.dedupeKey)
      return { ...directive, surface: false, reason: "already-notified-in-session" };

    writeUpdateCache(path, nextNotificationState(
      state, sessionId, directive, trigger, options.now));
    return directive;
  } catch {
    return { ...directive, reason: "notification-state-unavailable" };
  } finally {
    lock?.release();
  }
}

async function fetchLatestVersion(fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "claude-foundation-update-advisory"
      },
      signal: controller.signal
    });
    if (!response?.ok) throw new Error(`release-http-${response?.status || "unknown"}`);
    const payload = await response.json();
    const latestVersion = stableVersion(payload?.tag_name);
    if (!latestVersion) throw new Error("release-tag-invalid");
    return latestVersion;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUpdateAdvisory(options = {}) {
  const env = options.env || process.env;
  const cached = cachedUpdateAdvisory(options);
  if (cached.status === "disabled") return cached;
  const now = options.now ?? Date.now();
  const cachePath = options.cachePath || defaultUpdateCachePath(env);
  const shouldRefresh = options.refresh === true || cached.freshness !== "fresh";
  if (!shouldRefresh || options.allowNetwork === false) return cached;
  try {
    const latestVersion = await fetchLatestVersion(
      options.fetchImpl || globalThis.fetch,
      options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
    );
    const checkedAt = new Date(now).toISOString();
    writeUpdateCache(cachePath, {
      version: UPDATE_CACHE_VERSION,
      latestVersion,
      checkedAt
    });
    return advisoryFromVersions({
      installedVersion: options.installedVersion,
      projectVersion: options.projectVersion ?? null,
      latestVersion,
      checkedAt,
      freshness: "fresh",
      source: "remote"
    });
  } catch (error) {
    if (cached.latestVersion) return {
      ...cached,
      freshness: "stale",
      reason: error?.name === "AbortError" ? "release-timeout" : "release-unavailable"
    };
    return {
      ...cached,
      reason: error?.name === "AbortError" ? "release-timeout" : "release-unavailable"
    };
  }
}

export function updateBoundary(command) {
  return UPDATE_BOUNDARY_COMMANDS.has(command) ? command : null;
}

export function upgradeCompatibilityDiagnostics({
  previousVersion = null,
  currentVersion = null,
  configuredPolicy = {},
  activeChanges = [],
  signedCiConfigured = false
} = {}) {
  const policyFindings = [];
  const acknowledgement = configuredPolicy?.upgradeAcknowledgements?.["land.riskBasedCi"];
  const acknowledgementRef = String(acknowledgement?.decisionRef || "").trim();
  const intentionallyAcknowledged = acknowledgement?.value === true &&
    acknowledgementRef.length <= 160 && /^[A-Za-z0-9._:/-]+$/.test(acknowledgementRef);
  const policyObservations = [];
  if (configuredPolicy?.land?.riskBasedCi === true && signedCiConfigured)
    policyObservations.push({
      code: "historical-default-land-risk-based-ci",
      classification: "signed-ci-satisfies-policy",
      configuredValue: true,
      changed: false
    });
  else if (configuredPolicy?.land?.riskBasedCi === true && intentionallyAcknowledged)
    policyObservations.push({
      code: "historical-default-land-risk-based-ci",
      classification: "intentional-policy",
      configuredValue: true,
      decisionRef: acknowledgementRef,
      changed: false
    });
  else if (configuredPolicy?.land?.riskBasedCi === true) policyFindings.push({
    code: "historical-default-land-risk-based-ci",
    classification: "historical-default-or-explicit-value-ambiguous",
    configuredValue: true,
    historicalDefault: true,
    currentDefault: false,
    changed: false,
    summary: "land.riskBasedCi=true matches a historical shipped default; the installer preserved it because ownership cannot be inferred",
    recovery: "Review foundation.json land.riskBasedCi; keep true intentionally or set false explicitly to adopt the current default"
  });
  const activeChangeEffects = activeChanges
    .filter((change) => change?.id && change.status !== "archived")
    .map((change) => ({
      changeId: change.id,
      status: change.status || "unknown",
      changed: false,
      effects: [
        "state-and-agreement-preserved",
        "receipts-revalidated-against-current-protocols"
      ],
      recovery: "claude-foundation change validate " + change.id + " && " +
        "claude-foundation proof readiness " + change.id
    }));
  return {
    version: 1,
    previousVersion: stableVersion(previousVersion) || previousVersion || null,
    currentVersion: stableVersion(currentVersion) || currentVersion || null,
    blocking: false,
    policyFindings,
    policyObservations,
    activeChangeEffects
  };
}

function repositoriesHaveSignedCi(value) {
  return (value?.repositories || []).some((repository) =>
    Object.values(repository?.ci?.issuers || {}).some((issuer) =>
      issuer?.algorithm === "ed25519" &&
      String(issuer.publicKey || "").includes("PUBLIC KEY")));
}

function readProjectJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function projectUpgradeDiagnostics(root, versions = {}) {
  const runtimeRoot = join(root, ".foundation", "runtime");
  const activeChanges = existsSync(runtimeRoot)
    ? readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readProjectJson(join(runtimeRoot, entry.name), null))
      .filter(Boolean)
    : [];
  return upgradeCompatibilityDiagnostics({
    ...versions,
    configuredPolicy: readProjectJson(join(root, "foundation.json"), {}),
    activeChanges,
    signedCiConfigured: repositoriesHaveSignedCi(
      readProjectJson(join(root, "openspec", "repositories.yaml"), {}))
  });
}

export function printUpgradeDiagnostics(diagnostics, log = console.log) {
  log("INFO upgrade-context from=" + (diagnostics.previousVersion || "unknown") +
    " to=" + (diagnostics.currentVersion || "unknown") + " blocking=false");
  for (const finding of diagnostics.policyFindings)
    log("WARN " + finding.code + " configured=" + finding.configuredValue +
      " changed=" + finding.changed + "; " + finding.summary +
      "; recovery: " + finding.recovery);
  for (const observation of diagnostics.policyObservations || [])
    log("INFO " + observation.code + " classification=" + observation.classification +
      " configured=" + observation.configuredValue + " changed=" + observation.changed +
      (observation.decisionRef ? "; decision-ref: " + observation.decisionRef : ""));
  for (const effect of diagnostics.activeChangeEffects)
    log("INFO active-change-effects:" + effect.changeId + " status=" + effect.status +
      " changed=" + effect.changed + "; " + effect.effects.join(",") +
      "; recovery: " + effect.recovery);
}

function readInstalledVersion(packageRoot) {
  return readFileSync(join(packageRoot, "VERSION"), "utf8").trim();
}

export function printHuman(advisory, log = console.log) {
  log("Foundation update status");
  log(`CLI       ${advisory.installedVersion}${
    advisory.latestVersion && advisory.status !== "current"
      ? ` -> ${advisory.latestVersion}` : ""}`);
  if (advisory.projectVersion) log(`Project   ${advisory.projectVersion}`);
  log(`Status    ${advisory.status}`);
  log(`Freshness ${advisory.freshness}`);
  for (const action of advisory.actions) log(`Next      ${action.command}`);
}

async function main() {
  const args = process.argv.slice(2);
  const operation = args.shift();
  if (operation === "upgrade-diagnostics") {
    const value = (name) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : null;
    };
    const root = value("--root");
    const flagNames = args.filter((_, index) => index % 2 === 0);
    if (!root || args.length % 2 !== 0 || flagNames.some((arg) =>
      !["--root", "--previous-version", "--current-version"].includes(arg))) {
      console.error("usage: update-advisory.mjs upgrade-diagnostics --root <path> [--previous-version <version>] [--current-version <version>]");
      process.exitCode = 1;
      return;
    }
    printUpgradeDiagnostics(projectUpgradeDiagnostics(resolve(root), {
      previousVersion: value("--previous-version"),
      currentVersion: value("--current-version")
    }));
    return;
  }
  if (operation !== "check" || args.some((arg) => !["--json", "--refresh"].includes(arg))) {
    console.error("usage: claude-foundation update check [--refresh] [--json]");
    process.exitCode = 1;
    return;
  }
  const advisory = await resolveUpdateAdvisory({
    installedVersion: readInstalledVersion(DEFAULT_PACKAGE_ROOT),
    refresh: args.includes("--refresh")
  });
  if (args.includes("--json")) console.log(JSON.stringify(advisory, null, 2));
  else printHuman(advisory);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))
  await main();
