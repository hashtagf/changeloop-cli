# Change: port wordmark Changeloop และปรับ nav กับตัวอ่านโน้ตของ web UI บน v2

- **Change:** `port-wordmark-changeloop-nav-web-ui-v2` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

ตอนที่ 3 (สุดท้าย) ของการ port Foundation web UI ไปบน app v2: เปลี่ยนโลโก้หน้าเริ่ม session เป็น pixel wordmark Changeloop ตาม prototype ที่ผู้ใช้อนุมัติ, ให้เข้า Changes ได้จากจอแคบ, ทำให้ลิงก์ที่ใช้ `?change=` ไม่ระบุ scope เปิด change ได้ถูกหมวด, แก้ช่องว่างของตัวอ่านโน้ต (ลิงก์ section ใน excerpt, deep link ข้ามหน้า index, fragment ของลิงก์ระหว่างเอกสาร) และเพิ่มการตรวจ geometry ของ prototype ที่ v1 พลาดไปครั้งก่อน

## ขอบเขต

- **In scope (`foundation-webui-brand`):** แสดง wordmark Changeloop แบบ SVG ที่สร้างจากตาราง glyph ของ CLI/TUI ที่มีชื่อ accessible Changeloop สัดส่วน 310:25 กว้างไม่เกิน 720px และห่าง composer 32px โดยไม่เปลี่ยนพฤติกรรมของ composer; ถือ scope เป็น archive เมื่อ change ใน address ไม่มี scope และ status เป็น archived และเป็น active เมื่อเป็นอย่างอื่น แล้วเขียน scope ลง address แบบ replace; แสดงปุ่ม Changes เดี่ยวที่นำไป /changes โดยไม่มีปุ่ม Settings หรือ Help เพิ่ม; ตามลิงก์ #slug ไปส่วนอื่นของโน้ตด้วยการเปลี่ยน excerpt, เปิดเอกสารหรือโน้ตที่ id ไม่อยู่ใน index หน้าปัจจุบันด้วยการอ่านตรงด้วย id และคง fragment ของลิงก์ไปเอกสารอื่นเพื่อเปิดที่หัวข้อนั้น; รักษา hierarchy และ geometry ของ prototype ที่อนุมัติ: คอลัมน์เนื้อหากว้างไม่เกิน 720px, ช่องค้นหาสูง 36px, หัวข้อ Changes ขนาด 20px, หมวดและแท็บเป็นปุ่มขีดเส้นใต้ และหน้ารายละเอียดไม่มีตัวควบคุมของรายการ
- **Out of scope:** edits outside `packages/app/src/new-session/brand.ts`, `packages/app/src/new-session/brand.test.ts`, `packages/app/src/new-session/brand.tsx`, `packages/app/src/new-session/brand.stories.tsx`, `packages/app/src/new-session/view.tsx`, `packages/app/component-tests/new-session-brand.spec.ts`, … +16 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้าเริ่ม session แสดงโลโก้ Changeloop, เข้า Changes ได้จากจอแคบ, ลิงก์ change เปิดถูกหมวดโดยอัตโนมัติ และตัวอ่านโน้ตตามลิงก์ภายในเอกสารได้ครบขึ้น

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| session-brand | ตาราง glyph | success | T001 | test: `packages/app/src/new-session/brand.test.ts`, `packages/app/component-tests/new-session-brand.spec.ts` | — |
|  | น้ำหนัก CHANGE และ LOOP | success | T001 |  |  |
|  | ช่องคั่นระหว่างสองคำ | success | T001 |  |  |
|  | ชื่อและสัดส่วนบนหน้า | success | T001 |  |  |
|  | จอแคบ | success | T001 |  |  |
| scopeless-change-link | archived | success | T003 | test: `packages/app/src/changes/view-model.test.ts` | — |
|  | ยังไม่ทราบ status | success | T003 |  |  |
|  | ไม่มี change | success | T003 |  |  |
|  | scope ชัดเจนชนะ | success | T003 |  |  |
| narrow-entry | ปุ่มบนจอแคบ | success | T003 | test: `packages/app/src/changes/view-model.test.ts` | — |
|  | กลุ่ม utility เต็ม | success | T003 |  |  |
| note-links | slug ไปส่วนอื่นของโน้ต | success | T002 | test: `packages/app/src/changes/markdown.test.ts`, `packages/app/src/changes/document-refresh.test.ts`, `packages/app/component-tests/changes-documents.spec.ts` | — |
|  | id นอกหน้า index | success | T002 |  |  |
|  | fragment ของเอกสาร | success | T002 |  |  |
|  | slug ที่ไม่มี | failure | T002 |  |  |
|  | id ที่ไม่มีจริง | failure | T002 |  |  |
| prototype-geometry | ส่วนหัวของรายการ | success | T004 | test: `packages/app/component-tests/changes-fidelity.spec.ts` | — |
|  | รายละเอียดไม่มีตัวควบคุมรายการ | success | T004 |  |  |
|  | ความกว้างเนื้อหา | success | T004 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (19).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (2); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for session-brand, scopeless-change-link, narrow-entry, note-links, prototype-geometry.

## Appendix: Amendment history

- Revision 1 (2026-10-30): brand.ts กับ brand.tsx ชนกันเมื่อ import จึงใช้ชื่อไฟล์ component เป็น brand-view.tsx; ชื่อ accessible ของ wordmark ต้องเป็น key i18n (brand.name) ใน en.ts ตามกฎ Localization ของ app; spec ของ fidelity ต้องอ้างถึงชื่อไฟล์ใหม่

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-same-doc-fragment: `navigate` stores `pending` in a plain variable, and the effect only re-runs when `body()` changes. A link such as `proposal.md#why` clicked while `proposal.md` is already open never scrolls to the heading. `pending` also stays set, so a later body refresh could trigger a stale scroll. Resolve the fragment immediately when the target id equals the current body id, and clear `pending` in that case. (root/packages/app/src/changes/workspace.tsx:109) | minor | ยังเปิดอยู่ | claude-opus |
