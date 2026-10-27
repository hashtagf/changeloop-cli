import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { APPROVAL_ROLES, routeChange } from "../contracts/scratch-router.mjs";
import { missingApprovalLanes } from "../core/user-decisions.mjs";
import { esc, packageText, renderExample } from "./scratch-blocks.mjs";
import { placeDiagrams, renderChecklist, renderTypeCards, show } from "./approval-cards.mjs";

// The harness ships Mermaid once; a package loads it by relative path.
export const MERMAID_VENDOR = fileURLToPath(new URL("../../vendor/mermaid.min.js", import.meta.url));

// Approval package: a read-only HTML projection of a compiled change for the
// people who approve it. It reads state, the packet, receipts, and preview
// receipts, and writes only `.foundation/packages/<id>.html`. A label of
// `proof` requires a valid passing receipt; everything else stays a preview
// or design statement so the page never presents unverified work as proven.

const ROLE_LABELS = Object.freeze({
  "product-owner": "Product Owner", "tech-lead": "Tech Lead", qa: "QA",
  devops: "DevOps", security: "Security"
});
const LABEL_TEXT = Object.freeze({
  proof: "proof", preview: "preview", stale: "preview (stale)", none: "no evidence yet"
});

// The typed draft is trusted only when it describes the current revision.
export function currentDraft(state) {
  const source = state?.draftSource;
  if (!source?.draft || Number(source.contractRevision || 0) !== Number(state?.contractRevision || 0)) return null;
  return source.draft;
}

// Route a change from a state value, so callers can route a revision before
// it is saved. Approval lanes fail closed: an amendment leaves the typed draft
// one revision behind, so its last draft and the packet's work types are
// combined rather than either being dropped.
export function routeForState(state, packetWorkTypes = []) {
  const draft = currentDraft(state) ?? state?.draftSource?.draft ?? null;
  const workTypes = [...new Set([...(Array.isArray(draft?.workType) ? draft.workType : []),
    ...(packetWorkTypes || [])])];
  const paths = [
    ...(Array.isArray(draft?.tasks) ? draft.tasks.flatMap((task) => Array.isArray(task?.paths) ? task.paths : []) : []),
    ...(Array.isArray(draft?.fileMap) ? draft.fileMap.map((row) => row?.path).filter(Boolean) : [])
  ];
  // Every data model row kept in the browser means no server migration.
  const models = Array.isArray(draft?.dataModel) ? draft.dataModel : Array.isArray(draft?.dataModel?.entities) ? draft.dataModel.entities : [];
  const browserStorage = models.length > 0 && models.every((row) => String(row?.store || "").toLowerCase() === "browser");
  const exampleTypes = Array.isArray(draft?.examples) ? draft.examples.map((row) => row?.type).filter(Boolean) : [];
  return routeChange({
    workTypes, riskSignals: state?.riskSignals,
    impact: state?.impact, coupling: state?.coupling,
    integrations: draft?.integrations, securityTriggers: state?.securityTriggers, paths,
    browserStorage, exampleTypes
  });
}

