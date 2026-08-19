// Directories that are never change surface: never hashed, walked as evidence
// input, or projected back onto the target at apply.
export const EXCLUDED_WORKSPACE_DIRS = new Set([
  ".git", ".foundation", ".workflow", "node_modules",
  "coverage", "test-results", "playwright-report",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".astro", ".parcel-cache",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", "__pycache__", ".tox",
  ".gradle", ".terraform"
]);

// A copy sandbox keeps .git so git-aware behavior does not silently degrade to
// whole-tree behavior. Other tool-owned generated directories remain excluded.
export const SANDBOX_COPY_EXCLUDED_DIRS = new Set(
  [...EXCLUDED_WORKSPACE_DIRS].filter((dir) => dir !== ".git")
);
