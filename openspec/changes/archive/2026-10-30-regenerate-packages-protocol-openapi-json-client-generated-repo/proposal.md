# Change: regenerate packages/protocol/openapi.json และ client generated ด้วยสคริปต์ของ repo ให้ตรงกับ ClientApi ในโค้ด เพราะ snapshot บน HEAD ล้าสมัย (generate-openapi --check ล้ม) โดยไม่แก้ endpoint หรือ handler

- **Change:** `regenerate-packages-protocol-openapi-json-client-generated-repo` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-30

## ขอบเขต

- **In scope (`openapi-snapshot-regenerate`):** เท่ากับผลลัพธ์ของ generate-openapi จาก ClientApi และมี operation ของ group server.foundation ครบทั้ง 7 รายการโดย operation เดิมไม่เปลี่ยน; เท่ากับผลลัพธ์ของ `bun run generate` และ declaredStatuses ของ command.list SHALL มี 503
- **Out of scope:** edits outside `packages/protocol/openapi.json`, `packages/client/src/promise/generated/client.ts`

## ผลกระทบและความเสี่ยง

- **Impact:** medium (derived: declared work type api)
- **Coupling:** coupled (derived: tasks span packages/client, packages/protocol)
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

เอกสาร OpenAPI ของ protocol และ client generated ตรงกับ API จริงแล้ว รวม endpoint /experimental/foundation/* ที่เดิมขาดจาก snapshot

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| openapi-snapshot-current | check ผ่าน | unclassified | T001 | test | — |
|  | foundation ครบ | unclassified | T001 |  |  |
| client-generated-current | generated ตรงกัน | unclassified | T002 | test | — |
|  | client ทำงาน | unclassified | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Why:** not authored separately; the intent above states it.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for openapi-snapshot-current, client-generated-current.

## Appendix: Amendment history

- Revision 1 (2026-10-30): bun --cwd X run ไม่รันสคริปต์ (แค่แสดงรายการ) ต้องใช้ bun run --cwd
- Revision 2 (2026-10-30): bun --cwd X run ไม่รันสคริปต์ (แค่แสดงรายการ) ต้องใช้ bun run --cwd
- Revision 3 (2026-10-30): foundation.test.ts 'command list stays reachable' ล้มอยู่เดิมบน HEAD (คาดว่างาน de74e6f7a4 ทำให้ command list ไม่ว่างแล้ว) ไม่เกี่ยวกับ openapi; กรองออกและรายงานแยก
- Revision 4 (2026-10-30): review F1: verify ต้องรัน generate ของ client แล้วยืนยันว่าไฟล์ generated ไม่เปลี่ยน (เทียบ hash แทน git diff เพราะ sandbox ยังไม่ commit)

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-client-check-generated-not-verified: The 'generated ตรงกัน' scenario says to run `bun run generate` in packages/client and compare the output with the committed files. T002's verify command, and the evidence.yaml test provider segment, only run `bun run --cwd packages/protocol check:generated`. That command checks openapi.json alone. Nothing runs `bun run --cwd packages/client check:generated` (packages/client/package.json:33), which regenerates src/promise/generated, src/effect/generated and src/effect/api and runs git diff --exit-code on them. A stale client file would therefore pass every declared check. Fix: add `bun run --cwd packages/client check:generated` to T002's verify command and to the matching evidence.yaml segment. (contract/tasks.md:6) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-unexplained-test-exclusion: T001's verify command runs server test/foundation.test.ts with `-t "^(?!.*command list stays reachable)"`. This skips the /api/command passthrough test at packages/server/test/foundation.test.ts:255, and no reason is given. The design.md test map (line 162) runs the full file with no exclusion. Either explain the exclusion or remove it so the two documents agree. (contract/tasks.md:5) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 1 | F3-no-client-test-for-command-503: The new 503 in command.list's declaredStatuses has no client test. promise.test.ts only covers 503 for vcs.diff (line 144). This doesn't block, because the generated file is supposed to be checked by check:generated, but a short test that command.list rejects with ServiceUnavailableError would lock in the behaviour. (root/packages/client/src/promise/generated/client.ts:1842) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | D1-hash-ignores-filenames: h() hashes only the joined file contents (`find … \| sort \| xargs cat \| shasum`). It does not include file paths. So if generate added or removed an empty file, or renamed a file without changing what the sorted joined contents produce, the hash would stay the same. Generated output is unlikely to do this, so this does not block. To make the check stricter, hash each file's path together with its contents, e.g. `find … -type f \| sort \| xargs shasum \| shasum`. If you change it, keep evidence.yaml segment 2 identical to T002. (contract/tasks.md:6) | minor | ยังเปิดอยู่ | claude-opus |
