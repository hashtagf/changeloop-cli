// Approval scratch fields of a semantic draft: a plain-language `scratch`
// summary and typed concrete `examples`. Both are optional; when present they
// must be well formed so the approval package can render every value escaped.
// Each issue names the exact field so intake returns one batched EDIT.

export const SCRATCH_KEYS = Object.freeze(["get", "asIs", "toBe", "ifFail"]);
// Accepted with the same one-line shape but never required: how to undo the
// change and who it affects. The approval card derives or marks them unknown.
export const OPTIONAL_SCRATCH_KEYS = Object.freeze(["undo", "who"]);
export const SCRATCH_TEXT_MAX = 240;

// type -> { field: rule }. A rule is "text" (non-empty string), "list" (non-empty
// array), "table" ({ cols: [], rows: [] }), or an array of keys every item of a
// non-empty array must carry.
const SCHEMA = Object.freeze({
  prototype: { path: "text" },
  examples: { rules: ["rule", "rows"] },
  api: { endpoints: ["method", "path", "cases"] },
  timeline: { events: ["t", "event"] },
  dataDiff: { table: "text", before: "table", after: "table" },
  lineage: { steps: ["name", "sample"] },
  mermaid: { source: "text" },
  failures: { rows: ["failure", "system", "user"] },
  permission: { roles: "list", actions: ["action", "allow"] },
  plan: { items: ["op", "resource"] },
  snapshot: { cases: ["input", "before", "after"] },
  repro: { steps: "list", actual: "text", expected: "text" },
  perf: { metrics: ["name", "unit"] },
  golden: { cases: ["name", "input", "good"] },
  adr: { question: "text", options: ["name"] },
  rollout: { stages: ["stage"] },
  apiDiff: { changes: ["op", "signature"] },
  strings: { locales: "list", rows: ["key"] },
  alert: { rule: "text", title: "text" },
  privacy: { fields: ["field"] },
  coverage: { rows: ["scenario", "test"] },
  consumers: { rows: ["consumer"] },
  messages: { items: ["subject", "body"] },
  terminal: { lines: "list" },
  doc: { sections: "list" },
  pipeline: { before: "list", after: "list" },
  search: { queries: ["q", "results"] },
  report: { kpis: "list", table: "table" },
  diffSummary: { items: ["op", "path"] }
});
export const EXAMPLE_TYPES = Object.freeze(Object.keys(SCHEMA));
const OPTIONAL_TEXT = ["why", "postBuild", "capability"];

const text = (value) => typeof value === "string" ? value.trim() : "";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const present = (value) => value !== undefined && value !== null && value !== "";

function ruleIssues(value, rule, at, issues) {
  if (rule === "text") {
    if (!text(value) && typeof value !== "number") issues.push(`semantic draft ${at} is required`);
  } else if (rule === "list") {
    if (!Array.isArray(value) || !value.length) issues.push(`semantic draft ${at} must be a non-empty array`);
  } else if (rule === "table") {
    if (!isObject(value) || !Array.isArray(value.cols) || !value.cols.length || !Array.isArray(value.rows))
      issues.push(`semantic draft ${at} must be { cols: [...], rows: [[...]] }`);
  } else if (!Array.isArray(value) || !value.length) {
    issues.push(`semantic draft ${at} is required: a non-empty array of { ${rule.join(", ")} }`);
  } else {
    value.forEach((item, index) => {
      if (!isObject(item)) return issues.push(`semantic draft ${at}[${index}] must be an object`);
      for (const key of rule)
        if (!present(item[key]) || (Array.isArray(item[key]) && !item[key].length))
          issues.push(`semantic draft ${at}[${index}].${key} is required`);
    });
  }
}

// A prototype names a file the agent wrote under .foundation/previews/<change>/.
function prototypePathIssue(path, at) {
  const value = text(path);
  if (!value) return null;
  const parts = value.split(/[\\/]+/);
  if (/^[a-zA-Z]:|^[\\/]/.test(value) || parts.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(value))
    return `semantic draft ${at} must be a relative path inside .foundation/previews/<change>/ without '..'`;
  return null;
}

// A medium or high change is approved from the page, so its four plain lines
// are required there; low stays optional. Only the declared impact counts, and
// only a draft is checked: a started change keeps the draft it was approved with.
export function scratchRequiredIssues(source) {
  const impact = text(source?.impact).toLowerCase();
  if (impact !== "medium" && impact !== "high") return [];
  const scratch = isObject(source?.scratch) ? source.scratch : {};
  return SCRATCH_KEYS.filter((key) => scratch[key] === undefined || !text(scratch[key])).map((key) =>
    `semantic draft scratch.${key} is required for impact ${impact}: ` +
    `one plain line of at most ${SCRATCH_TEXT_MAX} characters for the approver`);
}

export function scratchFieldIssues(source) {
  const issues = [];
  if (source?.scratch !== undefined) {
    if (!isObject(source.scratch)) issues.push("semantic draft scratch must be an object of { get, asIs, toBe, ifFail }");
    else for (const key of [...SCRATCH_KEYS, ...OPTIONAL_SCRATCH_KEYS]) {
      const value = source.scratch[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !text(value) || /\r?\n/.test(value) || text(value).length > SCRATCH_TEXT_MAX)
        issues.push(`semantic draft scratch.${key} must be one line of at most ${SCRATCH_TEXT_MAX} characters`);
    }
  }
  if (source?.examples === undefined) return issues;
  if (!Array.isArray(source.examples)) {
    issues.push("semantic draft examples must be an array of typed example blocks");
    return issues;
  }
  source.examples.forEach((example, index) => {
    const at = `examples[${index}]`;
    if (!isObject(example)) return issues.push(`semantic draft ${at} must be an object`);
    const schema = SCHEMA[example.type];
    if (!schema) return issues.push(`semantic draft ${at}.type must be one of: ${EXAMPLE_TYPES.join(", ")}`);
    if (!text(example.title)) issues.push(`semantic draft ${at}.title is required`);
    for (const key of OPTIONAL_TEXT)
      if (example[key] !== undefined && typeof example[key] !== "string")
        issues.push(`semantic draft ${at}.${key} must be a string`);
    for (const [field, rule] of Object.entries(schema)) ruleIssues(example[field], rule, `${at}.${field}`, issues);
    if (example.type === "prototype") {
      const issue = prototypePathIssue(example.path, `${at}.path`);
      if (issue) issues.push(issue);
    }
  });
  return issues;
}
