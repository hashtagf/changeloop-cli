# Design

## Current state

ตรวจกับโค้ดแล้ว (ดู `openspec/investigations/phase-1-1-model-router.md`):

- Model ต่อ message: `packages/opencode/src/session/prompt.ts:646`
  `input.model ?? agent.model ?? currentModel(sessionID)`; agentic loop
  อ่าน model จาก user message ที่ persist ไว้ซ้ำทุก step (`prompt.ts:1141`)
  Subagent สืบทอด model จาก assistant message ของ parent เว้นแต่ pin เอง
  (`packages/opencode/src/tool/task.ts:181-184`)
- v1 `config` plugin hook รันก่อนทุกอย่างที่บริโภค config
  (`packages/opencode/src/project/bootstrap.ts:37-38`) และแก้ field ใดก็ได้
  ส่วน `chat.params` ยิงหลัง SDK bind model instance แล้ว — เปลี่ยน model ไม่ได้
- Built-in v1 plugins ลงทะเบียนใน `internalPlugins()`
  (`packages/opencode/src/plugin/index.ts:66-84`) และเป็น engine module ปกติ —
  import engine internals ได้ (มี copilot/codex เป็น precedent)
- v1 config เป็น Effect Schema struct (`packages/core/src/v1/config/config.ts:32`);
  key ที่ไม่ประกาศจะไม่รอด decode ดังนั้นตาราง routing ต้องเป็น field ที่
  ประกาศจริง; field `plugin` ของ v1 รับ tuple `[specifier, options]` ได้ แต่
  built-in plugin ไม่ได้รับ options
- ช่อง small-model: `cfg.small_model` → hook
  `experimental.provider.small_model` → heuristic ราย provider
  (`provider.ts:1878-1945`)

## Decisions

- **Decision:** ship เป็น built-in v1 plugin: ไฟล์ใหม่
  `packages/opencode/src/plugin/router.ts` + import 1 บรรทัด/entry 1 บรรทัดใน
  `internalPlugins()`
  - **Why:** ผู้ใช้ตัดสินใจ (2026-08-15) — binary ที่ compile แล้วเป็นช่องทาง
    เดียวที่ไปถึงเครื่องผู้ใช้ตอนนี้; external plugin file ไปไม่ถึงจนกว่า npm
    scope จะออก (Phase 3) รอยแตะ fork ~3 บรรทัด additive ใน 2 ไฟล์ upstream
  - **Rejected:** external plugin file + ประกาศใน config — ไม่แตะ engine เลย
    แต่ถึงแค่ dogfood; v2 transform plugin — v2 ยัง dormant ใน path จริง
- **Decision:** ตาราง routing เป็น field `router` (optional) ใน v1 config
  schema (`packages/core/src/v1/config/router.ts` อ้างจาก `config.ts`)
  layered ผ่าน merge global→project ที่มีอยู่
  - **Why:** schema ตัด key ที่ไม่ประกาศทิ้ง field ที่ประกาศจึงได้ validation,
    jsonschema docs, และ merge semantics ฟรี
  - **Rejected:** plugin-options tuple (built-in ไม่ได้รับ options);
    ไฟล์แยก `.changeloop/router.json` (ข้าม config layering และ discovery)
- **Decision:** lever คือ v1 `config` hook เท่านั้น: เติม
  `cfg.agent[<name>].model` กับ `cfg.small_model`; ไม่แตะ `cfg.model`
  - **Why:** การ pin ราย agent ตอน boot ครอบ V1 loop แล้ว (task-type ==
    agent ตาม roadmap 1.2); fallback chain เดิมของ engine จัดการที่เหลือ
    การเว้น `cfg.model` คง default แบบ interactive ของผู้ใช้ไว้
  - **Rejected:** dynamic routing ผ่าน `chat.message` — ใช้ได้แต่มี edge เรื่อง
    sticky model / TUI header; เลื่อนเป็น escalation path ของ Router v2
