# Change: ทำให้ v2 อ่านชื่อและโฟลเดอร์ของ Changeloop ตามที่ docs/CONFIGURATION.md สัญญา: Global เลือก dir changeloop ถ้ามี ไม่งั้นใช้ opencode เดิม, ตัวแปร CHANGELOOP_* ใช้แทน OPENCODE_*, ไฟล์ changeloop.json(c) และโฟลเดอร์ .changeloop/ ชนะ opencode ในระดับเดียวกัน, plan mode แก้ไฟล์ใน ~/.changeloop/plan ได้, และ debug paths แสดงตำแหน่งจริง โดยผู้ใช้ที่มี dir opencode เดิมต้องไม่เสียข้อมูล

- **Change:** `v2-changeloop-docs-configuration-md-global-dir-changeloop-openco` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-02

## เหตุผล

v2 ยังรู้จักแค่ชื่อ `opencode` ผู้ใช้ Changeloop v1 ที่เขียน `changeloop.json`, `.changeloop/`, `~/.config/changeloop/` หรือ `CHANGELOOP_*` จึงไม่มีผลบน v2 ทั้งที่ `docs/CONFIGURATION.md` สัญญาไว้ งานนี้ port พฤติกรรมเดิมของ v1 โดยไม่เปลี่ยนที่เก็บข้อมูลของผู้ใช้เดิม

1. **Global identity**: `Global` ใช้ `BASE/changeloop` ถ้ามี ไม่งั้น `BASE/opencode` ถ้ามี ไม่งั้นสร้าง `changeloop` ตัดสินแยกกันต่อ base (data/cache/config/state) ผู้ใช้เดิมที่มี `~/.local/share/opencode` ยังคงเห็น session เดิม; `CHANGELOOP_TEST_HOME` มาก่อน `OPENCODE_TEST_HOME`
2. **Env alias**: ตัวแปร `CHANGELOOP_*` ใช้แทน `OPENCODE_*` ได้ทุกตัว ถ้าตั้งทั้งคู่ฝั่ง changeloop ชนะ ทำที่จุดเดียวก่อนโค้ดใดอ่าน env
3. **ชื่อไฟล์ config**: global/โปรเจกต์อ่าน `changeloop.json(c)` ต่อจาก `opencode.json(c)` ลำดับ `opencode.json → opencode.jsonc → changeloop.json → changeloop.jsonc` (หลังชนะ) และ `Config.update` เขียนกลับไฟล์ที่ชนะ หรือ `changeloop.jsonc` เมื่อยังไม่มีไฟล์ใด
4. **โฟลเดอร์โปรเจกต์ `.changeloop/`**: ทำหน้าที่เหมือน `.opencode/` ทุกอย่าง (config, commands, plugins, skills) merge หลัง `.opencode` ในระดับเดียวกัน
5. **Plan mode**: agent plan แก้ไฟล์ใน `~/.changeloop/plan` ได้คู่กับ `~/.opencode/plan`
6. **`debug paths`** แสดงตำแหน่งตามข้อ 1 โดยอัตโนมัติ พิสูจน์ด้วย test ของ CLI

## ขอบเขต

- **In scope (`v1-user-compatibility`):** เลือกโฟลเดอร์ data, cache, config และ state ทีละ base ตามลำดับ BASE/changeloop ถ้ามี, ไม่งั้น BASE/opencode ถ้ามี, ไม่งั้น BASE/changeloop และ SHALL ไม่ย้ายหรือลบ dir ที่มีอยู่ และ home SHALL อ่าน CHANGELOOP_TEST_HOME ก่อน OPENCODE_TEST_HOME; ทำให้ทุกตัวแปรที่ขึ้นต้นด้วย CHANGELOOP_ ที่ตั้งไว้เป็นค่าของตัวแปรชื่อเดียวกันที่ขึ้นต้นด้วย OPENCODE_ และเมื่อตั้งทั้งคู่ฝั่ง CHANGELOOP_ SHALL ชนะ ส่วนตัวแปรที่ไม่มีคู่ changeloop SHALL ไม่เปลี่ยน; โหลดไฟล์ในแต่ละโฟลเดอร์ (global, ระดับโปรเจกต์ที่เดินขึ้น, และ dir .opencode/.changeloop) ตามลำดับ opencode.json, opencode.jsonc, changeloop.json, changeloop.jsonc โดยไฟล์หลังชนะ และ Config.update SHALL เขียนกลับไฟล์ที่มีอยู่ที่ชนะ หรือสร้าง changeloop.jsonc เมื่อไม่มีไฟล์ใด ผู้ใช้ที่มีแค่ opencode.json SHALL เห็นพฤติกรรมเดิมทุกอย่าง; ปฏิบัติต่อโฟลเดอร์ .changeloop เหมือน .opencode ในทุกระดับที่เดินขึ้น (config ภายในและ Directory entry ที่ใช้หา commands, plugins, skills) โดย .opencode โหลดก่อน .changeloop ในระดับเดียวกัน และ SHALL ไม่นับ .changeloop เป็นไฟล์ direct; ได้สิทธิ์ edit ภายใน ~/.changeloop/plan คู่กับ ~/.opencode/plan และ SHALL ปฏิเสธ edit ที่อื่นเหมือนเดิม
- **Out of scope:** edits outside `packages/util/src/env-alias.ts`, `packages/util/src/global.ts`, `packages/util/test/env-alias.test.ts`, `packages/util/test/global.test.ts`, `packages/core/src/config/discovery.ts`, `packages/core/src/config.ts`, … +6 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/cli, packages/core, packages/util)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

