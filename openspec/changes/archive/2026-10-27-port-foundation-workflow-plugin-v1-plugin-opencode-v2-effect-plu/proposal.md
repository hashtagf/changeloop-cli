# Change: port Foundation workflow plugin จาก v1 มาเป็น plugin บน opencode v2 Effect plugin API ใน package @opencode/foundation

- **Change:** `port-foundation-workflow-plugin-v1-plugin-opencode-v2-effect-plu` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

เฟส 2 ของการ port fork ไปบน opencode v2.2.x: ย้าย Foundation workflow plugin (8 คำสั่ง, instruction จาก `claude-foundation host`, PATH ของ runtime ใน shell, agent contract ใน system prompt) จาก v1 มาเป็น plugin บน v2 Effect plugin API ใน `@opencode/foundation` โดยผูกกับ `FoundationRuntime` เดิม

## ขอบเขต

- **In scope (`foundation-workflow-plugin`):** ลงทะเบียนคำสั่ง investigate, change, build, prove, land, changes, feature และ dev พร้อมคำอธิบาย เมื่อ workflow ไม่ถูกปิด; เรียก claude-foundation host instruction ด้วย protocol 1 และ arguments ของผู้ใช้ ตรวจ response แล้วส่ง instruction เป็น prompt ของ session; ส่งข้อความ failureInstruction ตามรหัสแทน instruction และห้ามให้ agent ด้นเอง; ครอบ instruction ด้วยข้อความ bootstrap ที่ต้องขออนุมัติก่อนแก้ไฟล์; ต่อ PATH ของ bundled runtime เข้า shell ที่ agent สร้าง เฉพาะโหมด bundled; เติม agent contract จาก claude-foundation host agent-contract เข้า system prompt ของ session และเมื่อล้มเหลวให้เติมข้อความ failure contract
- **Out of scope:** edits outside `packages/foundation/package.json`, `packages/foundation/src/plugin.ts`, `packages/foundation/src/index.ts`, `packages/foundation/test/plugin.test.ts`, `bun.lock`

## Work type

feature

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| workflow-commands | ลงทะเบียนครบ 8 คำสั่ง | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | ปิด workflow | unclassified | T001 |  |  |
|  | ไม่ทับคำสั่งผู้ใช้ | unclassified | T001 |  |  |
| instruction-resolution | resolve สำเร็จ | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | argumentMode ของ changes | unclassified | T001 |  |  |
|  | argumentMode ของคำสั่งอื่น | unclassified | T001 |  |  |
|  | response ไม่ครบ | unclassified | T001 |  |  |
| failure-instructions | ไม่พบ executable | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | timeout | unclassified | T001 |  |  |
|  | host api ไม่รองรับ | unclassified | T001 |  |  |
|  | bundle เสียหาย | unclassified | T001 |  |  |
| bootstrap-guard | ยังไม่ init | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | init แล้ว | unclassified | T001 |  |  |
|  | โหมด path | unclassified | T001 |  |  |
| shell-environment | ต่อ PATH | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | โหมด path | unclassified | T001 |  |  |
|  | materialize ล้มเหลว | unclassified | T001 |  |  |
| agent-contract-system | เติม contract | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | contract ล้มเหลว | unclassified | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (19).
- Changed tests fail on the original code.
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.