- **Decision:** การ resolve tier เลือก candidate ตัวแรกที่ provider พร้อมใช้;
  พร้อมใช้ = มี auth record หรือ config ใน `cfg.provider` หรือ env var ของ
  API key (จาก metadata models.dev) ตั้งอยู่; ไม่มีตัวไหนพร้อม → log warning
  แล้วปล่อยช่องว่าง
  - **Why:** ผู้ใช้ตัดสินใจ (warn + fallback): ตารางผิดต้องไม่ทำให้ CLI
    ใช้ไม่ได้; การเช็คถูกและไม่มี side effect ตอน boot
  - **Rejected:** hard fail ตอน boot; validate รอบเต็มผ่าน catalog ตอน config
    (สถานะ provider ยังไม่ materialize ระหว่าง config hook)
- **Decision:** router เติมเฉพาะช่องที่ว่าง — `cfg.agent[<name>].model` หรือ
  `cfg.small_model` ที่ตั้งไว้ชัดเจนจาก layer ไหนก็ตามชนะ
  - **Why:** pin ตรงคือเจตนาที่เจาะจงกว่า; feature เป็น additive ถอดออกได้
  - **Rejected:** ให้ router ชนะ — จะเขียนทับ pin ที่ผู้ใช้ตั้งใจแบบเงียบ ๆ

## Config example and flow

ตัวอย่าง `changeloop.jsonc` (global หรือ per-project, project ชนะ; layer ตาม
config merge เดิม):

```jsonc
{
  "router": {
    // tier → รายการ candidate เรียงลำดับ (ตัวแรกที่ "พร้อมใช้" ชนะ)
    "tiers": {
      "fast":     ["anthropic/claude-haiku-4-5", "google/gemini-2.5-flash"],
      "standard": ["anthropic/claude-sonnet-4-5", "openai/gpt-5"],
      "deep":     ["anthropic/claude-opus-4-1"]
    },
    // ชื่อ agent → tier หรือ "provider/model" ตรง ๆ ก็ได้
    "agents": {
      "plan":    "deep",
      "build":   "standard",
      "review":  "deep",
      "test":    "fast",
      "explore": "fast",
      "debug":   "openai/gpt-5"
    },
    // ช่อง small model (title generation ฯลฯ)
    "small_model": "fast"
  }
}
```

จุดที่ router เสียบเข้า boot flow:

```text
                    boot
                     │
     ┌───────────────▼────────────────┐
     │ Config merge                   │
     │ global → project               │
     │ opencode.* → changeloop.*      │   ← ตาราง router มาจากชั้นไหนก็ได้
     └───────────────┬────────────────┘
                     │ config hook (รันก่อนทุกอย่าง)
     ┌───────────────▼────────────────┐
     │ Router plugin (built-in)       │
     │ ต่อ rule: agent → tier         │
     └───────────────┬────────────────┘
                     │ ไล่ candidate ของ tier ตามลำดับ
                     │ พร้อมใช้? = auth record │ cfg.provider │ env API key
          ┌──────────┴──────────┐
     เจอ candidate          ไม่เจอสักตัว
          │                      │
   ช่องยังว่าง?             warn + ปล่อยว่าง
    ├ ใช่ → pin                  │
    └ ไม่ → คง pin ผู้ใช้        │
          └──────────┬──────────┘
     ┌───────────────▼────────────────┐
     │ Engine เดิม (ไม่แตะ):          │
     │ input.model ?? agent.model     │
     │            ?? currentModel     │
     └───────────────┬────────────────┘
                     ▼
        subagent สืบทอด model จาก parent
        เว้นแต่ agent นั้น pin เอง (task.ts)
```

ตัวอย่างผลจริง: สั่ง `/plan` → agent `plan` ถูก pin
`anthropic/claude-opus-4-1`; ถ้าเครื่องนั้น auth แค่ OpenAI → tier `deep`
resolve ไม่ได้ → warn แล้ว plan ใช้ model ปกติของ session แทน

### ใครรู้ว่าเป็นงานอะไร และ model สลับตอนไหน

