<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: upgrade-to-opencode-v2

**สถานะ:** ยังไม่สมบูรณ์ — ตรวจขั้นตอนถัดไปก่อนใช้ข้อสรุปนี้

อัปเดต: 2026-10-27T12:15:22.940Z · 312fd737a0820a163338389ac36939cc3f47452b30356c2320dc2e203cc99df8

## ปัญหา

fork อยู่ที่ opencode 1.18.18 (merge-base 92d29ba4a3) upstream อยู่ที่ v2.2.0 ห่าง 6,038 commits: ควรอัพเกรดแบบไหน และเสี่ยง/ใหญ่แค่ไหน

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** ตัดสินว่า fork changeloop-cli ควรตาม opencode upstream ไป v2.x ด้วยวิธีใด (merge เป็นช่วง / rebase / cherry-pick / port ใหม่) และงานใหญ่แค่ไหน

**ผลลัพธ์ที่ต้องการ:** ข้อสรุปพร้อมหลักฐานเกี่ยวกับความเป็นไปได้ ความเสี่ยง ขนาดงาน และทางเลือกที่แนะนำ โดยไม่แก้ product code


### ผู้เกี่ยวข้อง

- เจ้าของ fork changeloop-cli

### ขอบเขต

- packages/opencode (v1 runtime ของ fork)
- packages/cli/core/server/app
- plugin Foundation
- build/delivery ของ binary changeloop

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- ไม่มีข้อความสนทนาก่อนหน้า session นี้ที่อ่านได้ (ไม่ทราบว่าผู้ใช้เคยกำหนดเงื่อนไขเรื่อง v2 ไว้หรือไม่)

## ข้อสรุปปัจจุบัน

git merge/rebase ตรงๆ ไม่คุ้มและเสี่ยง เพราะ upstream ลบ packages/opencode ที่ fork ใช้ทั้ง package, เปลี่ยน namespace/toolchain และ dry-run ชน 99 ไฟล์. ชั้นของ fork ส่วนใหญ่เล็กและแยกได้ (≈60 ไฟล์ใน packages/opencode + vendor ที่ generate ซ้ำได้) จึงแนะนำให้ port ไปบน v2.2.x เป็นเฟส ไม่ใช่ merge; ต้องให้ผู้ใช้ตัดสินกลยุทธ์

## ข้อเสนอแนะและเหตุผล

git merge/rebase ตรงๆ ไม่คุ้มและเสี่ยง เพราะ upstream ลบ packages/opencode ที่ fork ใช้ทั้ง package, เปลี่ยน namespace/toolchain และ dry-run ชน 99 ไฟล์. ชั้นของ fork ส่วนใหญ่เล็กและแยกได้ (≈60 ไฟล์ใน packages/opencode + vendor ที่ generate ซ้ำได้) จึงแนะนำให้ port ไปบน v2.2.x เป็นเฟส ไม่ใช่ merge; ต้องให้ผู้ใช้ตัดสินกลยุทธ์

## ข้อเท็จจริงที่บันทึกไว้ — ยังตรวจสอบไม่ครบ

