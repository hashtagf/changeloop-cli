# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** Bundle template 8 ตัวของ foundation loop — สร้าง
  `packages/opencode/src/plugin/foundation/{investigate,change,build,prove,land,changes,feature,dev}.txt`
  จาก body ของ `.claude/commands/*.md` (ตัด frontmatter, เก็บ `$ARGUMENTS`,
  หัวไฟล์ระบุ source Foundation 3.2.27, prepend harness-missing guard) —
  verify: `bun test packages/opencode/test/plugin/foundation.test.ts -t template`
  [repo:root] [paths:packages/opencode/src/plugin/foundation/*]
  [claims:fnd-commands-injected]
- [x] **T002** Plugin `FoundationWorkflowPlugin` + registration — สร้าง
  `packages/opencode/src/plugin/foundation.ts` (`config` hook ฉีด
  `config.command` เฉพาะชื่อว่าง, เคารพ `foundation_workflow: false`) และ
  register ใน `packages/opencode/src/plugin/index.ts` — verify:
  `bun test packages/opencode/test/plugin/foundation.test.ts` [repo:root]
  [paths:packages/opencode/src/plugin/foundation.ts,packages/opencode/src/plugin/index.ts]
  [depends:T001] [claims:fnd-commands-injected,fnd-user-precedence,fnd-optout]
- [x] **T003** Config field `foundation_workflow` (optional boolean, v1
  additive) ใน `packages/core/src/v1/config/config.ts` + compat test v1
  decode / v1→v2 migrate — verify:
  `bun test packages/core/test/config/foundation-workflow.test.ts` [repo:root]
  [paths:packages/core/src/v1/config/config.ts,packages/core/test/config/*]
  [claims:fnd-config-compat]
- [x] **T004** Evidence script + docs — สร้าง
  `script/evidence-foundation-workflow-test.ts` (รวม test T001–T003 ออก
  JSON report) และเพิ่ม section `foundation_workflow` ใน
  `docs/CONFIGURATION.md` — verify:
  `bun run script/evidence-foundation-workflow-test.ts` เขียน
  `test-results/evidence-foundation-workflow-test.json` ผ่านทุกข้อ
  [repo:root] [paths:script/evidence-foundation-workflow-test.ts,docs/CONFIGURATION.md]
  [depends:T002,T003]
  [claims:fnd-commands-injected,fnd-user-precedence,fnd-optout,fnd-config-compat]
- [x] **T005** อัปเดต `docs/plan/ROADMAP.md` — 1.2 เป็น "foundation loop
  builtin (commands)" ตามมติสองเฟส และเพิ่ม item ใหม่ "embed harness +
  `changeloop foundation init`" ใน Phase 2 — verify: อ่านทวนว่า 1.2, มติ
  ผู้ใช้, และ item ใหม่ตรงกับ packet นี้ [repo:root] [kind:docs]
  [paths:docs/plan/ROADMAP.md]