V1 ไม่ได้เดา task type จากเนื้องาน — **ตัวบอก task type คือ agent ที่กำลัง
ทำงาน** router แค่ผูก agent → model ล่วงหน้า แล้ว model สลับเองทุกครั้งที่
ข้าม agent boundary ด้วยกลไก engine เดิม:

- ผู้ใช้เลือก agent เอง (`/plan`, สลับใน TUI) หรือ **agent หลักตัดสินใจ
  spawn subagent** ตามงานที่เห็น (`explore`, `test`, …) — การเลือก subagent
  ของ LLM คือตัว classify task ใน V1; ชุด workflow agents ครบมากับ
  roadmap 1.2
- Engine เลือกให้เองในงานพื้นหลัง: title ใช้ช่อง small-model, compaction
  ใช้ model ของ agent `compaction` ถ้า pin ไว้

จุดสลับ model ตอน runtime:

```text
ผู้ใช้พิมพ์งาน
 │  ▶ turn เริ่ม: resolve ครั้งเดียวต่อ message
 │    input.model (ผู้ใช้เลือกใน TUI — ชนะทุกอย่าง)
 │    ?? agent.model (← pin ของ router)
 │    ?? currentModel (sticky ของ session)
 │
 ├─ ตั้งชื่อ session ─────────▶ สลับไป small_model (tier fast)
 │
 ├─ agent หลัก (build) ───────▶ ใช้ model ที่ router pin ให้ build
 │    ├─ spawn subagent explore ─▶ สลับไป model ของ explore  ← จุดสลับหลัก
 │    └─ spawn subagent test ────▶ สลับไป model ของ test
 │          (subagent ไม่มี pin = สืบทอด model ของ parent)
 │
 ├─ context ล้น → compaction ─▶ model ของ agent compaction (ถ้า pin)
 │
 └─ ผู้ใช้สลับเป็น /review ───▶ message ถัดไป resolve ใหม่ = model ของ review
```

กติกาสรุป: model สลับเมื่อ (1) เปลี่ยน agent — โดยผู้ใช้หรือโดยการ spawn
subagent, (2) เข้า slot งานพื้นหลัง (title/compaction), (3) ผู้ใช้ override
ใน TUI; ภายใน turn เดียวของ agent เดียว model ไม่สลับกลางคัน การอ่านเนื้อ
prompt เพื่อจัด tier, สลับตาม cost/latency แบบ live, และ failover กลาง turn
เป็นของ Router v2 (lever `chat.message`) ตาม non-goals

## Compatibility and migration

- เป็น config field ใหม่แบบ optional; config ที่ไม่มี `router` ให้ผลลัพธ์
  เหมือนเดิมทุกไบต์ ไม่มีการเปลี่ยน persisted data
- ไฟล์ config เดียวกันถูก decode โดย v2 loader/migrator ด้วย
  (`packages/core/src/v1/config/migrate.ts`); เอกสารที่มี `router` ต้องยัง
  migrate/boot ผ่าน (คุมด้วย claim `router-config-compat`) — ตั้งใจไม่ map
  field นี้เข้า v2 config
- Rollback: ถอด field/การลงทะเบียน plugin ออก; ไม่มี state ต้องล้าง
- Upstream sync: 2 ไฟล์ upstream โดน diff เล็กแบบ additive; บันทึกเทียบ
  นโยบาย branding-allowlist ใน `docs/sync/UPSTREAM.md` ตอน Land ถ้านโยบาย
  กำหนดให้ระบุ

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| config ที่มี `router` ทำ v2 loader หรือ v1→v2 migration พัง | test decode/migrate เฉพาะทาง (claim `router-config-compat`) | test |
| router เขียนทับ pin ที่ผู้ใช้ตั้งเอง | กติกา precedence + test (claim `router-precedence`) | test |
| ตารางผิดทำ boot พัง | resolve แบบ warn-and-skip + test (claim `router-fallback`) | test |
| upstream churn ใน `plugin/index.ts` ดัน merge cost | diff additive 2 บรรทัด; logic ใหม่แยกอยู่ในไฟล์ใหม่ `router.ts` | review |
