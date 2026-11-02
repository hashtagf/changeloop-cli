# cli-identity Specification

## Purpose
TBD - created by archiving change phase-0-foundation. Update Purpose after archive.
## Requirements
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

### Requirement: สร้าง executable ชื่อ changeloop สำหรับ target

Build ของ packages/cli บน v2 SHALL สร้าง executable ชื่อ changeloop สำหรับ target ของเครื่อง

#### Scenario: รัน bun run build --single --skip-web-ui ใน packages/cli บน

- **WHEN** รัน bun run build --single --skip-web-ui ใน packages/cli บน darwin-arm64
- **THEN** ได้ไฟล์ dist/cli-darwin-arm64/bin/changeloop และไม่มีไฟล์ชื่อ opencode ใน bin

### Requirement: แสดงชื่อ changeloop ในข้อความ help และ usage

executable SHALL แสดงชื่อ changeloop ในข้อความ help และ usage แทนชื่อ opencode

#### Scenario: บรรทัด usage ขึ้นต้นด้วยชื่อ changeloop

- **WHEN** รัน changeloop --help
- **THEN** บรรทัด usage ขึ้นต้นด้วยชื่อ changeloop และผลลัพธ์ไม่มีคำสั่งแนะนำให้เรียก opencode

#### Scenario: พิมพ์หมายเลข version ที่ไม่ว่างและ exit code เป็น 0

- **WHEN** รัน changeloop --version
- **THEN** พิมพ์หมายเลข version ที่ไม่ว่างและ exit code เป็น 0