changeloop.json, .changeloop/ และ CHANGELOOP_* ใช้ได้บน v2 ตามเอกสาร เครื่องที่มีข้อมูลใน opencode อยู่แล้วคง dir เดิม เครื่องใหม่ใช้ dir changeloop

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| global-app-path-fallback | ติดตั้งใหม่ | unclassified | T001, T004 | test: `packages/util/test/env-alias.test.ts`, `packages/util/test/global.test.ts`, `packages/cli/test/debug-paths.test.ts` | — |
|  | ผู้ใช้ opencode เดิม | unclassified | T001, T004 |  |  |
|  | มีทั้งสอง | unclassified | T001, T004 |  |  |
|  | ตัดสินแยกต่อ base | unclassified | T001, T004 |  |  |
|  | ลำดับ test home | unclassified | T001, T004 |  |  |
|  | เห็นผ่าน debug paths จริง | unclassified | T001, T004 |  |  |
| env-changeloop-alias | alias ชนะ | unclassified | T001, T004 | test: `packages/util/test/env-alias.test.ts`, `packages/util/test/global.test.ts`, `packages/cli/test/debug-paths.test.ts` | — |
|  | fallback | unclassified | T001, T004 |  |  |
|  | ตัวแปรอื่นไม่ถูกแตะ | unclassified | T001, T004 |  |  |
| config-file-names | global changeloop ชนะ opencode | unclassified | T002 | test: `packages/core/test/config/config.test.ts`, `packages/core/test/config/changeloop-names.test.ts` | — |
|  | jsonc ชนะ json | unclassified | T002 |  |  |
|  | โปรเจกต์ | unclassified | T002 |  |  |
|  | เฉพาะ opencode เหมือนเดิม | unclassified | T002 |  |  |
|  | update เลือกไฟล์ที่ชนะ | unclassified | T002 |  |  |
|  | update seed | unclassified | T002 |  |  |
|  | ไฟล์เสีย | unclassified | T002 |  |  |
| project-changeloop-directory | ลำดับ directory | unclassified | T002 | test: `packages/core/test/config/config.test.ts`, `packages/core/test/config/changeloop-names.test.ts` | — |
|  | เฉพาะ .changeloop | unclassified | T002 |  |  |
|  | ซ้อนหลายระดับ | unclassified | T002 |  |  |
|  | command ใน .changeloop ใช้ได้จริง | unclassified | T002 |  |  |
| plan-changeloop-directory | ที่อื่นถูกปฏิเสธ | failure | T003 | test: `packages/core/test/plugin/plan.test.ts` | — |
|  | อนุญาต changeloop plan | unclassified | T003 |  |  |
|  | opencode plan เดิมยังได้ | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (23).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for global-app-path-fallback, env-changeloop-alias, config-file-names, project-changeloop-directory, plan-changeloop-directory.

## Appendix: Amendment history

- Revision 1 (2026-11-02): ชุด test ของ cli เดิม (service.test.ts) กำหนดตำแหน่ง state/config/tmp ของติดตั้งใหม่เป็นโฟลเดอร์ opencode แต่ข้อกำหนดนี้ทำให้ติดตั้งใหม่ใช้ changeloop จึงต้องแก้ expectation ของ 13 test ให้ตรง และรวมไฟล์นี้ใน verify ของ task
- Revision 2 (2026-11-02): test preload.test.ts ของ core (ที่รันผ่าน wrapper ที่ตั้ง home/XDG ชั่วคราว) กำหนดตำแหน่ง Global ของติดตั้งใหม่เป็น opencode แต่ข้อกำหนดนี้ทำให้ติดตั้งใหม่ใช้ changeloop จึงต้องแก้ expectation และรวมไว้ใน verify ของ T002 ผ่าน wrapper เพราะ test นี้ต้องการ env ที่ wrapper ตั้ง
- Revision 3 (2026-11-02): verify ที่ผ่าน wrapper ตั้ง home ชั่วคราวของ core ทำให้ test ที่เปิด session จริง (รวม command-subagent ของเดิม) ล้มตอนล้าง tmp ด้วย EACCES ทั้งที่ test ผ่าน เป็นพฤติกรรมเดิมของ wrapper จึงรัน preload.test.ts ผ่าน wrapper ตามลำพัง (ต้องมี env ของ wrapper) และรันที่เหลือด้วย bun test ตรงๆ

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-invalid-config-diagnostic-unasserted: The 'an invalid changeloop.json is skipped while opencode.json still loads' test only asserts that shell is still 'opencode'. The scenario also requires a diagnostic for changeloop.json, and the test does not check for one. The behaviour probably comes from existing diagnostic handling, but this change adds no assertion for the new file name. (root/packages/core/test/config/changeloop-names.test.ts) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | f-tmp-not-fallback: Global tmp always uses the changeloop name (preferredRoots.tmp) with no legacy fallback, so service.test.ts expectations moved from tmp/opencode to tmp/changeloop. The spec only lists data, cache, config and state, and tmp is not durable, so this is acceptable. It is a small behaviour change that the spec does not mention. (root/packages/util/src/global.ts:37) | minor | ยังเปิดอยู่ | claude-opus |
