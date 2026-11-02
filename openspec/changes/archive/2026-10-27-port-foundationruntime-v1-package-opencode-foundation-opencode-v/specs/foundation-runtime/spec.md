# foundation-runtime

## Purpose

Port FoundationRuntime จาก v1 มาเป็น package @opencode/foundation บน opencode v2.

## ADDED Requirements

### Requirement: bundle-verification

ตัวสร้าง embedded bundle SHALL ตรวจ manifest และ checksum ของทุกไฟล์ใน payload ก่อนสร้าง source

#### Scenario: payload ถูกต้อง

- **WHEN** payload ตรงกับ manifest ทุกไฟล์
- **THEN** ได้ source ที่มีรายการ manifest.json และทุก payload/ไฟล์

#### Scenario: checksum ไม่ตรง

- **WHEN** ไฟล์ใน payload ถูกแก้ให้ checksum ไม่ตรง
- **THEN** การสร้าง bundle ล้มเหลวด้วยข้อความ checksum mismatch

#### Scenario: ไม่ใช่ release ที่ tag

- **WHEN** manifest ระบุ tagged เป็น false และต้องการ release ที่ tag แล้ว
- **THEN** การสร้าง bundle ล้มเหลวด้วยข้อความ tagged release

### Requirement: materialize-cache

FoundationRuntime.materialize SHALL ตรวจ checksum แล้วเขียน runtime ลง cache แบบ content-addressed และล็อกเป็น read-only

#### Scenario: materialize สำเร็จ

- **WHEN** materialize จาก bundle ที่ถูกต้อง
- **THEN** ได้ไดเรกทอรีที่มี bin/claude-foundation ซึ่งรัน help ได้ และเปลี่ยนชื่อไดเรกทอรีนั้นไม่ได้

#### Scenario: checksum ใน bundle ไม่ตรง

- **WHEN** checksum ของไฟล์ใน bundle ไม่ตรง
- **THEN** materialize ล้มเหลวด้วย checksum mismatch และ cache ไม่มีไฟล์ใดเหลือ

#### Scenario: cache ไม่ปลอดภัย

- **WHEN** cache root เป็น symlink
- **THEN** materialize ล้มเหลวด้วยข้อความ cache is unsafe

#### Scenario: shim ถูกแก้ไข

- **WHEN** shim ใน cache ถูกแก้ไข
- **THEN** command ล้มเหลวด้วยข้อความ cache is invalid โดยไม่ fallback ไป PATH

### Requirement: command-environment

FoundationRuntime.command และ environment SHALL คืนคำสั่งและ PATH ตาม mode ที่เลือก

#### Scenario: path mode ไม่ materialize

- **WHEN** mode เป็น path
- **THEN** command คืน claude-foundation โดยไม่ materialize

#### Scenario: bundled ต่อ PATH

- **WHEN** mode เป็น bundled และเรียก environment กับ PATH เดิม
- **THEN** PATH ใหม่ขึ้นต้นด้วยไดเรกทอรี bin ของ runtime ตามด้วย PATH เดิม

### Requirement: status-readonly

FoundationRuntime.status SHALL รายงานสถานะการติดตั้งในโปรเจกต์โดยไม่แก้ไขไฟล์ใดๆ

#### Scenario: ยังไม่ติดตั้ง

- **WHEN** โปรเจกต์ไม่มี .claude/harness/protocol.json
- **THEN** installed.state เป็น missing และไดเรกทอรีโปรเจกต์ยังว่างเหมือนเดิม

#### Scenario: ติดตั้งแล้ว

- **WHEN** protocol.json มี runtime และ runtimeApi
- **THEN** installed.state เป็น installed พร้อมค่า runtime และ runtimeApi

#### Scenario: protocol เสียหาย

- **WHEN** protocol.json ไม่ใช่ JSON หรือขาดฟิลด์
- **THEN** installed.state เป็น invalid

### Requirement: managed-adapter

FoundationRuntime.hasManagedOpenCodeAdapter SHALL ยืนยันว่าไฟล์ adapter ที่ manifest บันทึกไว้ตรงกับ checksum ของ bundle

#### Scenario: ไม่มี adapter manifest

- **WHEN** ไม่มี .foundation/adapter-manifests/opencode.txt
- **THEN** คืน false

#### Scenario: adapter ตรง checksum

- **WHEN** manifest บันทึกไฟล์ command ที่ checksum ตรงกับ bundle
- **THEN** คืน true

#### Scenario: adapter ถูกแก้ไข

- **WHEN** ไฟล์ที่บันทึกไว้ถูกแก้ไข
- **THEN** คืน false

### Requirement: install-guards

FoundationRuntime.install SHALL ปฏิเสธเป้าหมายที่ไม่ปลอดภัยก่อนแก้ไขโปรเจกต์

#### Scenario: platform win32

- **WHEN** platform เป็น win32
- **THEN** คืน exitCode 1 พร้อมข้อความ not supported on win32 และไม่สร้างไฟล์ในโปรเจกต์

#### Scenario: managed path เป็น symlink

- **WHEN** path ที่ runtime จัดการเป็น symlink
- **THEN** ล้มเหลวด้วยข้อความ symlinked managed path และไม่แตะเป้าหมายของ symlink

#### Scenario: bundle เสียหาย

- **WHEN** bundle ไม่ผ่านการตรวจ checksum
- **THEN** ล้มเหลวด้วย checksum mismatch และโปรเจกต์ไม่ถูกสร้างไฟล์ใดๆ

### Requirement: install-idempotent

ตัวติดตั้ง SHALL ติดตั้ง Foundation ลงโปรเจกต์ด้วย runtime ที่ vendor มาแบบ idempotent และเก็บไฟล์อื่นของผู้ใช้

#### Scenario: install ซ้ำ

- **WHEN** install สองครั้งติดกันในโปรเจกต์ที่มีไฟล์ของผู้ใช้
- **THEN** ทั้งสองครั้ง exitCode เป็น 0 status เป็น installed hasManagedOpenCodeAdapter เป็น true และไฟล์ของผู้ใช้ไม่เปลี่ยน