- **gap-size:** fork อยู่ที่ opencode 1.18.18 ส่วน upstream มี tag ล่าสุด v2.2.0 และห่าง 6,038 commits จาก merge-base 92d29ba4a3 ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>), [packages/opencode/package.json](<../../packages/opencode/package.json>))
- **v1-runtime-deleted-upstream:** upstream ลบ packages/opencode ทั้ง package (commit 44b6938b2a) ปัจจุบันมี 0 ไฟล์ และไม่มี branch ดูแล v1 เหลืออยู่ ขณะที่ fork เก็บ runtime ทั้งหมดไว้ใน package นี้ (1,301 ไฟล์) ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>), [packages/opencode/package.json](<../../packages/opencode/package.json>))
- **toolchain-namespace-break:** upstream เปลี่ยนชื่อ package จาก @opencode-ai/\* เป็น @opencode/\*, effect 4.0.0-beta.83→4.0.1, TypeScript 5.8→6 และ bun 1.3.14→1.4.4 ทำให้โค้ดที่ merge สะอาดก็ยังคอมไพล์ไม่ผ่าน ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>), [package.json](<../../package.json>))
- **dry-run-conflicts:** dry-run merge (git merge-tree) ของ HEAD กับ upstream/dev ไม่สะอาด: 99 ไฟล์ conflict (app 40, opencode 32 แบบ modify/delete, core 8, client 5, server 4, อื่นๆ) ยังไม่นับ rename ของ namespace ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>))
- **fork-delta-shape:** งานของ fork 1,364 ไฟล์ แต่ 502 ไฟล์เป็น vendor/ ที่ generate ซ้ำได้ ส่วนที่เขียนเองใน packages/opencode ราว 60 ไฟล์ (plugin Foundation, router, branding ของ CLI, build/verify script) และนอก package นั้นคือ app 49, core 17, client 5, server 4 ไฟล์ โดย 47 ไฟล์ import @opencode-ai/\* รวม 173 บรรทัด ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>), [packages/opencode/src/plugin/foundation.ts](<../../packages/opencode/src/plugin/foundation.ts>), [packages/opencode/src/plugin/router.ts](<../../packages/opencode/src/plugin/router.ts>))
- **fork-services-in-core:** fork เพิ่ม Foundation, FoundationDocuments และ CommandPreparation เป็น service ใน core/server ซึ่งตัว implement จริงอยู่ใน packages/opencode/src/plugin/foundation-\*.ts; packages/server/routes.ts มีเฉพาะ fallback แบบ unsupported สำหรับ server แบบ standalone ([packages/core/src/foundation.ts](<../../packages/core/src/foundation.ts>), [packages/opencode/src/plugin/foundation-command.ts](<../../packages/opencode/src/plugin/foundation-command.ts>), [packages/server/src/routes.ts](<../../packages/server/src/routes.ts>))
- **v1-hooks-absent-in-v2:** plugin Foundation ของ fork พึ่ง v1 hook config, command.execute.before, shell.env และ experimental.chat.system.transform แต่ไม่พบ hook ชื่อเหล่านี้ใน packages/\*/src ของ upstream/dev ([packages/opencode/src/plugin/foundation.ts](<../../packages/opencode/src/plugin/foundation.ts>), [packages/opencode/src/plugin/router.ts](<../../packages/opencode/src/plugin/router.ts>), [openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>))
- **v2-plugin-equivalents:** v2 plugin API (Effect-based) มีจุดต่อที่ใกล้เคียง: command.transform + CommandDefinition, shell hook create.before ที่แก้ env ได้, agent/skill/tool transform และ session hook ที่มี system: Array\<SystemPart\> จึงมีเส้นทาง port แต่ยังไม่ได้ทดลอง ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>))
- **v2-breaking-and-migration:** v2.1 (commit acdcdb8dd9) ปรับ session compaction/history/projector และ schema/openapi/client types; upstream มี v1-migration ฝั่ง core สำหรับข้อมูลและ config เดิมของผู้ใช้ ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>))
- **v2-build-and-rebrand-surface:** entry และ build ของ v2 ย้ายไป packages/cli (script build, build:node, pack; bin opencode) แทน packages/opencode ที่ Delivery ของ fork ใช้ และ literal ที่มีคำว่า opencode ใน cli+tui มี 633 บรรทัดใน 257 ไฟล์ที่ต้อง rebrand ใหม่ ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>), [packages/opencode/package.json](<../../packages/opencode/package.json>))
- **last-v1-stretch:** มี 699 commits ระหว่าง merge-base กับ commit ก่อนการลบ packages/opencode (จุดสุดท้ายที่ v1 runtime ยังมีอยู่ ที่ 1.18.4/effect beta.98) ซึ่งยังเป็นเส้นทางที่ merge เข้า runtime v1 ของ fork ได้ในทางทฤษฎี แต่ยังไม่ได้ dry-run ([openspec/investigations/upgrade-to-opencode-v2.md](<upgrade-to-opencode-v2.md>))

## สมมติฐานและหลักฐาน

