# Change: ป้องกัน changeloop upgrade/update/uninstall และการแจ้งเตือนอัปเดตไม่ให้ติดตั้งหรือชี้ไป upstream OpenCode เมื่อ build นี้ยังไม่มี release channel ของ Changeloop (ค่าเดียว CHANGELOOP_UPDATE_URL) และเปลี่ยนคำสั่ง `opencode {subcommand}` ในคู่มือ skill ที่ส่งให้โมเดลเป็น `changeloop {subcommand}`

- **Change:** `changeloop-upgrade-update-uninstall-upstream-opencode-build-rele` · **Lane:** standard (security triggers: external-integration-authentication)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

Changeloop ยังไม่มี release channel ของตัวเอง แต่ `changeloop upgrade`, การเช็กอัปเดตตอนเปิดแอป และการแจ้งเตือนอัปเดตใน TUI ถามเซิร์ฟเวอร์ `opencode.ai/update/api/...` แล้วติดตั้งผ่าน npm/bun/brew/winget/`curl opencode.ai/v2/install` ผู้ใช้ที่กดอัปเกรดจึงได้ binary OpenCode ของ upstream ทับ Changeloop ที่ตัวเองใช้อยู่

ขอบเขต A: ทำให้ตัว updater มีค่าเดียวคือ base URL ของ release channel (build-time define `CHANGELOOP_UPDATE_URL`) ถ้าไม่ตั้งค่า ห้ามยิง network ห้าม spawn package manager ห้ามแจ้งเตือน และ `changeloop upgrade` จบด้วยข้อความ "ยังไม่มี release channel ของ Changeloop" พร้อมวิธี build จาก source และ exit code ไม่ใช่ 0 ส่วน `uninstall` ต้องไม่ลบ package ของคนอื่นเมื่อไม่มี channel

ขอบเขต B: คู่มือ skill ที่ส่งให้โมเดลสั่งให้รัน `opencode mcp add`, `opencode service restart`, `opencode api ...` ซึ่งไม่มีบนเครื่องผู้ใช้ (binary ชื่อ `changeloop`) เปลี่ยนเฉพาะคำสั่งให้รันเป็น `changeloop <subcommand>` คงบรรทัดตัวตนและ URL/ชื่อบริการเดิม

## ขอบเขต

- **In scope (`upgrade-safety-and-model-commands`):** NOT ส่ง network request ใดและ SHALL NOT spawn คำสั่ง package manager หรือ installer ไม่ว่าจากการตรวจตอนเปิดแอป การแจ้งเตือนใน TUI การ apply หรือ upgrade; จบด้วยข้อความ 'ยังไม่มี release channel ของ Changeloop' (ภาษาอังกฤษเดียวกับ UI: Changeloop has no release channel yet) พร้อมวิธีอัปเดตด้วยการ build จาก source และ SHALL ออกด้วย exit code ที่ไม่ใช่ 0; ใช้ `changeloop {subcommand}` ในทุกคำสั่งที่ให้โมเดลรัน และ SHALL NOT มี `opencode <subcommand>` นอก allowlist (บรรทัดตัวตน, URL, ชื่อบริการ, path config/log, env)
- **Out of scope:** edits outside `packages/cli/src/services/updater.ts`, `packages/cli/src/version.ts`, `packages/cli/script/build.ts`, `packages/cli/test/updater-no-channel.test.ts`, `packages/cli/test/updater-install.test.ts`, `packages/cli/src/commands/handlers/upgrade.ts`, … +5 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/cli, packages/core; declares integrations)
- **Affected surfaces:** code
- **Security triggers:** external-integration-authentication

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

changeloop upgrade และการแจ้งเตือนอัปเดตจะไม่ติดตั้ง OpenCode ของ upstream ทับอีก จนกว่าจะมี release channel ของ Changeloop: upgrade แจ้งว่ายังไม่มี channel พร้อมวิธี build จาก source และ skill ที่สอนโมเดลสั่งคำสั่ง changeloop แทน opencode

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| no-channel-no-upstream | ใส่ channel ภายหลัง | success | T001 | test, integration, security-static, resilience: `packages/cli/test/updater-no-channel.test.ts`, `packages/cli/test/updater-install.test.ts` | — |
|  | ตรวจตอนเปิดแอป | failure | T001 |  |  |
|  | apply/latest/upgrade | unclassified | T001 |  |  |
|  | ตรวจวิธีติดตั้ง | unclassified | T001 |  |  |
| upgrade-command-explains | ไม่ระบุ method | unclassified | T002 | test: `packages/cli/test/fixture/upgrade.ts`, `packages/cli/test/upgrade.test.ts` | — |
|  | ระบุ method และ target | unclassified | T002 |  |  |
|  | binary จริง | unclassified | T002 |  |  |
| model-facing-commands | คำสั่งใน skill | unclassified | T003 | test: `packages/core/test/model-facing-commands.test.ts` | — |
|  | บรรทัดตัวตนคงเดิม | unclassified | T003 |  |  |
|  | path และ env คงเดิม | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (10).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| operability | covered | no-channel-no-upstream, upgrade-command-explains |  | ผู้ใช้เห็นข้อความชัดเจนจาก upgrade และ update-check บันทึก log update check skipped reason no-release-channel |
| recoverability | covered | upgrade-command-explains |  | ข้อความ upgrade บอกวิธี build จาก source ตาม Delivery และใส่ channel ภายหลังด้วยค่าเดียวโดยไม่ต้องย้ายข้อมูล |

Harness derive จากเนื้อหา draft (2): integration-contract, timeout-retry-idempotency.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-binary-scenario-no-test: Scenario 'binary จริง' (run `changeloop upgrade` from a built binary, with HOME set to a temp dir and a proxy pointing at a dead port) is assigned to T002/upgrade.test.ts. That test runs test/fixture/upgrade.ts with a stubbed Updater.Service (released toggled by UPGRADE_TEST_NO_CHANNEL), so it never checks the build define (`CHANGELOOP_UPDATE_URL: "undefined"` in script/build.ts:204) or the version.ts normalization in a compiled binary. The code path looks correct when read (define → `typeof undefined === 'string'` is false → layer gets no channel → handler fails with noChannelError), but no automated test exercises it. (root/packages/cli/test/upgrade.test.ts:77) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F2-released-empty-string-inconsistency: `released: updateUrl !== undefined` disagrees with the `!updateUrl` gates when layerWith('') is called: released is true, but method() returns undefined and latest/upgrade/apply fail with noChannelError. With layerWith(''), the upgrade handler would print 'Could not detect the installation method' (or, with --method, the no-channel error after logging 'Using method'). A whitespace-only URL passed to layerWith is also not trimmed. Production is unaffected because version.ts trims the value and turns blank into undefined. Suggested fix: normalize inside layerWith/make (trim; empty → undefined) or use `released: Boolean(updateUrl)`. (root/packages/cli/src/services/updater.ts:655) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | F3-formatting: Formatting: `const decodeVpPackages =Schema.decodeUnknownOption(` is missing a space, and `const make = (updateUrl) => Effect.gen(function* () {` at line 158 is not wrapped the way the repository's formatter would wrap it. Cosmetic only. (root/packages/cli/src/services/updater.ts:61) | minor | ยังเปิดอยู่ | claude-opus |
