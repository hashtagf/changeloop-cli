# foundation-services Specification

## Purpose
ทำให้ endpoint Foundation (capability, changes list/detail, documents/investigations index/read) ตอบข้อมูลจริงจาก project ที่มี Foundation บน binary changeloop โดย port ตัวอ่าน snapshot และตัวอ่านเอกสารจาก v1 เป็น layer ตัวจริงของ Foundation.Service และ FoundationDocuments.Service และคง fallback unsupported เมื่อปิด Foundation.
## Requirements
### Requirement: snapshot-reader

ตัวอ่าน snapshot SHALL รัน `claude-foundation dashboard snapshot --json` ใน project root ที่มี .claude/harness/protocol.json เท่านั้น และ SHALL คืน snapshot พร้อม mode กับ version ของ runtime หรือ error ที่ระบุ code ได้ (not_initialized, runtime_unavailable, unsupported, timeout, output_too_large, invalid_response) โดยไม่ init project และไม่ fallback ไป runtime อื่น

#### Scenario: project ยังไม่ init

- **WHEN** อ่านใน directory ที่ไม่มี .claude/harness/protocol.json
- **THEN** ล้มด้วย code not_initialized และ directory ไม่ถูกเปลี่ยน

#### Scenario: runtime path หาไม่พบ

- **WHEN** mode เป็น path และ PATH ไม่มี claude-foundation
- **THEN** ล้มด้วย code runtime_unavailable

#### Scenario: snapshot สำเร็จ

- **WHEN** executable พิมพ์ JSON schemaVersion 3 พร้อม foundationVersion
- **THEN** คืน snapshot ตามที่พิมพ์ และ runtime.version เท่ากับ foundationVersion

#### Scenario: schema ไม่รองรับ ผิดรูป หรือ exit ไม่ใช่ศูนย์

- **WHEN** executable พิมพ์ schemaVersion 4, ข้อความที่ไม่ใช่ JSON, หรือ exit 1
- **THEN** ล้มด้วย unsupported, invalid_response และ runtime_unavailable ตามลำดับ และการอ่านครั้งถัดไปลองใหม่ได้

#### Scenario: เกินขีดจำกัด

- **WHEN** executable พิมพ์รวมเกิน 1 MiB หรือค้างเกิน 5 วินาที
- **THEN** ล้มด้วย output_too_large หรือ timeout และ process ลูกถูกฆ่า

#### Scenario: อ่านซ้อน

- **WHEN** อ่าน project เดียวกัน (รวม symlink) พร้อมกันสองครั้ง
- **THEN** spawn runtime ครั้งเดียว และ entry ถูกล้างหลังเสร็จ

#### Scenario: bundled จากไฟล์ที่ฝัง

- **WHEN** อ่านด้วย mode bundled และ project init ด้วย bundle เดียวกัน
- **THEN** ได้ snapshot จริงโดยไม่ต้องมี claude-foundation บน PATH

### Requirement: document-reader