- **git-merge-direct — มีหลักฐานหักล้าง:** merge หรือ rebase upstream/dev เข้า fork ตรงๆ (เป็นช่วงหรือทีเดียว) ทำได้อย่างปลอดภัย; หลักฐาน: v1-runtime-deleted-upstream, toolchain-namespace-break, dry-run-conflicts, fork-delta-shape
- **port-fork-layer-to-v2 — มีหลักฐานสนับสนุน:** ชั้นที่ fork เพิ่ม (branding, Foundation plugin/service, web UI, build/delivery) ย้ายไปอยู่บน v2 ได้ในรูป re-apply บน upstream v2.x; หลักฐาน: fork-delta-shape, fork-services-in-core, v2-plugin-equivalents, v2-build-and-rebrand-surface
- **cherry-pick-fixes-onto-v1 — ยังไม่สรุป:** ค้างที่ v1 แล้ว cherry-pick เฉพาะ security/crash fix จาก upstream มาใช้ได้; หลักฐาน: ยังไม่ได้บันทึก

## การตัดสินใจ

- **upgrade-strategy — ยังไม่สรุป:** จะตาม opencode ด้วยวิธีใด เมื่อ upstream ลบ v1 runtime ที่ fork ใช้อยู่ไปแล้ว
  ตัวเลือก: port-to-v2: เปิด branch ใหม่จาก upstream v2.2.x แล้ว re-apply ชั้นของ fork (branding, Foundation เป็น v2 plugin/service, web UI, build/delivery) ทำเป็นเฟสผ่าน Change Loop / freeze-v1: อยู่ที่ 1.18.18 ไม่ตาม upstream (อาจ backport fix เป็นรายตัวด้วยมือ ซึ่งยังไม่ได้ตรวจว่า apply ได้) / merge-last-v1-then-decide: merge เฉพาะ 699 commits สุดท้ายก่อน upstream ลบ v1 เพื่อรับ fix ล่าสุดของ v1 แล้วค่อยตัดสินเรื่อง v2 ทีหลัง; ข้อเสนอแนะและเหตุผล: port-to-v2: เปิด branch ใหม่จาก upstream v2.2.x แล้ว re-apply ชั้นของ fork ทำเป็นเฟสผ่าน Change Loop; หลักฐาน: v1-runtime-deleted-upstream, toolchain-namespace-break, dry-run-conflicts, fork-delta-shape, v2-plugin-equivalents

## สิ่งที่ยังไม่รู้และงานที่เหลือ

