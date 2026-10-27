# Change: CLI บน opencode v2 build ออกมาเป็น changeloop

- **Change:** `cli-opencode-v2-build-changeloop` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

เฟสแรกของการ port fork ไปบน opencode v2.2.x: ทำให้ CLI ที่ build จาก v2 ใช้ชื่อ changeloop เพื่อให้มีฐานที่ build และรันได้ก่อนย้าย Foundation plugin และ web UI ตามมาในเฟสถัดไป ผู้ใช้จะเห็นผลเมื่อเฟสต่อๆ ไปสลับมาใช้ v2

## ขอบเขต

- **In scope (`cli-identity`):** สร้าง executable ชื่อ changeloop สำหรับ target; แสดงชื่อ changeloop ในข้อความ help และ usage
- **Out of scope:** edits outside `packages/cli/script/build.ts`, `packages/cli/test/changeloop-identity.test.ts`

## Work type

feature

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| สร้าง executable ชื่อ changeloop สำหรับ target | รัน bun run build --single --skip-web-ui ใน packages/cli บน | unclassified | T001 | test: `packages/cli/test/changeloop-identity.test.ts` | — |
| แสดงชื่อ changeloop ในข้อความ help และ usage | บรรทัด usage ขึ้นต้นด้วยชื่อ changeloop | unclassified | T001 | test: `packages/cli/test/changeloop-identity.test.ts` | — |
|  | พิมพ์หมายเลข version ที่ไม่ว่างและ exit code เป็น 0 | unclassified | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (3).
- Changed tests fail on the original code.
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Appendix: Amendment history

- Revision 1 (2026-10-27): bunfig forbids running tests from the repository root
