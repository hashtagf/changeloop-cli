# foundation-vendor-runtime

## Purpose

อัปเดต vendor runtime ใน packages/foundation/vendor/claude-foundation จาก v3.5.14 เป็น v3.6.8 (runtime API 42) ให้ตรงกับ harness ของโปรเจกต์.

## ADDED Requirements

### Requirement: vendor-release-pin

manifest ของ vendor SHALL ระบุ release v3.6.8 ที่ tag แล้วพร้อม commit ต้นทางและ payload protocol runtimeApi 42

#### Scenario: manifest ตรงรุ่น

- **WHEN** อ่าน vendor/claude-foundation/manifest.json
- **THEN** release เป็น v3.6.8 version เป็น 3.6.8 tagged เป็น true และ commit เป็น 402a2eb7c5784816657cfd00bd4c1f5833e07926

#### Scenario: protocol ของ payload

- **WHEN** อ่าน payload/.claude/harness/protocol.json
- **THEN** runtime เป็น 3.6.8 และ runtimeApi เป็น 42

### Requirement: vendor-integrity

ตัวตรวจ bundle SHALL ยืนยันว่าทุกไฟล์ใน payload ตรง checksum ใน manifest และ install-opencode.sh ของ 3.6.8 อยู่ใน bundle

#### Scenario: vendor ผ่านการตรวจ

- **WHEN** รัน createEmbeddedFoundationBundle กับ vendor ที่ส่งมอบ
- **THEN** ผ่านโดยไม่เกิด checksum mismatch และ manifest มีรายการ install-opencode.sh ที่ hash ตรงไฟล์ใน payload

#### Scenario: payload ถูกแก้

- **WHEN** ไฟล์ใน payload ถูกแก้ให้ checksum ไม่ตรง
- **THEN** การสร้าง bundle ล้มเหลวด้วยข้อความ checksum mismatch

### Requirement: vendor-excludes-harness-tests

vendor SHALL ไม่รวมไดเรกทอรี .claude/harness/tests และ .claude/harness/fixtures ของ upstream (UNSHIPPED ใน install.sh) และไม่มีไฟล์ใต้ vendor ลึกเกิน 12 ระดับจากรากของ repo

#### Scenario: manifest ไม่มี tests

- **WHEN** อ่านรายการไฟล์ใน manifest.json ของ vendor
- **THEN** ไม่มี path ที่ขึ้นต้นด้วย .claude/harness/tests/ หรือ .claude/harness/fixtures/ และ payload บนดิสก์ไม่มีสองไดเรกทอรีนี้

#### Scenario: ความลึกไม่เกินกำหนด

- **WHEN** นับจำนวนระดับไดเรกทอรีของทุกไฟล์ใต้ packages/foundation/vendor จากรากของ repo
- **THEN** ไม่มีไฟล์ใดลึกเกิน 12 ระดับ

#### Scenario: sync กรองอย่างชัดเจน

- **WHEN** sync-foundation.ts รวบรวมไฟล์จากต้นทาง
- **THEN** ข้ามเฉพาะ .claude/harness/tests และ .claude/harness/fixtures ตามรายการ UNSHIPPED ของ install.sh ต้นทางและแจ้งจำนวนไฟล์ที่ข้าม
