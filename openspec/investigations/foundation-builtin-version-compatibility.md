# Investigation: Foundation builtin command version compatibility

วันที่: 2026-08-17

## คำถาม

Builtin commands ของ Changeloop รู้และตรวจได้อย่างไรว่ากำลังใช้
`claude-foundation` CLI, project harness และ command instructions เวอร์ชันใด
รวมถึงควรป้องกัน version drift อย่างไรโดยยังไม่ embed harness ทั้งก้อนใน
binary

## ข้อสรุป

ระบบปัจจุบันตรวจ compatibility ได้เฉพาะระหว่าง CLI กับ project runtime ผ่าน
runtime API แต่ไม่ตรวจ compatibility ระหว่าง builtin command template กับ
project harness เลย ขณะนี้ drift เกิดขึ้นแล้ว: template ที่ bundle ใน binary
มาจาก Foundation 3.2.27 แต่ CLI, project harness และ canonical project commands
เป็น 3.2.29 / runtime API 21

แนวทางที่เหมาะกับ V1 คือเปลี่ยน builtin templates ให้เป็น thin dispatchers:
คงชื่อ command และ missing-harness guard ไว้ใน binary แต่ให้แต่ละ command อ่าน
`.claude/commands/<name>.md` ของ project แล้วทำตามไฟล์นั้นเป็น canonical
instruction แทนการ duplicate body ของ Foundation release ใด release หนึ่ง
วิธีนี้ทำให้คำสั่งที่ agent ใช้เดินพร้อมกับ project-owned harness ซึ่ง installer
จัดการเป็น revision เดียวกัน และยังรักษาเป้าหมายที่ commands มองเห็นได้ในทุก
project

## ข้อเท็จจริงจาก repository และ runtime

1. `FoundationWorkflowPlugin` ฉีด template คงที่เข้า `config.command` ตอน boot
   และตรวจเพียง `foundation_workflow !== false` กับชื่อ command ที่มีอยู่แล้ว
   ไม่มี filesystem probe, version lookup หรือ compatibility check
2. template ทั้ง 8 ไฟล์ประกาศ source เป็น `claude-foundation 3.2.27` และ test
   pin string `3.2.27` โดยตรง จึงรับรองเพียงว่า metadata เก่ายังคงอยู่ ไม่ได้
   รับรองว่าเนื้อหาตรงกับ harness ที่ติดตั้ง
3. template guard ตรวจเพียงว่า `.claude/harness/foundation.mjs` มีอยู่ ไม่มีการ
   อ่าน version หรือ runtime API ก่อน agent เริ่มทำ workflow
4. executable ที่เรียกจริงถูก resolve จาก `PATH`; เครื่องที่ตรวจครั้งนี้ใช้
   Homebrew `/opt/homebrew/bin/claude-foundation` เวอร์ชัน 3.2.29
5. CLI หา project root จาก working directory (หรือ
   `CLAUDE_FOUNDATION_PROJECT`) แล้ว forward operation ไปยัง
   `.claude/harness/foundation.mjs` ของ project ไม่ได้ใช้ runtime ที่ bundle
   อยู่กับ CLI
6. CLI 3.2.29 คาดหวัง runtime API 21 การเรียกแบบ write จะหยุดเมื่อ API ไม่ตรง
   ส่วน read operation จะเตือน การตรวจ `doctor --stage change` และ
   `doctor --stage prove` ของ repository ปัจจุบันผ่าน
7. project runtime ระบุ Foundation 3.2.29 และ runtime API 21 ทั้งใน
   `foundation.mjs` และ `protocol.json`
8. canonical `.claude/commands/*.md` รุ่น 3.2.29 ต่างจาก bundled 3.2.27 ครบทั้ง
   8 commands ไม่ใช่แค่ formatting ตัวอย่างที่มีผลต่อพฤติกรรมคือ `land`
   เพิ่ม automatic recovery สำหรับ control-head movement และ `changes` เพิ่ม
   การแปล lifecycle labels/ซ่อน raw hashes กับ JSON
9. `claude-foundation init --host opencode` สามารถ copy canonical commands ไป
   `.opencode/commands`; command เหล่านี้จะชนะ builtin เพราะ plugin ไม่ทับชื่อ
   ที่มีอยู่แล้ว แต่การติดตั้งแบบปกติ/default host ไม่รับประกันว่าจะมี
   `.opencode/commands` repository นี้ไม่มี directory ดังกล่าว จึงใช้ bundled
   3.2.27 อยู่
10. design เดิมเลือก manual resync ต่อ Foundation release โดยตั้งใจ ดังนั้น
    drift นี้ไม่ได้ผิด implementation เดิม แต่แสดงว่ากลไกนั้นไม่ทำให้การ
    upgrade ปลอดภัยโดยอัตโนมัติ

## สิ่งที่ runtime API ป้องกันและไม่ป้องกัน

Runtime API ป้องกัน CLI เรียก function shape ที่ project runtime ไม่รองรับ เช่น
write operation จาก CLI API 21 ไปหา runtime API เก่า แต่ไม่ครอบคลุม semantic
instruction ที่ agent อ่าน ตัว template เก่าสามารถสั่ง sequence ที่เลิกใช้แล้ว
หรือพลาด recovery ใหม่ได้ แม้ CLI และ runtime จะมี API ตรงกันทุกประการ

ดังนั้น `claude-foundation version` และ `doctor` จำเป็น แต่ไม่เพียงพอสำหรับ
พิสูจน์ว่า builtin instructions ตรงกับ harness