// A link the page may follow: an existing regular file whose real path stays
// inside `base`, written relative to the packages folder. Anything else is null.
export function confinedHref(packagesDir, base, path) {
  const value = String(path ?? "").trim();
  if (!value || isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  let real;
  let realBase;
  try {
    real = realpathSync(resolve(base, value));
    realBase = realpathSync(base);
  } catch { return null; }
  if (real !== realBase && !real.startsWith(realBase + sep)) return null;
  try { if (!statSync(real).isFile()) return null; } catch { return null; }
  return relative(realFolder(packagesDir), real).split(sep).map(encodeURIComponent).join("/");
}

// The real path of a folder that may not exist yet: its nearest existing
// ancestor resolved, plus the missing tail, so links match realpath'd targets.
function realFolder(dir) {
  const missing = [];
  let current = resolve(dir);
  while (!existsSync(current)) {
    const parent = resolve(current, "..");
    if (parent === current) return resolve(dir);
    missing.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}

export function draftDiagrams(draft) {
  if (!draft) return [];
  const rows = [];
  if (draft.userFlow?.source) rows.push({ key: "user-flow", purpose: draft.userFlow.purpose, source: draft.userFlow.source });
  if (draft.diagram?.source) rows.push({ key: draft.diagram.key || "diagram", purpose: draft.diagram.purpose, source: draft.diagram.source });
  for (const row of Array.isArray(draft.diagrams) ? draft.diagrams : [])
    if (row?.type === "mermaid" && row.source) rows.push({ key: row.key, purpose: row.purpose, source: row.source });
  return rows;
}

// Preview receipts live outside the receipt store; a revision mismatch is stale.
export function previewReceipts(previewsDir, id, contractRevision) {
  const dir = join(previewsDir, id, "receipts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
    try {
      const value = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (value?.kind !== "preview") return [];
      return [{ ...value, stale: Number(value.contractRevision) !== Number(contractRevision || 0) }];
    } catch { return []; }
  });
}

function artifactLabel(capability, { proven, previews }) {
  if (!capability) return "none";
  if (proven.has(capability)) return "proof";
  const preview = previews.find((row) => row.capability === capability);
  if (preview) return preview.stale ? "stale" : "preview";
  return "none";
}

// Runnable artifacts of a High or Critical change become optional preview
// suggestions, matched to declared providers by capability.
export function previewSuggestions(route, providers, id) {
  if (route.level !== "High" && route.level !== "Critical") return [];
  const seen = new Set();
  return route.artifacts.filter((row) => row.runnable && !seen.has(row.capability) && seen.add(row.capability))
    .map((row) => {
      const matches = providers.filter((provider) => provider.capability === row.capability);
      return {
        capability: row.capability,
        artifact: row.label,
        providers: matches.map((provider) => ({
          name: provider.name,
          external: provider.external,
          command: `claude-foundation preview ${id} --provider ${provider.name}` +
            (provider.external ? " --decision-ref <user-decision>" : "")
        }))
      };
    });
}

// Agreement content behind each artifact, from the current typed draft. Every
// value is escaped; an artifact the agreement does not declare says so.
const list = (value) => Array.isArray(value) ? value : [];
const plain = (value) => value === undefined || value === null ? ""
  : typeof value === "string" ? value : JSON.stringify(value);
// Content renderers take the page text so table headers follow the language.
const tableIn = (t) => (headers, rows) => rows.length
  ? `<div class="content"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(t.head?.[h] || h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(plain(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : "";
const scenarioRows = (draft, keep = () => true) => list(draft?.requirements).flatMap((requirement) =>
  list(requirement.scenarios).filter(keep).map((scenario) => ({ requirement, scenario })));

function contentFor(t) {
  const table = tableIn(t);
  const CONTENT = {
  testmap: (draft) => table(["Requirement", "Scenario", "Kind", "Given", "When", "Then"],
    scenarioRows(draft).map(({ requirement, scenario }) => [requirement.key || requirement.description,
      scenario.name, scenario.kind, scenario.given, scenario.when,
      [scenario.then, ...list(scenario.and)].filter(Boolean).join("; ")])),
  impact: (draft) => table(["Task", "Outcome", "Files"],
    list(draft?.tasks).map((task) => [task.key, task.outcome, list(task.paths).join(", ")])),
  flow: (draft) => [
    table(["Priority", "As a", "I want", "So that"],
      list(draft?.userStories).map((story) => [story.priority, story.asA, story.iWant, story.soThat])),
    table(["Success criteria"], list(draft?.successCriteria).map((row) => [row])),
    table(["Non-goals"], list(draft?.nonGoals).map((row) => [row]))
  ].join(""),
  api: (draft) => table(["Method", "Path", "Auth", "Request", "Response", "Errors"],
    list(draft?.apiContracts).map((row) => [row.method, row.path, row.auth, row.request, row.response,
      list(row.errors).map((error) => `${error.status}: ${error.when}`).join("; ")])),
  erd: (draft) => {
    const model = draft?.dataModel;
    const entities = Array.isArray(model) ? model : list(model?.entities);
    return table(["Entity", "Fields", "Migration"], entities.map((row) => [row.entity || row.name,
      list(row.fields || row.columns).map(plain).join(", "), row.migration || model?.migration]));
  },
  perm: (draft) => table(["Access", "Scenario", "When", "Then"],
    scenarioRows(draft, (scenario) => scenario.access).map(({ scenario }) =>
      [scenario.access, scenario.name, scenario.when, scenario.then])),
  ui: (draft) => table(["Screen", "States", "Accessibility"], list(draft?.uiStates).map((row) => [row.screen,
    list(row.states).map((state) => `${state.state}: ${state.shows}`).join("; "), row.accessibility])),
  state: (draft) => table(["Job", "States", "Retry", "Timeout", "Idempotency"], list(draft?.jobContract)
    .map((row) => [row.key, list(row.states).join(" → "), row.retry, row.timeout, row.idempotency])),
  config: (draft) => table(["Key", "Default", "Validation"],
    list(draft?.configContract).map((row) => [row.key, row.default, row.validation])),
  repro: (draft) => draft?.bugfix ? table(["Reproduction", "Root cause", "Regression"],
    [[draft.bugfix.reproduction, draft.bugfix.rootCause, draft.bugfix.regression]]) : "",
  equiv: (draft) => draft?.refactor ? table(["Invariants", "Characterization"],
    [[draft.refactor.invariants, draft.refactor.characterization]]) : "",
  integ: (draft) => table(["Integration", "Detail"], list(draft?.integrations).map((row) => [row.name || row.key, row])),
  ledger: (draft) => [
    table(["Decision", "Reason"], list(draft?.decisions).map((row) => [row.choice, row.reason])),
    CONTENT.failures(draft)
  ].join(""),
  failures: (draft) => table(["Failure", "User sees", "Recovery"],
    scenarioRows(draft, (scenario) => scenario.kind === "failure").map(({ scenario }) =>
      [scenario.when, scenario.then, scenario.recovery]))
  };
  CONTENT.timeline = CONTENT.state;
  // Concurrency and retry artifacts show only the failures about them.
  const matchingFailures = (pattern) => (draft) => {
    const rows = scenarioRows(draft, (scenario) => scenario.kind === "failure" &&
      pattern.test([scenario.name, scenario.given, scenario.when, scenario.then].join(" ")));
    if (!rows.length) return scenarioRows(draft, (scenario) => scenario.kind === "failure").length
      ? `<p class="undeclared">${esc(t.noFailure)}</p>` : "";
    return table(["Failure", "User sees", "Recovery"],
      rows.map(({ scenario }) => [scenario.when, scenario.then, scenario.recovery]));
  };
  CONTENT.concur = matchingFailures(CONCURRENCY);
  CONTENT.retry = matchingFailures(RETRY);
  return CONTENT;
}
const CONCURRENCY = /พร้อมกัน|concurren|simultan|double|twice|ซ้ำ|race|parallel|idempot/i;
const RETRY = /retry|ลองใหม่|timeout|time out|หมดเวลา|dead.?letter|dlq|backoff|ซ้ำ/i;

export function artifactContent(id, draft, t = packageText("en")) {
  if (!draft) return "";
  const render = contentFor(t)[id];
  if (!render) return "";
  const html = render(draft);
  return html || `<p class="undeclared">${esc(t.undeclared)}</p>`;
}

// A preview's observed result, labeled as preview so it never reads as proof.
export function previewOutput(preview, t = packageText("en")) {
  if (!preview) return "";
  return `<div class="preview-run"><p>${esc(t.previewWord)} <code>${esc(preview.provider)}</code>: ` +
    `<span class="label label-${preview.stale ? "stale" : "preview"}">${esc(preview.status)}${preview.stale ? ", stale" : ""}</span> ` +
    `${esc(t.previewOnly)}</p>` +
    (preview.artifact ? `<p><a href="../previews/${encodeURIComponent(preview.changeId || "")}/${
      String(preview.artifact).split("/").map(encodeURIComponent).join("/")}">${esc(t.openPreview)}</a></p>` : "") +
    `${preview.outputTail ? `<pre>${esc(preview.outputTail)}</pre>` : ""}</div>`;
}

