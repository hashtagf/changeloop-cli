## ADDED Requirements

### Requirement: Changeloop CLI identity

The CLI SHALL identify itself as `changeloop`: a bin entry named `changeloop`
is published alongside the kept `opencode` bin, the package name stays
`opencode` (npm rename is deferred), and the app identity constant is
`changeloop`.

#### Scenario: rebrand-cli

- **WHEN** the CLI entrypoint is invoked with `--version`
- **THEN** it exits 0, a bin entry named `changeloop` invokes it, and the
  legacy `opencode` bin entry remains

### Requirement: Legacy state directory fallback

The CLI SHALL keep using an existing legacy `opencode` data/config directory
when no `changeloop` directory exists yet, so existing installs keep their
sessions, auth, and cache without migration.

#### Scenario: app-dir-fallback

- **WHEN** the `changeloop` data/config directory does not exist and a legacy
  `opencode` directory does
- **THEN** the CLI resolves its app directories to the legacy `opencode` paths

### Requirement: Config compatibility fallback

The CLI SHALL read `changeloop.json`/`changeloop.jsonc` as its project config
and SHALL fall back to `opencode.json`/`opencode.jsonc` when no changeloop
config exists.

#### Scenario: config-fallback

- **WHEN** a project contains both `changeloop.json` and `opencode.json`
- **THEN** values from `changeloop.json` win
- **WHEN** a project contains only `opencode.json`
- **THEN** the CLI loads it unchanged

### Requirement: Environment variable aliasing

The CLI SHALL honor `CHANGELOOP_*` environment variables and SHALL keep
honoring the corresponding `OPENCODE_*` variables when the `CHANGELOOP_*`
variant is unset.

#### Scenario: env-fallback

- **WHEN** both `CHANGELOOP_CONFIG` and `OPENCODE_CONFIG` are set
- **THEN** the `CHANGELOOP_CONFIG` value is used
- **WHEN** only `OPENCODE_CONFIG` is set
- **THEN** its value is used
