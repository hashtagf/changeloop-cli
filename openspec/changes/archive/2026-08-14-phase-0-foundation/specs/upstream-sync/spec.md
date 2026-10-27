## ADDED Requirements

### Requirement: Documented upstream sync policy

The repository SHALL carry a sync policy document (`docs/sync/UPSTREAM.md`)
that names the upstream remote and branch layout (`upstream/main` → `dev`),
the merge cadence, and the exact allowlist of core files a branding edit may
touch; all other fork work is plugin-first.

#### Scenario: sync-policy

- **WHEN** the sync policy document is checked
- **THEN** it contains the upstream remote URL, the `upstream/main` → `dev`
  branch layout, a merge cadence, and the branding-file allowlist
