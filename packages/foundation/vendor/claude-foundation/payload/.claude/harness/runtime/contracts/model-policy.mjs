// Task kinds whose planned model tier is part of the risk contract. Kept out
// of observability because planning and drift inspection both consume it.
export const DRIFT_BLOCKING_TASK_KINDS = new Set([
  "contract", "architecture", "security", "migration", "review"
]);
