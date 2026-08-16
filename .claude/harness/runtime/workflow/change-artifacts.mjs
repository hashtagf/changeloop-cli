// Compatibility path retained for commands that overlap an installer upgrade.
// New runtime code imports the canonical pure contract directly.
export {
  parseSpecRequirements, taskBlocks, taskMetadata
} from "../contracts/change-artifacts.mjs";
