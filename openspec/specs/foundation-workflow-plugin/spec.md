# foundation-workflow-plugin Specification

## Purpose
Port Foundation workflow plugin จาก v1 มาเป็น plugin บน opencode v2 Effect plugin API ใน package @opencode/foundation.
## Requirements
### Requirement: workflow-commands

plugin SHALL ลงทะเบียนคำสั่ง investigate, change, build, prove, land, changes, feature และ dev พร้อมคำอธิบาย เมื่อ workflow ไม่ถูกปิด

#### Scenario: ลงทะเบียนครบ 8 คำสั่ง

- **WHEN** plugin เริ่มทำงานโดยไม่ตั้ง workflow
- **THEN** command transform เพิ่มคำสั่งทั้ง 8 ชื่อ แต่ละตัวมี description ไม่ว่าง

#### Scenario: ปิด workflow

- **WHEN** options.workflow เป็น false
- **THEN** plugin ไม่ลงทะเบียนคำสั่ง ไม่ลงทะเบียน hook shell และไม่ลงทะเบียน hook session

#### Scenario: ไม่ทับคำสั่งผู้ใช้

- **WHEN** ผู้ใช้มีคำสั่งชื่อเดียวกับ builtin ที่ลงทะเบียนหลัง plugin
- **THEN** คำสั่งของผู้ใช้คือตัวที่ทำงานเมื่อ execute และ plugin ไม่ลบหรือแก้คำสั่งนั้น

### Requirement: instruction-resolution

การรันคำสั่ง SHALL เรียก claude-foundation host instruction ด้วย protocol 1 และ arguments ของผู้ใช้ ตรวจ response แล้วส่ง instruction เป็น prompt ของ session

#### Scenario: resolve สำเร็จ

- **WHEN** executable ตอบ response ที่ถูกต้องของคำสั่ง build พร้อม arguments ที่มีช่องว่างและเครื่องหมายคำพูด
- **THEN** executable ได้รับ argv host instruction build --protocol 1 --format json --arguments ตามค่าเดิมทุกตัวอักษร และ session.prompt ได้ text เป็น instruction พร้อม sessionID และ delivery เดิม

#### Scenario: argumentMode ของ changes

- **WHEN** รันคำสั่ง changes
- **THEN** response ที่มี argumentMode เป็น none ผ่านการตรวจ และ response ของคำสั่ง changes ที่มี argumentMode เป็น required ถูกปฏิเสธเป็น foundation_response_invalid

#### Scenario: argumentMode ของคำสั่งอื่น

- **WHEN** รันคำสั่ง build และ response มี argumentMode เป็น none
- **THEN** ถูกปฏิเสธเป็น foundation_response_invalid

#### Scenario: response ไม่ครบ

- **WHEN** response ขาด protocol ตรง, command ตรง, description, instruction หรือ foundationVersion ที่ไม่ว่าง หรือไม่ใช่ JSON หรือใหญ่เกิน maxOutputBytes
- **THEN** prompt ของ session เป็นข้อความ failureInstruction รหัส foundation_response_invalid

### Requirement: failure-instructions

เมื่อ resolve ไม่สำเร็จ plugin SHALL ส่งข้อความ failureInstruction ตามรหัสแทน instruction และห้ามให้ agent ด้นเอง

#### Scenario: ไม่พบ executable

- **WHEN** โหมด path และ claude-foundation ไม่อยู่ใน PATH หรือ executable ไม่มีอยู่
- **THEN** prompt มีรหัส foundation_cli_missing และข้อความให้ติดตั้ง claude-foundation

#### Scenario: timeout

- **WHEN** executable ทำงานเกิน timeoutMs
- **THEN** prompt มีรหัส foundation_cli_timeout

#### Scenario: host api ไม่รองรับ

- **WHEN** executable จบด้วย exit code ไม่ใช่ 0
- **THEN** prompt มีรหัส foundation_host_api_unsupported

#### Scenario: bundle เสียหาย

- **WHEN** โหมด bundled และ FoundationRuntime.command ล้มด้วยข้อความ Bundled Foundation หรือ Unsafe Foundation bundle
- **THEN** prompt มีรหัส foundation_bundle_invalid และข้อความให้ติดตั้ง release ใหม่

### Requirement: bootstrap-guard

ในโหมด bundled เมื่อโปรเจกต์ยังไม่ติดตั้ง Foundation plugin SHALL ครอบ instruction ด้วยข้อความ bootstrap ที่ต้องขออนุมัติก่อนแก้ไฟล์

#### Scenario: ยังไม่ init

- **WHEN** โหมด bundled และ status ของโปรเจกต์ไม่ใช่ installed
- **THEN** prompt ขึ้นต้นด้วยข้อความ Foundation is not initialized และมี instruction เดิมอยู่ท้ายสุด

#### Scenario: init แล้ว

- **WHEN** โหมด bundled และ status เป็น installed
- **THEN** prompt คือ instruction ล้วนไม่มีข้อความ bootstrap

#### Scenario: โหมด path

- **WHEN** options.runtime เป็น path
- **THEN** prompt คือ instruction ล้วนโดยไม่ตรวจ status

### Requirement: shell-environment

plugin SHALL ต่อ PATH ของ bundled runtime เข้า shell ที่ agent สร้าง เฉพาะโหมด bundled

#### Scenario: ต่อ PATH

- **WHEN** โหมด bundled และเกิด hook shell create.before
- **THEN** env.PATH ขึ้นต้นด้วยไดเรกทอรี bin ของ runtime ที่ materialize ตามด้วย PATH เดิม และ env อื่นไม่เปลี่ยน

#### Scenario: โหมด path

- **WHEN** options.runtime เป็น path
- **THEN** env ไม่ถูกแก้

#### Scenario: materialize ล้มเหลว

- **WHEN** FoundationRuntime.environment ล้มเหลว
- **THEN** hook ไม่ทำให้การสร้าง shell ล้มและ env ไม่ถูกแก้

### Requirement: agent-contract-system

plugin SHALL เติม agent contract จาก claude-foundation host agent-contract เข้า system prompt ของ session และเมื่อล้มเหลวให้เติมข้อความ failure contract

#### Scenario: เติม contract

- **WHEN** hook session context ทำงานและ executable ตอบ contract ที่ถูกต้อง
- **THEN** system มีส่วน text ใหม่ที่เป็น contract ท้ายสุด และเรียก executable ด้วย host agent-contract --protocol 1 --format json เพียงครั้งเดียวแม้ hook ทำงานหลายครั้ง

#### Scenario: contract ล้มเหลว

- **WHEN** executable ล้มเหลวหรือ response ไม่ถูกต้อง
- **THEN** system มีข้อความ Foundation agent contract unavailable พร้อมรหัสที่ตรงกัน
