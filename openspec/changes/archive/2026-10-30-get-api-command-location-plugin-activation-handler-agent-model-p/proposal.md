# Change: แก้ GET /api/command ที่คืนรายการคำสั่งว่างในคำขอแรกของ location ที่เพิ่งสร้าง โดยให้รอ plugin activation ก่อนตอบ เหมือน handler agent/model/provider

- **Change:** `get-api-command-location-plugin-activation-handler-agent-model-p` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

`GET /api/command` ตอบรายการคำสั่งว่าง (0 รายการ) ในคำขอแรกของ location ที่เพิ่งสร้าง แล้วจึงครบ 10 รายการ (Foundation 8 ตัว + init + review) ราว 1-6 วินาทีหลังจากนั้น ผู้ใช้ที่เปิดแอปแล้วพิมพ์ `/` ทันทีจึงไม่เห็นคำสั่ง Foundation สาเหตุคือ handler `command.list` อ่าน `Command.Service` ทันทีโดยไม่รอ plugin activation ของ location ขณะที่คำสั่งทั้งหมด (builtin และ Foundation) ถูกเพิ่มผ่าน `command.transform` ของ plugin ซึ่ง activate เป็น fiber เบื้องหลัง ส่วน handler อื่น (agent, model, provider) รอ `awaitPlugins` อยู่แล้ว งานนี้ให้ `command.list` รอ activation แบบเดียวกัน (timeout 5 วินาที แล้วตอบ 503 ServiceUnavailableError) และเพิ่ม 503 ในสัญญา endpoint และ OpenAPI

## ขอบเขต

- **In scope (`command-list-awaits-plugin-activation`):** รอให้ plugin activation ของ location เสร็จก่อนตอบ และ SHALL ไม่ตอบรายการคำสั่งที่ยังไม่ครบโดยเงียบ; ประกาศ response 503 ServiceUnavailableError
- **Out of scope:** edits outside `packages/server/src/handlers/command.ts`, `packages/protocol/src/groups/command.ts`, `packages/protocol/openapi.json`, `packages/server/test/command.test.ts`

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** coupled (derived: tasks span packages/protocol, packages/server)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

เปิดแอปแล้วพิมพ์ / ทันที จะเห็นคำสั่งครบ (รวมคำสั่ง Foundation) เพราะ GET /api/command รอให้ plugin ของ location พร้อมก่อนตอบ แทนที่จะคืนรายการว่าง ถ้า plugin ไม่พร้อมใน 5 วินาทีจะตอบ 503 ServiceUnavailableError

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| command-list-awaits-activation | คำขอแรกของ location ใหม่ | unclassified | T001 | test: `packages/server/test/command.test.ts` | — |
|  | activation ไม่เสร็จ | unclassified | T001 |  |  |
| command-list-contract-503 | openapi ประกาศ 503 | unclassified | T001 | test: `packages/server/test/command.test.ts` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (3).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for command-list-awaits-activation, command-list-contract-503.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-activation-timeout-503-untested: Scenario 'activation ไม่เสร็จ' (claim command-list-awaits-activation-plugin-activation-location-5, capability: test) has no test. design.md's test map says the T001 check (`bun test test/command.test.ts`) proves this scenario, but command.test.ts has only two tests: the happy-path first request and the openapi 503 description. Neither makes plugin activation exceed the 5-second awaitPlugins deadline, and neither checks that GET /api/command then returns 503 ServiceUnavailableError instead of a 200 with an empty list. No other server test covers the awaitPlugins timeout either: 'did not finish activating' never appears in packages/server/test. The handler code does reach the 503 path through the shared awaitPlugins (packages/server/src/handlers/command.ts:13 → packages/server/src/location.ts:36-47), but a passing T001 check would still record evidence for a scenario it never runs. Fix: add a test that holds activation open past the deadline and asserts a 503 response with a ServiceUnavailableError body. Options for holding it open are a plugin whose setup never settles, or a Plugin.Service hold() that is never released, with a test clock or a shorter deadline if needed. (root/packages/server/test/command.test.ts:33) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-openapi-test-checks-description-only: The OpenAPI test checks only that responses['503'].description === 'ServiceUnavailableError'. The scenario requires the 503 response to reference ServiceUnavailableErrorEncoded the same way agent.list does, but the test never checks content['application/json'].schema.$ref. The current openapi.json is correct (lines 10359-10368 match agent.list at 363-372), so this is a weakness in the test, not in the code. Consider also asserting the $ref, or comparing the 503 entry with agent.list's. (root/packages/server/test/command.test.ts:40) | minor | แก้แล้วในรอบ 2 | claude-opus |
