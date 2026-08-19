# Investigation: Foundation built-ins are visible but not usable in a fresh repository

วันที่: 2026-08-19

## คำถาม

ทำไม Changeloop แสดง `/investigate`, `/change`, `/build`, `/prove`, `/land`,
`/changes`, `/feature`, และ `/dev` ใน repository เปล่า แต่เรียกใช้งานจริงแล้ว
ไม่สามารถเดิน Foundation workflow ได้ ทั้งที่ release bundle runtime และ installer
มาใน binary แล้ว

## ข้อสรุป

ปัญหาอยู่ที่ activation boundary ไม่ใช่ command discovery หรือ installer:
Changeloop bundle Foundation runtime ไว้สำหรับ resolve host instruction, agent
contract, status, doctor และ installer แต่ไม่ได้ expose lifecycle CLI ของ bundled
runtime ให้ agent เรียกใช้ หลัง dispatcher resolve instruction แล้ว canonical
instruction ยังสั่ง agent ให้รัน `claude-foundation ...` จาก `PATH` ดังนั้นเครื่องที่
ติดตั้งเพียง Changeloop จะเห็น command, ติดตั้ง harness ได้, แต่ทำ lifecycle จริงไม่ได้
เมื่อไม่มี external `claude-foundation` executable

first-use bootstrap ยังพึ่ง model turn ก่อน mutation ด้วย ใน reproduction ครั้งนี้
provider ตอบ HTTP 402 ก่อน agent จะถาม permission และ headless `changeloop run`
ปิด permission `question` อยู่ จึงไม่มี deterministic path ที่ `/changes` ครั้งแรกจะ
นำไปสู่ initialization สำเร็จใน headless mode

## Expected กับ actual

- Expected: binary ที่ไม่มี `claude-foundation` ใน `PATH` สามารถ initialize repo และ
  เดิน built-in workflow ผ่าน bundled release เดียวกันได้ตาม public documentation
  และ specification
- Actual: command ถูก inject และ marker ถูก resolve ผ่าน bundled release สำเร็จ แต่
  instruction ถัดไปเรียก external PATH CLI; initialization ต้องผ่าน model-mediated
  approval ก่อน และอาจหยุดก่อนถึง installer
- Definition of fixed: integration smoke ใช้ compiled Changeloop binary, PATH ที่ไม่มี
  `claude-foundation`, repo เปล่า และ model/tool harness แบบ deterministic แล้วสามารถ
  bootstrap จาก first built-in invocation และ execute lifecycle operation อย่างน้อย
  `changes` ผ่าน bundled release โดยไม่เกิด PATH lookup หรือ version drift

## ข้อเท็จจริงและหลักฐาน

1. `FoundationWorkflowPlugin` เป็น internal plugin และ
   `applyFoundationCommands()` inject commands ทั้ง 8 เมื่อ
   `foundation_workflow !== false`; command visibility จึงไม่ใช่หลักฐานว่า project
   initialized แล้ว
2. ใน temp repo เปล่า `changeloop debug config` แสดง commands ทั้ง 8 ขณะที่
   `changeloop foundation status --json` รายงาน `installed.state = missing` และ
   `changeloop foundation doctor` ล้มด้วย `not inside a Foundation project`
3. การเรียก `changeloop run --command changes --format json` แทน dispatcher marker
   ด้วย bootstrap instruction ถูกต้อง แต่ model request ล้มด้วย HTTP 402
   `Insufficient credits` ก่อนถาม authorization; exported session มี
   `question: deny` สำหรับ headless run
4. `changeloop foundation init --yes` บน temp repo ติดตั้ง Foundation 3.3.1/runtime
   API 24 สำเร็จ และ bundled doctor ผ่าน แสดงว่า payload, installer และ project
   runtime ใช้งานได้
5. canonical `.claude/commands/changes.md` ที่ bundle มากับ release สั่งตรง ๆ ว่า
   `Run claude-foundation changes`; `changeloop foundation` มีเพียง
   `init|upgrade|status|doctor` และไม่มี lifecycle passthrough
6. เมื่อ PATH ไม่มี `claude-foundation`, `command -v claude-foundation` ไม่คืนค่า
   จึงไม่มี executable ที่ agent ทำตาม instruction ได้ แม้ project initialized แล้ว
7. บนเครื่องที่มี PATH CLI งาน read-only เดินต่อได้แต่เกิด drift จริง:
   PATH CLI เป็น Foundation 3.3.0/API 23 ส่วน temp project เป็น 3.3.1/API 24;
   `claude-foundation changes` เตือนว่า project runtime API 24 ต่างจาก CLI API 23
8. repository ปัจจุบันมี drift อีกชุดหนึ่ง: Changeloop bundle 3.3.1/API 24 แต่
   `FoundationRuntime.status()` ยอมรับ installed project 3.3.0/API 23 เป็น
   `installed` เพราะตรวจเพียง schema ของ `protocol.json`; bootstrap instruction จึง
   ไม่แนะนำ upgrade สำหรับ stale installation

