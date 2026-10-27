# model-router Specification

## Purpose
TBD - created by archiving change model-router-v1. Update Purpose after archive.
## Requirements
### Requirement: ตาราง routing ปัก model ให้ agent ตอน boot

CLI SHALL (ต้อง) รับ config section `router` (optional) — ชื่อ tier → รายการ candidate
`provider/model` เรียงลำดับ, ชื่อ agent → tier หรือ `provider/model` ตรง ๆ,
และ tier ของ `small_model` เป็น optional — และตอน boot ให้ built-in plugin
ตั้ง model ของ agent ที่ถูก map (รวมถึงช่อง small-model) เป็น candidate
ตัวแรกที่พร้อมใช้ของ tier นั้น

#### Scenario: router-pins-agents

- **WHEN** config มีตาราง `router` ที่ map agent ไปยัง tier ซึ่ง candidate
  ตัวแรกมี provider พร้อมใช้
- **THEN** config ที่ resolve แล้ว pin model ของ agent นั้นเป็น candidate
  ดังกล่าว และการ map tier ของ `small_model` ก็ pin `cfg.small_model`
  แบบเดียวกัน

### Requirement: rule ที่ resolve ไม่ได้ต้องเตือนแล้ว fallback

Router SHALL NOT (ต้องไม่) ทำให้ boot ล้ม และต้องไม่ pin model ที่ใช้ไม่ได้: เมื่อไม่มี
candidate ตัวใดของ tier ที่ map ไว้มี provider พร้อมใช้ ให้ log คำเตือนและ
ปล่อยช่องนั้นว่างไว้ เพื่อให้ fallback chain เดิมของ engine ทำงาน

#### Scenario: router-fallback

- **WHEN** routing rule ชี้ไป tier ที่ไม่มี candidate ตัวใดมี provider
  พร้อมใช้
- **THEN** agent ที่ได้รับผลไม่ถูก router pin, มีการ log คำเตือน และการ
  resolve config จบตามปกติ

### Requirement: pin ที่ผู้ใช้ตั้งเองมาก่อนเสมอ

Router SHALL (ต้อง) เติมเฉพาะช่องที่ยังว่าง: `cfg.agent[<name>].model` หรือ
`cfg.small_model` ที่ตั้งไว้ชัดเจนจาก config layer ใดก็ตามต้องชนะตาราง
routing

#### Scenario: router-precedence

- **WHEN** config pin model ของ agent ไว้ชัดเจน และตาราง router ก็ map agent
  ตัวเดียวกัน
- **THEN** pin ที่ตั้งไว้ชัดเจนไม่ถูกเปลี่ยนหลัง router ทำงาน

### Requirement: field router เข้ากันได้กับ loader ทุกรุ่น

ไฟล์ config ที่มี field `router` SHALL (ต้อง) decode ผ่าน v1 config schema โดย field
ถูกเก็บไว้ครบ และต้องยัง migrate/โหลดผ่านเส้นทาง config v1→v2 ได้ปกติ

#### Scenario: router-config-compat

- **WHEN** เอกสาร config ที่มี section `router` ถูก decode ด้วย v1 schema
  และถูกส่งผ่าน migration v1→v2
- **THEN** v1 decode เก็บ section ไว้ครบ และ migration จบโดยไม่มี error

