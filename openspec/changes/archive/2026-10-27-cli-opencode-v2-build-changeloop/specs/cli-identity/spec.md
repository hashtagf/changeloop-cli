# cli-identity

## ADDED Requirements

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
