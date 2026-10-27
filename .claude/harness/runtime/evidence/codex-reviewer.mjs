// Compatibility entrypoint for installations and integrations that imported
// the v3.3 Codex-specific factory before configured Claude review was added.
export {
  REVIEW_SCHEMA,
  createConfiguredReviewerRuntime,
  createConfiguredReviewerRuntime as createCodexReviewerRuntime
} from "./configured-reviewer.mjs";
