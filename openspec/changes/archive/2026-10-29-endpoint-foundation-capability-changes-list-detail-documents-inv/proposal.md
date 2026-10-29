# Change: ทำให้ endpoint Foundation (capability, changes list/detail, documents/investigations index/read) ตอบข้อมูลจริงจาก project ที่มี Foundation บน binary changeloop โดย port ตัวอ่าน snapshot และตัวอ่านเอกสารจาก v1 เป็น layer ตัวจริงของ Foundation.Service และ FoundationDocuments.Service และคง fallback unsupported เมื่อปิด Foundation

- **Change:** `endpoint-foundation-capability-changes-list-detail-documents-inv` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

หลังเฟส 3 binary `changeloop` มีคำสั่ง Foundation แล้ว แต่ endpoint `/experimental/foundation/*` ที่ web UI ใช้ยังตอบ `unsupported` เสมอ เพราะ `Foundation.Service` และ `FoundationDocuments.Service` มีแค่ fallback งานนี้ port ตัวอ่านสถานะและตัวอ่านเอกสารจริงจาก v1 มาเป็น layer ที่ server ใช้ โดยยังคง fallback ไว้สำหรับ server ที่ปิด Foundation (เช่น workerd) และไม่เพิ่ม `CommandPreparation` ตัวจริงเพราะ plugin ลงทะเบียนคำสั่งผ่าน `command.transform` อยู่แล้ว

## ขอบเขต

