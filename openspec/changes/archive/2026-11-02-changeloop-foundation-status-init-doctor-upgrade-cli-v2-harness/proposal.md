# Change: เพิ่มคำสั่ง changeloop foundation (status, init, doctor, upgrade) บน CLI v2 ให้ผู้ใช้โปรเจกต์ที่ยังไม่มี harness ติดตั้ง ตรวจ และอัปเกรด Foundation ได้ตามที่ plugin และเอกสารสัญญาไว้ โดยไม่แก้ไฟล์ถ้าไม่ได้รับอนุมัติ

- **Change:** `changeloop-foundation-status-init-doctor-upgrade-cli-v2-harness` · **Lane:** standard (security triggers: external-integration-authentication)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-11-02

## เหตุผล

plugin Foundation บอกผู้ใช้โปรเจกต์ที่ยังไม่มี harness ให้รัน `changeloop foundation init --yes` แต่ binary v2 ไม่มีคำสั่ง `changeloop foundation` ผู้ใช้โปรเจกต์ใหม่จึงติดทางตัน และ `docs/CONFIGURATION.md` สัญญาคำสั่งสี่ตัวไว้แล้ว: `status --json`, `init --yes`, `doctor`, `upgrade --yes`

งานนี้ port คำสั่งจาก v1 (`packages/opencode/src/cli/cmd/foundation.ts` ที่ tag `changeloop-v1-final`) ไปบนเฟรมเวิร์กคำสั่งของ v2:

- logic ระดับโปรเจกต์ (อนุมัติก่อนเขียน, ติดตั้ง, ตรวจสถานะ, doctor, จัดการ error) อยู่ใน `packages/foundation` เป็นโมดูล `FoundationCommand` ที่รับ dependency ฉีดได้ ใช้ `FoundationRuntime` ที่ port แล้วโดยไม่เปลี่ยนความหมาย API ที่ plugin ใช้
- CLI ลงทะเบียน `foundation status|init|doctor|upgrade` ใน spec และ handler map; handler ใช้ไฟล์ runtime ที่ฝังใน binary (หรือ vendor ตอนรันจาก source) จึงไม่ต้องมี `claude-foundation` ใน PATH และไม่ดาวน์โหลดอะไร
- ไม่แก้ไฟล์ใดโดยไม่ได้รับอนุมัติ (`--yes` หรือยืนยันใน terminal จริง); target ที่เป็น symlink, ไม่ใช่ directory หรือแพลตฟอร์มที่ไม่รองรับถูกปฏิเสธก่อน invoke installer; ไฟล์นอก manifest ไม่ถูกลบ

## ขอบเขต

