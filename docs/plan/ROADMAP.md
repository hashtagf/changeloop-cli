# Changeloop CLI — Priority Roadmap

อ้างอิง: `CHANGELOOP.PRD.md` + ผล survey codebase (OpenCode monorepo, 2026-08)

หลักการจัดลำดับ:

1. **อย่า rebuild สิ่งที่ upstream มีแล้ว** — plugin system, skills, commands,
   agents/subagents, MCP, context engine, session ครบอยู่แล้ว
2. **แตะ fork internals ให้น้อยที่สุด** — OpenCode กำลัง rewrite v1→v2
   (`packages/opencode` → `packages/core`+`packages/llm`) ยิ่ง fork ลึก
   ยิ่ง merge upstream แพง สิ่งใดทำเป็น plugin ได้ให้ทำเป็น plugin
3. **V1 พิสูจน์ loop เดียว:** `Task → Context → เลือก Model → Skill/Plugin →
   Execute → Verify` — งานที่ไม่อยู่ใน loop นี้เลื่อนออกทั้งหมด

---

## Phase 0 — Foundation ✅ (จบ 2026-08-15)

| # | งาน | ทำไมก่อน | Effort |
|---|------|----------|--------|
| 0.1 | **Thin rebrand** — bin `changeloop`, config dir + `changeloop.json` (อ่าน fallback `opencode.json` / `OPENCODE_*` ได้), `const app` ใน `packages/core/src/global.ts`, env alias ใน `flag/flag.ts` | ทุกอย่างที่เหลือ ship ภายใต้ชื่อนี้ | S–M |
| 0.2 | **Upstream sync strategy** — branch layout (`upstream/main` → `dev`), merge cadence, กติกา "แก้ core ได้เฉพาะไฟล์ branding" | กำหนดต้นทุน maintenance ตลอดชีวิต fork | S |
| 0.3 | **Plugin scaffold + CI** — template plugin (v2 draft-transform API), build/test pipeline | Phase 1 ทั้งหมด ship เป็น plugin | S |

**อย่าทำตอนนี้:** เปลี่ยน npm scope `@opencode-ai/*` (~30 packages) และ
service tags `@opencode/v2/*` — mechanical แต่ทำให้ merge upstream พังทุกครั้ง
เลื่อนไปจน fork นิ่ง

**Exit:** `changeloop` binary รันได้, plugin ตัวอย่าง load ได้, merge upstream
หนึ่งรอบผ่าน

## Phase 1 — V1 Proof Loop (P0 จริง)

ลำดับตาม dependency:

| # | งาน | รายละเอียด | Effort |
|---|------|-----------|--------|
| 1.1 | ✅ **Model Router (plugin)** — land 2026-08-16 | ส่งจริงเป็น built-in v1 plugin + config field `router` (tiers/agents/small_model) ปัก model ตอน boot; warn+fallback เมื่อ provider ไม่พร้อม; pin ผู้ใช้ชนะเสมอ **หมายเหตุจากการ investigate: insertion point เดิมที่วางไว้ผิดทั้งคู่** — `chat.params` เปลี่ยน model ไม่ได้ และ v2 catalog transform ยัง dormant ใน live path; lever จริงคือ v1 `config` hook (boot) ส่วน `chat.message` เก็บไว้เป็น lever ของ Router v2 (สเปกอยู่ที่ `openspec/specs/model-router/`, ทดลองได้ที่ `~/Desktop/Work/changeloop-lab`) | ~~M~~ done |
| 1.2 | **Workflow agents + commands** | `understand / plan / code / test / review / debug` เป็น markdown agents + `command/*.md` แต่ละตัว pin model ผ่าน router — งาน authoring ไม่ใช่งาน engine | M |
| 1.3 | **Verify step** | ครึ่งที่หายของ loop: review agent + pass/fail receipt (ไฟล์ JSON ต่อ task) — พอสำหรับ V1 ไม่ต้องมี eval system | S–M |
| 1.4 | **OpsX plugin skeleton** | Hook เดียว end-to-end (แนะนำ GitHub) เพื่อพิสูจน์ boundary Core↔OpsX; RBAC/Audit ยังไม่ทำ (upstream ไม่มีให้ต่อยอด ต้อง build เองทั้งหมด — ยังไม่คุ้มใน V1) | M |

**Exit (นิยาม V1 สำเร็จ):** สั่งงานจริง 1 งาน เช่น "implement endpoint + test"
แล้ว loop วิ่งครบ — router เลือก model ต่างกันตาม step, verify ออก receipt,
OpsX เปิด PR ได้ — โดยไม่แก้ engine code นอกไฟล์ branding

