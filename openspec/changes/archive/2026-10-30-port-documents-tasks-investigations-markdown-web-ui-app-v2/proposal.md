# Change: port Documents, Tasks, Investigations และ Markdown ปลอดภัยของ web UI ไป app v2

- **Change:** `port-documents-tasks-investigations-markdown-web-ui-app-v2` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

ตอนที่ 2 ของการ port Foundation web UI ไปบน app v2: เพิ่มหมวด Investigations, แท็บ Documents และ Tasks ของ change, Why/ข้อเท็จจริง/ทางลัดเอกสารใน Overview และตัวแสดง Markdown ที่ปลอดภัย โดยอ่านผ่าน endpoint `foundation.documents/document/investigations/investigation` ที่ server จริงของ v2 เปิดแล้ว ผู้ใช้จะอ่านโน้ตวิจัยและเอกสาร agreement ของ change ได้ในหน้า Changes เดียวกันโดยไม่ต้องเปิดไฟล์เอง และไม่ถือ checkbox หรือ claim ในเอกสารเป็นผล proof

## ขอบเขต

- **In scope (`foundation-webui-documents`):** เรียก foundation.documents/document/investigations/investigation สำหรับ location ที่เลือก ตรวจ response ด้วย schema Foundation.DocumentPage/Document และแปลง error ของ server เป็น code โดยไม่ส่งข้อมูลบางส่วน; เลือกเอกสารตาม id หรือ preferred, cache เนื้อหาตาม modifiedAt และ size, ทิ้ง response ของ selection เก่า, แยกความล้มเหลวของ index กับ body และ poll ทุก 10 วินาทีเฉพาะเมื่อมองเห็น; เลือกส่วนของโน้ตที่โฟกัส (anchor, Summary/Findings, หรือหัวข้อระดับ 2 แรก) รวมหัวข้อย่อย ไม่รวมหัวข้อพี่น้อง และเลือกเฉพาะส่วน Why สำหรับ Overview; ไม่แสดง raw HTML (escape), ละรูปภาพ, รับลิงก์ภายนอกเฉพาะ https และลิงก์ภายในเฉพาะเอกสารที่ index แล้วหรือ section ของเอกสาร และต้องกรองผลด้วย allowlist; มีหมวด Investigations คู่กับ Active/Archived แสดงโน้ตจาก index พร้อมค้นหา แบ่งหน้า และหน้าอ่านโน้ตที่มี section nav, Full source text, references ที่ตรงเป๊ะ และปุ่ม Continue investigation / Draft change ที่เปิด draft พร้อม reference ของโน้ต; มีแท็บ Documents และ Tasks และ Overview แสดง Why จาก proposal.md, ข้อเท็จจริงจาก snapshot และทางลัดไปเอกสาร โดย checkbox ของ tasks.md และ claims ของ evidence.yaml เป็นคำประกาศที่ไม่ใช่ proof และความล้มเหลวของเอกสารต้องไม่ทำให้ข้อมูล runtime หาย; ประกาศ marked และ dompurify เป็น dependency และ bun.lock SHALL ตรงกับ package.json
- **Out of scope:** edits outside `packages/app/package.json`, `bun.lock`, `packages/app/src/changes/document-reader.ts`, `packages/app/src/changes/document-reader.test.ts`, `packages/app/src/changes/document-refresh.ts`, `packages/app/src/changes/document-refresh.test.ts`, … +17 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้า Changes อ่านโน้ต Investigations และเอกสาร agreement, tasks และ claims ของ change ได้ โดยแสดง Markdown อย่างปลอดภัยและไม่ถือ checklist เป็นผล proof

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| document-reader | index ของ change | success | T002 | test: `packages/app/src/changes/document-reader.test.ts`, `packages/app/src/changes/document-refresh.test.ts`, `packages/app/src/changes/document-excerpt.test.ts`, `packages/app/src/changes/markdown.test.ts` | — |
|  | index ของโน้ต | success | T002 |  |  |
|  | เนื้อหาเอกสารและโน้ต | success | T002 |  |  |
|  | เอกสารใหญ่หรือเสีย | failure | T002 |  |  |
|  | body ผิด schema | failure | T002 |  |  |
| document-refresh | เลือก proposal | success | T002 | test: `packages/app/src/changes/document-reader.test.ts`, `packages/app/src/changes/document-refresh.test.ts`, `packages/app/src/changes/document-excerpt.test.ts`, `packages/app/src/changes/markdown.test.ts` | — |
|  | ใช้ cache | success | T002 |  |  |
|  | ทิ้ง response เก่า | success | T002 |  |  |
|  | ไม่พบเอกสาร | failure | T002 |  |  |
|  | body ล้มแต่ index ใช้ได้ | failure | T002 |  |  |
| document-excerpt | เปิดส่วน Findings | success | T002 | test: `packages/app/src/changes/document-reader.test.ts`, `packages/app/src/changes/document-refresh.test.ts`, `packages/app/src/changes/document-excerpt.test.ts`, `packages/app/src/changes/markdown.test.ts` | — |
|  | Why | success | T002 |  |  |
|  | โน้ตไม่มีหัวข้อ | success | T002 |  |  |
|  | anchor ไม่ถูกต้อง | failure | T002 |  |  |
| safe-markdown | ลิงก์ https | success | T002 | test: `packages/app/src/changes/document-reader.test.ts`, `packages/app/src/changes/document-refresh.test.ts`, `packages/app/src/changes/document-excerpt.test.ts`, `packages/app/src/changes/markdown.test.ts` | — |
|  | ลิงก์ไปเอกสารที่ index | success | T002 |  |  |
|  | anchor ของหัวข้อ | success | T002 |  |  |
|  | raw HTML | failure | T002 |  |  |
|  | ลิงก์อันตราย | failure | T002 |  |  |
|  | รูปภาพ | failure | T002 |  |  |
| investigations-library | รายการโน้ต | success | T003, T004 | test: `packages/app/src/changes/view-model.test.ts`, `packages/app/src/changes/draft.test.ts`, `packages/app/component-tests/changes-documents.spec.ts` | — |
|  | ไม่มี reference | success | T003, T004 |  |  |
|  | ตาม reference | success | T003, T004 |  |  |
|  | draft จากโน้ต | success | T003, T004 |  |  |
|  | ว่างแยกกรณี | failure | T003, T004 |  |  |
|  | นับหมวด | failure | T003, T004 |  |  |
| change-documents | ชื่อจาก proposal | success | T003, T004 | test: `packages/app/src/changes/view-model.test.ts`, `packages/app/src/changes/draft.test.ts`, `packages/app/component-tests/changes-documents.spec.ts` | — |
|  | tasks เป็น checklist | success | T003, T004 |  |  |
|  | claims ที่ประกาศ | success | T003, T004 |  |  |
|  | ทางลัดเอกสาร | success | T003, T004 |  |  |
|  | tasks ไม่รู้จัก | failure | T003, T004 |  |  |
|  | เอกสารอ่านไม่ได้ | failure | T003, T004 |  |  |
|  | ข้อมูลที่ไม่มี | failure | T003, T004 |  |  |
| markdown-dependencies | lockfile ตรง | success | T001 | test | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (34).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (13); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for document-reader, document-refresh, document-excerpt, safe-markdown, investigations-library, change-documents, markdown-dependencies.

