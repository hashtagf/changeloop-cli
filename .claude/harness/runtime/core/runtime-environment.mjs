import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const DEFAULT_POLICY = {
  version: 1,
  execution: {
    maxParallelAgents: 3,
    packetBytes: { task: 8192, review: 8192, repository: 12288, global: 16384 },
    tokenBudgets: { rapid: 800000, standard: 1600000 },
    requestBudgets: { rapid: 100, standard: 200 },
    planSummaryBytes: 4096,
    leaseMinutes: 45
  },
  models: {
    fast: { family: "haiku", fallbackTier: "standard", purposes: ["inventory", "logs", "mechanical-docs"] },
    standard: { family: "sonnet", fallbackTier: "deep", purposes: ["implementation", "tests", "focused-investigation"] },
    deep: { family: "opus", fallbackTier: null, purposes: ["architecture", "security", "migration", "independent-review"] }
  },
  escalation: [
    "ambiguous-contract", "auth-or-sensitive-data", "migration",
    "concurrency", "public-compatibility", "cross-repository-conflict",
    "evidence-anomaly", "two-failed-attempts"
  ],
  review: { diversity: "required", independence: "required" }
};

export function createRuntimeEnvironment({ root, protocols, readJson, fail }) {
  function protocolDescriptor() {
    return readJson(join(root, ".claude", "harness", "protocol.json"), protocols);
  }

  function commandExists(command, cwd = root) {
    if (!command) return false;
    if (command.includes("/") || isAbsolute(command))
      return existsSync(resolve(cwd, command));
    return String(process.env.PATH || "").split(delimiter)
      .some((directory) => existsSync(join(directory, command)));
  }

  function playwrightAvailability(workspace) {
    const packageJson = readJson(join(workspace, "package.json"), {});
    const packages = {
      ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {})
    };
    const packageOwned = Boolean(packages["@playwright/test"] || packages.playwright);
    const binary = join(workspace, "node_modules", ".bin", "playwright");
    const config = [
      "playwright.config.ts", "playwright.config.js", "playwright.config.mjs",
      "playwright.config.cjs"
    ].find((name) => existsSync(join(workspace, name))) || null;
    return { packageOwned, binary, binaryAvailable: existsSync(binary), config };
  }

  function foundationPolicy() {
    const path = join(root, "foundation.json");
    const configured = existsSync(path) ? readJson(path) : {};
    if (configured.version !== undefined && configured.version !== 1)
      fail("foundation.json requires version 1");
    const policy = {
      ...DEFAULT_POLICY, ...configured,
      execution: { ...DEFAULT_POLICY.execution, ...(configured.execution || {}) },
      models: Object.fromEntries(["fast", "standard", "deep"].map((tier) => [
        tier, { ...DEFAULT_POLICY.models[tier], ...(configured.models?.[tier] || {}) }
      ])),
      review: { ...DEFAULT_POLICY.review, ...(configured.review || {}) }
    };
    if (typeof policy.execution.packetBytes === "number") {
      policy.execution.legacyNumericPacketBytes = policy.execution.packetBytes;
      policy.execution.packetBytes = {
        task: policy.execution.packetBytes,
        review: policy.execution.packetBytes,
        repository: policy.execution.packetBytes,
        global: policy.execution.packetBytes
      };
    } else {
      policy.execution.packetBytes = {
        ...DEFAULT_POLICY.execution.packetBytes,
        ...(policy.execution.packetBytes || {})
      };
    }
    policy.execution.tokenBudgets = {
      ...DEFAULT_POLICY.execution.tokenBudgets,
      ...(policy.execution.tokenBudgets || {})
    };
    policy.execution.requestBudgets = {
      ...DEFAULT_POLICY.execution.requestBudgets,
      ...(policy.execution.requestBudgets || {})
    };
    for (const type of ["task", "review", "repository", "global"]) {
      const bytes = Number(policy.execution.packetBytes?.[type]);
      if (!Number.isInteger(bytes) || bytes < 2048 || bytes > 65536)
        fail(`foundation.json execution.packetBytes.${type} must be 2048..65536`);
    }
    const summaryBytes = Number(policy.execution.planSummaryBytes);
    if (!Number.isInteger(summaryBytes) || summaryBytes < 1024 || summaryBytes > 16384)
      fail("foundation.json execution.planSummaryBytes must be 1024..16384");
    for (const type of ["rapid", "standard"]) {
      const tokens = Number(policy.execution.tokenBudgets[type]);
      if (!Number.isInteger(tokens) || tokens < 10000 || tokens > 100000000)
        fail(`foundation.json execution.tokenBudgets.${type} must be 10000..100000000`);
      const requests = Number(policy.execution.requestBudgets[type]);
      if (!Number.isInteger(requests) || requests < 10 || requests > 100000)
        fail(`foundation.json execution.requestBudgets.${type} must be 10..100000`);
    }
    const parallel = Number(policy.execution.maxParallelAgents);
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16)
      fail("foundation.json execution.maxParallelAgents must be an integer from 1 to 16");
    const leaseMinutes = Number(policy.execution.leaseMinutes);
    if (!Number.isFinite(leaseMinutes) || leaseMinutes < 1 || leaseMinutes > 1440)
      fail("foundation.json execution.leaseMinutes must be from 1 to 1440");
    if (!["required", "single-model"].includes(policy.review.diversity))
      fail("foundation.json review.diversity must be required|single-model");
    if (!["required", "self"].includes(policy.review.independence))
      fail("foundation.json review.independence must be required|self");
    for (const tier of ["fast", "standard", "deep"])
      if (!policy.models[tier] || typeof policy.models[tier].family !== "string")
        fail(`foundation.json models.${tier}.family is required`);
    for (const tier of ["fast", "standard", "deep"]) {
      const fallback = policy.models[tier].fallbackTier;
      if (fallback !== null && fallback !== undefined &&
          !["fast", "standard", "deep"].includes(fallback))
        fail(`foundation.json models.${tier}.fallbackTier is invalid`);
      if (tier === "deep" && fallback && fallback !== "deep")
        fail("deep model tier cannot downgrade when unavailable");
    }
    return policy;
  }

  return { protocolDescriptor, commandExists, playwrightAvailability, foundationPolicy };
}
