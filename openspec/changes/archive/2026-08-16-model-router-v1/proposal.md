# Change: model-router-v1

## Why

Phase 1.1 ตาม roadmap: V1 proof loop ของ changeloop ต้องให้ CLI เลือก model
ต่างกันตามขั้นตอนงานได้ โดยผู้ใช้ไม่ต้องมานั่ง pin model ให้ทุก agent เอง
ทุกวันนี้การเลือก model คือ `input.model ?? agent.model ?? currentModel(session)`
โดยไม่มีชั้น rule ใด ๆ ผลสำรวจ
(`openspec/investigations/phase-1-1-model-router.md`) ยืนยันว่า lever ที่ใช้ได้
จริงคือ v1 `config` plugin hook ตอน boot — ไม่ใช่ `chat.params` (เปลี่ยน model
ไม่ได้) และไม่ใช่ v2 catalog (ยัง dormant ใน path จริง)

## What changes

- config ของ changeloop/opencode รู้จัก section `router` (tier → รายการ
  candidate `provider/model` เรียงลำดับ; ชื่อ agent → tier หรือ model ตรง ๆ;
  `small_model` tier เป็น optional) ใน v1 config schema
- built-in v1 plugin (ลงทะเบียนใน `internalPlugins`) apply ตารางตอน boot ผ่าน
  `config` hook: เติม `cfg.agent[<name>].model` และ `cfg.small_model` จาก
  candidate ตัวแรกของ tier ที่ *available*
- ความ available = provider มี auth record, ถูก config ไว้ใน `cfg.provider`,
  หรือมี env var ของ API key ตั้งอยู่ — rule ที่ resolve ไม่ได้จะ log คำเตือน
  แล้วปล่อยช่องว่างไว้ให้ fallback chain เดิมทำงาน (ผู้ใช้ตัดสินใจ: warn +
  fallback ห้าม boot ล้ม)
- pin ที่ผู้ใช้ตั้งเองชนะเสมอ: router ไม่เขียนทับ `cfg.agent[<name>].model`
  หรือ `cfg.small_model` ที่มีค่าอยู่แล้ว
- `docs/CONFIGURATION.md` อธิบายรูปแบบตารางและ semantics

## Impact

- **Impact:** medium — เปลี่ยน model ที่ turn จริงใช้ แต่เฉพาะเมื่อ config มี
  ตาราง `router` เท่านั้น; ไม่มีตาราง = พฤติกรรมเดิมทุกประการ
- **Coupling:** coupled — คร่อม v1 config schema ที่ใช้ร่วมกัน
  (`packages/core/src/v1/config`) กับ plugin list ของ engine
  (`packages/opencode/src/plugin`); config file เดียวกันถูกอ่านโดย loader ทั้ง
  สองรุ่น
- **Affected surfaces:** code (config schema, built-in plugin), config
  contract (field `router`), docs
- **Security triggers:** none — เป็น local trusted config ล้วน; ไม่มี input
  ภายนอก, sink, หรือ credential ใหม่

## Non-goals

- Dynamic per-message routing (lever `chat.message`) — บันทึกเป็น escalation
  path เลื่อนไป Router v2 (Phase 2)
- การให้คะแนนตาม cost/latency, fallback chain กลาง session, budget — Phase 2
- v2 catalog/agent transform — กลับมาทำเมื่อ v2 กลายเป็น live selection path
- ตัว workflow agents (understand/plan/code/…) — เป็น roadmap item 1.2;
  change นี้ route ชื่อ agent ใดก็ได้ที่อยู่ใน config
