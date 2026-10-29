# Change: port หน้า Changes ของ Foundation web UI ไปบน app v2

- **Change:** `port-changes-foundation-web-ui-app-v2` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

เฟส 4 ของการ port fork ไปบน opencode v2.2.x ตอนที่ 1: ย้ายหน้า Changes ของ Foundation web UI จาก v1 มาไว้บน `packages/app` ของ v2 (shell, route, i18n และ Home projects แบบใหม่) เพื่อให้ผู้ใช้ดูรายการ change, รายละเอียด, สถานะ evidence และเปิด session ต่อจากหน้าเดียวได้ หน้านี้ต้องแสดงสถานะ unsupported / not_initialized / error อย่างถูกต้อง เพราะ server ของ v2 ยังตอบ Foundation เป็น unsupported จนกว่าทีม service จะต่อ runtime จริง

## ขอบเขต

- **In scope (`foundation-webui-changes`):** แสดง change ของ server และโปรเจกต์ที่เลือกจาก foundation.list แยก active กับ archived พร้อมค้นหา, pagination ครั้งละ 50 และ Snapshot generatedAt โดยไม่คำนวณ title หรือสถานะเอง; แยกแสดง unsupported, not_initialized, denied, timeout, invalid_response และ disconnected เป็นข้อความต่างกัน พร้อม Retry และห้ามถือความล้มเหลวเป็นรายการว่าง; มี Overview, Evidence และ Usage โดยแสดง recordedStatus, status ปัจจุบันและ freshness แยกกัน และแสดง usage ที่เป็น null ว่า Unavailable; Key ตาม server และ directory ทิ้ง response ของ selection เก่า poll ทุก 10 วินาทีเฉพาะเมื่อหน้ามองเห็น และหยุดเมื่อซ่อนหรือ dispose; เปิด draft ในโปรเจกต์ที่เลือกด้วยคำสั่งที่มีอยู่จริงโดยไม่ submit และไม่สั่ง lifecycle; ลงทะเบียน route /changes เป็น LayoutRoute changes ที่ไม่เป็น tab และ Home SHALL มีปุ่มทางเข้า Changes โดยหน้านี้ใช้ server/โปรเจกต์จาก Home selection
- **Out of scope:** edits outside `packages/app/src/changes/reader.ts`, `packages/app/src/changes/reader.test.ts`, `packages/app/src/changes/refresh.ts`, `packages/app/src/changes/refresh.test.ts`, `packages/app/src/changes/draft.ts`, `packages/app/src/changes/draft.test.ts`, … +11 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

app v2 มีหน้า Changes สำหรับดูรายการ change, evidence, usage ของโปรเจกต์ และเปิด draft ต่อใน session โดยแสดงสถานะ unsupported/not_initialized/error ให้ชัดเจน

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| changes-list | แสดงรายการ | success | T002 | test: `packages/app/src/changes/view.test.tsx` | — |
|  | archived เป็นประวัติ | success | T002 |  |  |
|  | pagination | success | T002 |  |  |
|  | ไม่มี evidence | failure | T002 |  |  |
|  | ว่างแยกตามเงื่อนไข | failure | T002 |  |  |
| failure-states | server ไม่รองรับ | failure | T001, T002 | test: `packages/app/src/changes/reader.test.ts`, `packages/app/src/changes/refresh.test.ts`, `packages/app/src/changes/draft.test.ts`, `packages/app/src/changes/view.test.tsx` | — |
|  | ยังไม่ init | failure | T001, T002 |  |  |
|  | ไม่มีสิทธิ์หรือ transport ล้ม | failure | T001, T002 |  |  |
|  | response ผิด schema | failure | T001, T002 |  |  |
|  | คงข้อมูลเดิม | failure | T001, T002 |  |  |
| change-detail | evidence แยกสามค่า | success | T002 | test: `packages/app/src/changes/view.test.tsx` | — |
|  | workflow track | success | T002 |  |  |
|  | เลื่อนแท็บด้วยคีย์บอร์ด | success | T002 |  |  |
|  | usage เป็น null | failure | T002 |  |  |
|  | ไม่มี budget | failure | T002 |  |  |
| selection-refresh | ทิ้ง response เก่า | success | T001 | test: `packages/app/src/changes/reader.test.ts`, `packages/app/src/changes/refresh.test.ts`, `packages/app/src/changes/draft.test.ts` | — |
|  | poll เมื่อมองเห็น | success | T001 |  |  |
|  | รวม request | success | T001 |  |  |
|  | ข้อมูลเดิมเมื่อล้ม | failure | T001 |  |  |
| session-draft-handoff | เลือกคำสั่งตาม phase | success | T001, T003 | test: `packages/app/src/changes/reader.test.ts`, `packages/app/src/changes/refresh.test.ts`, `packages/app/src/changes/draft.test.ts`, `packages/app/src/shell/state/layout.test.ts` | — |
|  | archived ใช้ /changes | success | T001, T003 |  |  |
|  | ไม่มีคำสั่ง | failure | T001, T003 |  |  |
|  | โหลด commands ไม่ได้ | failure | T001, T003 |  |  |
| route-and-entry | จำแนก route | success | T003 | test: `packages/app/src/shell/state/layout.test.ts` | — |
|  | typecheck ทั้ง app | success | T003 |  |  |
|  | ไม่มีโปรเจกต์ | failure | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (26).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (13); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for changes-list, failure-states, change-detail, selection-refresh, session-draft-handoff, route-and-entry.

## Appendix: Amendment history

- Revision 1 (2026-10-29): bun test ของ app render JSX ไม่ได้ (preload solid-jsx ของ ui ใช้กับ Bun 1.4.4 ไม่ได้: jsx runtime ไม่ถูก import) และ playwright component test ของ repo ต้องดาวน์โหลด browser เพิ่มบนเครื่องนี้ จึงแยก logic ที่ตัดสินใจของ view ไว้ใน view-model.ts ให้ bun พิสูจน์ได้ และเพิ่ม story กับ component spec ตามแบบ repo สำหรับ browser ส่วน home/route.tsx ต้องเพิ่มปุ่มทางเข้า Changes ที่ breakpoint กลาง

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f1: The list and detail requests share one Promise.all catch. A failed detail fetch (for example not_found for a stale `change` query param) fails the whole read, so the list is not shown. The failure is reported correctly, so this is not a correctness violation, but the detail failure could be isolated from the list. (root/packages/app/src/changes/reader.ts:38) | minor | ยังเปิดอยู่ | claude-opus |