- **In scope (`foundation-cli-commands`):** รายงานเวอร์ชันและ release ที่ bundle กับสถานะที่ติดตั้ง (missing, installed, invalid) โดยไม่เขียนไฟล์ใด และ --json SHALL พิมพ์ JSON ออบเจ็กต์เดียวที่มี root, bundle (schema, release, commit, version, tagged, hostProtocols) และ installed ส่วน exit code SHALL เป็น 1 เมื่อสถานะ installed เป็น invalid และ 0 กรณีอื่น; ไม่เรียก installer และไม่เขียนไฟล์ในโปรเจกต์จนกว่าจะได้รับอนุมัติด้วย --yes หรือการยืนยันใน terminal จริง; เมื่อไม่ได้อนุมัติ SHALL จบด้วย exit code 1 พร้อมข้อความที่บอกให้ใช้ --yes; ติดตั้ง harness ของ Foundation ด้วย installer ที่ฝังใน binary ผ่าน init --host opencode แล้วรายงาน release ที่ติดตั้งและผล doctor โดยไม่ต้องมี claude-foundation ใน PATH และ SHALL ทำซ้ำได้โดยผลเหมือนเดิมโดยไม่เปลี่ยนไฟล์ที่ไม่ใช่ของ Foundation; ทำให้ไฟล์ที่ Foundation เป็นเจ้าของตรงกับ release ที่ bundle กับ binary นี้ และ SHALL ไม่ลบหรือแก้ไฟล์นอก manifest ของ Foundation รวมถึงไฟล์ของผู้ใช้ที่ชื่อชนกับ command ของ Foundation; รัน diagnostics ของ Foundation ที่ฝังใน binary กับโปรเจกต์โดยไม่เขียนไฟล์ในโปรเจกต์ พิมพ์ stdout และ stderr ของ diagnostics และจบด้วย exit code ของมัน; ปฏิเสธ target ที่ไม่ปลอดภัยด้วยข้อความ error และ exit code 1 ก่อนเรียก installer: path ที่ไม่มีอยู่หรือไม่ใช่ directory, โปรเจกต์ที่ path ซึ่ง Foundation จัดการ (เช่น .claude/commands หรือ .opencode/plugins) เป็น symlink หรือมี symlink อยู่ข้างใน, และแพลตฟอร์ม win32; ลงทะเบียน changeloop foundation พร้อม subcommand status, init, doctor และ upgrade ใน help และ handler map; ข้อความ help SHALL ใช้ชื่อ Changeloop และไม่มี OpenCode; ทุกคำสั่งรับ argument path ที่เป็น directory ของโปรเจกต์ โดย default คือ directory ปัจจุบัน
- **Out of scope:** edits outside `packages/foundation/src/foundation-command.ts`, `packages/foundation/src/index.ts`, `packages/foundation/test/foundation-command.test.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/src/index.ts`, `packages/cli/src/commands/handlers/foundation/status.ts`, … +5 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/cli, packages/foundation; declares integrations)
- **Affected surfaces:** code
- **Security triggers:** external-integration-authentication

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