## Phase 2 — Deepen (P1, เริ่มหลัง V1 exit เท่านั้น)

เรียงตามผลตอบแทน:

1. **Router v2 = "auto mode" ตัวจริง** — อ่านงานแล้วเลือก model เองราย
   message ผ่าน lever `chat.message` (investigation 1.1 ยืนยันแล้วว่าแก้
   `output.message.model` ก่อน persist ได้; ระวัง edge: session-sticky ที่
   `prompt.ts:679` และ TUI header), cost/latency-aware, fallback chain กลาง
   session เมื่อเจอ error อย่าง 402 (token/cost tracking ต่อ turn มีอยู่แล้ว
   แค่เอามาใช้ตัดสินใจ) — V1 ตั้งใจไม่ทำตาม non-goals ของ change
   model-router-v1
2. **Context/Knowledge เสริม** — ต่อยอด `reference` system (named dirs/repos)
   ก่อนทำ RAG จริง; cross-session memory ยังไม่มี upstream
3. **RAG** — greenfield ทั้งก้อน (upstream ไม่มี embeddings/vector store);
   เริ่มเมื่อ workflow ใช้งานจริงแล้วเจอ limit ของ ripgrep+LSP
4. **Multi-agent ขยาย** — subagent + background task มีแล้ว; เพิ่มแค่ pattern
   ที่ workflow ต้องใช้ ยังไม่ต้องมี DAG engine

## Phase 3 — Scale (P2, ยังไม่ commit วันเวลา)

- **DAG/Workflow engine** — ทำเมื่อ Phase 2 พิสูจน์ว่า flat chaining ไม่พอ
- **Dashboard** — เริ่มจาก local per-session view (token/cost/trace มี data
  อยู่แล้วผ่าน OTLP + SQLite); `packages/stats` ของ upstream ใช้ไม่ได้
  (เป็น community aggregate)
- **Evaluation + Improvement Loop** — greenfield; ต้องมี trace/receipt สะสม
  จาก Phase 1–2 ก่อนถึงมีข้อมูลให้ eval
- **Multiplayer** — `packages/enterprise` เป็นแค่ session-share app;
  งานจริงใหญ่มาก ทำท้ายสุด
- **Full rebrand** — npm scope + service tags เมื่อ fork นิ่ง

## บันทึกความคืบหน้า

- **2026-08-15** Phase 0 จบ: rebrand (0.1), sync policy (0.2), plugin
  scaffold (0.3) — spec ครบใน `openspec/specs/`
- **2026-08-16** 1.1 Model Router land + ส่งถึงเครื่อง (binary
  `0.0.0-dev-202608161312`); เทสใน changeloop-lab ผ่าน 6/6 + live smoke
  ยืนยัน haiku ตาม tier และ small-model slot ถูก route จริง
- **งานแทรกค้าง:** บั๊ก harness ของ claude-foundation 6 จุดที่เจอระหว่าง
  prove/land (การ์ด receipt 3 มุม, `uniqueItems` ใน REVIEW_SCHEMA, ไม่มีทาง
  reset โควต้า infra-retry, `sandbox apply --refresh` ไม่มี CLI) — hotfix
  เฉพาะ copy ที่ติดตั้งใน repo นี้แล้ว (commit `54af4f8`) ต้องแก้จริง+เทส
  ที่ upstream ก่อน install รอบหน้าจะทับ
- **ถัดไป:** 1.2 Workflow agents (ยิ่งมี agent ครบ ตาราง router ยิ่งครอบ
  งานกว้าง) → 1.3 Verify → 1.4 OpsX

## สรุป dependency

```text
0.1 rebrand ──┐
0.2 sync ─────┼─→ 1.1 router ─→ 1.2 workflow ─→ 1.3 verify ─→ V1 EXIT
0.3 scaffold ─┘        └────────→ 1.4 opsx ────────┘
                                        │
                    Phase 2 (router v2, knowledge, RAG, multi-agent)
                                        │
                    Phase 3 (DAG, dashboard, eval, multiplayer)
```

## ความเสี่ยงหลัก

| ความเสี่ยง | ผลกระทบ | ทางกัน |
|---|---|---|
| Upstream v1→v2 rewrite ยังไม่จบ | plugin API (v2 draft-transform) อาจขยับ | ปักที่ v2 API, ตาม release notes ทุก sync (0.2) |
| Fork ลึกเกินไป | merge cost โตไม่หยุด | กติกา "plugin-first" + review ทุก diff ที่แตะ `packages/core` |
| OpsX scope บวม (RBAC/Audit/Knowledge) | ลาก V1 ยาว | V1 = GitHub hook เดียว ที่เหลือ backlog |
