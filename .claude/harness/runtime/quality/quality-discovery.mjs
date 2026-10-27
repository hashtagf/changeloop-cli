import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  capabilityNamesForProfiles, languagesForProfiles, profilesForInventory
} from "./language-profiles.mjs";
import {
  requiredControlsForProfiles, semanticFaultsForProfiles
} from "./semantic-fault-catalog.mjs";

const EXCLUDED = new Set([
  ".git", ".claude", ".foundation", "node_modules", "vendor", "target", "dist", "build",
  "coverage", "test-results", ".venv", "venv", "__pycache__"
]);
const EXCLUDED_PATHS = new Set(["openspec/changes/archive"]);
const MARKERS = new Set([
  "package.json", "tsconfig.json", "go.mod", "pyproject.toml", "requirements.txt",
  "composer.json", "phpunit.xml", "phpunit.xml.dist"
]);

export function inventoryRepository(root, { maximumFiles = 10000 } = {}) {
  const files = [];
  const extensions = new Set();
  const markers = new Set();
  let truncated = false;
  const walk = (directory) => {
    if (truncated) return;
    let entries = [];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_PATHS.has(path)) walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maximumFiles) { truncated = true; return; }
      files.push(path);
      const extension = extname(entry.name).toLowerCase();
      if (extension) extensions.add(extension);
      if (MARKERS.has(entry.name)) markers.add(path);
    }
  };
  walk(root);
  return { files, extensions: [...extensions].sort(), markers: [...markers].sort(), truncated };
}

function jsonAt(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function commandProvider(command, extra = {}) {
  return { kind: "command", command, isolation: "read-only", ...extra };
}

export function detectedProviders(root, profiles) {
  const providers = {};
  const packageJson = jsonAt(join(root, "package.json"));
  const scripts = packageJson?.scripts || {};
  if (profiles.includes("application-js-ts")) {
    if (scripts.test) providers.test = commandProvider(["npm", "test"]);
    if (scripts.typecheck) providers["static-analysis"] = commandProvider(["npm", "run", "typecheck"]);
    else if (scripts.lint) providers["static-analysis"] = commandProvider(["npm", "run", "lint"]);
    const crapScript = scripts["foundation:quality:crap"]
      ? "foundation:quality:crap" : scripts["quality:crap"] ? "quality:crap" : null;
    if (crapScript) providers.crap = commandProvider(["npm", "run", crapScript], {
      protocol: "foundation-crap-v1", output: ".foundation/quality/crap.json"
    });
    if (scripts["foundation:quality:mutation"]) providers["automated-mutation"] = commandProvider(["npm", "run", "foundation:quality:mutation"], {
      protocol: "foundation-automated-mutation-v1", output: ".foundation/quality/mutation.json", isolation: "tool"
    });
  }
  if (profiles.includes("application-go")) {
    providers.test ||= commandProvider(["go", "test", "./..."]);
    providers["static-analysis"] ||= commandProvider(["go", "vet", "./..."]);
  }
  if (profiles.includes("application-python")) {
    providers.test ||= commandProvider(["python", "-m", "pytest"]);
    const pyproject = existsSync(join(root, "pyproject.toml"));
    if (pyproject) providers["static-analysis"] ||= commandProvider(["python", "-m", "compileall", "-q", "."]);
  }
  if (profiles.includes("application-php")) {
    const composer = jsonAt(join(root, "composer.json"));
    if (composer?.scripts?.test) providers.test ||= commandProvider(["composer", "test"]);
    if (composer?.scripts?.analyse) providers["static-analysis"] ||= commandProvider(["composer", "analyse"]);
  }
  return providers;
}

function mongoProfile(root, inventory, profiles) {
  const manifests = inventory.markers.filter((path) =>
    ["package.json", "go.mod", "pyproject.toml", "requirements.txt", "composer.json"]
      .includes(path.split("/").at(-1)));
  const mentionsMongo = manifests.some((path) => {
    try { return /mongodb|mongoose|pymongo|mongo-driver/i.test(readFileSync(join(root, path), "utf8")); }
    catch { return false; }
  });
  return mentionsMongo && !profiles.includes("database-mongodb")
    ? [...profiles, "database-mongodb"].sort() : profiles;
}

export function discoverRepositoryQuality(repository) {
  const inventory = inventoryRepository(repository.path);
  let profiles = profilesForInventory({ files: inventory.markers, extensions: inventory.extensions });
  profiles = mongoProfile(repository.path, inventory, profiles);
  const providers = detectedProviders(repository.path, profiles);
  const applicable = capabilityNamesForProfiles(profiles);
  const capabilities = Object.fromEntries(applicable.map((capability) => [capability,
    providers[capability]
      ? { status: "available", adapter: providers[capability].kind,
        tool: providers[capability].command?.[0] || "builtin" }
      : { status: "unsupported", reason: `no configured or safely detected ${capability} provider` }
  ]));
  return {
    protocol: "foundation-quality-capabilities-v1",
    repository: repository.id,
    root: repository.relativePath || ".",
    languages: languagesForProfiles(profiles), profiles, capabilities, providers,
    requiredControls: requiredControlsForProfiles(profiles),
    recommendedSemanticFaults: semanticFaultsForProfiles(profiles),
    inventory: { files: inventory.files.length, truncated: inventory.truncated,
      markers: inventory.markers, extensions: inventory.extensions }
  };
}

export function discoverConsumerQuality(repositories) {
  return {
    protocol: "foundation-quality-discovery-v1",
    generatedAt: new Date().toISOString(),
    repositories: repositories.map(discoverRepositoryQuality)
  };
}
