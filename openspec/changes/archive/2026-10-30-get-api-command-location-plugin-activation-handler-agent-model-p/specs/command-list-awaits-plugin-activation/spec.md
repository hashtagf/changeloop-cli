# command-list-awaits-plugin-activation

## Purpose

แก้ GET /api/command ที่คืนรายการคำสั่งว่างในคำขอแรกของ location ที่เพิ่งสร้าง โดยให้รอ plugin activation ก่อนตอบ เหมือน handler agent/model/provider.

## ADDED Requirements

### Requirement: command-list-awaits-activation

GET /api/command SHALL รอให้ plugin activation ของ location เสร็จก่อนตอบ และ SHALL ไม่ตอบรายการคำสั่งที่ยังไม่ครบโดยเงียบ

#### Scenario: คำขอแรกของ location ใหม่

- **WHEN** เรียก GET /api/command เป็นคำขอแรกของ location ที่มีคำสั่งใน config และ Foundation plugin builtin
- **THEN** ตอบ 200 พร้อมคำสั่งจาก config และคำสั่ง Foundation ทั้ง 8 ตัว (investigate, change, build, prove, land, changes, feature, dev)

#### Scenario: activation ไม่เสร็จ

- **WHEN** plugin activation ของ location ไม่เสร็จใน 5 วินาที
- **THEN** ตอบ 503 ServiceUnavailableError แทนรายการว่าง

### Requirement: command-list-contract-503

สัญญา endpoint command.list และ openapi.json SHALL ประกาศ response 503 ServiceUnavailableError

#### Scenario: openapi ประกาศ 503

- **WHEN** อ่านนิยาม operation command.list
- **THEN** responses มี 503 อ้าง ServiceUnavailableErrorEncoded เหมือน agent.list
