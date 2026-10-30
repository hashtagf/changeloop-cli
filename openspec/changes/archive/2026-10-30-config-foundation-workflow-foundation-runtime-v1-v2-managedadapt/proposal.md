# Change: ทำให้ config เดิม foundation_workflow และ foundation_runtime ของ v1 ยังมีผลบน v2 และพิสูจน์ความเข้ากันได้อีกสามเรื่องของผู้ใช้เดิม คือ managedAdapter, คำสั่ง service และข้อมูล session เดิม

- **Change:** `config-foundation-workflow-foundation-runtime-v1-v2-managedadapt` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

ผู้ใช้ v1 เดิมของ fork ตั้ง `foundation_workflow` (false = ปิดคำสั่ง Foundation 8 ตัว) และ `foundation_runtime` ("bundled"|"path") ใน config บน v2 workflow นี้เป็น builtin plugin `opencode.foundation` ที่ไม่อ่าน key เหล่านี้ (schema ของ v2 ทิ้ง key ที่ไม่รู้จักเงียบๆ) ผู้ใช้ที่ปิด workflow จึงได้คำสั่ง 8 ตัวกลับมาโดยไม่ตั้งใจ งานนี้แปลง key เดิมเป็นการเปิด/ปิด/ตั้ง option ของ plugin ในขั้น normalize และให้ builtin รับ option จาก operation `plugins` ที่มีอยู่แล้ว

งานเดียวกันตรวจอีกสามเรื่องที่กระทบผู้ใช้เดิมและบันทึกผลเป็นหลักฐาน: (1) `managedAdapter` ของ v1 ไม่ต้อง port เพราะ v2 ฉีด env และ agent contract ทุกครั้งที่ workflow เปิดอยู่ (2) `changeloop service start` ใช้ executable ที่กำลังรันอยู่แล้ว ค่าเริ่มต้น `opencode serve --service` ของ client library ไม่ถูกเรียกโดย CLI (3) fork ไม่ได้เปลี่ยน schema ฐานข้อมูล v1 จึงไม่มีข้อมูลเฉพาะ fork ที่ต้องย้าย พิสูจน์ด้วย test ว่า migration ของ upstream รับ session รูปแบบ v1 ที่มีคำสั่ง Foundation

## ขอบเขต

- **In scope (`v1-user-compatibility`):** ทำให้คำสั่ง Foundation 8 ตัวไม่ถูกลงทะเบียนในอินสแตนซ์จริง และ config ที่ไม่มี key นี้ SHALL ได้ 8 คำสั่งเหมือนเดิม; เลือก runtime ของ plugin เหมือน v1: path ไม่เติม PATH ของ bundle เข้า shell ส่วน bundled (ค่าเริ่มต้น) เติม; แปลง foundation_workflow และ foundation_runtime เป็น plugin operation ในเอกสารเดียวกัน โดยวางก่อน plugin และ plugins ที่ผู้ใช้เขียนเอง และข้ามค่าไม่ถูกต้องพร้อม diagnostic; ใช้ executable ที่กำลังรันตามด้วย serve --service ไม่ใช่ชื่อ opencode; ย้าย session รูปแบบ v1 ที่มีข้อความคำสั่ง Foundation และ tool call ของ harness โดยไม่ข้ามแถวและไม่ล้ม
- **Out of scope:** edits outside `packages/core/src/config/normalize.ts`, `packages/core/src/plugin/supervisor.ts`, `packages/core/test/config/foundation-compat.test.ts`, `packages/core/test/plugin/foundation-config.test.ts`, `packages/cli/test/service-command.test.ts`, `packages/core/test/v1-migration-foundation.test.ts`

## ผลกระทบและความเสี่ยง

- **Impact:** medium (derived: data work: tasks touch packages/core/test/v1-migration-foundation.test.ts)
- **Coupling:** coupled (derived: tasks span packages/cli, packages/core)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

ผู้ใช้ Changeloop v1 ที่ตั้ง foundation_workflow: false หรือ foundation_runtime: "path" ใน opencode.json (โปรเจกต์หรือ global) ยังได้ผลเหมือนเดิมบนเวอร์ชันใหม่ config ที่ไม่มี key นี้ได้คำสั่ง Foundation 8 ตัวเหมือนเดิม และ session เดิมย้ายเข้ามาได้

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| foundation-workflow-config | ปิดในโปรเจกต์ | unclassified | T002 | test: `packages/core/test/plugin/foundation-config.test.ts` | — |
|  | ปิดใน global | unclassified | T002 |  |  |
|  | โปรเจกต์เปิดทับ global | unclassified | T002 |  |  |
|  | ไม่มี key | unclassified | T002 |  |  |
|  | ค่าไม่ถูกต้อง | unclassified | T002 |  |  |
| foundation-runtime-config | runtime path | unclassified | T002 | test: `packages/core/test/plugin/foundation-config.test.ts` | — |
|  | runtime bundled | unclassified | T002 |  |  |
|  | เปลี่ยนค่าแล้ว activate ใหม่ | unclassified | T002 |  |  |
| legacy-config-translation | ค่าไม่ถูกต้อง | failure | T001 | test: `packages/core/test/config/foundation-compat.test.ts` | — |
|  | แปลง workflow | unclassified | T001 |  |  |
|  | แปลง runtime | unclassified | T001 |  |  |
|  | ไม่มี key | unclassified | T001 |  |  |
| service-command-self | command ของ CLI | unclassified | T003 | test: `packages/cli/test/service-command.test.ts` | — |
| v1-session-migration | session ที่มีคำสั่ง Foundation | unclassified | T004 | test: `packages/core/test/v1-migration-foundation.test.ts` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (14).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for foundation-workflow-config, foundation-runtime-config, legacy-config-translation, service-command-self, v1-session-migration.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-reactivation-direction: The scenario 'เปลี่ยนค่าแล้ว activate ใหม่' says options change from bundled to path while the instance runs, and the plugin reactivates with the path runtime. changeRuntime does the reverse: it starts at path and writes bundled. It then waits until PATH differs from /usr/bin. The mechanism is the same (the revision carries JSON.stringify(options) at supervisor.ts:111), so this probably holds both ways. Still, the literal direction, and the removal of the bundled shell hook when moving to path, is not exercised. (root/packages/core/test/plugin/foundation-config.test.ts:106) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F2-builtin-options-replace: builtinOptions.set replaces the options; it does not merge them. As a result, foundation_runtime is silently lost when the same or a later document also has a native { package: 'opencode.foundation', options: { timeoutMs: ... } } entry. Also, a later bare add, or an add with options {}, cannot clear options set earlier, because of the Object.keys(...).length > 0 guard. This matches how package plugins behave and the comment's 'native entries outrank', so it is non-blocking. But a v1 user who mixes the legacy key with native plugin options can lose the runtime choice. (root/packages/core/src/plugin/supervisor.ts:59) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F3-bundled-prefix-assertion: The explicit 'foundation_runtime bundled' test only asserts that PATH is not '/usr/bin'. It does not check the scenario's THEN, that PATH starts with the bundle bin folder. The no-key test is a little stronger: it asserts the PATH ends with ':/usr/bin'. Neither one checks that the prefix is the bundle's bin directory. (root/packages/core/test/plugin/foundation-config.test.ts:192) | minor | ยังเปิดอยู่ | claude-opus |
