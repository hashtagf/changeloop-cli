import { devDocumentChecklist, inferWorkTypes } from "./validation/dev-document.mjs";
import { esc } from "./scratch-blocks.mjs";
import { undoPlan } from "./undo-plan.mjs";
import { absenceKind, absenceReason } from "./validation/explicit-absence.mjs";

// Decision cards for the approval page. A declared or inferred work type maps
// to one of seven kinds of decision (A-G); each card pulls the typed draft
// fields that kind of approver needs, and says "unknown" for a field the draft
// lacks instead of guessing. The required-section checklist reuses the rule
// the compiler enforces (`requiredDevSections`); nothing here defines a rule.

// Order on the page: the choices that are hardest to undo come first.
export const CARD_ORDER = Object.freeze(["E", "G", "F", "D", "A", "B", "C"]);
export const WORK_TYPE_CARD = Object.freeze({
  feature: "A", ui: "A", "client-release": "A", experiment: "A",
  bugfix: "B",
  refactor: "C", dependency: "C", config: "C", docs: "C", test: "C", chore: "C",
  api: "D", library: "D", deprecation: "D",
  data: "E", migration: "E", "data-fix": "E",
  async: "F", integration: "F", infra: "F", observability: "F", performance: "F", cicd: "F",
  privacy: "G", ml: "G", security: "G"
});

// Advice, not rules: sections the harness does not require but a reader of that
// kind of work wants, shown apart and never changing whether a draft is valid.
// None are defined today: the ones that used to be advice are now required.
export const RECOMMENDED_BY_TYPE = Object.freeze({});

const list = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const at = (value, path) => path.split(".").reduce((node, part) => node?.[part], value);

// Plain text for a draft value, or null when there is nothing to show.
export function show(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(show).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (isObject(value)) {
    const parts = Object.entries(value).map(([key, item]) => {
      const text = show(item);
      return text ? `${key}: ${text}` : null;
    }).filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  }
  return null;
}

export function cardsFor(types) {
  const found = new Set(types.map((type) => WORK_TYPE_CARD[type]).filter(Boolean));
  return CARD_ORDER.filter((id) => found.has(id));
}

