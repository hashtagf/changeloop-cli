# Tasks

> ไฟล์นี้เป็น ledger การ implement เพียงแห่งเดียว ติ๊กเมื่อเงื่อนไข verify
> ผ่านจริงเท่านั้น

- [x] **T001** Schema ของ router config: `packages/core/src/v1/config/router.ts`
  (tiers, agents, small_model) + field `router` (optional) ต่อเข้า
  `packages/core/src/v1/config/config.ts` — verify: v1 decode ของ config ที่มี
  `router` เก็บ field ไว้ครบ; v1→v2 migrate ของเอกสารเดียวกันผ่าน
  (`packages/core/test/config/router.test.ts`) [claims:router-config-compat]
  [repo:root] [paths:packages/core/src/v1/config/**,packages/core/test/**]
- [x] **T002** แกนการ resolve: ฟังก์ชัน pure `resolveRouting(table, availability)`
  ใน `packages/opencode/src/plugin/router.ts` คืนผล pin ราย agent +
  small-model; เลือก candidate แรกที่พร้อมใช้, รวมรายการ warn สำหรับ rule ที่
  resolve ไม่ได้, ไม่เขียนทับ pin เดิม — verify: unit test คลุมกรณี pin,
  fallback-เป็นช่องว่าง, และ precedence ของ pin ที่ตั้งเอง
  (`packages/opencode/test/plugin/router.test.ts`)
  [claims:router-pins-agents,router-fallback,router-precedence]
  [depends:T001] [repo:root]
  [paths:packages/opencode/src/plugin/router.ts,packages/opencode/test/**]
- [x] **T003** ต่อเข้า built-in: ตัวเช็คความพร้อมใช้ (auth record, cfg.provider,
  env var จาก models.dev) + `config` hook ที่ apply ผลการ resolve, ลงทะเบียนใน
  `internalPlugins()` (`packages/opencode/src/plugin/index.ts`) — verify:
  test ระดับ plugin ยิง `config` hook ใส่ stub config พร้อม availability
  ปลอม แล้วดูช่องที่ถูก pin/ไม่ถูก pin
  [claims:router-pins-agents] [depends:T002] [repo:root]
  [paths:packages/opencode/src/plugin/**,packages/opencode/test/**]
- [x] **T004** ตัว run evidence `script/evidence-router-test.ts` (pattern
  เดียวกับ phase-0: bun suite ที่ scope ไว้ → JUnit → สรุป JSON รวมที่
  `test-results/evidence-router-test.json`) — verify: script จบด้วย exit 0
  และปล่อยตัวเลข pass/fail ของ suite router
  [claims:router-pins-agents,router-fallback,router-precedence,router-config-compat]
  [depends:T002,T003] [repo:root] [paths:script/**]
- [x] **T005** เอกสาร: section `router` ใน `docs/CONFIGURATION.md` (รูปแบบตาราง,
  ความพร้อมใช้, warn-and-fallback, precedence) — verify: section อธิบายครบ
  ทั้งสี่พฤติกรรมตรงกับ spec delta
  [claims:router-pins-agents,router-fallback,router-precedence]
  [depends:T003] [repo:root] [paths:docs/CONFIGURATION.md]
