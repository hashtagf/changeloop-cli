import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewProtocol,
  deterministicReview,
  legacySubjectProvenance,
  reviewActorComplete,
  reviewProvenanceResult,
  reviewSessionIndependent,
  reviewSubjectComplete,
  reviewSubjectsComplete,
  reviewSubjectsDiverse,
  structuredSubjectProvenance,
  subjectProvenanceOperation
} from "../runtime/evidence/review-protocol.mjs";

const fail = (message) => { throw new Error(message); };

function flagValues(flags, name) {
  const value = flags[name];
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

test("structured provenance accepts one or repeated JSON tuples", () => {
  const human = { type: "human", identity: "alice" };
  const ai = {
    type: "ai", identity: "agent", sessionId: "session-1",
    providerFamily: "openai", modelFamily: "gpt", modelId: "gpt-5"
  };
  assert.deepEqual(structuredSubjectProvenance({ fail }, JSON.stringify(human)), [human]);
  assert.deepEqual(structuredSubjectProvenance({ fail }, [
    JSON.stringify(human), JSON.stringify(ai)
  ]), [human, ai]);
  assert.deepEqual(structuredSubjectProvenance({ fail }, undefined), []);
});

test("structured provenance rejects malformed JSON with the established message", () => {
  assert.throws(() => structuredSubjectProvenance({ fail }, "{broken"),
    /invalid --subject-provenance JSON/);
});

test("legacy provenance infers human when only identity is present", () => {
  assert.deepEqual(legacySubjectProvenance({ flagValues, fail }, {
    "subject-actor": " Alice "
  }), [{
    type: "human",
    identity: "Alice",
    sessionId: null,
    providerFamily: null,
    modelFamily: null,
    modelId: null
  }]);
  assert.deepEqual(legacySubjectProvenance({ flagValues, fail }, {}), []);
});

test("legacy provenance infers AI and normalizes provider/model families", () => {
  assert.deepEqual(legacySubjectProvenance({ flagValues, fail }, {
    "subject-actor": "agent",
    "subject-session": "session-1",
    "subject-provider-family": "OpenAI",
    "subject-model-family": "GPT",
    "subject-model": "gpt-5.6"
  }), [{
    type: "ai",
    identity: "agent",
    sessionId: "session-1",
    providerFamily: "openai",
    modelFamily: "gpt",
    modelId: "gpt-5.6"
  }]);
});

test("legacy provenance rejects multiple values in every legacy field", () => {
  for (const name of [
    "subject-actor", "subject-session", "subject-provider-family",
    "subject-model-family", "subject-model"
  ])
    assert.throws(() => legacySubjectProvenance({ flagValues, fail }, {
      "subject-actor": "agent",
      [name]: ["one", "two"]
    }), /multiple implementers require repeated --subject-provenance JSON tuples/);
});

test("structured provenance takes precedence over conflicting legacy flags", () => {
  const structured = { type: "human", identity: "structured" };
  assert.deepEqual(subjectProvenanceOperation({ flagValues, fail }, {
    "subject-provenance": JSON.stringify(structured),
    "subject-actor": ["legacy-one", "legacy-two"]
  }), [structured]);
});

test("review protocol exposes the decomposed provenance operation", () => {
  const protocol = createReviewProtocol({ stableHash: JSON.stringify, fail });
  assert.deepEqual(protocol.subjectProvenance({
    "subject-actor": "agent",
    "subject-provider-family": "Anthropic"
  }), [{
    type: "ai",
    identity: "agent",
    sessionId: null,
    providerFamily: "anthropic",
    modelFamily: null,
    modelId: null
  }]);
});

const humanSubject = { type: "human", identity: "implementer" };
const aiSubject = {
  type: "ai", identity: "builder", sessionId: "build-session",
  providerFamily: "openai", modelFamily: "gpt", modelId: "gpt-5"
};
const aiReviewer = {
  type: "ai", identity: "reviewer", sessionId: "review-session",
  providerFamily: "anthropic", modelFamily: "claude", modelId: "claude-opus"
};

test("review provenance completeness validates every actor shape and subject bound", () => {
  assert.equal(reviewSubjectComplete(humanSubject), true);
  assert.equal(reviewSubjectComplete({ type: "human", identity: "" }), false);
  assert.equal(reviewSubjectComplete(aiSubject), true);
  assert.equal(reviewSubjectComplete({ ...aiSubject, modelId: null }), false);
  assert.equal(reviewSubjectComplete({ type: "service", identity: "x" }), false);
  assert.equal(reviewSubjectsComplete([]), false);
  assert.equal(reviewSubjectsComplete([humanSubject]), true);
  assert.equal(reviewSubjectsComplete(Array(17).fill(humanSubject)), false);
  assert.equal(deterministicReview({
    type: "deterministic", identity: "foundation-repair-closure"
  }), true);
  assert.equal(deterministicReview({ type: "deterministic", identity: "other" }), false);
});

test("review actor and session predicates preserve human, AI, and deterministic rules", () => {
  assert.equal(reviewActorComplete({}, "", "", false, true), true);
  assert.equal(reviewActorComplete({ type: "human" }, "human", "", false, false), true);
  assert.equal(reviewActorComplete({ type: "human" }, "", "", false, false), false);
  assert.equal(reviewActorComplete(aiReviewer, "reviewer", "review-session",
    false, false), true);
  assert.equal(reviewActorComplete({ ...aiReviewer, modelId: null }, "reviewer",
    "review-session", false, false), false);
  assert.equal(reviewActorComplete({ ...aiReviewer, sessionId: null }, "reviewer",
    "", true, false), true);
  assert.equal(reviewSessionIndependent(aiReviewer, "", [aiSubject], false), false);
  assert.equal(reviewSessionIndependent(aiReviewer, "review-session",
    [aiSubject], false), true);
  assert.equal(reviewSessionIndependent(aiReviewer, "build-session",
    [aiSubject], false), false);
  assert.equal(reviewSessionIndependent({ type: "human" }, "", [aiSubject], false), true);
  assert.equal(reviewSessionIndependent(aiReviewer, "", [aiSubject], true), true);
});

test("review provenance reports identity, session, and model diversity independently", () => {
  assert.deepEqual(reviewProvenanceResult({
    reviewer: aiReviewer, subjects: [aiSubject, humanSubject]
  }), { complete: true, independent: true, diverse: true });
  assert.equal(reviewProvenanceResult({
    reviewer: aiReviewer,
    subjects: [{ ...aiSubject, identity: "REVIEWER" }]
  }).independent, false);
  assert.equal(reviewProvenanceResult({
    reviewer: aiReviewer,
    subjects: [{ ...aiSubject, sessionId: "REVIEW-SESSION" }]
  }).independent, false);
  assert.equal(reviewProvenanceResult({
    reviewer: aiReviewer,
    subjects: [{ ...aiSubject, providerFamily: "ANTHROPIC", modelFamily: "CLAUDE" }]
  }).diverse, false);
  assert.equal(reviewProvenanceResult({
    reviewer: aiReviewer,
    subjects: [{ ...aiSubject, providerFamily: "anthropic", modelFamily: "other" }]
  }).diverse, true);
  assert.deepEqual(reviewProvenanceResult({
    reviewer: { type: "human", identity: "reviewer" }, subjects: [humanSubject]
  }), { complete: true, independent: true, diverse: true });
  assert.deepEqual(reviewProvenanceResult({
    reviewer: {
      type: "deterministic", identity: "foundation-repair-closure"
    }, subjects: [humanSubject]
  }), { complete: true, independent: true, diverse: true });
  assert.deepEqual(reviewProvenanceResult(undefined), {
    complete: false, independent: false, diverse: false
  });
  assert.equal(reviewProvenanceResult({
    reviewer: { ...aiReviewer, sessionId: null }, subjects: [humanSubject]
  }, { allowMissingAiSession: true }).complete, true);
});

test("review diversity predicate returns early for authority and incomplete evidence", () => {
  assert.equal(reviewSubjectsDiverse(aiReviewer, [aiSubject], false, false), false);
  assert.equal(reviewSubjectsDiverse({ type: "human" }, [aiSubject], false, false), true);
  assert.equal(reviewSubjectsDiverse(aiReviewer, [aiSubject], false, true), true);
});