// panel: rows (label/value pairs from one object) or table (one row per item).
// `need` names the work types that owe the source; a missing source for one of
// them reads "unknown", for any other type the panel is simply left out.
const PANELS = Object.freeze({
  A: [
    { key: "userFlow", kind: "rows", source: "userFlow", fields: ["purpose"], need: ["feature", "ui"] },
    { key: "uiStates", kind: "states", source: "uiStates", need: ["ui"] },
    { key: "experimentDesign", kind: "rows", source: "experimentDesign", fields: ["hypothesis", "primaryMetric", "allocation", "decisionRule", "guardrails", "stopRules"], need: ["experiment"] },
    { key: "releasePlan", kind: "rows", source: "releasePlan", fields: ["minimumVersion", "stagedRollout", "crashGate"], need: ["client-release"] }
  ],
  B: [
    { key: "bugfix", kind: "rows", source: "bugfix", fields: ["reproduction", "rootCause", "regression"], need: ["bugfix"] },
    { key: "incident", kind: "rows", source: "bugfix.incident", fields: ["link", "mitigation", "minimumScope", "followUp"], need: [], variant: "hotfix" },
    { key: "disclosure", kind: "rows", source: "bugfix.disclosure", fields: ["class", "affectedVersions", "owner"], need: [], variant: "security" }
  ],
  C: [
    { key: "refactor", kind: "rows", source: "refactor", fields: ["invariants", "characterization"], need: ["refactor"] },
    { key: "dependencyChange", kind: "table", source: "dependencyChange", cols: ["package", "from", "to", "breaking", "cves", "rollbackPin"], need: ["dependency"] },
    { key: "configContract", kind: "table", source: "configContract", cols: ["key", "default", "validation"], need: ["config"] }
  ],
  D: [
    { key: "apiContracts", kind: "table", source: "apiContracts", cols: ["method", "path", "auth", "errors"], need: ["api"] },
    { key: "boundaries", kind: "table", source: "boundaries", cols: ["from", "to", "mode", "timeout", "retry", "owner"], need: ["api"] },
    { key: "libraryContract", kind: "rows", source: "libraryContract", fields: ["semver", "changelog", "exports"], need: ["library"] },
    { key: "deprecationPlan", kind: "rows", source: "deprecationPlan", fields: ["what", "replacement", "warning", "removalCondition", "consumers"], need: ["deprecation"] }
  ],
  E: [
    { key: "dataModel", kind: "table", source: "dataModel", cols: ["entity", "fields", "migration", "rollback"], need: ["data"] },
    { key: "migrationPlan", kind: "rows", source: "migrationPlan", fields: ["from", "to", "cutover", "rollbackWindow", "parity"], need: ["migration"] },
    { key: "rollout", kind: "rows", source: "rollout", fields: ["strategy", "rollback", "deployOrder", "rollbackProof"], need: ["migration"] },
    { key: "dataFix", kind: "rows", source: "dataFix", fields: ["scope", "snapshot", "dryRun", "rerunSafe", "rollback"], need: ["data-fix"] }
  ],
  F: [
    { key: "infraPlan", kind: "rows", source: "infraPlan", fields: ["planDiff", "environments", "blastRadius", "costDelta"], need: ["infra"] },
    { key: "nfr", kind: "table", source: "nfr", cols: ["key", "characteristic", "measure"], need: ["performance"] },
    { key: "performanceAnalysis", kind: "rows", source: "performanceAnalysis", fields: ["baseline", "target", "hypothesis"], need: ["performance"] },
    { key: "jobContract", kind: "table", source: "jobContract", cols: ["key", "states", "retry", "timeout", "idempotency"], need: ["async"] },
    { key: "integrations", kind: "table", source: "integrations", cols: ["key", "kind"], need: ["integration"] },
    { key: "observability", kind: "table", source: "observability.rows", cols: ["failure", "signal", "slo", "alert", "owner"], need: ["observability"] },
    { key: "pipelinePlan", kind: "rows", source: "pipelinePlan", fields: ["changes", "permissions", "blastRadius", "rollback"], need: ["cicd"] }
  ],
  G: [
    { key: "privacyAssessment", kind: "rows", source: "privacyAssessment", fields: ["purpose", "retention"], need: ["privacy"] },
    { key: "privacyData", kind: "table", source: "privacyAssessment.data", cols: ["field", "class"], need: ["privacy"], title: "privacyData" },
    { key: "threatModel", kind: "table", source: "threatModel.threats", cols: ["threat", "likelihood", "impact", "control", "residual"], need: ["privacy", "security"] },
    { key: "hardening", kind: "rows", source: "hardening", fields: ["weakness", "control", "verification"], need: ["security"] },
    { key: "modelCard", kind: "rows", source: "modelCard", fields: ["intendedUse", "model", "fallback", "evaluation"], need: ["ml"] }
  ]
});

function rowsOf(source) {
  if (Array.isArray(source)) return source;
  if (isObject(source) && Array.isArray(source.entities)) return source.entities;
  return [];
}

function cellText(value, col) {
  // Error lists read as "status: when".
  if (col === "errors" && Array.isArray(value))
    return value.map((row) => isObject(row) ? [row.status, row.when].filter(Boolean).join(": ") : show(row)).filter(Boolean).join("; ") || null;
  return show(value);
}

// A "none: why" or "unknown: why" answer reads as that word, marked, and the
// reason; any other answer is shown as written. Everything is escaped.
export function answerHtml(text, t) {
  if (absenceKind(text) !== "reasoned") return esc(text);
  const first = text.trim().split(/[:\s]/)[0].toLowerCase();
  const word = first === "none" || first === "ไม่มี" ? t.cards.noneWord : t.unknown;
  return `<span class="unknown">${esc(word)}</span> ${esc(absenceReason(text))}`;
}

