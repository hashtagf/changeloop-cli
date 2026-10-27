## ADDED Requirements

### Requirement: Template plugin scaffold

The repository SHALL provide a template plugin on the v2 draft-transform API
that builds and loads in an example workspace, so Phase 1 features ship as
plugins without touching engine code.

#### Scenario: plugin-scaffold

- **WHEN** the template plugin's load test runs
- **THEN** the plugin registers through the v2 plugin API and the test passes

### Requirement: Plugin CI pipeline

The repository SHALL run a CI pipeline that builds and tests the template
plugin on every push affecting it.

#### Scenario: plugin-ci

- **WHEN** the plugin CI workflow definition is checked
- **THEN** it builds the template plugin and runs its tests