- **cherry-pick-fixes-onto-v1:** ค้างที่ v1 แล้ว cherry-pick เฉพาะ security/crash fix จาก upstream มาใช้ได้ — ยังไม่มีการตรวจต่อ
- repository discovery scan-file-limit: packages/opencode/test/provider/transform.test.ts
- repository discovery scan-file-size-skipped: packages/codemode/test/fixtures/opencode-v2-openapi.json
- repository discovery scan-symlink-skipped: .agents/skills/api-design-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/architecture-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/brainstorming
- repository discovery scan-symlink-skipped: .agents/skills/build
- repository discovery scan-symlink-skipped: .agents/skills/change
- repository discovery scan-symlink-skipped: .agents/skills/changes
- repository discovery scan-symlink-skipped: .agents/skills/claude-md
- repository discovery scan-symlink-skipped: .agents/skills/coding-discipline
- repository discovery scan-symlink-skipped: .agents/skills/concurrency-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/database-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/ddd-strategic
- repository discovery scan-symlink-skipped: .agents/skills/debug-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/delivery-engineering
- repository discovery scan-symlink-skipped: .agents/skills/dev
- repository discovery scan-symlink-skipped: .agents/skills/feature
- repository discovery scan-symlink-skipped: .agents/skills/frontend-design
- repository discovery scan-symlink-skipped: .agents/skills/git-workflow
- repository discovery scan-symlink-skipped: .agents/skills/gridgeist
- repository discovery scan-symlink-skipped: .agents/skills/grill-task-gu
- repository discovery scan-symlink-skipped: .agents/skills/grill-task-gu-please
- repository discovery scan-symlink-skipped: .agents/skills/harness-html-report
- repository discovery scan-symlink-skipped: .agents/skills/hexagonal-backend
- repository discovery scan-symlink-skipped: .agents/skills/init-project-docs
- repository discovery scan-symlink-skipped: .agents/skills/investigate
- repository discovery scan-symlink-skipped: .agents/skills/land
- repository discovery scan-symlink-skipped: .agents/skills/observability-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/plan-writing
- repository discovery scan-symlink-skipped: .agents/skills/programming-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/prove
- repository discovery scan-symlink-skipped: .agents/skills/queue-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/refactoring-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/security-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/skill-creator
- repository discovery scan-symlink-skipped: .agents/skills/tailwind-design-system
- repository discovery scan-symlink-skipped: .agents/skills/testing-fundamentals
- repository discovery scan-symlink-skipped: .agents/skills/ui-ux-pro-max
- repository discovery scan-symlink-skipped: packages/app/public/apple-touch-icon-v3.png
- repository discovery scan-symlink-skipped: packages/app/public/apple-touch-icon.png
- repository discovery scan-symlink-skipped: packages/app/public/favicon-96x96-v3.png
- repository discovery scan-symlink-skipped: packages/app/public/favicon-96x96.png
- repository discovery scan-symlink-skipped: packages/app/public/favicon-v3.ico
- repository discovery scan-symlink-skipped: packages/app/public/favicon-v3.svg
- repository discovery scan-symlink-skipped: packages/app/public/favicon.ico
- repository discovery scan-symlink-skipped: packages/app/public/favicon.svg
- repository discovery scan-symlink-skipped: packages/app/public/site.webmanifest
- repository discovery scan-symlink-skipped: packages/app/public/social-share-zen.png
- repository discovery scan-symlink-skipped: packages/app/public/social-share.png
- repository discovery scan-symlink-skipped: packages/app/public/web-app-manifest-192x192.png
- repository discovery scan-symlink-skipped: packages/app/public/web-app-manifest-512x512.png
- repository discovery scan-symlink-skipped: packages/app/src/custom-elements.d.ts
- repository discovery scan-symlink-skipped: packages/console/app/public/apple-touch-icon-v3.png
- repository discovery scan-symlink-skipped: packages/console/app/public/apple-touch-icon.png
- repository discovery scan-symlink-skipped: packages/console/app/public/email
- repository discovery scan-symlink-skipped: packages/console/app/public/favicon-96x96-v3.png
- repository discovery scan-symlink-skipped: packages/console/app/public/favicon-96x96.png
- repository discovery scan-symlink-skipped: packages/console/app/public/favicon-v3.ico
- repository discovery scan-symlink-skipped: packages/console/app/public/favicon-v3.svg
- repository discovery scan-symlink-skipped: packages/console/app/public/favicon.ico
- repository discovery scan-symlink-skipped: packages/console/app/public/favicon.svg
- repository discovery scan-symlink-skipped: packages/console/app/public/site.webmanifest
- repository discovery scan-symlink-skipped: packages/console/app/public/social-share-black.png
- repository discovery scan-symlink-skipped: packages/console/app/public/social-share-zen.png
- repository discovery scan-symlink-skipped: packages/console/app/public/social-share.png
- repository discovery scan-symlink-skipped: packages/console/app/public/web-app-manifest-192x192.png
- repository discovery scan-symlink-skipped: packages/console/app/public/web-app-manifest-512x512.png
- repository discovery scan-symlink-skipped: packages/docs/openapi.json
- repository discovery scan-symlink-skipped: packages/enterprise/public/apple-touch-icon-v3.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/apple-touch-icon.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/favicon-96x96-v3.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/favicon-96x96.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/favicon-v3.ico
- repository discovery scan-symlink-skipped: packages/enterprise/public/favicon-v3.svg
- repository discovery scan-symlink-skipped: packages/enterprise/public/favicon.ico
- repository discovery scan-symlink-skipped: packages/enterprise/public/favicon.svg
- repository discovery scan-symlink-skipped: packages/enterprise/public/site.webmanifest
- repository discovery scan-symlink-skipped: packages/enterprise/public/social-share-zen.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/social-share.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/web-app-manifest-192x192.png
- repository discovery scan-symlink-skipped: packages/enterprise/public/web-app-manifest-512x512.png
- repository discovery scan-symlink-skipped: packages/enterprise/src/custom-elements.d.ts
- จะตาม opencode ด้วยวิธีใด เมื่อ upstream ลบ v1 runtime ที่ fork ใช้อยู่ไปแล้ว

## แหล่งอ้างอิง

ยังไม่ได้บันทึก

## ขั้นตอนถัดไป

ต้องสำรวจต่อ

The investigation workspace or repository discovery failed the same way three times; repair the harness or sandbox, then rerun the same record.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/upgrade-to-opencode-v2.json
```

