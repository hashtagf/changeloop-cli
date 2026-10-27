# Investigation: ChangeLoop ใน Web UI

วันที่: 2026-09-09 (Asia/Bangkok)

## Intent และขอบเขต

สำรวจและวางแนวทางให้ผู้ใช้ติดตาม Foundation changes และทำงานต่อจาก Web UI
ของ `changeloop serve` ได้ ตามคำขอให้ใช้ investigate หลังสำรวจความสามารถ Web UI
ปัจจุบัน เอกสารนี้เป็นผลการสำรวจและข้อเสนอ ไม่ใช่ implementation agreement หรือ proof
ยังไม่มี product edits, prototype, active change หรือการอนุมัติให้ Land

ผู้ใช้เพิ่มขอบเขตชัดเจน: เปลี่ยนโลโก้ตอนเปิด session ใน Web UI เป็นแบรนด์
Changeloop ด้วย รวมในงาน UI รุ่นแรก ไม่ขึ้นกับการเลือก direct lifecycle controls

## ข้อสรุป

แนะนำเพิ่มหน้า Changes ในแอปเดิม ใช้ข้อมูลสถานะจาก Foundation และเปิด session
เพื่อทำงานต่อผ่าน command flow เดิม เริ่มจากการอ่านสถานะก่อนเพิ่มการสั่ง lifecycle
โดยตรงจากปุ่ม UI ต้องแก้ช่องว่างของ bundled snapshot ก่อน: Foundation 3.5.14
ที่ติดตั้งผ่าน Homebrew มี dashboard projection แต่ payload ที่ Changeloop bundle
ยังไม่มีไฟล์ dashboard ที่ CLI ต้องใช้

Foundation เป็นเจ้าของ lifecycle, gates, evidence และ authority ต่อไป; UI แสดงผล
และส่งเจตนาผู้ใช้ ไม่คำนวณว่าผ่าน proof หรือได้รับอนุมัติ Land เอง

## ข้อเท็จจริงและหลักฐาน

1. CLI และ project doctor ยืนยัน Foundation 3.5.14 / runtime API 33; doctor
   ไม่มี error มีคำเตือน no-direct-main เป็น opt-in ที่ปิดอยู่
   `claude-foundation changes` คืน No active changes จึงไม่มี packet ของงานนี้
2. `packages/app/src/app.tsx` มี home, new-session และ session routes รวมทั้ง
   layout เก่า/ใหม่ แต่ยังไม่พบ dedicated Foundation page ใน app source
3. `packages/opencode/src/plugin/foundation.ts` inject 8 commands ได้แก่
   investigate/change/build/prove/land/changes/feature/dev เมื่อ config อนุญาต
   โดย command.execute.before resolve canonical host instruction
4. `packages/app/src/components/prompt-input/submit.ts` ส่ง slash commands ผ่าน
   session command flow ทั้งใน draft และเส้นทางเดิม นี่เป็นจุดต่อยอด ไม่ใช่หลักฐาน
   ว่า Foundation commands ทำงานครบทุกเส้นทาง V2: ยังต้องพิสูจน์ command discovery,
   dispatch และ host instruction บน session path ที่หน้าใหม่ใช้จริง
5. `claude-foundation dashboard snapshot --json` ผ่านจาก Homebrew installation
   ได้ schemaVersion 3, sourceSchema foundation-runtime-v2, 12 archived changes,
   runs, phase counts, blocker codes, budgets, evidence, diagnostics และ generatedAt
6. snapshot แยก evidence.status, recordedStatus และ freshness จริง: หลายงานมี
   recordedStatus=pass แต่ status=unverified/freshness=unavailable; อีกงาน partial
   ห้ามรวมความหมายเหล่านี้เป็น badge สีเขียวเดียว หรือเปลี่ยน archived เป็น failed
7. projection ไม่มี task graph, full gate decisions, backlog หรือ session ID
   blockers ให้ code เท่านั้น ไม่ใช่คำอธิบายพร้อม owner/next action
   `phases` รวม archived ด้วย และ operationMs เป็นเวลาปฏิบัติการ ไม่ใช่ elapsed time
8. ทดลอง `bash packages/opencode/vendor/claude-foundation/payload/cli.sh dashboard
   snapshot --json` ได้ exit 1: dashboard client not found ที่ payload/dashboard/client.sh
   `script/sync-foundation.ts` ไม่มี dashboard ใน roots ที่คัดลอก
   ขณะที่ payload/cli.sh ต้องพบ dashboard/client.sh ก่อนเรียก dashboard/snapshot.mjs
   จึงห้ามออกแบบโดยสมมติว่า binary ปัจจุบันมี snapshot capability แล้ว
