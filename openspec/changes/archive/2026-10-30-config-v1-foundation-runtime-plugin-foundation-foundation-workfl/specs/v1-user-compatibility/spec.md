# v1-user-compatibility

## ADDED Requirements

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
