# Design

## Current state

- Builtin commands ของ v1 มีแค่ `init`/`review` ลงทะเบียนตรงใน
  `packages/opencode/src/command/index.ts:70-88` จาก `.txt` template ที่ bundle
  มากับ binary จากนั้น loop `cfg.command ?? {}` (`:90`) ทับได้, MCP prompts
  ต่อ, และ skills เติมเฉพาะชื่อที่ยังว่าง (`:135 if (commands[item.name])
  continue`)
- Plugin v1 แก้ config ตอน boot ได้จริง — `ModelRouterPlugin`
  (`packages/opencode/src/plugin/router.ts:100-116`) mutate `config.agent` /
  `config.small_model` ผ่าน `config` hook และ investigation 1.1 ยืนยันว่า
  hook นี้คือ lever เดียวที่ live
- Registration: builtin plugins ถูก import และลงทะเบียนใน
  `packages/opencode/src/plugin/index.ts` (เช่น `ModelRouterPlugin` บรรทัด 22)
- Config schema v1: field `router` เพิ่มแบบ additive ใน
  `packages/core/src/v1/config/config.ts:81` โดย schema แยกไฟล์
  (`config/router.ts`) — precedent สำหรับ field ใหม่
- Template ต้นทาง: `.claude/commands/*.md` 8 ไฟล์ รวม ~7.4KB (Foundation
  3.2.27) แต่ละไฟล์มี frontmatter (description, argument-hint) + body ที่สั่ง
  ให้เดินตาม harness (`packet`, doctor ฯลฯ) โดยอิง `.claude/harness/` และ
  `.claude/skills/` ใน project
- Skill discovery ของ changeloop เก็บ `.claude/skills/**` อยู่แล้ว — ใน
  project ที่ติดตั้ง foundation, skill ชื่อ `change`/`build`/… จะกลายเป็น
  command ผ่าน skill source ถ้าชื่อยังว่าง; การฉีดผ่าน `cfg.command`
  เกิดก่อน จึงชนะ duplicate เหล่านั้นโดยไม่ต้องแก้ engine

## Decisions

- **Decision:** ship เป็น built-in v1 plugin `FoundationWorkflowPlugin`
  (`packages/opencode/src/plugin/foundation.ts`) ใช้ `config` hook ฉีด
  `config.command` ตอน boot
  - **Why:** pattern เดียวกับ router v1 ที่พิสูจน์แล้ว; engine touch เหลือ
    registration + config field; รอด upstream v1→v2 rewrite เพราะไม่ fork core
  - **Rejected:** แก้ `command/index.ts` เพิ่ม builtin ตรง ๆ (fork ลึก,
    ผิดกติกา plugin-first), หรือใช้ v2 `ctx.command.transform` (dormant ใน
    live path)
- **Decision:** เปิด default + opt-out ด้วย `foundation_workflow: false`
  - **Why:** มติผู้ใช้ 2026-08-17 — loop คือ identity ของ changeloop
  - **Rejected:** opt-in ผ่าน config (ผู้ใช้ปฏิเสธ)
- **Decision:** commands อย่างเดียว ไม่ฉีด agents ใหม่
  - **Why:** มติผู้ใช้ 2026-08-17; ลด scope; command แต่ละตัวรันใน agent
    ปัจจุบัน
  - **Rejected:** ฉีด agent ต่อเฟส (fnd-*) เพื่อให้ router route per-phase —
    เลื่อนไปคู่ Router v2
- **Decision:** template = body ของ `.claude/commands/*.md` (ตัด frontmatter,
  เก็บ `$ARGUMENTS`) + guard นำหน้าเรื่อง harness หาย; sync ด้วยมือต่อ
  foundation release และบันทึกเวอร์ชันต้นทางในหัวไฟล์ template
  - **Why:** ไฟล์เล็ก (~7.4KB) และเปลี่ยนช้า; guard เป็น text ไม่ใช่ logic
    ตอน boot จึงไม่ต้องแตะ engine และไม่ต้อง stat filesystem ทุก start
  - **Rejected:** plugin ตรวจ harness แล้ว skip ฉีด (ผู้ใช้ต้องการเห็น
    commands ทุก project), embed installer (เฟสสอง)
- **Decision:** user-defined command ชื่อซ้ำชนะ — plugin ฉีดเฉพาะชื่อที่
  `config.command` ยังไม่มี
  - **Why:** สอดคล้อง precedence ของ router v1 (explicit pin ชนะ)
  - **Rejected:** plugin ทับเสมอ (ทำลาย config ผู้ใช้)

## Compatibility and migration

- Config field ใหม่เป็น optional additive — เอกสาร config เดิม decode ผ่าน
  v1 และเส้นทาง migrate v1→v2 ไม่เปลี่ยน (มี test ยืนยันแบบเดียวกับ
  `router-config-compat`)
- ไม่มี persisted data / rollout พิเศษ; ปิดได้ทันทีด้วย
  `foundation_workflow: false`

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Template ฉีดทับ command ที่ผู้ใช้ define เอง | precedence test: ชื่อซ้ำใน config.command ต้องรอด | test |
| Config เดิมพังเพราะ field ใหม่ | v1 decode + v1→v2 migrate compat test | test |
| Template เพี้ยนจากต้นทาง foundation | หัว template ระบุ source version 3.2.27; test ตรวจครบ 8 ชื่อ + guard string | test |
| Opt-out ไม่ตัดจริง | test: `foundation_workflow: false` ต้องไม่ฉีดสัก command และไม่แตะ init/review | test |
