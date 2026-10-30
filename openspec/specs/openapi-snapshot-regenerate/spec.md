# openapi-snapshot-regenerate Specification

## Purpose
Regenerate packages/protocol/openapi.json และ client generated ด้วยสคริปต์ของ repo ให้ตรงกับ ClientApi ในโค้ด เพราะ snapshot บน HEAD ล้าสมัย (generate-openapi --check ล้ม) โดยไม่แก้ endpoint หรือ handler.
## Requirements
### Requirement: openapi-snapshot-current

packages/protocol/openapi.json SHALL เท่ากับผลลัพธ์ของ generate-openapi จาก ClientApi และมี operation ของ group server.foundation ครบทั้ง 7 รายการโดย operation เดิมไม่เปลี่ยน

#### Scenario: check ผ่าน

- **WHEN** รัน generate-openapi --check ใน packages/protocol
- **THEN** คำสั่งออกด้วยรหัส 0

#### Scenario: foundation ครบ

- **WHEN** อ่าน paths ใน openapi.json
- **THEN** มี /experimental/foundation/capability, changes, changes/{changeID}, changes/{changeID}/documents, changes/{changeID}/documents/{documentID}, investigations, investigations/{investigationID} และ response 503 ของ command.list ยังอยู่

### Requirement: client-generated-current

client generated artifacts ใน packages/client SHALL เท่ากับผลลัพธ์ของ `bun run generate` และ declaredStatuses ของ command.list SHALL มี 503

#### Scenario: generated ตรงกัน

- **WHEN** รัน bun run generate ใน packages/client แล้วเทียบกับไฟล์ที่ commit
- **THEN** ไม่มีความต่าง

#### Scenario: client ทำงาน

- **WHEN** รัน test ของ client (promise, effect, foundation, contract-identity)
- **THEN** ผ่านทั้งหมด
