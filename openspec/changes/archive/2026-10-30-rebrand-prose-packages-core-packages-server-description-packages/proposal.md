# Change: rebrand ข้อความ prose ที่ผู้ใช้เห็นซึ่งยังค้างใน packages/core, packages/server และ description ใน packages/protocol (OpenAPI, หน้า OAuth callback, คำถามขอสิทธิ์, error และคำสั่งแนะนำ) จาก OpenCode เป็น Changeloop โดยไม่แตะ identifier ที่เป็นสัญญา

- **Change:** `rebrand-prose-packages-core-packages-server-description-packages` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-29

## เหตุผล

ต่อจาก cli-tui-brand-prose: packages/core, packages/server และ packages/protocol ยังมีข้อความที่ผู้ใช้เห็นซึ่งเรียกโปรแกรมว่า OpenCode (หน้า OAuth callback, คำถามขอสิทธิ์ค้นเว็บ, error, คำแนะนำ `opencode pair` / `opencode service restart` ที่ไม่มีคำสั่งนี้แล้ว, title และ description ใน /openapi.json) งานนี้เปลี่ยนเฉพาะ prose เหล่านั้นเป็น Changeloop ด้วยกติกาคัดแยกเดียวกัน และคง identifier ที่เป็นสัญญา ชื่อบริการ OpenCode Console/Go/Zen ข้อความที่ส่งให้โมเดล (system prompt, skill guide) และตัวตนที่ส่งให้ระบบภายนอก โดยรายงานรายการที่คงไว้เป็นข้อค้างให้ผู้ใช้ตัดสินใจ

## ขอบเขต

- **In scope (`core-server-brand-prose`):** ไม่มีคำว่า OpenCode หรือ opencode ใน title, summary และ description ที่ผู้ใช้อ่าน ยกเว้นชื่อบริการ OpenCode Console/Go/Zen; เรียกโปรแกรมว่า Changeloop และแนะนำคำสั่ง changeloop; คงค่าเดิมหลัง rebrand และ guard test SHALL ตรวจว่าบรรทัดโค้ดใน core, server, protocol src ที่ยังมี OpenCode เป็นรายการใน allowlist เท่านั้น
- **Out of scope:** edits outside `packages/core/src/oauth/page.ts`, `packages/core/src/tool/plugin/websearch.ts`, `packages/core/src/generate.ts`, `packages/core/test/oauth-page.test.ts`, `packages/core/test/tool-websearch.test.ts`, `packages/server/src/process.ts`, … +6 more

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/core, packages/protocol, packages/server)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้า OAuth callback, คำถามขอสิทธิ์ค้นเว็บ, ข้อความ error, คำสั่งแนะนำ (pair, service restart) และคำอธิบายใน /openapi.json เรียกตัวเองว่า Changeloop แทน OpenCode โดย endpoint, header, config และชื่อบริการ OpenCode Console/Go เดิมใช้ได้เหมือนเดิม

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| openapi-no-opencode-prose | info และ description | unclassified | T002 | test: `packages/server/test/openapi-brand.test.ts` | — |
|  | path และ header คงเดิม | unclassified | T002 |  |  |
| user-messages-rebranded | หน้า OAuth callback | unclassified | T001, T002 | test: `packages/core/test/oauth-page.test.ts`, `packages/core/test/tool-websearch.test.ts`, `packages/server/test/openapi-brand.test.ts` | — |
|  | คำสั่งแนะนำ | unclassified | T001, T002 |  |  |
|  | คำถามขอสิทธิ์ค้นเว็บ | unclassified | T001, T002 |  |  |
|  | ชื่อบริการคงเดิม | unclassified | T001, T002 |  |  |
| contract-identifiers-unchanged | guard ไม่พบ prose | unclassified | T003 | test: `packages/core/test/brand-prose.test.ts` | — |
|  | identifier คงเดิม | unclassified | T003 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (8).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for openapi-no-opencode-prose, user-messages-rebranded, contract-identifiers-unchanged.

## Appendix: Amendment history

- Revision 1 (2026-10-29): Review พบว่า test เดิม process.test.ts ยัง assert `opencode pair`, ไม่มี test คำแนะนำ service restart และ snapshot packages/protocol/openapi.json ยังมี prose เดิม จึงเพิ่ม task ครอบคลุมไฟล์เหล่านี้

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-process-test-asserts-old-pair-command: The browser 401 text now says "Run `changeloop pair` to get a new one.", but the existing test packages/server/test/process.test.ts:212 still asserts `expect(await reused.text()).toContain("opencode pair")`. The change didn't update that test, so the server suite fails. That test is also the only one covering this message, so the claim has no passing evidence. Fix: change the assertion to `changeloop pair`. Optionally also assert that the text no longer contains `opencode pair`. (root/packages/server/src/handlers/server.ts:42) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-stale-generated-openapi-snapshot: The OpenApi annotations changed in api.ts (title), groups/session.ts (three descriptions) and groups/persistent-pty.ts (one description), but packages/protocol/openapi.json was not regenerated. It still has "title": "opencode HttpApi" (line 4) and "OpenCode process" / "through the OpenCode server" (lines 1633, 4239, 12588, 22016). `bun run check:generated` (script/generate-openapi.ts --check) will exit 1 with "Generated OpenAPI document is stale". The published document (packages/console/app/src/routes/openapi.json.ts fetches it from GitHub raw) still shows OpenCode prose. Fix: run `bun run generate` in packages/protocol and commit the result. (root/packages/protocol/src/api.ts:205) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F3-service-restart-and-pair-hint-not-asserted: Scenario user-messages-rebranded-pair-service requires the hints to recommend `changeloop pair` and `changeloop service restart`. No test in core/server checks the service_failed action text. The pair hint's only test still checks the old string (F1). brand-prose.test.ts only proves `opencode pair` is gone; it doesn't check that the `changeloop` command is present. So this scenario is covered by code only. Fix: add assertions for both `changeloop pair` (process.test.ts) and `changeloop service restart` (the unavailable() 503 body). (root/packages/server/src/process.ts:227) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F4-openapi-test-does-not-check-directory-header: The scenario names x-opencode-directory as unchanged in the OpenAPI document, but the test checks only x-opencode-ticket and the server.info operationId. x-opencode-directory isn't in the served document at all: it only appears in server/src/location.ts, and brand-prose.test.ts checks it in source. Non-blocking. Consider spot-checking a few more operationIds (for example session.active and persistentPty.connect, whose descriptions changed). (root/packages/server/test/openapi-brand.test.ts:54) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F5-whole-file-allowlist-weakens-guard: allowedFiles skips the whole of core/src/oauth/page.ts, skill.ts and plugin/provider/opencode.ts, but the stated reason for page.ts is only the wordmark SVG. If OpenCode prose comes back in page.ts, this guard won't catch it; only oauth-page.test.ts will. A line-level allowlist entry for the `aria-label="OpenCode"` line would be tighter. Separately, the guard checks one line at a time: string lines inside multi-line templates that start with `*` or `//` are treated as comments and skipped. Non-blocking. (root/packages/core/test/brand-prose.test.ts:44) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1-service-failed-test-relies-on-posix-path: The new service_failed test makes boot fail by passing database path "/dev/null/changeloop.db". This only fails on POSIX systems, where /dev/null is not a directory. On another platform, or if database opening becomes lazy, boot might succeed. The test would then poll 50 times and fail with a confusing status mismatch instead of a clear message. Non-blocking. Consider a temp file used as a parent directory, or an explicit failing layer, to make the failure deterministic and portable. (root/packages/server/test/process.test.ts:237) | minor | ยังเปิดอยู่ | claude-opus |
