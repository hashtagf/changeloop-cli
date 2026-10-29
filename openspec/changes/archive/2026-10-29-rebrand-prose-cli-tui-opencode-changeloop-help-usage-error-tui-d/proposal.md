# Change: rebrand ข้อความ prose ที่ผู้ใช้เห็นของ CLI และ TUI จาก OpenCode เป็น Changeloop (help, usage, ข้อความอัปเกรด/ถอนการติดตั้ง/error, คำสั่งแนะนำ, TUI dialog/title, wordmark) โดยไม่แตะ identifier ที่เป็นสัญญา

- **Change:** `rebrand-prose-cli-tui-opencode-changeloop-help-usage-error-tui-d` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

เฟส 4 ของการ port ไป opencode v2.2.x: เฟส 1 เปลี่ยนแค่ชื่อ binary และชื่อใน usage ทำให้ `changeloop --help` และข้อความในโปรแกรมยังเรียกตัวเองว่า OpenCode และแนะนำให้พิมพ์คำสั่ง `opencode ...` ที่ไม่มีอยู่ งานนี้เปลี่ยนเฉพาะข้อความ prose ที่ผู้ใช้เห็นใน packages/cli และ packages/tui เป็น Changeloop (รวม wordmark แบบ pixel จาก v1) โดยคง identifier ที่เป็นสัญญา (package `@opencode/*`, plugin id `opencode.*`, env `OPENCODE_*`, config/dir เดิม, URL/endpoint, ชื่อแบรนด์บริการ OpenCode Console/Go/Zen ที่ผู้ให้บริการยังใช้) ไว้เหมือนเดิม

## ขอบเขต

- **In scope (`cli-tui-brand-prose`):** ไม่มีคำว่า OpenCode หรือ opencode ยกเว้นบรรทัด USAGE ที่ชื่อมาจากการ build; คำสั่ง terminal-auth เป็น changeloop auth login, ชื่อที่แสดงเป็น Changeloop และ agent id ภายใน (`opencode`) เหมือนเดิม; ใช้ชื่อ Changeloop และคำสั่ง changeloop; สะกด CHANGELOOP แบบ pixel โดยไอคอน loop แทนตัว O ทั้งสองและไม่ถูกตัดแถวที่ความกว้างใดๆ; ทุกค่ายังตรงกับของเดิม
- **Out of scope:** edits outside `packages/tui/src/logo.ts`, `packages/tui/src/component/logo.tsx`, `packages/tui/src/util/presentation.ts`, `packages/tui/test/util/presentation.test.ts`, `packages/tui/test/util/logo.test.ts`, `packages/cli/src/commands/commands.ts`, … +48 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/cli, packages/tui)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

ข้อความใน changeloop (help, อัปเกรด, ถอนการติดตั้ง, error, dialog ใน TUI, ชื่อหน้าต่าง, wordmark) เรียกตัวเองว่า Changeloop และแนะนำคำสั่ง changeloop แทน opencode โดย config, plugin, env var และ endpoint เดิมใช้ได้เหมือนเดิม

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| help-no-opencode-prose | root help | unclassified | T002 | test: `packages/cli/test/rebrand-help.test.ts`, `packages/cli/test/acp/error.test.ts`, `packages/cli/test/acp/session.test.ts`, `packages/cli/test/acp/lifecycle.subprocess.test.ts`, `packages/cli/test/pair-remote-consent.test.ts`, `packages/cli/test/stats.test.ts`, `packages/cli/test/mini.test.ts`, `packages/cli/test/service-lifecycle.test.ts` | — |
|  | subcommand help | unclassified | T002 |  |  |
| runtime-messages-rebranded | คำสั่งแนะนำ | failure | T002 | test: `packages/cli/test/rebrand-help.test.ts`, `packages/cli/test/acp/error.test.ts`, `packages/cli/test/acp/session.test.ts`, `packages/cli/test/acp/lifecycle.subprocess.test.ts`, `packages/cli/test/pair-remote-consent.test.ts`, `packages/cli/test/stats.test.ts`, `packages/cli/test/mini.test.ts`, `packages/cli/test/service-lifecycle.test.ts` | — |
|  | acp | unclassified | T002 |  |  |
|  | ชื่อบริการคงเดิม | unclassified | T002 |  |  |
| tui-prose-rebranded | ชื่อหน้าต่างและ dialog | unclassified | T003 | test: `packages/tui/test/brand-prose.test.ts`, `packages/tui/test/app-lifecycle.test.tsx`, `packages/tui/test/mini/splash.test.ts`, `packages/tui/test/component/dialog-update.test.tsx`, `packages/tui/test/cli/tui/dialog-mcp.test.tsx`, `packages/tui/test/mini/blocker.responsive.test.tsx`, `packages/tui/test/feature-plugins/sidebar-footer.test.tsx` | — |
|  | epilogue | unclassified | T003 |  |  |
| wordmark-changeloop | ตารางแถว | unclassified | T001 | test: `packages/tui/test/util/presentation.test.ts`, `packages/tui/test/util/logo.test.ts` | — |
|  | epilogue | unclassified | T001 |  |  |
| contract-identifiers-unchanged | guard ไม่พบ prose | unclassified | T003 | test: `packages/tui/test/brand-prose.test.ts`, `packages/tui/test/app-lifecycle.test.tsx`, `packages/tui/test/mini/splash.test.ts`, `packages/tui/test/component/dialog-update.test.tsx`, `packages/tui/test/cli/tui/dialog-mcp.test.tsx`, `packages/tui/test/mini/blocker.responsive.test.tsx`, `packages/tui/test/feature-plugins/sidebar-footer.test.tsx` | — |
|  | identifier คงเดิม | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (11).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for help-no-opencode-prose, runtime-messages-rebranded, tui-prose-rebranded, wordmark-changeloop, contract-identifiers-unchanged.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-epilogue-wordmark-wraps-narrow: wordmark() always joins logo.left[i] and logo.right[i] on one row: `${pad}${left} ${right}`, which is 2+35+1+25 = 63 columns. epilogue() has no width input and never stacks or omits the wordmark. Before this change the glyph wordmark was about 41 columns. Now any terminal narrower than 63 columns soft-wraps each of the 5 pixel rows, so CHANGELOOP prints garbled. That violates the wordmark-changeloop requirement ('ไม่ถูกตัดแถวที่ความกว้างใดๆ', which also applies to the epilogue) and design.md's failure table ('จอแคบกว่าความกว้าง wordmark → แสดงแบบ stack สองส่วนไม่ถูกตัดแถว'). Only component/logo.tsx implements stacking or hiding. Fix: pass the output width (e.g. process.stdout.columns) into epilogue. Stack left over right when width < 63, and drop the wordmark when width < 37 (2 pad + 35). Add presentation tests at widths 40, 62 and 80 asserting that no printed row exceeds the width. (root/packages/tui/src/util/presentation.ts:19) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-mini-splash-oc-label: The mini entry splash still labels the program 'oc mini' (lines 288 and 290). 'oc' is the old OpenCode abbreviation and is not a command (there is no 'oc' bin alias in cli/tui). The same change renamed the terminal-title prefix 'OC \|' to 'CL \|' in app.tsx and mini/runtime.lifecycle.ts. The brand-prose guard only matches OpenCode/opencode, so it cannot catch this. Rename it for consistency (e.g. 'cl mini' or 'changeloop mini') and update the splash.test.ts expectations, or add the label to the allowlist with a reason. (root/packages/tui/src/mini/splash.ts:290) | minor | แก้แล้วในรอบ 2 | claude-opus |