## Appendix: Amendment history

- Revision 1 (2026-10-29): bun install --frozen-lockfile ล้มบนเครื่องนี้ก่อนถึง lockfile เพราะ patch ใน patches/ ไม่ตรงกับ package ที่ติดตั้ง (ปัญหามีอยู่เดิม) จึงตรวจ lockfile ด้วย --lockfile-only; ตัวแสดง Markdown ใช้ชื่อไฟล์ markdown-view เพราะ markdown.ts และ markdown.tsx ชนกันเมื่อ import; เพิ่ม spec ของ view ตอนที่ 1 ที่ต้องแก้ตามแท็บใหม่

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | overview-shortcut-double-setquery: The Overview's agreement-document shortcut calls props.onSection("documents") and then props.onSelect(id). In route.tsx:289/294 these are two consecutive @solidjs/router setSearchParams calls. setSearchParams merges with location.search read untracked. Navigation commits inside a transition, so the second call can merge against the stale query and drop section=documents. That would leave the Overview showing 'Proposal summary unavailable' with document=<id>. The story test only checks the button labels, not the click. A single setQuery({ section: "documents", document: id, anchor: undefined }) avoids the ordering hazard. (root/packages/app/src/changes/workspace.tsx:148) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | task-label-truncates-brackets: taskLabel uses text.split(" [")[0]. Any task whose text has ' [' before the harness metadata (e.g. 'Support [beta] flag [key:x]' or a Markdown link '[docs](...)') is cut short in the checklist summary. Stripping only the trailing `[key:…]`/`[kind:…]` metadata tokens (e.g. /(\s\[[a-z]+:[^\]]*\])+$/) would keep the declared text intact. (root/packages/app/src/changes/view-model.ts:52) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | counts-title-cleanup-outside-owner: loadCounts and loadTitle call onCleanup(() => abort.abort()) but also run from the onRefreshed/onRefresh click handlers (route.tsx:290-293, 380-384), where there is no reactive owner. In those calls the AbortController is never aborted, and Solid prints an ownerless-cleanup warning in dev. Stale results are still dropped by the run counters, so the impact is limited to wasted requests. (root/packages/app/src/changes/route.tsx:145) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | why-unavailable-text-untested: Scenario document-excerpt-purpose-why requires the text 'Why section unavailable.' when there is no Why heading. The excerpt test only checks found=false. The Overview renders changes.docs.overview.whyUnavailable ('Why section unavailable.') when found is false, but no story or component test asserts that this text appears. This is non-blocking because the code path exists. (root/packages/app/src/changes/workspace.tsx:406) | minor | ยังเปิดอยู่ | claude-opus |