9. ทดลอง packet กับ archived change
   `make-bundled-foundation-lifecycle-commands-executable-without-a-` ได้
   FOUNDATION_WORKSPACE_MISSING เพราะ sandbox เก่าหายแล้ว ไม่ซ่อมหรือสร้าง sandbox
   ของงานเก่าเพื่อเปิด dashboard; หน้าประวัติต้องอ่านได้โดยไม่ต้องใช้ live packet
10. `packages/opencode/src/server/shared/ui.ts` ใช้ embedded UI ก่อน แล้ว fallback
    ไป app.opencode.ai เมื่อไม่มี embedded assets; การส่งมอบหน้าใหม่จึงต้องทดสอบ
    compiled binary ที่ embed app เวอร์ชันเดียวกับ API ด้วย
11. server ประกอบทั้ง instance API และ V2 Protocol/Server API ใน
    `packages/opencode/src/server/routes/instance/httpapi/server.ts` ส่วน runtime bridge
    อยู่ใน opencode plugin; ห้ามให้ Core/Server import ย้อนกลับเข้า opencode
12. หน้า session ใหม่ `packages/app/src/pages/new-session/new-session-view.tsx:42`
    แสดง WordmarkV2 จาก `packages/ui/src/v2/components/wordmark-v2.tsx`
    ส่วน session empty view เดิม `packages/app/src/components/session/session-new-view.tsx:56`
    แสดง Mark จาก `packages/ui/src/components/logo.tsx` ซึ่งเป็น OpenCode assets
    ต้องครอบคลุมทั้งสองเส้นทางที่ยังรองรับ ไม่เปลี่ยนเพียงหน้า home
13. แนวทางแบรนด์เดิมใน archived proposal
    `2026-08-15-redraw-the-cli-banner-as-a-pixel-wordmark-with-loop-icons-replac`
    เป็น pixel wordmark CHANGELOOP โดย O ทั้งสองใช้ circular-arrow loop icon
    และแยกน้ำหนัก CHANGE / LOOP; `packages/tui/src/logo.ts` เป็นจุดอ้างอิง glyph
    การค้น asset ครั้งนี้ยังไม่พบ SVG ของ Changeloop ที่ยืนยันว่าใช้ซ้ำได้โดยตรง

## ทางเลือก

| ทางเลือก | ประโยชน์ | ต้นทุน/ข้อจำกัด |
| --- | --- | --- |
| เพิ่มเพียง shortcuts ส่ง slash commands | งานเล็ก ใช้ session เดิม | ยังไม่มีภาพรวมสถานะ ไม่ตอบโจทย์ติดตาม Changes |
| หน้า Changes อ่าน projection และเปิด session ทำงานต่อ (แนะนำ) | เห็นสถานะจริง ใช้ execution/permission เดิม | ต้องเพิ่ม snapshot ใน bundle และ read API; รายละเอียดบางอย่างยังไม่มี contract |
| หน้า control plane สั่ง Build/Prove/Land โดยตรง | ควบคุมงานจากจุดเดียว | ต้องมี operation identity, duplicate protection, recovery, host execution และ authority UX ครบ |

ไม่จำเป็นต้องเพิ่ม team-presence server หรือฐานข้อมูล lifecycle ใหม่เพื่อทำหน้าอ่าน
สถานะระดับโปรเจกต์

## UX ที่เสนอ

Audience เริ่มจาก developer ที่เลือก server และโปรเจกต์แล้ว งานหลักคือรู้ว่า
change อยู่ขั้นไหน ติดอะไร หลักฐานมีสถานะอย่างไร และเปิดงานต่อได้ที่ไหน

- เพิ่มทางเข้า Changes จาก home/project navigation โดยรักษา session navigation เดิม
- หน้าเริ่ม session แสดง Changeloop wordmark/mark ตามแบรนด์ที่มีอยู่ใน CLI/TUI
  แนะนำทำเป็น vector สำหรับเว็บ รักษาสัดส่วนและความชัดใน light/dark และ mobile
  accessible name เป็น Changeloop เมื่อภาพสื่อชื่อผลิตภัณฑ์
- หน้า list มี active/archived filters, ค้นหา, lifecycle status, phase, evidence status,
  blocker count และเวลาข้อมูลล่าสุด แสดง empty state แยกจากโหลดไม่สำเร็จ
