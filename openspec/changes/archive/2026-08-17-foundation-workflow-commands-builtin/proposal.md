# Change: foundation-workflow-commands-builtin

## Why

Phase 1.2 ตาม roadmap ถูกปรับ scope โดยผู้ใช้: workflow ที่ ship ใน changeloop
ต้องเป็น change loop ของ claude-foundation เอง ไม่ใช่ชุด agent generic
ทุกวันนี้ project ที่ใช้ `changeloop` เห็น loop commands ก็ต่อเมื่อ
claude-foundation ติดตั้ง `.claude/commands/*.md` ให้ และ host นั้นอ่านไฟล์
เหล่านั้นเอง — ตัว CLI ไม่รู้จัก `/investigate /change /build /prove /land`
เลย เป้าหมายคือให้ loop เป็น built-in identity ของ changeloop

## What changes

- Plugin v1 ตัวใหม่ (`foundation` ตาม pattern ของ `router`) ฉีด commands
  8 ตัว — `investigate change build prove land changes feature dev` — เข้า
  `config.command` ตอน boot ผ่าน `config` hook; template bundle ในไฟล์ binary
  (ดัดแปลงจาก `.claude/commands/*.md` ของ claude-foundation 3.2.27)
- เปิด default ทุก project; ปิดได้ด้วย config field ใหม่
  `foundation_workflow: false` (v1 schema, additive)
- Command ที่ผู้ใช้ define ชื่อซ้ำใน config ชนะเสมอ — plugin ไม่ทับ
- Template แต่ละตัว guard กรณี project ไม่มี harness
  (`.claude/harness/foundation.mjs` หาย): ให้ relay
  `.claude/harness/DEVELOPER-SETUP.md` / ชี้ไปติดตั้ง claude-foundation
  ห้าม improvise

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** command surface ของ CLI (slash commands ใน TUI),
  v1 config schema (additive field เดียว)
- **Security triggers:** none — template คงที่ compile-time, ไม่มี untrusted
  input / trust boundary ใหม่

## Non-goals

- ไม่ embed harness runtime / installer เข้า binary (`changeloop foundation
  init`) — แยกเป็น roadmap item ใหม่ตามมติผู้ใช้ (สองเฟส)
- ไม่ฉีด workflow agents ใหม่ — ผู้ใช้เลือก commands อย่างเดียว; per-phase
  model routing ผ่านตาราง router เลื่อนไปคู่ Router v2
- ไม่แตะ engine นอก plugin file + registration + config field (กติกา
  plugin-first ข้อ 2 ของ roadmap)
- ไม่แก้ v2 core path (`packages/core/src/plugin/command.ts`) — live path
  คือ v1
