# foundation-server-contract Specification

## Purpose
Port service Foundation, FoundationDocuments, CommandPreparation และ endpoint ฝั่ง server จาก v1 ไปบน opencode v2.
## Requirements
### Requirement: Validate selection และ change identifier ก่อนอ่าน

Foundation core SHALL validate selection และ change identifier ก่อนอ่าน snapshot และ SHALL project snapshot เป็น Page ตาม schema

#### Scenario: เรียก Foundation.selection ด้วย offset

- **WHEN** เรียก Foundation.selection ด้วย offset ที่ไม่ใช่จำนวนเต็มไม่ติดลบ, limit เกิน 100, scope นอก active/archive หรือ search ยาวเกิน 256 ตัวอักษร
- **THEN** ล้มด้วย ReadError code invalid_input

#### Scenario: เรียก Foundation.identifier ด้วย id ที่มี path separator

- **WHEN** เรียก Foundation.identifier ด้วย id ที่มี path separator หรือยาวเกิน 128 ตัวอักษร
- **THEN** ล้มด้วย ReadError code invalid_input

#### Scenario: เรียก Foundation.project กับ envelope ที่ schemaVersion

- **WHEN** เรียก Foundation.project กับ envelope ที่ schemaVersion ไม่ใช่ 3 หรือโครงสร้างไม่ถูกต้อง
- **THEN** ล้มด้วย ReadError code unsupported หรือ invalid_response ตามลำดับ

#### Scenario: เรียก Foundation.project กับ envelope ที่มี change ซ้ำ, row

- **WHEN** เรียก Foundation.project กับ envelope ที่มี change ซ้ำ, row เสีย และ malformedStates มากกว่า 0
- **THEN** ข้ามแถวที่เสีย รายงานใน diagnostics และคืนเฉพาะแถวที่ถูกต้องโดยเรียง updatedAt ใหม่ก่อน

### Requirement: เปิด endpoint /experimental/foundation ตาม

Server SHALL เปิด endpoint /experimental/foundation ตาม contract ของ v1 และ standalone server SHALL ตอบ unsupported แทนการล้มเมื่อไม่มี FoundationRuntime

#### Scenario: ตอบ 200 โดย available เป็น false และ code เป็น unsupported

- **WHEN** GET /experimental/foundation/capability บน standalone server
- **THEN** ตอบ 200 โดย available เป็น false และ code เป็น unsupported

#### Scenario: ตอบ 503 พร้อม error data code unsupported

- **WHEN** GET /experimental/foundation/changes บน standalone server
- **THEN** ตอบ 503 พร้อม error data code unsupported

#### Scenario: ตอบ 400 พร้อม error data code invalid_input โดยไม่เรียก

- **WHEN** GET /experimental/foundation/changes ด้วย limit=0
- **THEN** ตอบ 400 พร้อม error data code invalid_input โดยไม่เรียก Foundation.Service.read

#### Scenario: GET /experimental/foundation/changes/:changeID ด้วย id

- **WHEN** GET /experimental/foundation/changes/:changeID ด้วย id ที่ผิดรูปแบบ
- **THEN** ตอบ 400 พร้อม error data code invalid_input

#### Scenario: GET /experimental/foundation/changes/x/documents บน

- **WHEN** GET /experimental/foundation/changes/x/documents บน standalone server
- **THEN** ตอบ 503 พร้อม error data code unsupported

### Requirement: เป็น passthrough บน standalone server

CommandPreparation SHALL เป็น passthrough บน standalone server

#### Scenario: คืนรายการ command ที่ Command ค้นพบโดยไม่เพิ่มหรือตัดรายการ

- **WHEN** GET /api/command บน standalone server
- **THEN** คืนรายการ command ที่ Command ค้นพบโดยไม่เพิ่มหรือตัดรายการ

#### Scenario: เรียก prepare ของ standalone CommandPreparation โดยไม่มี

- **WHEN** เรียก prepare ของ standalone CommandPreparation โดยไม่มี command
- **THEN** ล้มด้วย CommandPreparation.Error code command_not_found

#### Scenario: เรียก prepare ของ standalone CommandPreparation พร้อม

- **WHEN** เรียก prepare ของ standalone CommandPreparation พร้อม command
- **THEN** คืน command เดิมโดยไม่แก้ไข

### Requirement: รวม group foundation ที่ตรงกับ protocol

Generated client contract SHALL รวม group foundation ที่ตรงกับ protocol

#### Scenario: ไม่มีส่วนต่างหลังจาก generated output ถูก commit รวมกับ

- **WHEN** รัน bun run generate ใน packages/client แล้วตรวจ git diff
- **THEN** ไม่มีส่วนต่างหลังจาก generated output ถูก commit รวมกับ change นี้ และ client มีเมธอด foundation.list, foundation.get, foundation.capability