- หน้า detail มี Overview, Evidence และ Usage; แสดงเฉพาะข้อมูลที่ projection รองรับ
  เริ่มจาก ID เป็นชื่อ หากจะมีชื่ออ่านง่ายต้องกำหนดแหล่งข้อมูล canonical เพิ่ม
- บอกผลหลักฐานที่บันทึกไว้และความสดของหลักฐานแยกกัน; null usage แสดงว่าไม่มีข้อมูล
  ไม่ตีความเป็น 0; archived แสดงเป็นประวัติที่ส่งมอบแล้วโดยคงข้อจำกัด evidence
- ใช้ปุ่มเปิด session พร้อมร่างคำสั่งและ change ID ให้ผู้ใช้ตรวจแล้วส่ง
  ไม่ผูก change กับ session ด้วยการค้นชื่อแชตหรืออนุมานจาก transcript
  ถ้ายังไม่มี persisted association ให้สร้าง/เปิด draft ที่เลือกโปรเจกต์ถูกต้อง
- หากเพิ่มปุ่ม lifecycle ในอนาคต ให้แสดง next action ที่ harness อนุญาต
  การอยู่ phase prove ไม่เท่ากับมีสิทธิ์ Land; บอก owner/เงื่อนไขเมื่อกำลังรอ
- ยึด component และ tokens ปัจจุบัน; mobile ใช้ list/detail แทนตารางกว้าง
  มี keyboard focus, accessible labels และข้อความสถานะแทนการใช้สีเพียงอย่างเดียว
- loading, empty, missing initialization, unsupported runtime, disconnected server,
  stale snapshot, malformed data และ archived workspace missing เป็นคนละ UI state

ยังไม่ได้ตรวจ rendered UI หรือทำ visual/accessibility sign-off ในการสำรวจนี้

## ขอบเขตระบบที่เสนอ

1. Web app อ่าน typed API ของ server ที่ผู้ใช้เลือก; identity ของข้อมูลต้องรวม
   server + canonical project/location เพื่อไม่ปะปนข้อมูลหลายเครื่อง/หลายโปรเจกต์
2. Host adapter ใช้ Foundation runtime ตาม config bundled/path อย่างชัดเจน
   รันเฉพาะ read operation ที่กำหนดไว้ด้วย argv array, timeout และ output limit
   ไม่เปิด arbitrary shell/argv API และไม่ fallback ไป PATH เงียบ ๆ
3. Schema/Protocol เป็นเจ้าของ response contract; adapter implementation อยู่ฝั่ง
   host composition และ inject เข้าขอบเขตบริการที่เหมาะสมโดยไม่ย้อน dependency
   ชื่อ endpoint และตำแหน่ง interface ต้องสรุปใน Change หลังยืนยัน client path
4. อ่าน capability/status ก่อน snapshot; missing initialization ต้องไม่ init repo
   จาก GET และ unsupported version ต้องไม่ถูกตีความเป็นรายการงานว่าง
5. v1 แนะนำ refresh เมื่อเปิด/กลับมาที่หน้า พร้อม polling ทุก 10 วินาทีเฉพาะหน้า
   ที่มองเห็นและ manual refresh; coalesce request ต่อ project และคืน snapshot เดิม
   พร้อม stale marker เมื่อ refresh ล้มเหลว ไม่มีการใช้ข้อมูลเก่าตัดสินสิทธิ์ mutation
6. API ส่งเฉพาะ field ที่ UI ต้องใช้ ไม่ส่ง raw packet, arbitrary paths หรือ ownerEmail
   ที่ projection มีมาโดยไม่จำเป็น ใช้ authorization และ location routing เดิม
7. UI rollback ได้ด้วยการซ่อน entry/capability; read API เป็น additive ไม่เปลี่ยน
   session behavior และไม่มี schema migration สำหรับ lifecycle state ใหม่

## ลำดับงานที่เสนอสำหรับ Change

### A — ทำ read capability ให้ส่งมอบใน binary ได้

- ปิด bundle gap โดยเลือกไฟล์จาก tagged Foundation source ตาม
  docs/FOUNDATION_UPDATE_AGENT.md แล้ว regenerate manifest; ห้ามแก้ vendor bytes เอง
- ตรวจ dependency closure ของ snapshot และ cli dispatch ก่อนกำหนดไฟล์ที่จะ bundle
  การคัดลอก dashboard ทั้ง service โดยไม่จำเป็นไม่ใช่ข้อสรุปของ investigation นี้
