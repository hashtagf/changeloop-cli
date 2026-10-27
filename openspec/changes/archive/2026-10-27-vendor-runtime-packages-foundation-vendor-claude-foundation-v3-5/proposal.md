# Change: อัปเดต vendor runtime ใน packages/foundation/vendor/claude-foundation จาก v3.5.14 เป็น v3.6.8 (runtime API 42) ให้ตรงกับ harness ของโปรเจกต์

- **Change:** `vendor-runtime-packages-foundation-vendor-claude-foundation-v3-5` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

เฟส 3 ของการ port บน opencode v2: vendor runtime ใน `packages/foundation/vendor/claude-foundation` ยังเป็น v3.5.14 ขณะที่ harness ของโปรเจกต์เป็น 3.6.8 (runtime API 42) จึงอัปเดต vendor และ manifest เป็น v3.6.8 จาก checkout ในเครื่องที่ tag แล้ว

## ขอบเขต

- **In scope (`foundation-vendor-runtime`):** ระบุ release v3.6.8 ที่ tag แล้วพร้อม commit ต้นทางและ payload protocol runtimeApi 42; ยืนยันว่าทุกไฟล์ใน payload ตรง checksum ใน manifest และ install-opencode.sh ของ 3.6.8 อยู่ใน bundle
- **Out of scope:** edits outside `packages/foundation/vendor`, `packages/foundation/test/foundation-bundle.test.ts`

## Work type

chore

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| vendor-release-pin | manifest ตรงรุ่น | unclassified | T001 | static-analysis: `packages/foundation/test/foundation-bundle.test.ts` | — |
|  | protocol ของ payload | unclassified | T001 |  |  |
| vendor-integrity | vendor ผ่านการตรวจ | unclassified | T001 | static-analysis: `packages/foundation/test/foundation-bundle.test.ts` | — |
|  | payload ถูกแก้ | unclassified | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Appendix: Amendment history

- Revision 1 (2026-10-27): ทีม D ติด scan-depth-limit (maxDepth 12) เพราะ vendor รวม harness tests/fixtures ที่ลึกถึง 13 ระดับ upstream install.sh ประกาศ .claude/harness/tests และ .claude/harness/fixtures เป็น UNSHIPPED (ไม่คัดลอก ไม่ลงใน manifest) และ runtime ไม่อ้างถึงสองไดเรกทอรีนี้ จึงให้ sync กรองออกอย่างชัดเจนตามแบบ upstream

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | redundant-checksum-test: The new test 'every shipped payload file matches its manifest checksum on disk' mostly repeats work createEmbeddedFoundationBundle already does (foundation-bundle.ts:26-32), which the shipped-vendor tests at lines 22 and 35 already call. It also checks only one direction: files listed in the manifest. An unlisted extra file in the payload would not fail it. The bundle function's file-set check does catch that, so nothing is left uncovered. Non-blocking. (root/packages/foundation/test/foundation-bundle.test.ts:51) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | sync-filter-untested: The claim vendor-excludes-harness-tests-sync-foundation-ts lists 'test' as its capability, but no test runs the unshipped filter in sync-foundation.ts or its skipped-count message. The tests only check the output that was already synced (the manifest and payload on disk). Suppose the filter regressed, for example by dropping a root or matching '.claude/harness/tests-extra' by prefix. The committed vendor would still pass until the next sync. The code matches install.sh's is_unshipped exactly, so this does not block. (root/packages/foundation/script/sync-foundation.ts:58) | minor | ยังเปิดอยู่ | claude-opus |