ตัวอ่านเอกสาร SHALL ทำดัชนีและอ่านเอกสารของ change (proposal.md, design.md, tasks.md, evidence.yaml, grounding.yaml, specs/**/*.md ทั้ง active และ archive) และ investigation (openspec/investigations/*.md) ผ่าน id แบบ opaque โดยปฏิเสธ symlink path ที่ออกนอก project และไฟล์เกิน 256 KiB และ SHALL ทำงานได้โดยไม่ต้อง init runtime

#### Scenario: investigation ก่อน init

- **WHEN** มีไฟล์ใน openspec/investigations ใน project ที่ไม่มี runtime
- **THEN** index คืนรายการพร้อม title จาก heading แรกที่ไม่อยู่ใน code fence และ read คืน sections, sha256 ของข้อความ และ references ว่าง โดยไม่สร้างไฟล์ใน project

#### Scenario: เอกสารของ change

- **WHEN** change active มี proposal.md, tasks.md, evidence.yaml และ specs/**
- **THEN** index เรียงตามลำดับที่กำหนดและไม่รวมไฟล์นอกรายการ read คืน tasks จาก checkbox นอก code fence และ claims จาก evidence.yaml

#### Scenario: archive

- **WHEN** change ไม่อยู่ใน active แต่มี archive เดียวที่ชื่อ YYYY-MM-DD-<id>
- **THEN** อ่านจาก archive ได้ และถ้ามี archive มากกว่าหนึ่งล้มด้วย ambiguous_archive

#### Scenario: ป้องกันการออกนอก project

- **WHEN** เอกสารหรือ ancestor เป็น symlink หรือ id ไม่ใช่ sha256 hex 64 ตัว
- **THEN** ล้มด้วย invalid_input และไม่อ่านไฟล์เป้าหมาย

#### Scenario: เอกสารใหญ่เกินและไม่พบ

- **WHEN** ไฟล์เกิน 256 KiB หรือ id ไม่ตรงเอกสารใด
- **THEN** read ล้มด้วย document_too_large หรือ not_found และ index ระบุ diagnostic document_too_large โดยไม่ล้มทั้งหน้า

#### Scenario: references

- **WHEN** เอกสารของ change มีลิงก์ markdown ไปยัง investigation นอก code fence และ inline code
- **THEN** read ของ investigation คืน references ตรงกับ change/ไฟล์ที่ลิงก์จริงเท่านั้น

### Requirement: server-foundation-endpoints

server SHALL ใช้ layer ตัวจริงของ Foundation.Service และ FoundationDocuments.Service เป็นค่าเริ่มต้น เพื่อให้ endpoint capability, changes list/detail, documents และ investigations ตอบข้อมูลจริงจาก project และ error code ที่ถูกต้อง และ SHALL ใช้ fallback unsupported เมื่อ option foundation.enabled เป็น false รวมถึงโปรไฟล์ workerd

#### Scenario: ข้อมูลจริง

- **WHEN** project init แล้วและ runtime ตอบ snapshot ที่มี change active กับ archived
- **THEN** capability ตอบ available true พร้อม runtime และ list ตอบ change active พร้อม total
- **AND** list scope=archive ตอบ change archived
- **AND** get ตอบ change ตาม id รวม archived

#### Scenario: change ไม่มี

- **GIVEN** project init แล้ว
- **WHEN** get ด้วย id ที่ไม่มีใน snapshot
- **THEN** ตอบ 404 not_found

#### Scenario: ไม่ได้ init

- **WHEN** project ไม่มี .claude/harness/protocol.json
- **THEN** list ตอบ 409 not_initialized และ capability ตอบ available false code not_initialized
- **AND** investigations ยังตอบ 200

#### Scenario: input ไม่ถูกต้อง

- **WHEN** limit=0 หรือ change id ผิดรูป
- **THEN** ตอบ 400 invalid_input โดยไม่ spawn runtime

#### Scenario: runtime ค้าง

- **WHEN** runtime ค้างเกิน 5 วินาที
- **THEN** list ตอบ 504 timeout

#### Scenario: runtime พิมพ์เกิน

- **WHEN** runtime พิมพ์เกิน 1 MiB
- **THEN** list ตอบ 502 output_too_large

#### Scenario: เอกสารผ่าน HTTP

- **WHEN** เรียก documents และ investigations index แล้ว read ด้วย id ที่ index คืน
- **THEN** ตอบข้อความเอกสารจริง

#### Scenario: id เอกสารผิดรูปหรือไม่พบ

- **WHEN** read ด้วย id ที่ไม่ใช่ sha256 hex หรือ id ที่ไม่ตรงเอกสาร
- **THEN** ตอบ 400 invalid_input หรือ 404 not_found ตามลำดับ

#### Scenario: ปิด Foundation

- **WHEN** สร้าง server ด้วย foundation.enabled เป็น false
- **THEN** capability ตอบ available false code unsupported และ list ตอบ 503 unsupported

### Requirement: binary-routes-foundation-api

web shell handler ของ cli SHALL ส่งทุก request ใต้ /experimental/ ไปยัง API (รวมการตรวจ authentication) แทนที่จะตอบ web shell เพื่อให้ endpoint /experimental/foundation/* ใช้ได้บน binary changeloop

#### Scenario: ไม่มี credential

- **GIVEN** server ตั้งรหัสผ่านและมี web shell
- **WHEN** เรียก GET /experimental/foundation/capability โดยไม่ส่ง credential
- **THEN** ตอบ 401 พร้อม www-authenticate แทนการตอบ web shell

#### Scenario: มี credential

- **GIVEN** server ตั้งรหัสผ่านและมี web shell
- **WHEN** เรียก GET /experimental/foundation/capability พร้อม Basic credential
- **THEN** ตอบ 200 เป็น JSON ที่มี data.available และ data.code จาก Foundation service ไม่ใช่ HTML

#### Scenario: path ของ web shell

- **GIVEN** server มี web shell
- **WHEN** เรียก path ที่ไม่ใช่ API เช่น /settings
- **THEN** ยังตอบ web shell 200 โดยไม่ต้องมี credential