// The after-Build view of one example: a valid passing receipt is proof, a
// failing receipt says so, a preview stays a preview, and nothing found says
// what Build will be compared against.
function exampleActual(example, model, t) {
  const capability = typeof example.capability === "string" ? example.capability.trim() : "";
  const result = capability ? (model.results || []).find((row) => row.capability === capability) : null;
  const preview = capability ? (model.previews || []).find((row) => row.capability === capability) : null;
  const links = (hrefs) => hrefs.filter(Boolean).map((href) =>
    `<p><a href="${esc(href)}">${esc(t.openArtifact)}</a> <code>${esc(decodeURIComponent(href.split("/").pop()))}</code></p>`).join("");
  let state = "none";
  let body = "";
  if (result?.status === "pass" && result.valid) {
    state = "proof";
    body = `<p>${esc(result.provider)}: pass</p>${links(result.hrefs)}`;
  } else if (result?.status === "fail") {
    state = "fail";
    body = `<p>${esc(result.provider)}: fail</p>${links(result.hrefs)}`;
  } else if (preview) {
    state = preview.stale ? "stale" : "preview";
    body = `<p>${esc(preview.provider)}: ${esc(preview.status)}</p>${links([preview.href])}` +
      (preview.outputTail ? `<pre>${esc(preview.outputTail)}</pre>` : "");
  } else {
    body = `<p>${esc(t.noResult)}</p>` + (example.postBuild ? `<p class="muted">${esc(t.willCompare)} ${esc(example.postBuild)}</p>` : "");
  }
  return `<p><span class="label label-${state}">${esc(t[state])}</span></p>${body}`;
}

function exampleSection(example, index, model, t) {
  const name = `ex${index}`;
  return `<section class="block" id="example-${index}"><div class="block-h"><h3>${esc(example.title)}</h3>` +
    (example.why ? `<p class="muted small">${esc(example.why)}</p>` : "") + `</div>` +
    `<div class="tabs"><input type="radio" class="sr" id="${name}-a" name="${name}" checked><label for="${name}-a">${esc(t.agreed)}</label>` +
    `<input type="radio" class="sr" id="${name}-r" name="${name}"><label for="${name}-r">${esc(t.actual)}</label>` +
    `<div class="panel p1">${renderExample(example, t, { prototypeHref: model.prototypeHref })}</div>` +
    `<div class="panel p2">${exampleActual(example, model, t)}</div></div></section>`;
}

// The spec is approved for the revision on the page when consent exists and
// matches it; a change without a typed draft has no verifiable approval claim.
export function approvalStatus(state, missingLanes = []) {
  const approval = state?.specApproval;
  const approved = Boolean(approval?.identity) && Number(approval.revision) === Number(state?.contractRevision || 0);
  return { approved, missingLanes: approved ? [] : missingLanes };
}

// Counts the page can derive from the draft; null means unknown, never zero.
export function scopeCounts(draft) {
  const tasks = Array.isArray(draft?.tasks) ? draft.tasks : null;
  const paths = tasks ? new Set(tasks.flatMap((task) => Array.isArray(task?.paths) ? task.paths : [])) : null;
  const requirements = Array.isArray(draft?.requirements) ? draft.requirements : null;
  return {
    files: paths && paths.size ? paths.size : null,
    questions: Array.isArray(draft?.openQuestions) ? openQuestions(draft).length : null,
    failures: requirements ? requirements.flatMap((row) => list(row.scenarios)).filter((row) => row.kind === "failure").length : null
  };
}

function scopeStrip(model, t) {
  if (model.legacy) return "";
  const counts = scopeCounts(model.draft);
  const item = (value, word) => `<li><b>${value === null ? esc(t.unknown) : esc(value)}</b> ${esc(word)}</li>`;
  return `<section class="scope" id="scope" aria-label="${esc(t.scope)}"><ul>${item(counts.files, t.filesWord)}` +
    `${item(counts.questions, t.questionsWord)}${item(counts.failures, t.failuresWord)}</ul></section>`;
}

// One quiet line under the header: this revision is approved, or the roles that
// have not approved yet. The page records and asks nothing; the decision is
// made in the chat.
function statusLine(model, t) {
  const { approved, missingLanes } = model.approval ?? { approved: false, missingLanes: [] };
  if (approved) return `<p class="notice status" id="approval-status">${esc(t.approvedBanner)}</p>`;
  return missingLanes.length
    ? `<p class="warn status" id="pending-lanes">${esc(t.pendingLanes)} ${esc(missingLanes.join(", "))}</p>` : "";
}

// The risk level and hero below replace the chip-only header of
// the first approval-page change; everything else of that change is kept.
const RISK_STEP = Object.freeze({ Low: 1, Medium: 2, High: 3, Critical: 4 });

// A risk reason arrives as a code (`impact:high`, `risk:financial`,
// `path:db/x.sql→persisted-data-change`); the page says it in words.
export function reasonText(reason, t) {
  const text = String(reason);
  const [kind, rest = ""] = [text.slice(0, text.indexOf(":")), text.slice(text.indexOf(":") + 1)];
  if (kind === "impact") return t.reasons.impact[rest] || text;
  if (kind === "risk") return t.reasons.risk[rest] || text;
  if (kind === "path") {
    const [path, signal] = rest.split("→");
    return `${t.reasons.path} ${path}${signal && t.reasons.risk[signal] ? ` (${t.reasons.risk[signal]})` : ""}`;
  }
  return text;
}

