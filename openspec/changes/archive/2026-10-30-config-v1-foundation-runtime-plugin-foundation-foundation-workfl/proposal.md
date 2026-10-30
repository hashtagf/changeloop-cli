# Change: แก้สองช่องความเข้ากันได้ของ config v1: foundation_runtime อย่างเดียวต้องไม่เปิด plugin Foundation ที่ถูกปิดไว้ และ foundation_workflow:false ต้องปิดการอ่านข้อมูล Foundation ของ web UI ด้วย พร้อมบันทึกด้วย test ว่า foundation_runtime ชนกับ plugins ของ opencode.foundation แล้วใครชนะ และค่าไม่ถูกต้องได้ diagnostic

- **Change:** `config-v1-foundation-runtime-plugin-foundation-foundation-workfl` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

หลัง port ความเข้ากันได้ของ config v1 (change `config-foundation-workflow-...`) ยังเหลือสองช่องที่ผู้ใช้ v1 เจอ และหนึ่งพฤติกรรมที่ต้องบันทึกเป็นหลักฐาน

1. ตั้งแค่ `foundation_runtime` ในโปรเจกต์ทำให้ plugin `opencode.foundation` ที่ถูกปิดด้วย `foundation_workflow: false` ใน global กลับมาเปิด เพราะ operation ที่แปลงมาเป็น add ซึ่ง supervisor ถือว่าเป็นการเปิด ใน v1 plugin ยังปิดอยู่ แก้โดยให้ operation ที่มาจาก `foundation_runtime` มี option สงวน `$configureOnly` ที่ supervisor อ่านแล้วตั้ง option แต่ไม่เปิด plugin และไม่ส่ง key นี้ต่อให้ plugin ความหมายของ add-with-options ของ plugin ทั่วไปไม่เปลี่ยน
2. ผู้ใช้ที่ปิดด้วย `foundation_workflow: false` ยังเห็นข้อมูล Foundation ใน web UI เพราะ endpoint `/experimental/foundation/*` อ่านจาก runtime ตรงๆ ใน v1 ตอบ `unsupported` แก้โดยให้ handler ตรวจ inventory ของ plugin ที่ active ใน location ของคำขอ ถ้าไม่มี `opencode.foundation` ตอบ `unsupported` ด้วยโครง error เดิม
3. บันทึกด้วย test (ไม่แก้โค้ด): ตัวไหนชนะเมื่อ `foundation_runtime` ชนกับ entry `plugins` ของ `opencode.foundation` และค่าไม่ถูกต้องของสอง key ได้ diagnostic และใช้ค่าเริ่มต้น

## ขอบเขต

- **In scope (`v1-user-compatibility`):** ตั้ง runtime ของ plugin opencode.foundation โดยไม่เปลี่ยนสถานะเปิดปิด ส่วน plugin entry ที่เป็น add พร้อม options ของ package ทั่วไปและของ builtin ที่ผู้ใช้เขียนเองใน plugins SHALL ยังเปิด plugin ตามเดิม; แปลง foundation_runtime เป็น operation เพิ่มของ opencode.foundation พร้อม option runtime และ option สงวน $configureOnly เป็น true ส่วน foundation_workflow แปลงเหมือนเดิม และค่าไม่ถูกต้องของทั้งสอง key SHALL ถูกข้ามพร้อม diagnostic ชนิด invalid; ชนะ operation ที่แปลงจาก foundation_workflow และ foundation_runtime ในเอกสารเดียวกัน; ตอบ unsupported เมื่อ plugin opencode.foundation ไม่อยู่ใน inventory ของ location ของคำขอ และตอบตามปกติเมื่ออยู่
- **Out of scope:** edits outside `packages/core/src/config/plugin/configure-only.ts`, `packages/core/src/config/normalize.ts`, `packages/core/src/plugin/supervisor.ts`, `packages/core/test/config/foundation-compat.test.ts`, `packages/core/test/plugin/foundation-config.test.ts`, `packages/server/src/handlers/foundation.ts`, … +1 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/core, packages/server)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

ผู้ใช้ที่ปิด foundation_workflow ใน global แล้วตั้ง foundation_runtime ในโปรเจกต์ ยังได้ workflow ปิดเหมือนเดิม และหน้าเว็บจะไม่แสดงข้อมูล Foundation ของโปรเจกต์ที่ปิด workflow

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| runtime-key-keeps-disabled | global ปิด และโปรเจกต์มี runtime เท่านั้น | unclassified | T002 | test: `packages/core/test/plugin/foundation-config.test.ts` | — |
|  | global ปิด และโปรเจกต์เปิดชัด | unclassified | T002 |  |  |
|  | ไม่มี key | unclassified | T002 |  |  |
|  | โปรเจกต์ปิดเอง | unclassified | T002 |  |  |
|  | runtime พร้อม workflow true | unclassified | T002 |  |  |
|  | option สงวนไม่รั่วเข้า plugin | unclassified | T002 |  |  |
| runtime-key-configure-only-translation | ค่าไม่ถูกต้องในอินสแตนซ์จริง | failure | T001 | test: `packages/core/test/config/foundation-compat.test.ts` | — |
|  | แปลง runtime | unclassified | T001 |  |  |
| native-plugins-precedence | options ใน plugins ชนะ runtime | unclassified | T002 | test: `packages/core/test/plugin/foundation-config.test.ts` | — |
|  | ลบใน plugins ชนะ workflow true | unclassified | T002 |  |  |
| foundation-read-gated-by-plugin | ปิดด้วย config | failure | T003 | test: `packages/server/test/foundation.test.ts` | — |
|  | เปิดอยู่ | unclassified | T003 |  |  |
|  | คนละ location | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (13).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for runtime-key-keeps-disabled, runtime-key-configure-only-translation, native-plugins-precedence, foundation-read-gated-by-plugin.

## Appendix: Amendment history

- Revision 1 (2026-10-30): ตัว option สงวน $configureOnly ถูกตัดออกใน supervisor ก่อนถึง plugin และสังเกตจากภายนอกอินสแตนซ์ไม่ได้ จึงถอด scenario รั่ว option ออก ส่วนที่เหลือพิสูจน์ด้วยอินสแตนซ์จริงแล้ว

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | ไม่มีข้อค้นพบ | — | — | claude-opus |