## จุดที่ evidence เดิมพลาด

claim `compiled-binary-works-without-path-foundation` ทดสอบ compiled binary เฉพาะ
`foundation status`, `foundation init`, และ `foundation doctor` ใน PATH ที่ไม่มี
Foundation ส่วน unit test `bundled host endpoints work without a PATH` ตรวจเพียงว่า
host instruction และ agent contract resolve ได้ ไม่ได้ execute lifecycle command ที่
instruction ส่งกลับมา จึงผ่านทั้งที่ end-to-end user path ยังต้องใช้ PATH CLI

test `guides explicit bootstrap before the first bundled workflow command` ตรวจเพียง
ข้อความมี approval และ `changeloop foundation init --yes`; ไม่ได้พิสูจน์ว่า host
สามารถถามคำถามใน execution mode นั้น, initialize, แล้ว resume command เดิมโดยไม่
เริ่ม model turn ใหม่

## Root cause

release เปลี่ยน runtime source ของ dispatcher จาก PATH เป็น bundled แต่ไม่ได้เปลี่ยน
execution source ของ lifecycle operations ที่ canonical instructions เรียกใช้ ทำให้
เกิด split-brain สองชั้น:

1. Changeloop bundled runtime 3.3.1 สร้าง instruction และ agent contract
2. agent เรียก PATH `claude-foundation` ซึ่งอาจไม่มีหรือเป็นคนละ version เพื่อทำงานจริง

สถานะ `installed` ยังหมายถึงเพียง “มี protocol file ที่ decode ได้” ไม่ใช่
“ตรงกับ bundled release หรือ compatible สำหรับ execution” จึงซ่อน stale-install
recovery อีกชั้นหนึ่ง

## ข้อเสนอสำหรับ Change

แนะนำเปิด change ที่ทำ bundled lifecycle execution path ให้เป็นเจ้าของโดย Changeloop
ตลอดเส้นทาง ไม่ใช่แก้ข้อความ error อย่างเดียว:

1. expose bounded passthrough/bridge สำหรับ Foundation lifecycle operations ผ่าน
   bundled runtime และให้ canonical host instructions อ้าง execution surface นี้
   แทน PATH executable ใน bundled mode
2. คง `foundation_runtime: "path"` เป็น explicit compatibility mode ซึ่งทั้ง
   instruction/context/execution ต้องใช้ source เดียวกัน
3. ทำ first-use activation เป็น deterministic host flow: built-in invocation ขอ
   authority ใน UI ที่รองรับ หรือคืน typed bootstrap-required outcome ใน headless
   mode; หลัง init ต้อง resume original command โดยไม่พึ่ง model ตีความ prose
4. แยกสถานะ `missing`, `current`, `stale-compatible`, `incompatible`, และ `invalid`
   โดยเทียบ installed identity กับ bundled identity/compatibility contract แล้วเสนอ
   `upgrade` เมื่อจำเป็น
5. เพิ่ม compiled-binary E2E ที่เอา `claude-foundation` ออกจาก PATH จริงและพิสูจน์
   first invocation → init → lifecycle execution รวมถึง negative case ที่ไม่มี model
   credit และ headless question permission

## Unknowns ที่ต้องปิดใน Change

- bundled lifecycle bridge ควรเป็น `changeloop foundation exec -- ...`, explicit
  subcommands, หรือ private tool boundary; แนะนำไม่ expose arbitrary argv จนกว่าจะ
  กำหนด allowlist และ permission semantics
- การพิมพ์ `/change` ถือเป็น authorization ให้ติดตั้ง managed filesหรือยัง; design
  ปัจจุบันตอบว่าไม่ และควรรักษา explicit approval แต่ต้องกำหนด UX ของ headless mode
- stale runtime API ที่ยัง read-compatible ควร block ทุก command หรืออนุญาต read-only
  พร้อม typed upgrade requirement; write lifecycle ไม่ควรเดินข้าม version โดยเงียบ

## ไฟล์ที่เกี่ยวข้อง

- `packages/opencode/src/plugin/foundation.ts`
- `packages/opencode/src/plugin/foundation-runtime.ts`
- `packages/opencode/src/cli/cmd/foundation.ts`
- `packages/opencode/test/plugin/foundation.test.ts`
- `packages/opencode/test/plugin/foundation-runtime.test.ts`
- `script/evidence-foundation-bootstrap-test.ts`
- `openspec/specs/foundation-workflow/spec.md`
- `docs/CONFIGURATION.md`
- `packages/opencode/vendor/claude-foundation/payload/.claude/commands/changes.md`

## Next action

`/change foundation-bundled-lifecycle-execution --prototype-selection openspec/investigations/foundation-bundled-lifecycle-gap.md`
