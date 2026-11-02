// Accepted semantic draft versions. v5 is v4 semantics plus authored folder
// prose, so every v4 rule applies to it through isSemanticV4Plus. This leaf
// module has no imports so validation modules can use it without a cycle.
export const SEMANTIC_DRAFT_VERSIONS = Object.freeze([3, 4, 5]);

export function isSemanticVersion(version) {
  return SEMANTIC_DRAFT_VERSIONS.includes(version);
}

export function isSemanticV4Plus(version) {
  return isSemanticVersion(version) && version >= 4;
}

// The v5 draft is a folder: change.json declares this version.
export const FOLDER_DRAFT_VERSION = 5;

export function isFolderDraftVersion(version) {
  return version === FOLDER_DRAFT_VERSION;
}