// Level as a word and symbol, a four-step scale, and the reasons in words, so
// colour is never the only carrier of the level.
function riskBlock(route, state, t) {
  const step = RISK_STEP[route.level] || 1;
  const labels = Object.keys(RISK_STEP);
  return `<div class="riskbox"><p><span class="chip risk risk-${esc(route.level)}">${esc(t.risk)}: ${esc(t.riskLevels?.[route.level] || route.level)}</span>` +
    ` <span class="muted small">${esc(t.riskScale.replace("{n}", step))} · ${esc(t.riskBasis)} · ${esc(t.revision)} ${esc(state.contractRevision || 0)}</span></p>` +
    `<ul class="meter lvl-${esc(route.level)}" aria-hidden="true">${labels.map((_, index) => `<li${index < step ? ' class="on"' : ""}></li>`).join("")}</ul>` +
    `<p class="meter-labels" aria-hidden="true">${labels.map((name) => `<span${name === route.level ? ' class="on"' : ""}>${esc(t.riskWords[name])}</span>`).join("")}</p>` +
    (route.reasons.length ? `<ul class="why" id="risk-why" aria-label="${esc(t.riskWhy)}">${route.reasons.map((reason) => `<li>${esc(reasonText(reason, t))}</li>`).join("")}</ul>` : "") + `</div>`;
}

// Questions arrive as strings or as { question | text } rows.
function openQuestions(draft) {
  return list(draft?.openQuestions).map((row) => typeof row === "string" ? row : row?.question ?? row?.text)
    .map((text) => String(text ?? "").trim()).filter(Boolean);
}

function questionsBox(model, t) {
  const questions = openQuestions(model.draft);
  if (!questions.length) return "";
  return `<section class="ask-box" id="open-questions" role="note"><h2>${esc(t.questionsBox)} (${questions.length})</h2>` +
    `<ul>${questions.map((text) => `<li>${esc(text)}</li>`).join("")}</ul><p class="small">${esc(t.questionsHint)}</p></section>`;
}

// Failure scenarios become cards of when / what happens / recovery, the same
// rows the scope strip counts; with none, the section is left out.
function failureRows(draft) {
  return list(draft?.requirements).flatMap((requirement) => list(requirement?.scenarios))
    .filter((scenario) => scenario?.kind === "failure")
    .map((scenario) => ({ when: show(scenario.when) || show(scenario.name), sees: show(scenario.then), recovery: show(scenario.recovery) }));
}

function failureCards(model, t) {
  const rows = failureRows(model.draft).filter((row) => row.when || row.sees);
  if (!rows.length) return "";
  return `<section class="block" id="failure-cards"><h2>${esc(t.failureCards)}</h2><div class="fail">${rows.map((row) =>
    `<div class="row"><div class="trig">${esc(row.when || t.unknown)}</div>` +
    `<div><span>${esc(t.seesWord)}</span>${esc(row.sees || t.unknown)}</div>` +
    (row.recovery ? `<div><span>${esc(t.recoverWord)}</span>${esc(row.recovery)}</div>` : "") + `</div>`).join("")}</div></section>`;
}

function heroSection(model, t) {
  const scratch = model.draft?.scratch && typeof model.draft.scratch === "object" ? model.draft.scratch : {};
  const line = (key) => typeof scratch[key] === "string" && scratch[key].trim() ? scratch[key].trim() : "";
  const any = ["get", "asIs", "toBe", "ifFail"].some((key) => line(key));
  if (!any) return `<section class="hero" id="scratch"><p class="q-get"><b>${esc(t.get)}</b>${esc(model.state.intent || model.id)}</p>` +
    `<p class="notice warn small">${esc(t.scratchMissing)}</p></section>`;
  const side = (key, tag, cls) => line(key)
    ? `<div class="card ${cls}"><span class="side-tag">${esc(tag)}</span>${esc(line(key))}</div>` : "";
  const before = side("asIs", t.before, "before");
  const after = side("toBe", t.after, "after");
  return `<section class="hero" id="scratch">` +
    (line("get") ? `<p class="get"><b>${esc(t.get)}</b>${esc(line("get"))}</p>` : "") +
    (before || after ? `<div class="ba${before && after ? "" : " single"}">${before}${before && after ? '<div class="arrow" aria-hidden="true">→</div>' : ""}${after}</div>` : "") +
    (line("ifFail") ? `<p class="q q-fail"><b>${esc(t.ifFail)}</b>${esc(line("ifFail"))}</p>` : "") +
    // Without both sides the before/after cards are left out and the gap is said.
    (!line("asIs") && !line("toBe") ? `<p class="notice warn small">${esc(t.scratchMissing)}</p>` : "") + `</section>`;
}

// Cards and checklist are reading aids: a failure to build them is a warning
// on the page, never a reason to withhold the rest.
function safely(build, t) {
  try { return build(); } catch (error) {
    return `<p class="notice warn small">${esc(t.cardsFailed)} (${esc(String(error?.message || error).split("\n")[0])})</p>`;
  }
}

