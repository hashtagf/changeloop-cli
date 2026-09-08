// Compatibility surface for hook tests and third-party host integrations. The
// runtime owns the policy so `exec` and live hooks cannot drift apart.
export {
  looksMutatingShellCommand,
  mutatingShellOperations,
  pinShellAnchor,
  shellMutationViolation,
} from "../harness/runtime/core/shell-mutation-policy.mjs";
