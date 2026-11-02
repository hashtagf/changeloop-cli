# Change: port service Foundation, FoundationDocuments, CommandPreparation และ endpoint ฝั่ง server จาก v1 ไปบน opencode v2

- **Change:** `port-service-foundation-foundationdocuments-commandpreparation-e` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

เฟส 2 ของการ port fork ไปบน opencode v2.2.x: ย้าย contract ของ service Foundation, FoundationDocuments และ CommandPreparation พร้อม schema, protocol, handler และ route ฝั่ง server จาก v1 มาไว้บน v2 เพื่อให้เฟสถัดไปต่อ FoundationRuntime และ web UI ได้โดยไม่ต้องแก้ contract อีก ในเฟสนี้ server แบบ standalone ตอบ `unsupported` สำหรับ Foundation และ passthrough สำหรับ command จนกว่าตัว implement จริงจะมา

## ขอบเขต

- **In scope (`foundation-server-contract`):** Validate selection และ change identifier ก่อนอ่าน; เปิด endpoint /experimental/foundation ตาม; เป็น passthrough บน standalone server; รวม group foundation ที่ตรงกับ protocol
- **Out of scope:** edits outside `packages/schema/src/foundation.ts`, `packages/schema/src/index.ts`, `packages/core/src/foundation.ts`, `packages/core/src/foundation-documents.ts`, `packages/core/src/command-preparation.ts`, `packages/core/test/foundation.test.ts`, … +13 more

## ผลกระทบและความเสี่ยง

- **Impact:** medium (derived: data work: tasks touch packages/schema/src/foundation.ts, packages/schema/src/index.ts; declared work type api)
- **Coupling:** coupled (derived: tasks span packages/client, packages/core, packages/protocol, packages/schema, packages/server)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

เพิ่ม API ทดลอง /experimental/foundation สำหรับอ่านสถานะ change และเอกสาร โดย server แบบ standalone ตอบ unsupported จนกว่าจะเชื่อม runtime

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| Validate selection และ change identifier ก่อนอ่าน | เรียก Foundation.selection ด้วย offset | unclassified | T001 | test: `packages/core/test/foundation.test.ts` | — |
|  | เรียก Foundation.identifier ด้วย id ที่มี path separator | unclassified | T001 |  |  |
|  | เรียก Foundation.project กับ envelope ที่ schemaVersion | unclassified | T001 |  |  |
|  | เรียก Foundation.project กับ envelope ที่มี change ซ้ำ, row | unclassified | T001 |  |  |
| เปิด endpoint /experimental/foundation ตาม | ตอบ 503 พร้อม error data code unsupported | failure | T002 | test: `packages/server/test/foundation.test.ts` | — |
|  | ตอบ 400 พร้อม error data code invalid_input โดยไม่เรียก | failure | T002 |  |  |
|  | GET /experimental/foundation/changes/:changeID ด้วย id | failure | T002 |  |  |
|  | GET /experimental/foundation/changes/x/documents บน | failure | T002 |  |  |
|  | ตอบ 200 โดย available เป็น false และ code เป็น unsupported | unclassified | T002 |  |  |
| เป็น passthrough บน standalone server | เรียก prepare ของ standalone CommandPreparation โดยไม่มี | failure | T002 | test: `packages/server/test/foundation.test.ts` | — |
|  | คืนรายการ command ที่ Command ค้นพบโดยไม่เพิ่มหรือตัดรายการ | unclassified | T002 |  |  |
|  | เรียก prepare ของ standalone CommandPreparation พร้อม | unclassified | T002 |  |  |
| รวม group foundation ที่ตรงกับ protocol | ไม่มีส่วนต่างหลังจาก generated output ถูก commit รวมกับ | unclassified | T003 | test: `packages/client/test/foundation.test.ts` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (13).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from scenarios that state a rejection or error (5); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for validate-selection-change-identifier, endpoint-experimental-foundation, passthrough-standalone-server, group-foundation-protocol.

## Appendix: Amendment history

- Revision 1 (2026-10-27): ชุดทดสอบเดิม packages/client/test/promise.test.ts ตรวจรายชื่อ group ของ client แบบ exact จึงต้องเพิ่ม foundation ตามที่ generated client เพิ่มขึ้น
- Revision 2 (2026-10-27): lane standard ต้องมีผลนับจำนวน test แต่ bun ไม่พิมพ์ summary ที่ harness อ่านได้ จึงให้ verify พิมพ์ footer แบบ Jest จากตัวเลข pass/fail จริงของ bun และคง exit code เดิม

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-capability-overstates-documents: When read() fails (always the case on a standalone server, where the foundationLayer in routes.ts:131-137 also makes FoundationDocuments.index/read fail with `unsupported`), the capability response still sets `investigations: true, documents: true`. Clients that use these flags to decide what to show would offer investigation and document views whose endpoints return 503 unsupported. The capability scenario itself passes (available=false, code=unsupported, runtime=null), so this is non-blocking. Consider reporting investigations/documents as false when the documents service is the unsupported stub. (root/packages/server/src/handlers/foundation.ts:35) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F2-prototype-key-lookup: `data.evidence[row.id]` and `data.budgets[row.id]` use plain property access on a decoded Record. identifier and the row filter (`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`) accept ids such as `constructor`, `toString`, `valueOf` and `hasOwnProperty`. For those ids the lookup returns the inherited Object.prototype function, not undefined. partition then fails to decode it, so project adds spurious 'Malformed evidence omitted' and 'Malformed budget omitted' diagnostics for a change that has no evidence or budget. Use an own-property check (Object.hasOwn) before indexing. (root/packages/core/src/foundation.ts:113) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-title-stripped: The `Row` decoder used by project has no `title` field, so excess-property stripping drops any title in the snapshot. Foundation.Change and the generated client types both declare an optional `title`, but project never fills it in. If the v1 snapshot carries titles, list and get will never return them. (root/packages/core/src/foundation.ts:30) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F4-generate-drift-unverified: The scenario requires no diff after running `bun run generate` in packages/client. The committed generated output looks consistent with the protocol: the group is mapped to `foundation` in protocol/src/client.ts:69, the endpoint order matches the group, and the declared statuses match the error classes. However, I couldn't run the generator in read-only mode, the types.ts diff was truncated in the packet, and no test checks for drift. Method presence (foundation.list/get/capability) is covered by packages/client/test/foundation.test.ts:4-10. (root/packages/client/src/promise/generated/types.ts) | minor | แก้แล้วในรอบ 2 | claude-opus |
