# core-server-brand-prose

## Purpose

Rebrand ข้อความ prose ที่ผู้ใช้เห็นซึ่งยังค้างใน packages/core, packages/server และ description ใน packages/protocol (OpenAPI, หน้า OAuth callback, คำถามขอสิทธิ์, error และคำสั่งแนะนำ) จาก OpenCode เป็น Changeloop โดยไม่แตะ identifier ที่เป็นสัญญา.

## ADDED Requirements

### Requirement: openapi-no-opencode-prose

เอกสาร /openapi.json ที่ server จริงให้บริการ SHALL ไม่มีคำว่า OpenCode หรือ opencode ใน title, summary และ description ที่ผู้ใช้อ่าน ยกเว้นชื่อบริการ OpenCode Console/Go/Zen

#### Scenario: info และ description

- **WHEN** เรียก GET /openapi.json จาก server
- **THEN** info.title เป็น Changeloop HttpApi และ summary กับ description ของทุก operation ไม่มี OpenCode นอกชื่อบริการ

#### Scenario: path และ header คงเดิม

- **WHEN** อ่าน paths และ parameters ใน /openapi.json
- **THEN** ชื่อ header x-opencode-ticket และ x-opencode-directory กับ operationId ยังเหมือนเดิม

### Requirement: user-messages-rebranded

ข้อความที่ผู้ใช้เห็นจาก core และ server (หน้า OAuth callback, คำถามขอสิทธิ์ค้นเว็บ, error ของ generate, ลิงก์ pair หมดอายุ, คำแนะนำเมื่อ service เริ่มไม่ได้) SHALL เรียกโปรแกรมว่า Changeloop และแนะนำคำสั่ง changeloop

#### Scenario: หน้า OAuth callback

- **WHEN** สร้างหน้า callback ทั้งสถานะสำเร็จ ล้มเหลว และไม่มี provider
- **THEN** headline, message, footnote และ title ใช้ Changeloop และ HTML ไม่มีข้อความ OpenCode นอก wordmark SVG

#### Scenario: คำสั่งแนะนำ

- **WHEN** ลิงก์ pair หมดอายุหรือ service เริ่มไม่ได้
- **THEN** ข้อความแนะนำ `changeloop pair` และ `changeloop service restart`

#### Scenario: คำถามขอสิทธิ์ค้นเว็บ

- **WHEN** tool websearch ถามผู้ใช้ครั้งแรก
- **THEN** คำถามคือ Allow Changeloop to search the web for up-to-date information? และตัวเลือกเดิมครบ

#### Scenario: ชื่อบริการคงเดิม

- **WHEN** แสดงข้อความเกี่ยวกับ OpenCode Console หรือ OpenCode Go
- **THEN** ข้อความยังใช้ชื่อบริการเดิม

### Requirement: contract-identifiers-unchanged

identifier ที่เป็นสัญญา SHALL คงค่าเดิมหลัง rebrand และ guard test SHALL ตรวจว่าบรรทัดโค้ดใน core, server, protocol src ที่ยังมี OpenCode เป็นรายการใน allowlist เท่านั้น

#### Scenario: guard ไม่พบ prose

- **WHEN** สแกนบรรทัดโค้ดที่ไม่ใช่ comment ใน packages/core/src, packages/server/src, packages/protocol/src
- **THEN** ไม่มี prose OpenCode หรือคำสั่ง opencode นอก allowlist (บริการ OpenCode Console/Go/Zen, plugin ของบริการ, ตัวตนที่ส่งให้ระบบภายนอก, symbol SDK)

#### Scenario: identifier คงเดิม

- **WHEN** ตรวจ header x-opencode-*, env OPENCODE_*, basic-auth username, id integration opencode และ URL opencode.ai
- **THEN** ทุกค่ายังอยู่ใน source ตามเดิม