- เพิ่ม typed read adapter/API พร้อม schema validation, project isolation และ errors
- regenerate Client เมื่อแก้ public HttpApi; ไม่เขียน generated files ด้วยมือ
- พิสูจน์ compiled binary อ่าน snapshot ได้เมื่อ PATH ไม่มี claude-foundation และ
  ข้อมูลจากโปรเจกต์ที่ยังไม่ init ไม่ถูกเขียนหรือซ่อมจาก read request

### B — หน้า Changes และรายละเอียดที่มีหลักฐานรองรับ

- ใช้ read contract จาก A ทำ list, filters, detail, refresh และ error states
- แยก archived/active และ recorded proof/freshness อย่างถูกต้อง
- ทดสอบ archived ที่ไม่มี sandbox, malformed entry, unknown schema, null usage,
  server switch ระหว่าง request, authorization และขนาดข้อมูลมาก
- ตรวจ mobile/desktop, keyboard, light/dark ตามที่แอปรองรับ และ embedded UI จริง
- เปลี่ยนโลโก้เริ่ม session ทั้ง V2 และ legacy เป็น Changeloop; ตรวจ caller ของ
  shared logo ก่อนเลือกเพิ่ม asset หรือแทน component เพื่อจำกัดการเปลี่ยนแปลง
  ตามขอบเขต session ไม่ขยายเป็น rebrand เว็บไซต์/console/desktop icons ทั้งหมด
- ตรวจภาพจริงว่าชื่อ Changeloop และ loop glyph อ่านได้ โลโก้ไม่ล้น/บัง composer
  และยังปรากฏถูกต้องเมื่อสร้าง session ผ่าน Changes รวมถึงเปิด new-session โดยตรง

### C — ทำงานต่อผ่าน session

- เพิ่ม draft command ที่ผูก server/project/change อย่างชัดเจน
- ตรวจ discovery และ dispatch ของ Foundation บน V2/legacy path ที่รองรับจริง
- คง permission/question flow และ user-owned command overrides
- refresh สถานะหลังกลับจาก session โดยไม่อ่านความสำเร็จจากข้อความของ model

### D — Direct lifecycle controls (ขอบเขตเพิ่มเติม)

หากเลือกทำ ต้องกำหนด durable operation/retry/cancel/reconnect, session association,
host execution response, authority และ stale-action validation ก่อนเริ่ม implementation
ห้ามเพิ่มปุ่มเรียก advance แล้วถือว่า exit 0 เท่ากับทำงานครบหรือส่งมอบแล้ว
Tasks/Gates/Decision Sheet/Backlog detail ต้องมี read contract ที่เหมาะสมก่อนสัญญา UX

## Unknowns และการตัดสินใจ

- ถามผู้ใช้แล้ว: รุ่นแรกเลือก A–C หรือรวม direct lifecycle controls แบบ D
  ยังรอคำตอบ ณ เวลาสร้างบันทึก; recommendation ไม่ใช่ user approval
- ผู้ใช้ยืนยันให้เปลี่ยนโลโก้ตอนเปิด session เป็นของ Changeloop แล้ว;
  ใช้แบรนด์ pixel/loop เดิมเป็นแนวทางเสนอ ไม่ถือว่าผู้ใช้อนุมัติ artwork ใหม่ที่ยังไม่เห็น
- ต้องพิสูจน์ snapshot จาก bundle ที่แก้แล้ว ไม่ใช้ผล Homebrew แทน compiled binary
- ต้องทดสอบ live building/proven/wait states ใน isolated fixtures ตอน Build/Prove;
  repo ปัจจุบันมีแต่ archived changes ไม่มี live packet ให้ตรวจ
- ต้องกำหนด read contract เพิ่มถ้าจะมี task/gate/decision details และ canonical
  next action; snapshot schema 3 เพียงอย่างเดียวไม่ให้ข้อมูลเหล่านี้ครบ
- รองรับ remote projects ผ่าน location routing ที่มีจริงเท่านั้น ไม่ขยายไป clustered
  session ownership หรือ autonomous background orchestration โดยอนุมาน

## Next action

หลังตกลงขอบเขต ใช้ `/change` เพื่อ compile implementation agreement จาก intent:
“เพิ่มหน้า ChangeLoop Changes ใน Web UI ด้วย bundled read projection, สถานะ evidence
ที่ไม่ปนกับ freshness และการเปิด session เพื่อทำงานต่อใน server/project ที่ถูกต้อง
พร้อมเปลี่ยนโลโก้หน้าเริ่ม session เป็น Changeloop”
อ้างอิง investigation นี้ ไม่เริ่ม Build หรือสร้าง change agreement ในขั้น investigate