- **In scope (`foundation-services`):** รัน `claude-foundation dashboard snapshot --json` ใน project root ที่มี .claude/harness/protocol.json เท่านั้น และ SHALL คืน snapshot พร้อม mode กับ version ของ runtime หรือ error ที่ระบุ code ได้ (not_initialized, runtime_unavailable, unsupported, timeout, output_too_large, invalid_response) โดยไม่ init project และไม่ fallback ไป runtime อื่น; ทำดัชนีและอ่านเอกสารของ change (proposal.md, design.md, tasks.md, evidence.yaml, grounding.yaml, specs/**/*.md ทั้ง active และ archive) และ investigation (openspec/investigations/*.md) ผ่าน id แบบ opaque โดยปฏิเสธ symlink path ที่ออกนอก project และไฟล์เกิน 256 KiB และ SHALL ทำงานได้โดยไม่ต้อง init runtime; ใช้ layer ตัวจริงของ Foundation.Service และ FoundationDocuments.Service เป็นค่าเริ่มต้น เพื่อให้ endpoint capability, changes list/detail, documents และ investigations ตอบข้อมูลจริงจาก project และ error code ที่ถูกต้อง และ SHALL ใช้ fallback unsupported เมื่อ option foundation.enabled เป็น false รวมถึงโปรไฟล์ workerd
- **Out of scope:** edits outside `packages/foundation/src/foundation-webui.ts`, `packages/foundation/src/embedded-files.ts`, `packages/foundation/src/plugin.ts`, `packages/foundation/test/foundation-webui.test.ts`, `packages/core/src/foundation-document-reader.ts`, `packages/core/test/foundation-document-reader.test.ts`, … +5 more

## ผลกระทบและความเสี่ยง

- **Impact:** medium (derived: declared work type api)
- **Coupling:** coupled (derived: tasks span packages/core, packages/foundation, packages/server)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

web UI ของ changeloop อ่านสถานะ change และเอกสาร OpenSpec/investigation จริงจาก project ที่ init Foundation แล้ว แทนข้อความ unsupported

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| snapshot-reader | project ยังไม่ init | unclassified | T001 | test: `packages/foundation/test/foundation-webui.test.ts` | — |
|  | runtime path หาไม่พบ | unclassified | T001 |  |  |
|  | snapshot สำเร็จ | unclassified | T001 |  |  |
|  | schema ไม่รองรับ ผิดรูป หรือ exit ไม่ใช่ศูนย์ | unclassified | T001 |  |  |
|  | เกินขีดจำกัด | unclassified | T001 |  |  |
|  | อ่านซ้อน | unclassified | T001 |  |  |
|  | bundled จากไฟล์ที่ฝัง | unclassified | T001 |  |  |
| document-reader | investigation ก่อน init | unclassified | T002 | test: `packages/core/test/foundation-document-reader.test.ts` | — |
|  | เอกสารของ change | unclassified | T002 |  |  |
|  | archive | unclassified | T002 |  |  |
|  | ป้องกันการออกนอก project | unclassified | T002 |  |  |
|  | เอกสารใหญ่เกินและไม่พบ | unclassified | T002 |  |  |
|  | references | unclassified | T002 |  |  |
| server-foundation-endpoints | ข้อมูลจริง | unclassified | T003 | test: `packages/server/test/foundation.test.ts` | — |
|  | change ไม่มี | unclassified | T003 |  |  |
|  | ไม่ได้ init | unclassified | T003 |  |  |
|  | input ไม่ถูกต้อง | unclassified | T003 |  |  |
|  | runtime ค้าง | unclassified | T003 |  |  |
|  | runtime พิมพ์เกิน | unclassified | T003 |  |  |
|  | เอกสารผ่าน HTTP | unclassified | T003 |  |  |
|  | id เอกสารผิดรูปหรือไม่พบ | unclassified | T003 |  |  |
|  | ปิด Foundation | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (22).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for snapshot-reader, document-reader, server-foundation-endpoints.

## Appendix: Amendment history

- Revision 1 (2026-10-29): smoke ด้วย binary จริงพบว่า /experimental/foundation/* ไม่ถึง API: web-ui handler ของ cli ส่งเฉพาะ /api, /auth/, /openapi.json ไปที่ API ส่วน path อื่นไป web shell จึงตอบ 404 หรือ index.html ทั้งที่ openapi ประกาศ route นี้และ client ที่ generate ชี้ path นี้ ต้องส่ง /experimental/ ไปที่ API ด้วยเพื่อให้ endpoint ที่ port ใช้ได้บน binary

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-schema-version-gated-by-header: `Header` requires `foundationVersion: string` before `schemaVersion` is compared to 3 (line 129). A runtime that prints a non-3 schemaVersion but leaves out or renames `foundationVersion` (for example a future schema 4 envelope) is reported as `invalid_response`, not `unsupported`. Only the case where both fields are present is tested. Suggested fix: decode `schemaVersion` on its own first, reject anything other than 3 as unsupported, then require `foundationVersion`. (root/packages/foundation/src/foundation-webui.ts:28) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F2-sibling-failure-fails-whole-index: Both `notes()` and `documents()` call `metadata()` on every listed entry, and `index()` reads every investigation body to get its title (line 26). As a result, one symlinked `*.md`, one directory named `x.md`, one file that isn't valid UTF-8, or one file that changes mid-read makes the whole investigation index fail, and also makes `read` fail for every other investigation. The core test even asserts that the whole index rejects with `invalid_document`. The spec only names oversized files as non-fatal to the page. Still, rejecting siblings this way is broader than 'the document or its ancestor is a symlink'. Consider turning per-entry failures into index diagnostics instead. (root/packages/core/src/foundation-document-reader.ts:159) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-child-kill-not-asserted: The output-too-large and hang tests check the error code and the elapsed time, but nothing checks that the child process group (including the backgrounded `sleep 30`) is actually dead. On failure, `snapshot()` deliberately skips `await child.exited`. The 'child process is killed' outcome is only shown by the `process.kill(-pid)` code path. (root/packages/foundation/test/foundation-webui.test.ts:140) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-foundation-live-embedded-untested: No test reaches these `FoundationLive.layer` paths: passing the embedded file map to `FoundationWebui.read`, turning a broken embedded module into `runtime_unavailable`, or the server's default bundled mode. Every server test uses `runtime: "path"`. The bundled scenario is tested only through `FoundationWebui.read` with the vendored bundle. (root/packages/core/src/foundation-live.ts:24) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1-capability-code-not-asserted: The 'มี credential' scenario says the response is JSON with both `data.available` and `data.code` from the Foundation service. The test casts the body to `{ data: { available: boolean } }` and checks only `typeof body.data.available === "boolean"`. It never checks `data.code` or that the value comes from the Foundation service and not some other JSON 200. The behaviour is still shown because the content-type is JSON and the route is the protocol's capability route. Suggested fix: when `available` is false, also assert that `data.code` is a string, or point the server at a temp directory that has no `.claude/harness/protocol.json` and assert `code === "not_initialized"`. The second option also keeps the test from depending on whether the test's working directory happens to have Foundation set up. (root/packages/cli/test/web-ui.test.ts:121) | minor | ยังเปิดอยู่ | claude-opus |
