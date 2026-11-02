# v1-user-compatibility Specification

## Purpose
ทำให้ config เดิม foundation_workflow และ foundation_runtime ของ v1 ยังมีผลบน v2 และพิสูจน์ความเข้ากันได้อีกสามเรื่องของผู้ใช้เดิม คือ managedAdapter, คำสั่ง service และข้อมูล session เดิม.
## Requirements
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

### Requirement: runtime-key-keeps-disabled

foundation_runtime SHALL ตั้ง runtime ของ plugin opencode.foundation โดยไม่เปลี่ยนสถานะเปิดปิด ส่วน plugin entry ที่เป็น add พร้อม options ของ package ทั่วไปและของ builtin ที่ผู้ใช้เขียนเองใน plugins SHALL ยังเปิด plugin ตามเดิม

#### Scenario: global ปิด และโปรเจกต์มี runtime เท่านั้น

- **WHEN** global config มี foundation_workflow: false และโปรเจกต์มี foundation_runtime: "path"
- **THEN** plugin opencode.foundation ไม่อยู่ใน inventory และไม่มีคำสั่ง 8 ตัว

#### Scenario: global ปิด และโปรเจกต์เปิดชัด

- **WHEN** global มี foundation_workflow: false และโปรเจกต์มี foundation_workflow: true
- **THEN** plugin active และมีคำสั่ง 8 ตัว

#### Scenario: ไม่มี key

- **WHEN** config ไม่มี foundation_workflow และ foundation_runtime
- **THEN** plugin active และมีคำสั่ง 8 ตัว

#### Scenario: โปรเจกต์ปิดเอง

- **WHEN** โปรเจกต์มี foundation_workflow: false และ foundation_runtime: "path"
- **THEN** plugin ไม่อยู่ใน inventory

#### Scenario: runtime พร้อม workflow true

- **WHEN** โปรเจกต์มี foundation_workflow: true และ foundation_runtime: "path" ขณะ global ปิด
- **THEN** plugin active ด้วย runtime path (PATH ของ shell ไม่ถูกเติม bundle)

### Requirement: runtime-key-configure-only-translation

ConfigNormalize SHALL แปลง foundation_runtime เป็น operation เพิ่มของ opencode.foundation พร้อม option runtime และ option สงวน $configureOnly เป็น true ส่วน foundation_workflow แปลงเหมือนเดิม และค่าไม่ถูกต้องของทั้งสอง key SHALL ถูกข้ามพร้อม diagnostic ชนิด invalid

#### Scenario: แปลง runtime

- **WHEN** normalize config ที่มี foundation_runtime: "path"
- **THEN** plugins คือ [{ package: "opencode.foundation", options: { runtime: "path", "$configureOnly": true } }]

#### Scenario: ค่าไม่ถูกต้องในอินสแตนซ์จริง

- **WHEN** โปรเจกต์มี foundation_workflow: "no" และ foundation_runtime: "system"
- **THEN** config โหลดได้ plugin active ด้วย runtime ค่าเริ่มต้น (PATH ถูกเติม) และ normalize รายงาน diagnostic invalid ทั้งสอง path

### Requirement: native-plugins-precedence

entry ใน plugins ของผู้ใช้ที่ระบุ opencode.foundation SHALL ชนะ operation ที่แปลงจาก foundation_workflow และ foundation_runtime ในเอกสารเดียวกัน

#### Scenario: options ใน plugins ชนะ runtime

- **WHEN** เอกสารเดียวมี foundation_runtime: "path" และ plugins: [{ package: "opencode.foundation", options: { runtime: "bundled" } }]
- **THEN** plugin active และ PATH ของ shell ถูกเติม bundle (bundled ชนะ)

#### Scenario: ลบใน plugins ชนะ workflow true

- **WHEN** เอกสารเดียวมี foundation_workflow: true และ plugins: ["-opencode.foundation"]
- **THEN** plugin ไม่อยู่ใน inventory

### Requirement: foundation-read-gated-by-plugin

endpoint /experimental/foundation/* (capability, list, get, investigations, documents) SHALL ตอบ unsupported เมื่อ plugin opencode.foundation ไม่อยู่ใน inventory ของ location ของคำขอ และตอบตามปกติเมื่ออยู่

#### Scenario: ปิดด้วย config

- **WHEN** config ของ location มี foundation_workflow: false แล้วเรียก list, capability และ documents
- **THEN** list และ documents ตอบ error รหัส unsupported ด้วยโครงเดียวกับ fallback และ capability ตอบ available: false พร้อม code unsupported โดยไม่เรียก runtime

#### Scenario: เปิดอยู่

- **WHEN** config ไม่มี foundation_workflow แล้วเรียก list
- **THEN** ตอบ snapshot ตามปกติ

#### Scenario: คนละ location

- **WHEN** สอง location ในเซิร์ฟเวอร์เดียว location แรกปิด workflow อีกอันไม่ปิด
- **THEN** location แรกได้ unsupported อีกอันได้ข้อมูลปกติ