function renderPanel(panel, draft, types, t) {
  const c = t.cards;
  const value = at(draft, panel.source);
  const owed = panel.need.some((type) => types.includes(type));
  const title = c.panels[panel.title || panel.key] || panel.key;
  const unknown = `<span class="unknown">${esc(t.unknown)}</span>`;
  if (panel.kind === "states") {
    const rows = list(value).filter(isObject);
    if (!rows.length) return owed ? `<div class="card"><h3>${esc(title)}</h3><p>${unknown}</p></div>` : "";
    return `<div class="card wide"><h3>${esc(title)}</h3>${rows.map((row) => `<p class="small muted" style="margin:6px 0 2px">${esc(row.screen)}</p><ul class="chips">${
      list(row.states).map((state) => `<li>${esc(state.state)}: ${esc(show(state.shows) || t.unknown)}</li>`).join("")}</ul>` +
      (row.accessibility ? `<p class="small muted" style="margin:4px 0 0">${esc(c.f.accessibility)}: ${esc(show(row.accessibility))}</p>` : "")).join("")}</div>`;
  }
  if (panel.kind === "rows") {
    const object = isObject(value) ? value : null;
    if (!object && !owed) return "";
    const lines = panel.fields.map((field) => {
      const text = object ? cellText(at(object, field), field) : null;
      return `<div class="line"><dt>${esc(c.f[field] || field)}</dt><dd>${text ? answerHtml(text, t) : unknown}</dd></div>`;
    }).join("");
    return `<div class="card"><h3>${esc(title)}</h3><dl>${lines}</dl></div>`;
  }
  const rows = rowsOf(value).filter(isObject);
  if (!rows.length) return owed ? `<div class="card"><h3>${esc(title)}</h3><p>${unknown}</p></div>` : "";
  return `<div class="card wide"><h3>${esc(title)}</h3><div class="scroll"><table><thead><tr>${
    panel.cols.map((col) => `<th scope="col">${esc(c.f[col] || col)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${panel.cols.map((col) => {
      const text = cellText(row[col], col);
      return `<td>${text ? answerHtml(text, t) : unknown}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}

// The author's own line wins; otherwise the answer is read from fields the
// draft already has, and the page says where it came from.
export function undoWho(draft) {
  const scratch = isObject(draft?.scratch) ? draft.scratch : {};
  const own = (key) => typeof scratch[key] === "string" && scratch[key].trim() ? scratch[key].trim() : null;
  const derive = (candidates) => {
    for (const [path, read] of candidates) {
      const text = read(at(draft, path));
      if (text) return { value: text, source: path };
    }
    return null;
  };
  const undo = undoPlan(draft);
  const who = own("who") ? { value: own("who"), source: "scratch.who" } : derive([
    ["deprecationPlan", (plan) => show(plan?.consumers)],
    ["userStories", (stories) => show(list(stories).map((story) => story?.asA))]
  ]);
  return { undo, who };
}

function fact(label, found, t) {
  return `<div class="fact"><b>${esc(label)}</b>${found
    ? `${answerHtml(found.value, t)}<span class="src">${esc(found.source)}</span>`
    : `<span class="unknown">${esc(t.unknown)}</span>`}</div>`;
}

// Sections a reader would like even though the harness does not require them.
function recommendedMissing(draft, types) {
  return [...new Set(types.flatMap((type) => RECOMMENDED_BY_TYPE[type] || []))]
    .filter((path) => !show(at(draft, path)));
}

export function renderChecklist(draft, t) {
  const c = t.cards;
  const types = inferWorkTypes(draft);
  const rows = devDocumentChecklist(draft);
  if (!types.length) return "";
  const recommended = recommendedMissing(draft, types);
  const done = rows.filter((row) => row.present).length;
  const label = (key) => c.sections[key] || key;
  const items = rows.map((row) => row.present
    ? `<li class="y"><span class="mk" aria-hidden="true">✓</span><span>${esc(label(row.key))}</span></li>`
    : `<li class="n"><span class="mk" aria-hidden="true">✕</span><span>${esc(label(row.key))} <span class="why">${esc(c.missingWord)}${
      row.missingFields?.length ? `: ${esc(row.missingFields.map((field) => c.f[field] || field).join(", "))}` : ""}</span></span></li>`);
  for (const path of recommended)
    items.push(`<li class="skip"><span class="mk" aria-hidden="true">!</span><span>${esc(label(path))} <span class="tag rec">${esc(c.recommendedWord)}</span></span></li>`);
  return `<section class="check" id="checklist"><h2>${esc(c.checkTitle)} <span class="muted small">${done} ${esc(c.checkOf)} ${rows.length}${
    recommended.length ? ` · ${esc(c.recommendedWord)} ${recommended.length}` : ""}</span></h2>` +
    (items.length ? `<ul>${items.join("")}</ul>` : `<p class="muted">${esc(c.checkNone)}</p>`) +
    `<p class="legend">${esc(c.checkLegend)}</p></section>`;
}

// Where a diagram reads best: a sequence is an interface story (D, then F), a
// state machine is a data or job story (F, then E), a user flow is a screen
// story (A). The first preferred card that is shown wins; none shown falls back
// to the first card on the page, and no cards at all leaves it for the
// reviewer section. Each diagram is placed exactly once.
const DIAGRAM_PREFERENCE = Object.freeze({ sequence: ["D", "F", "A"], state: ["F", "E", "A"], flow: ["A"], other: ["A"] });

function diagramKind(row) {
  if (row.key === "user-flow") return "flow";
  const head = String(row.source || "").trim().split(/\s+/)[0] || "";
  if (/^sequenceDiagram/i.test(head)) return "sequence";
  if (/^stateDiagram/i.test(head)) return "state";
  return "other";
}

export function placeDiagrams(draft, diagrams) {
  const ids = isObject(draft) ? cardsFor(inferWorkTypes(draft)) : [];
  const byCard = {};
  const leftover = [];
  for (const row of diagrams) {
    const target = DIAGRAM_PREFERENCE[diagramKind(row)].find((id) => ids.includes(id)) || ids[0];
    if (!target) { leftover.push(row); continue; }
    (byCard[target] ||= []).push(row);
  }
  return { byCard, leftover };
}

// One titled frame per diagram: open, collapsible, and scrolling sideways when
// it is wider than the screen. Without Mermaid the source stays readable text.
function diagramFrame(row) {
  return `<details class="diagram" open><summary>${esc(row.purpose || row.key)}</summary>` +
    `<div class="dg"><pre class="mermaid">${esc(row.source)}</pre></div></details>`;
}

export function renderTypeCards(draft, t, { placement = { byCard: {} }, noPrototype = false } = {}) {
  if (!isObject(draft)) return "";
  const c = t.cards;
  const types = inferWorkTypes(draft);
  const ids = cardsFor(types);
  if (!ids.length) return "";
  const variant = String(draft?.bugfix?.variant || "").toLowerCase();
  const { undo, who } = undoWho(draft);
  const cards = ids.map((id) => {
    const panels = PANELS[id].filter((panel) => !panel.variant || panel.variant === variant)
      .map((panel) => renderPanel(panel, draft, types, t)).join("");
    return `<section class="type-card" id="card-${id}" data-card="${id}"><div class="head"><span class="badge">${esc(id)} · ${esc(c.names[id])}</span>` +
      `<p class="q"><span>${esc(c.ask)}</span>${esc(c.asks[id])}</p></div><div class="grid">${panels}</div>` +
      `${list(placement.byCard[id]).map(diagramFrame).join("")}` +
      (id === "A" && noPrototype ? `<p class="notice small" id="no-prototype">${esc(t.noPrototype)}</p>` : "") + `</section>`;
  }).join("");
  return `<section id="type-cards">${cards}<div class="two">${fact(c.undo, undo, t)}${fact(c.who, who, t)}</div></section>`;
}