export function renderApprovalPackage(model) {
  const { id, state, route, draft, diagrams, artifacts, suggestions, legacy, proposal } = model;
  const t = packageText(draft?.language);
  const declared = Array.isArray(draft?.examples) ? draft.examples.filter((row) => row && typeof row === "object") : [];
  // A prototype is what an approver most wants to see: it goes first and open;
  // the rest keep their order.
  const examples = [...declared.filter((row) => row.type === "prototype"), ...declared.filter((row) => row.type !== "prototype")];
  const evidenceText = { proof: t.proof, preview: t.preview, stale: t.stale, none: t.noEvidence };
  const artifactName = (row) => t.artifactNames?.[row.id] || row.label;
  const roleSections = APPROVAL_ROLES.map((role) => {
    const mine = artifacts.filter((row) => row.roles.includes(role));
    const body = mine.length
      ? `<table><thead><tr><th scope="col">${esc(t.artifactCol)}</th><th scope="col">${esc(t.domainsCol)}</th><th scope="col">${esc(t.evidenceCol)}</th></tr></thead><tbody>${
        mine.map((row) => `<tr><td>${esc(artifactName(row))}</td><td>${esc(row.domains.join(", ") || t.allChanges)}</td>` +
          `<td><span class="label label-${row.evidence}">${esc(evidenceText[row.evidence] || LABEL_TEXT[row.evidence])}</span></td></tr>`).join("")
      }</tbody></table>`
      : `<p>${esc(t.noRole)}</p>`;
    const details = mine.map((row) => {
      const content = artifactContent(row.id, draft, t) + previewOutput(row.preview, t);
      return content ? `<details class="artifact" open><summary>${esc(artifactName(row))}</summary>${content}</details>` : "";
    }).join("");
    return `<section class="role" id="role-${role}"><h3>${esc(ROLE_LABELS[role])}</h3>${body}${details}</section>`;
  }).join("\n");
  // Diagrams sit in the cards they explain; only those no card took stay in the
  // reviewer section. If the cards cannot be built, every diagram stays there.
  let typeCards = "";
  let leftover = diagrams;
  if (!legacy) {
    try {
      const placement = placeDiagrams(draft, diagrams);
      typeCards = renderTypeCards(draft, t, { placement, noPrototype: !examples.some((row) => row.type === "prototype") });
      leftover = placement.leftover;
    } catch (error) { typeCards = safely(() => { throw error; }, t); }
  }
  const diagramBlocks = leftover.length
    ? leftover.map((row) => `<details class="diagram" open><summary>${esc(row.purpose || row.key)}</summary>` +
      `<div class="dg"><pre class="mermaid">${esc(row.source)}</pre></div></details>`).join("\n")
    : diagrams.length ? "" : `<p>${esc(t.noDiagrams)}</p>`;
  const needsMermaid = diagrams.length > 0 || examples.some((row) => row.type === "mermaid");
  const mermaid = needsMermaid && model.mermaidHref ? `<script src="${esc(model.mermaidHref)}"></script>` : "";
  const OPEN_EXAMPLES = 2;
  const exampleBlocks = examples.length
    ? `<section id="examples"><h2>${esc(t.examples)}</h2>${
      examples.slice(0, OPEN_EXAMPLES).map((row, index) => exampleSection(row, index, model, t)).join("\n")}${
      examples.length > OPEN_EXAMPLES
        ? `<details id="more-examples"><summary>${esc(t.moreExamples)} (${examples.length - OPEN_EXAMPLES})</summary>${
          examples.slice(OPEN_EXAMPLES).map((row, index) => exampleSection(row, index + OPEN_EXAMPLES, model, t)).join("\n")}</details>`
        : ""}</section>` : "";
  const reviewerCount = artifacts.length + leftover.length + suggestions.length;
  const suggestionBlock = suggestions.length
    ? `<section id="preview-suggestions"><h2>${esc(t.suggestions)}</h2><p>${esc(t.suggestionsNote)}</p><ul>${
      suggestions.map((row) => `<li><strong>${esc(row.artifact)}</strong> (${esc(t.capabilityWord)} <code>${esc(row.capability)}</code>): ${
        row.providers.length
          ? row.providers.map((provider) => `<code>${esc(provider.command)}</code>${provider.external
            ? ` <span class="label label-none">${esc(t.externalRef)}</span>` : ""}`).join("; ")
          : `${esc(t.noProvider)} <code>${esc(row.capability)}</code> ${esc(t.noProviderTail)}`
      }</li>`).join("")}</ul></section>`
    : "";
  const allWarnings = [...route.warnings, ...(model.notices || [])];
  const warnings = allWarnings.length
    ? `<ul class="warnings">${allWarnings.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : "";
  return `<!doctype html>
<html lang="${esc(t === packageText("th") ? "th" : draft?.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(id)} approval package</title>
<style>
:root { --bg: #f6f7f9; --fg: #17212b; --muted: #5a6876; --line: #d5dce3; --accent: #1f5f8b; --ok: #2e7d4f; --warn: #9a6400; --bad: #b3261e; --high: #b8530a; --card: #ffffff; --shadow: 0 1px 2px rgba(16, 24, 40, .07), 0 2px 8px rgba(16, 24, 40, .04);
  --sans: "Sukhumvit Set", "Leelawadee UI", "Noto Sans Thai", Thonburi, Tahoma, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #11171d; --fg: #e4eaf0; --muted: #94a3b2; --line: #2a3644; --accent: #6fb0dd; --ok: #6cc596; --warn: #e8b052; --bad: #ff9088; --high: #ffa05c; --card: #19222b; --shadow: none; color-scheme: dark; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.75 var(--sans); }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 24px; min-width: 0; }
main > * { min-width: 0; }
h1, h2, h3 { line-height: 1.25; margin: 0 0 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.label { font-size: .8em; padding: 1px 8px; border-radius: 4px; border: 1px solid currentColor; white-space: nowrap; }
.label-proof { color: var(--ok); } .label-preview, .label-stale { color: var(--warn); } .label-none { color: var(--muted); }
.notice { border: 1px dashed var(--warn); padding: 8px 12px; border-radius: 6px; }
pre.mermaid { overflow-x: auto; background: transparent; border: 1px solid var(--line); padding: 8px; }
.role { border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
.artifact summary { font-weight: 600; cursor: pointer; }
.content { overflow-x: auto; margin-top: 6px; }
.content table { font-size: .9em; }
.undeclared { color: var(--muted); font-style: italic; margin: 6px 0 0; }
.preview-run { border-left: 3px solid var(--warn); padding-left: 10px; margin-top: 8px; }
.preview-run pre { overflow-x: auto; white-space: pre-wrap; font-size: .85em; margin: 4px 0 0; }
.muted { color: var(--muted); } .small { font-size: .88em; } p { margin: 0 0 4px; } code, pre { overflow-wrap: anywhere; }
.hero { display: grid; gap: 8px; }
.q { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin: 0; }
.q b, .q-get b { display: block; font-size: .82em; color: var(--muted); }
.q-get { border-left: 4px solid var(--accent); } .q-change { border-left: 4px solid var(--ok); } .q-fail { border-left: 4px solid var(--warn); }
.asis { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; } .asis span { min-width: 0; }
.block { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: grid; gap: 8px; margin-bottom: 12px; min-width: 0; }
.block-h h3 { margin: 0; }
.tabs { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: center; }
.tabs > label { border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; cursor: pointer; font-size: .9em; }
.tabs > input:checked + label { border-color: var(--fg); font-weight: 600; }
.tabs > input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px; }
.tabs > .panel { grid-column: 1 / -1; display: none; gap: 8px; min-width: 0; }
.tabs > input:nth-of-type(1):checked ~ .p1, .tabs > input:nth-of-type(2):checked ~ .p2 { display: grid; }
.sr { position: absolute; width: 1px; height: 1px; opacity: 0; }
.scroll { overflow-x: auto; } .box { border: 1px solid var(--line); border-radius: 8px; min-width: 0; }
.box-h { margin: 0; padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: .82em; color: var(--muted); }
.box pre, .stp pre, .term, .doc pre { margin: 0; padding: 8px; white-space: pre-wrap; font-size: .85em; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.cards { display: grid; gap: 8px; }
.ex, .opt { border: 1px solid var(--line); border-left: 4px solid var(--k, var(--ok)); border-radius: 8px; padding: 8px 10px; min-width: 0; }
.k-boundary { --k: var(--accent); } .k-failure { --k: #c4372c; } .k-success { --k: var(--ok); }
.ex-h { display: flex; justify-content: space-between; gap: 8px; } .ex-h span { font-size: .8em; color: var(--k); font-weight: 600; }
.l { display: inline-block; min-width: 3.5em; color: var(--muted); font-size: .85em; }
.rule { font-weight: 600; color: var(--accent); }
.ep { display: grid; gap: 6px; } .method { font-weight: 700; color: var(--accent); }
.chip { border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; font-size: .8em; }
.case summary { cursor: pointer; } .status { font-weight: 700; } .s2 { color: var(--ok); } .s4, .s5 { color: #c4372c; }
.add { color: var(--ok); } .chg { color: var(--warn); } .del { color: #c4372c; text-decoration: line-through; }
.yes { color: var(--ok); font-weight: 600; } .no { color: #c4372c; font-weight: 600; } .warn { color: var(--warn); }
.plan { list-style: none; margin: 0; padding: 0; font-family: ui-monospace, monospace; font-size: .85em; }
.tl { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.tl li { display: grid; grid-template-columns: 70px 10px 1fr; gap: 8px; } .tl-t { color: var(--muted); font-size: .85em; text-align: right; }
.tl-d { width: 10px; height: 10px; border-radius: 50%; background: var(--k, var(--accent)); margin-top: 6px; }
.st { font-size: .8em; border: 1px solid currentColor; border-radius: 4px; padding: 0 6px; }
.bars { display: grid; gap: 4px; } .bar-row { display: grid; grid-template-columns: 110px 1fr 80px; gap: 8px; align-items: center; font-size: .88em; }
.track { height: 10px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; } .fill { display: block; height: 100%; }
.fill.now { background: #c4372c; } .fill.target { background: var(--ok); }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.kpi { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; } .kpi b { display: block; font-size: 1.15em; }
.push, .msg, .doc, .stp { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.cta { border: 1px solid var(--accent); color: var(--accent); border-radius: 6px; padding: 2px 10px; }
.term { background: #0d1117; color: #d6deeb; border-radius: 8px; } .t-p { color: #7fdbca; } .t-e { color: #ff8f86; } .t-o { color: #c5e478; }
.pipe span { border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; } .lin .arrow { text-align: center; color: var(--muted); }
.frame { width: 100%; height: 560px; border: 1px solid var(--line); border-radius: 8px; }
.label-fail { color: #c4372c; }
.risk { font-weight: 600; } .risk-High, .risk-Critical { color: #c4372c; } .risk-Medium { color: var(--warn); } .risk-Low { color: var(--ok); }
.decision-needed { font-size: 1.1em; margin: 4px 0; }
.scope ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; }
.scope li b { font-size: 1.25em; }
#reviewer-details > summary { cursor: pointer; padding: 8px 0; }
h1, h2, h3 { font-weight: 600; }
h1 { font-size: 1.9rem; letter-spacing: -.01em; overflow-wrap: anywhere; }
.diagram { border: 1px solid var(--line); border-radius: 10px; background: var(--card); box-shadow: var(--shadow); margin-top: 12px; }
.diagram > summary { cursor: pointer; padding: 8px 14px; font-weight: 600; }
.diagram .dg { overflow-x: auto; padding: 0 14px 12px; }
.diagram pre.mermaid { border: 0; padding: 0; margin: 0; }
.riskbox { display: grid; gap: 6px; } .riskbox .chip { font-size: 1em; padding: 2px 12px; }
.meter { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; list-style: none; margin: 0; padding: 0; }
.meter li { height: 10px; border: 1.5px solid var(--muted); border-radius: 3px; } .meter li.on { background: var(--fg); border-color: var(--fg); }
.meter.lvl-Low li.on { background: var(--ok); border-color: var(--ok); } .meter.lvl-Medium li.on { background: var(--warn); border-color: var(--warn); }
.meter.lvl-High li.on { background: var(--high); border-color: var(--high); } .meter.lvl-Critical li.on { background: var(--bad); border-color: var(--bad); }
.status { margin: 4px 0 0; }
.meter-labels { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; font-size: .78em; color: var(--muted); margin: 0; }
.meter-labels .on { color: var(--fg); font-weight: 700; }
.why { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
.why li { border: 1px dashed var(--muted); border-radius: 14px; padding: 0 12px; font-size: .88em; max-width: 100%; overflow-wrap: anywhere; }
.get { font-size: 1.3em; line-height: 1.5; border-left: 5px solid var(--ok); padding: 4px 0 4px 16px; margin: 0; } .get b { display: block; font-size: .6em; color: var(--muted); font-weight: 600; }
.ba { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: stretch; } .ba.single { grid-template-columns: 1fr; }
.ba .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; box-shadow: var(--shadow); }
.ba .side-tag { display: block; width: fit-content; font: 700 .8em ui-monospace, Menlo, monospace; letter-spacing: .06em; margin-bottom: 4px; }
.ba .before { border-top: 4px solid var(--bad); } .ba .before .side-tag { color: var(--bad); }
.ba .after { border-top: 4px solid var(--ok); } .ba .after .side-tag { color: var(--ok); }
.ba .arrow { align-self: center; font-size: 1.6rem; color: var(--muted); }
.ask-box { border: 2px solid var(--warn); border-radius: 10px; padding: 12px 16px; background: var(--card); } .ask-box h2 { font-size: 1.05em; } .ask-box ul { margin: 4px 0; padding-left: 1.2em; }
.fail { display: grid; gap: 10px; } .fail .row { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; box-shadow: var(--shadow); display: grid; gap: 6px 12px; grid-template-columns: 1fr 1fr; }
.fail .row > div > span { display: block; font: 700 .72em ui-monospace, Menlo, monospace; color: var(--muted); }
.fail .trig { grid-column: 1 / -1; font-weight: 600; border-bottom: 1px dashed var(--line); padding-bottom: 4px; } .fail .trig::before { content: "⚠ "; color: var(--warn); }
.type-card { display: grid; gap: 10px; } .type-card + .type-card { margin-top: 18px; }
.type-card .head { display: grid; gap: 6px; } .badge { font: 700 .78em ui-monospace, Menlo, monospace; letter-spacing: .06em; color: var(--muted); }
.type-card .q { background: var(--card); border-left: 5px solid var(--warn); border-radius: 6px; padding: 8px 14px; font-weight: 600; margin: 0; } .type-card .q span { display: block; color: var(--warn); font-size: .8em; }
.grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; } .grid .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; min-width: 0; box-shadow: var(--shadow); } .grid .card h3 { font-size: 1rem; color: var(--muted); }
.grid .wide { grid-column: 1 / -1; }
.line { display: grid; grid-template-columns: 7.5em 1fr; gap: 4px 12px; padding: 4px 0; border-bottom: 1px dashed var(--line); } .line:last-child { border-bottom: 0; } .line dt { color: var(--muted); font-size: .88em; } .line dd { margin: 0; } dl { margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; } .chips li { border: 1.5px solid var(--line); border-radius: 14px; padding: 0 12px; font-size: .92em; max-width: 100%; overflow-wrap: anywhere; }
.two { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin-top: 12px; } .fact { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; box-shadow: var(--shadow); } .fact b { display: block; font-size: .8em; color: var(--muted); }
.src { font: 600 .72em ui-monospace, Menlo, monospace; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; margin-left: 6px; } .unknown { color: var(--warn); font-weight: 600; }
.check { background: var(--card); border: 2px solid var(--fg); border-radius: 12px; padding: 12px 16px; box-shadow: var(--shadow); } .check h2 { font-size: 1rem; }
.check ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px 20px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); } .check li { display: flex; gap: 8px; align-items: baseline; }
.mk { font-weight: 700; min-width: 1.4em; } .check .y .mk { color: var(--ok); } .check .n { background: rgba(179, 38, 30, .12); border-radius: 6px; padding: 0 6px; margin: 0 -6px; } .check .n .mk, .check .n .why { color: var(--bad); }
.tag.rec, .check .skip .mk { color: var(--warn); } .tag { font: 700 .7em ui-monospace, Menlo, monospace; border: 1.5px solid currentColor; border-radius: 4px; padding: 0 6px; white-space: nowrap; } .legend { font-size: .82em; color: var(--muted); margin: 8px 0 0; }
@media (max-width: 640px) {
  .ba, .grid, .two, .fail .row { grid-template-columns: 1fr; } .ba .arrow { transform: rotate(90deg); justify-self: center; } .line { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<main>
<header>
<h1>${esc(id)}</h1>
<p class="decision-needed"><strong>${esc(t.decisionNeeded)}</strong></p>
${riskBlock(route, state, t)}
${statusLine(model, t)}
${legacy ? `<p class="notice">${esc(t.legacy)}</p>` : ""}
${warnings}
</header>
${heroSection(model, t)}
${scopeStrip(model, t)}
${typeCards}
${legacy ? "" : safely(() => renderChecklist(draft, t), t)}
${failureCards(model, t)}
${exampleBlocks}
${questionsBox(model, t)}
<details id="reviewer-details"><summary><strong>${esc(t.reviewerDetails)}</strong> <span class="muted small">(${reviewerCount} ${esc(t.reviewerSummary)})</span></summary>
<p class="notice">${esc(t.readOnly)}</p>
<section id="summary"><h2>${esc(t.summary)}</h2><p>${esc(proposal || state.intent || "")}</p>
<p>${esc(t.intent)} ${esc(route.intents.join(", "))}</p>
<p>${esc(t.packet)} <code>openspec/changes/${esc(id)}/</code></p></section>
<section id="domains"><h2>${esc(t.domains)}</h2><ul>${
  route.domains.map((row) => `<li>${esc(row.id)}. ${esc(row.name)}</li>`).join("") || `<li>${esc(t.noDomain)}</li>`}</ul></section>
<section id="roles"><h2>${esc(t.roles)}</h2>
${roleSections}
</section>
${suggestionBlock}
${diagramBlocks ? `<section id="diagrams"><h2>${esc(t.diagrams)}</h2>\n${diagramBlocks}\n</section>` : ""}
</details>
</main>
${mermaid}
</body>
</html>
`;
}

// Relative path from the packages folder to a harness file; null when no
// relative form exists (for example, another drive).
function vendorHref(packagesDir, file) {
  const path = relative(realFolder(packagesDir), realpathSync(file));
  if (!path || isAbsolute(path)) return null;
  return path.split(sep).map(encodeURIComponent).join("/");
}

function proposalSummary(path) {
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  const match = text.match(/^## (?:Summary|สรุป)\s*\n+([\s\S]*?)(?=\n## |$)/m);
  return (match ? match[1] : "").trim();
}

export function createApprovalPackageRuntime({
  root, runtimeDir, packagesDir, previewsDir, receiptsDir, loadRuntime, activeChangePath,
  changeWorkTypes, evidence, providerCapability, receiptValidity, fail,
  // Runs a harness call so its failure throws instead of exiting the process;
  // the package is a reading aid and survives broken evidence wiring.
  trap = (operation) => operation()
}) {
  const message = (error) => String(error?.message || error).split("\n")[0];
  function buildModel(id) {
    if (!existsSync(join(runtimeDir, `${id}.json`))) fail(`package: unknown change '${id}'`);
    const state = loadRuntime(id);
    const packet = activeChangePath(id, state);
    const draft = currentDraft(state);
    const route = routeForState(state, draft ? [] : changeWorkTypes(packet));
    const notices = [];
    let configured = {};
    let previewOnly = {};
    try {
      const contract = trap(() => evidence(id));
      configured = contract.providers || {};
      previewOnly = contract.previewProviders || {};
    } catch (error) {
      configured = {};
      notices.push(`evidence not read (${message(error)}); providers, proof labels, and suggestions are omitted`);
    }
    const describe = ([name, config]) => ({
      name, capability: providerCapability(name, config), external: config?.external === true
    });
    // Proof labels come only from Prove providers; suggestions also offer preview-only ones.
    const providers = Object.entries(configured).map(describe);
    const suggestable = [...providers, ...Object.entries(previewOnly).map(describe)];
    const proven = new Set();
    // Per-capability outcome for the after-Build tab of each example. Artifact
    // links are confined to this change's evidence folder.
    const results = [];
    const evidenceBase = join(root, ".foundation", "evidence", id);
    const record = (provider, receipt, valid) => {
      if (!provider.capability || !receipt || receipt.kind === "preview") return;
      const hrefs = (Array.isArray(receipt.artifacts) ? receipt.artifacts : [])
        .map((artifact) => confinedHref(packagesDir, evidenceBase, relative(evidenceBase, resolve(root, String(artifact?.path || "")))));
      results.push({ capability: provider.capability, provider: provider.name, status: receipt.status, valid, hrefs });
    };
    // After Land the sandbox is gone, so a workspace-bound validity check can
    // only fail; the receipts Land accepted are the record of proof.
    const landed = ["archived", "applied"].includes(state.status) && state.land?.assurance?.status === "passed";
    for (const provider of landed ? providers : []) {
      try {
        const receipt = JSON.parse(readFileSync(join(receiptsDir, id, `${provider.name}.json`), "utf8"));
        if (receipt?.status === "pass" && receipt.kind !== "preview" && provider.capability) proven.add(provider.capability);
        record(provider, receipt, receipt?.status === "pass");
      } catch { /* no receipt for this provider */ }
    }
    for (const provider of landed ? [] : providers) {
      let result = null;
      try { result = trap(() => receiptValidity(id, provider.name)); }
      catch (error) {
        result = null;
        notices.push(`receipt for '${provider.name}' not checked (${message(error)})`);
      }
      // Harness receipts record pass|fail|inconclusive|error.
      if (result?.validity === "valid" && result.receipt?.status === "pass" && provider.capability)
        proven.add(provider.capability);
      record(provider, result?.receipt, result?.validity === "valid");
    }
    const previewBase = join(previewsDir, id);
    const previews = previewReceipts(previewsDir, id, state.contractRevision)
      .map((row) => ({ ...row, href: row.artifact ? confinedHref(packagesDir, previewBase, row.artifact) : null }));
    const capabilityOf = (row) => row.id === "testmap" ? "test" : row.source === "provider" ? row.ref : null;
    const artifacts = route.artifacts.map((row) => ({
      ...row, evidence: artifactLabel(capabilityOf(row), { proven, previews }),
      preview: capabilityOf(row) ? previews.find((preview) => preview.capability === capabilityOf(row)) || null : null
    }));
    // Lane status is a reading aid: a failed check leaves the lanes unlisted.
    let missingLanes = [];
    try { missingLanes = missingApprovalLanes(root, id, state); } catch { /* lanes stay unlisted */ }
    return {
      id, state, route, draft, artifacts,
      approval: approvalStatus(state, missingLanes),
      diagrams: draftDiagrams(draft),
      suggestions: previewSuggestions(route, suggestable, id),
      legacy: !draft,
      proposal: proposalSummary(join(packet, "proposal.md")),
      notices,
      results,
      previews,
      prototypeHref: (path) => confinedHref(packagesDir, previewBase, path),
      mermaidHref: existsSync(MERMAID_VENDOR) ? vendorHref(packagesDir, MERMAID_VENDOR) : null
    };
  }

  function writePackage(id) {
    const model = buildModel(id);
    // Links are relative to the packages folder, so it exists before rendering.
    mkdirSync(packagesDir, { recursive: true });
    const html = renderApprovalPackage({ ...model, mermaidHref: existsSync(MERMAID_VENDOR) ? vendorHref(packagesDir, MERMAID_VENDOR) : null });
    const path = join(packagesDir, `${id}.html`);
    const temporary = `${path}.tmp-${process.pid}`;
    writeFileSync(temporary, html);
    renameSync(temporary, path);
    return { path: relative(root, path), level: model.route.level, roles: model.route.roles,
      suggestions: model.suggestions.length, warnings: [...model.route.warnings, ...model.notices] };
  }

  function showPackage(id, flags = {}) {
    const result = writePackage(id);
    if (flags.pretty) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`PACKAGE ${id}`);
      console.log(`  file: ${result.path}`);
      console.log(`  risk: ${result.level}`);
      console.log(`  roles: ${result.roles.join(", ") || "none"}`);
      if (result.suggestions) console.log(`  suggested previews: ${result.suggestions}`);
      for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    }
    return result;
  }

  // Approval output links the package but never fails because of it.
  function tryWritePackage(id) {
    try { return { path: writePackage(id).path }; }
    catch (error) { return { error: error?.message || String(error) }; }
  }

  return { buildModel, writePackage, showPackage, tryWritePackage };
}
