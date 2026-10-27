export const QUALITY_PROFILES = Object.freeze({
  "application-js-ts": {
    languages: ["javascript", "typescript"],
    extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"],
    capabilities: ["test", "static-analysis", "coverage", "complexity", "crap", "automated-mutation", "semantic-mutation"]
  },
  "application-go": {
    languages: ["go"], extensions: [".go"],
    capabilities: ["test", "static-analysis", "coverage", "complexity", "crap", "automated-mutation", "semantic-mutation", "compatibility", "resilience"]
  },
  "application-python": {
    languages: ["python"], extensions: [".py"],
    capabilities: ["test", "static-analysis", "coverage", "complexity", "crap", "automated-mutation", "semantic-mutation"]
  },
  "application-php": {
    languages: ["php"], extensions: [".php"],
    capabilities: ["test", "static-analysis", "coverage", "complexity", "crap", "automated-mutation", "semantic-mutation"]
  },
  "script-bash": {
    languages: ["bash"], extensions: [".sh", ".bash"],
    capabilities: ["test", "static-analysis", "semantic-mutation", "state-identity"]
  },
  "database-sql": {
    languages: ["sql"], extensions: [".sql"],
    capabilities: ["static-analysis", "integration", "compatibility", "data-migration", "performance", "semantic-mutation"]
  },
  "database-mongodb": {
    languages: ["mongodb"], extensions: [],
    capabilities: ["integration", "compatibility", "data-migration", "performance", "semantic-mutation"]
  },
  "web-markup": {
    languages: ["html"], extensions: [".html", ".htm"],
    capabilities: ["static-analysis", "browser", "accessibility"]
  },
  "web-style": {
    languages: ["css", "sass"], extensions: [".css", ".scss", ".sass"],
    capabilities: ["static-analysis", "browser", "accessibility"]
  }
});

const FILE_HINTS = Object.freeze({
  "package.json": ["application-js-ts"],
  "tsconfig.json": ["application-js-ts"],
  "go.mod": ["application-go"],
  "pyproject.toml": ["application-python"],
  "requirements.txt": ["application-python"],
  "composer.json": ["application-php"]
});

export function profilesForInventory({ files = [], extensions = [] }) {
  const detected = new Set();
  const names = new Set(files.map((path) => path.split("/").at(-1)));
  for (const [name, profiles] of Object.entries(FILE_HINTS))
    if (names.has(name)) for (const profile of profiles) detected.add(profile);
  const suffixes = new Set(extensions.map((value) => value.toLowerCase()));
  for (const [name, profile] of Object.entries(QUALITY_PROFILES))
    if (profile.extensions.some((extension) => suffixes.has(extension))) detected.add(name);
  return [...detected].sort();
}

export function languagesForProfiles(profiles) {
  return [...new Set(profiles.flatMap((name) => QUALITY_PROFILES[name]?.languages || []))].sort();
}

export function capabilityNamesForProfiles(profiles) {
  return [...new Set(profiles.flatMap((name) => QUALITY_PROFILES[name]?.capabilities || []))].sort();
}

export function validateProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.some((name) => typeof name !== "string"))
    throw new Error("quality profiles must be an array of strings");
  const unknown = profiles.filter((name) => !QUALITY_PROFILES[name]);
  if (unknown.length) throw new Error(`unknown quality profile(s): ${unknown.join(", ")}`);
  return profiles;
}