## ทางเลือก

### A. Manual resync ทุก Foundation release

เปลี่ยน 8 template และ version assertion ทุกครั้งที่ upgrade harness

- ข้อดี: diff เล็กและตรงกับ design/spec ปัจจุบัน
- ข้อเสีย: มีช่วง drift เสมอ, พึ่งวินัยคน, test ตรวจ version ที่ hardcode แทน
  semantic equivalence และ binary เก่าจะใช้ instruction เก่ากับ project ใหม่

### B. Thin dispatcher ไปยัง project canonical command — แนะนำ

Bundle เฉพาะ prompt คงที่ที่ตรวจว่ามี harness และ command file จากนั้นอ่าน
`.claude/commands/<name>.md` แบบครบไฟล์และทำตามด้วย `$ARGUMENTS` เดิม

- ข้อดี: instruction กับ project harness upgrade พร้อมกัน, ลด duplication,
  รักษา command discovery และ plugin-first boundary, ไม่ต้อง embed runtime
- ข้อเสีย: invocation ต้องอ่านไฟล์เพิ่มหนึ่งไฟล์ และต้องกำหนด failure ที่ชัด
  เมื่อ installation เป็น mixed/partial revision
- Contract impact: ต้องแก้ requirement จาก “bundled full templates carrying
  source version” เป็น “bundled dispatchers resolving project-owned canonical
  commands”

### C. Plugin อ่าน canonical command files ตอน boot

ให้ `FoundationWorkflowPlugin` ใช้ project directory อ่าน
`.claude/commands/*.md` แล้ว inject body โดยตรง พร้อม fallback เมื่อไม่มี harness

- ข้อดี: command ที่ expose มี body ล่าสุดโดยตรง
- ข้อเสีย: เพิ่ม filesystem/error/cache behavior ใน config hook, ต้องแยก
  missing/partial install และยังต้องมี fallback templates; ซับซ้อนกว่า B โดย
  ไม่เพิ่ม correctness ที่สำคัญ

### D. บังคับ template version เท่ากับ harness semantic version

อ่าน version แล้ว hard fail เมื่อไม่เท่ากัน

- ข้อดี: ตรวจ drift ได้ชัด
- ข้อเสีย: ผูก binary กับ Foundation release เกินจำเป็น แม้ runtime API ยัง
  compatible และเปลี่ยนปัญหาจาก silent drift เป็นคำสั่งใช้ไม่ได้ แนวทางนี้
  เหมาะเป็น diagnostic เพิ่มเติม ไม่ควรเป็นกลไกหลัก

### E. Embed harness และ installer ใน binary

ทำให้ binary, templates และ runtime เป็น release unit เดียว

- ข้อดี: pin ได้สมบูรณ์และรองรับ project initialization ในตัว
- ข้อเสีย: scope ใหญ่, ต้องออกแบบ upgrade/ownership และถูกวางไว้ใน Roadmap
  Phase 2 แล้ว จึงไม่เหมาะเป็น fix ของ V1

## ข้อเสนอ

เปิด change เพื่อทำทางเลือก B และเพิ่ม deterministic tests ดังนี้:

1. builtin command ทั้ง 8 เป็น dispatcher ที่คง missing-install guard
2. dispatcher ระบุ canonical path ตามชื่อ command และส่งต่อ `$ARGUMENTS`
3. เมื่อ harness หรือ canonical command หาย ให้หยุดและชี้
   `DEVELOPER-SETUP.md`; ห้าม fallback ไปใช้ body เก่า
4. test ยืนยัน mapping 8 ชื่อ → 8 canonical paths, user precedence และ opt-out
5. ลบ assertion ที่ pin `3.2.27`; แทนด้วย contract test ของ dispatcher
6. เพิ่ม diagnostic/documentation แสดง CLI version, project runtime version
   และ runtime API แยกกัน โดยไม่ตีความ semantic-version equality ว่าเป็น
   compatibility requirement

## Unknowns ที่ควรปิดใน Change

- UX ที่ต้องการเมื่อมี harness แต่ `.claude/commands/<name>.md` หาย: แนะนำให้
  ถือเป็น partial installation และหยุด พร้อมชี้ reinstall
- จะเพิ่มคำสั่ง diagnostic ของ Changeloop เองหรือบันทึกเฉพาะวิธีตรวจใน
  documentation; ไม่กระทบแกน dispatcher และตัดสินแยกได้
- host ที่ไม่มีสิทธิ์อ่าน project files ไม่สามารถใช้ Foundation workflow อยู่
  แล้ว เพราะ harness ต้องอ่าน OpenSpec และ repository จึงไม่ใช่ trust boundary
  ใหม่ แต่ควรบันทึก assumption นี้ใน change

## หลักฐานที่อ่าน

- `packages/opencode/src/plugin/foundation.ts`
- `packages/opencode/src/plugin/foundation/*.txt`
- `packages/opencode/test/plugin/foundation.test.ts`
- `packages/opencode/src/config/config.ts`
- `.claude/commands/*.md`
- `.claude/harness/foundation.mjs`
- `.claude/harness/runtime/version.mjs`
- `.claude/harness/protocol.json`
- Foundation 3.2.29 `cli.sh`, `install.sh`, `install-opencode.sh`
- archived change `foundation-workflow-commands-builtin`

## Next action

`/change foundation-builtin-command-dispatch --prototype-selection openspec/investigations/foundation-builtin-version-compatibility.md`
