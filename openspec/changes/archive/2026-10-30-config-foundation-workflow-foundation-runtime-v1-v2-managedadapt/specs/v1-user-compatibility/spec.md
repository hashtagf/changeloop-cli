# v1-user-compatibility

## Purpose

ทำให้ config เดิม foundation_workflow และ foundation_runtime ของ v1 ยังมีผลบน v2 และพิสูจน์ความเข้ากันได้อีกสามเรื่องของผู้ใช้เดิม คือ managedAdapter, คำสั่ง service และข้อมูล session เดิม.

## ADDED Requirements

### Requirement: foundation-workflow-config

config ที่ตั้ง foundation_workflow เป็น false (ในโปรเจกต์หรือ global) SHALL ทำให้คำสั่ง Foundation 8 ตัวไม่ถูกลงทะเบียนในอินสแตนซ์จริง และ config ที่ไม่มี key นี้ SHALL ได้ 8 คำสั่งเหมือนเดิม

#### Scenario: ปิดในโปรเจกต์

- **WHEN** opencode.json ของโปรเจกต์มี foundation_workflow: false แล้วอินสแตนซ์เริ่มทำงาน
- **THEN** ไม่มีคำสั่ง investigate, change, build, prove, land, changes, feature, dev และ plugin opencode.foundation ไม่อยู่ใน inventory

#### Scenario: ปิดใน global

- **WHEN** opencode.json ใน global config มี foundation_workflow: false และโปรเจกต์ไม่มี key
- **THEN** ไม่มีคำสั่ง 8 ตัว

#### Scenario: โปรเจกต์เปิดทับ global

- **WHEN** global ตั้ง false และโปรเจกต์ตั้ง foundation_workflow: true
- **THEN** คำสั่ง 8 ตัวลงทะเบียน

#### Scenario: ไม่มี key

- **WHEN** config ไม่มี foundation_workflow และ foundation_runtime
- **THEN** คำสั่ง 8 ตัวลงทะเบียนและ plugin active

#### Scenario: ค่าไม่ถูกต้อง

- **WHEN** foundation_workflow เป็น "no" และ foundation_runtime เป็น "system" พร้อมค่าอื่นที่ถูกต้องใน config เดียวกัน
- **THEN** config โหลดสำเร็จ ค่าอื่นยังมีผล และคำสั่ง 8 ตัวลงทะเบียนตามค่าเริ่มต้น

### Requirement: foundation-runtime-config

foundation_runtime SHALL เลือก runtime ของ plugin เหมือน v1: path ไม่เติม PATH ของ bundle เข้า shell ส่วน bundled (ค่าเริ่มต้น) เติม

#### Scenario: runtime path

- **WHEN** config ตั้ง foundation_runtime: "path" แล้วสร้าง shell
- **THEN** คำสั่ง 8 ตัวลงทะเบียน และ PATH ของ shell ไม่ถูกเติมโฟลเดอร์ bin ของ bundle

#### Scenario: runtime bundled

- **WHEN** config ไม่ตั้ง runtime หรือตั้งเป็น bundled แล้วสร้าง shell
- **THEN** PATH ของ shell ขึ้นต้นด้วยโฟลเดอร์ bin ของ bundle

#### Scenario: เปลี่ยนค่าแล้ว activate ใหม่

- **WHEN** operation เพิ่มของ builtin เปลี่ยน options จาก bundled เป็น path ระหว่างที่อินสแตนซ์ทำงาน
- **THEN** plugin ถูก activate ใหม่ด้วย runtime path

### Requirement: legacy-config-translation

ConfigNormalize SHALL แปลง foundation_workflow และ foundation_runtime เป็น plugin operation ในเอกสารเดียวกัน โดยวางก่อน plugin และ plugins ที่ผู้ใช้เขียนเอง และข้ามค่าไม่ถูกต้องพร้อม diagnostic

#### Scenario: แปลง workflow

- **WHEN** normalize config ที่มี foundation_workflow: false และ plugins ["-x"]
- **THEN** plugins คือ ["-opencode.foundation", "-x"] และไม่มี diagnostic

#### Scenario: แปลง runtime

- **WHEN** normalize config ที่มี foundation_runtime: "path"
- **THEN** plugins คือ [{ package: "opencode.foundation", options: { runtime: "path" } }]

#### Scenario: ค่าไม่ถูกต้อง

- **WHEN** normalize config ที่มี foundation_workflow: "no"
- **THEN** ไม่มี plugins จาก key นี้ และมี diagnostic ชนิด invalid ที่ path foundation_workflow

#### Scenario: ไม่มี key

- **WHEN** normalize config ที่ไม่มีทั้งสอง key
- **THEN** ผลลัพธ์เหมือนก่อนเปลี่ยน ไม่มี field plugins เพิ่ม

### Requirement: service-command-self

คำสั่งที่ ServiceConfig.options ส่งให้ Service.ensure SHALL ใช้ executable ที่กำลังรันตามด้วย serve --service ไม่ใช่ชื่อ opencode

#### Scenario: command ของ CLI

- **WHEN** เรียก ServiceConfig.options()
- **THEN** command ขึ้นต้นด้วย selfCommand() และลงท้ายด้วย serve และ --service และไม่มีสมาชิกที่เป็นชื่อ opencode

### Requirement: v1-session-migration

migration ของ upstream SHALL ย้าย session รูปแบบ v1 ที่มีข้อความคำสั่ง Foundation และ tool call ของ harness โดยไม่ข้ามแถวและไม่ล้ม

#### Scenario: session ที่มีคำสั่ง Foundation

- **WHEN** ฐานข้อมูล v1 สังเคราะห์มี session ที่ผู้ใช้เรียก /change และ assistant เรียก bash ด้วย claude-foundation
- **THEN** V1Migration.run สำเร็จ ข้อความผู้ใช้และ assistant ถูกย้ายครบ ไม่มี warning ของแถวที่ถูกข้าม