เพิ่มคำสั่ง changeloop foundation (status, init, doctor, upgrade) ผู้ใช้โปรเจกต์ใหม่ติดตั้ง harness ได้ด้วย changeloop foundation init --yes โดยไม่ต้องติดตั้ง claude-foundation แยก

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| foundation-status-reports-versions | protocol.json เสีย | failure | T001, T002 | test: `packages/foundation/test/foundation-command.test.ts`, `packages/cli/test/foundation-command.test.ts` | — |
|  | โปรเจกต์ยังไม่มี harness | unclassified | T001, T002 |  |  |
|  | หลัง init | unclassified | T001, T002 |  |  |
|  | ข้อความอ่านง่าย | unclassified | T001, T002 |  |  |
| foundation-write-requires-approval | ไม่มี --yes และไม่ใช่ terminal | unclassified | T001, T002 | test, security-static: `packages/foundation/test/foundation-command.test.ts`, `packages/cli/test/foundation-command.test.ts` | — |
|  | ผู้ใช้ปฏิเสธการยืนยัน | unclassified | T001, T002 |  |  |
|  | upgrade ก็ต้องอนุมัติ | unclassified | T001, T002 |  |  |
| foundation-init-installs-bundled-harness | โปรเจกต์ใหม่ | success | T001, T002 | test, integration, security-static, resilience: `packages/foundation/test/foundation-command.test.ts`, `packages/cli/test/foundation-command.test.ts` | — |
|  | installer ล้ม | failure | T001, T002 |  |  |
|  | ไม่มี claude-foundation ใน PATH | unclassified | T001, T002 |  |  |
|  | รันซ้ำ | unclassified | T001, T002 |  |  |
|  | ระบุ path | unclassified | T001, T002 |  |  |
| foundation-upgrade-converges-managed-files | ซ่อมไฟล์ที่ถูกแก้ | success | T001 | test, integration, security-static, resilience: `packages/foundation/test/foundation-command.test.ts` | — |
|  | ไฟล์นอก manifest | failure | T001 |  |  |
|  | ไฟล์ชื่อชนที่ manifest ไม่ได้เป็นเจ้าของ | unclassified | T001 |  |  |
| foundation-doctor-reports-health | โปรเจกต์ที่ติดตั้งดี | unclassified | T001 | test: `packages/foundation/test/foundation-command.test.ts` | — |
|  | doctor ล้ม | unclassified | T001 |  |  |
|  | ก่อน init | unclassified | T001 |  |  |
| foundation-rejects-unsafe-target | path ไม่มีอยู่ | failure | T001, T002 | test, security-static: `packages/foundation/test/foundation-command.test.ts`, `packages/cli/test/foundation-command.test.ts` | — |
|  | path เป็นไฟล์ | unclassified | T001, T002 |  |  |
|  | managed path เป็น symlink | unclassified | T001, T002 |  |  |
|  | แพลตฟอร์ม win32 | unclassified | T001, T002 |  |  |
| foundation-commands-registered | help ของ foundation | unclassified | T002 | test: `packages/cli/test/foundation-command.test.ts` | — |
|  | root help | unclassified | T002 |  |  |
|  | path เริ่มต้น | unclassified | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (25).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| operability | covered | foundation-status-reports-versions, foundation-doctor-reports-health |  | status --json และ doctor ให้ผู้ใช้และสคริปต์ตรวจสถานะ release และสุขภาพของ harness ได้ด้วย exit code และ error ทุกชนิดแสดงสาเหตุบน stderr |
| data-migration | covered | foundation-upgrade-converges-managed-files |  | upgrade เรียก installer เดิมที่ converge ไฟล์ที่ Foundation เป็นเจ้าของไป release ที่ pin และไม่ลบไฟล์นอก manifest จึงไม่มีรูปแบบข้อมูลใหม่ของ Changeloop ต้องย้าย |
| rollout-rollback | covered | foundation-upgrade-converges-managed-files, foundation-commands-registered |  | rollback ของ Changeloop ทำโดยติดตั้ง binary รุ่นก่อนแล้วรัน upgrade --yes เพื่อ converge กลับ release ที่ bundle กับรุ่นนั้นตามเอกสาร คำสั่งใหม่ไม่มี feature flag เพราะไม่มีผลถ้าผู้ใช้ไม่เรียก |
| recoverability | covered | foundation-init-installs-bundled-harness, foundation-write-requires-approval |  | init และ upgrade เป็น idempotent จึงรันซ้ำหลังล้มได้ installer เป็นเจ้าของ backup และ rollback และคำสั่งไม่เขียนอะไรก่อนได้รับอนุมัติ |
| input-boundary | covered | foundation-rejects-unsafe-target |  | path จากผู้ใช้ถูก canonicalize ด้วย realpath ตรวจว่าเป็น directory และปฏิเสธ symlink ในทุก path ที่ Foundation จัดการ รวมถึง win32 ก่อนเรียก installer |

Harness derive จากเนื้อหา draft (2): integration-contract, timeout-retry-idempotency.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-confirm-message-upgrade: The init and upgrade handlers share one confirm prompt, and it always says "Initialize Foundation-managed workflow files in this project?". During `foundation upgrade` in a terminal, this wording is wrong. A fix is to pass the subcommand name into `dependencies()` so the prompt matches the action. Approval itself still works. (root/packages/cli/src/commands/handlers/foundation/shared.ts:10) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F2-release-not-compared-to-manifest: The scenario requires bundle.release to match the embedded manifest, but the test only checks the regex /^v?\d/. The code copies bundle.manifest.release directly (foundation-runtime.ts:58), so the behaviour is correct. Comparing against vendor/claude-foundation/manifest.json would make the test actually check the requirement. (root/packages/foundation/test/foundation-command.test.ts:25) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-doctor-before-init-weak-exit-assertion: The 'doctor before init' test only asserts `typeof exitCode === 'number'`. It does not check that the returned code is the diagnostics' own exit code. `runDoctor` returns `result.exitCode` unchanged, and the injected exit-7 test covers that passthrough, so this is only a test-strength gap. (root/packages/foundation/test/foundation-command.test.ts:284) | minor | แก้แล้วในรอบ 2 | claude-opus |
