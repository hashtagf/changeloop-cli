# Change: ทำให้ binary changeloop ที่ build จาก packages/cli มี Foundation workflow ใช้ได้จริง: ลงทะเบียน plugin เป็น builtin ของ v2 และฝัง bundle ของ runtime เข้า binary โดยไม่อ่าน vendor จากดิสก์

- **Change:** `binary-changeloop-build-packages-cli-foundation-workflow-plugin` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

เฟส 3 ของการ port ไป opencode v2.2.x: plugin Foundation workflow มีอยู่แล้วแต่ยังไม่ถูกลงทะเบียน และ binary ยังไม่มี runtime ฝังอยู่ งานนี้ลงทะเบียนเป็น builtin ใน core และฝัง bundle runtime เข้า binary ที่ build จาก packages/cli เพื่อให้ `changeloop` มีคำสั่ง investigate/change/build/prove/land/changes/feature/dev ใช้ได้จริงโดยไม่อ่าน vendor จากดิสก์

## ขอบเขต

- **In scope (`foundation-builtin-wiring`):** ใช้ไฟล์ runtime ที่ฝังในบิลด์เมื่อมีโมดูล virtual:opencode-foundation-files และ SHALL ใช้ vendor บนดิสก์เมื่อไม่มี โดยไม่ล้มทั้ง plugin; ลงทะเบียน FoundationPlugin เป็น builtin ใน PluginInternal ก่อน ConfigCommandPlugin เพื่อให้คำสั่งที่ผู้ใช้ตั้งชื่อซ้ำทับ builtin ได้ และผู้ใช้ SHALL ปิดได้ด้วยการลบ id opencode.foundation; สร้างโมดูล virtual:opencode-foundation-files จากไฟล์ vendor ที่ตรวจ manifest และ checksum แล้ว และฝังไฟล์ทุกตัวเข้า binary ส่วน build ปกติ (--single --skip-web-ui) SHALL ยังสำเร็จ
- **Out of scope:** edits outside `packages/foundation/src/plugin.ts`, `packages/foundation/src/virtual.d.ts`, `packages/foundation/test/plugin.test.ts`, `packages/core/package.json`, `packages/core/src/plugin/internal.ts`, `packages/core/test/plugin/foundation-builtin.test.ts`, … +5 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/cli, packages/core, packages/foundation)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

binary changeloop มีคำสั่ง Foundation workflow (investigate, change, build, prove, land, changes, feature, dev) ในตัว โดยฝัง runtime ไว้ใน binary ปิดได้ด้วยการลบ plugin opencode.foundation

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| embedded-files-source | มีไฟล์ฝัง | unclassified | T001 | test: `packages/foundation/test/plugin.test.ts` | — |
|  | ไม่มีโมดูล | unclassified | T001 |  |  |
|  | ผู้เรียกกำหนด files เอง | unclassified | T001 |  |  |
| builtin-registration | ลงทะเบียน builtin | unclassified | T002 | test: `packages/core/test/plugin/foundation-builtin.test.ts` | — |
|  | ลำดับก่อน config command | unclassified | T002 |  |  |
|  | ผู้ใช้ปิด | unclassified | T002 |  |  |
| build-embeds-runtime | โมดูลที่สร้างอ่านได้ | unclassified | T003 | test: `packages/cli/script/foundation-files.test.ts` | — |
|  | vendor เสีย | unclassified | T003 |  |  |
|  | binary จริง | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (9).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for embedded-files-source, builtin-registration, build-embeds-runtime.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 4 | F1: isModuleNotFound only recognises ERR_MODULE_NOT_FOUND or the text 'Cannot find module/package' (Bun's shape). Registering FoundationPlugin in core also puts it into the Vite-based Node artifact (packages/cli/vite.node.config.ts, build:node), which has no resolver for virtual:opencode-foundation-files. If the import is left in the bundle, Node throws ERR_UNSUPPORTED_ESM_URL_SCHEME at runtime. That gets classified as a broken bundle, so every session's context hook would get the 'Foundation agent contract unavailable (foundation_bundle_invalid) … Stop here' text. The plugin is Bun-only anyway (Bun.spawn, import.meta.dir), so this is a non-blocking note about the effect on that artifact. (root/packages/foundation/src/plugin.ts:140) | minor | ยังเปิดอยู่ | claude-opus |
| 4 | F2: The 'embedded module's file map feeds the runtime' test only shows the map is read by making it fail: a manifest of '{}' yields foundation_bundle_invalid. No test shows that a valid embedded map is passed through unchanged as runtimeOptions.files and actually materializes the runtime. The foundation-files test covers the build side separately, and the real-binary smoke test is manual. (root/packages/foundation/test/plugin.test.ts:405) | minor | ยังเปิดอยู่ | claude-opus |
