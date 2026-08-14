สรุปงาน **Changeloop CLI** ที่เราวางไว้ตอนนี้ ผมมองโครงสร้างประมาณนี้

### Changeloop CLI = AI Operation Harness

```text
Developer / Team
      │
      ▼
┌─────────────────────────────┐
│       Changeloop CLI        │
│      (OpenCode Fork)        │
├─────────────────────────────┤
│ Agent Runtime               │
│ Context / Session           │
│ Model Router                │
│ Skills                      │
│ Plugin System               │
│ Multi-Agent / DAG           │
│ Observability               │
└──────────────┬──────────────┘
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
    Models   Plugins   Knowledge
 Claude     OpsX       RAG
 GPT        MCP        Project
 Gemini     GitHub     Company
 Local      Grafana    Memory
 LLM        etc.
```

### งานหลักที่ต้องพัฒนา

| Module                   | สิ่งที่จะทำ                                               | Priority |
| ------------------------ | --------------------------------------------------------- | -------- |
| **1. OpenCode Fork**     | ใช้ OpenCode เป็นฐาน CLI + Agent Runtime                  | P0       |
| **2. Changeloop Core**   | Branding, config, project/session management              | P0       |
| **3. Model Router**      | Auto-select model ตาม task / cost / quality / latency     | P0       |
| **4. Built-in Skills**   | Coding workflow เช่น plan, implement, review, test, debug | P0       |
| **5. Plugin System**     | ให้ MCP / Tool / Knowledge / Skill ต่อเข้ามาได้           | P0       |
| **6. OpsX Plugin**       | OpsX เป็น plugin ไม่ฝังเข้า Core                          | P0       |
| **7. Context Engine**    | project context + knowledge + Single Source of Truth      | P1       |
| **8. RAG**               | Search code/docs/knowledge หลาย project                   | P1       |
| **9. Multi-Agent**       | Agent หลายตัวทำงานร่วมกัน                                 | P1       |
| **10. DAG / Workflow**   | กำหนด dependency และลำดับงาน agent                        | P1       |
| **11. Multiplayer**      | คนหลายคน + agent หลายตัวทำงาน workspace เดียวกัน          | P2       |
| **12. Dashboard**        | ดู session, agent, model, token, cost, task, trace        | P2       |
| **13. Evaluation**       | วัดว่า agent ทำงานดีขึ้นหรือแย่ลง                         | P2       |
| **14. Improvement Loop** | Trace → Eval → Feedback → Improve                         | P2       |

### Plugin Architecture

เราเคยตกลงว่า **Core ต้องไม่ผูกกับ OpsX**

```text
Changeloop Core
     │
     ├── Model Plugin
     ├── MCP Plugin
     ├── Tool Plugin
     ├── Knowledge Plugin
     ├── Skill Plugin
     ├── Hook Plugin
     └── UI Plugin
              │
              ▼
          OpsX Plugin
```

ดังนั้น OpsX จะรับผิดชอบฝั่ง Enterprise เช่น GitHub, Grafana, Knowledge/RAG, Feedback, RBAC, Audit และ MCP tools ส่วน Changeloop เป็นตัว orchestrate การทำงานของ AI

### Built-in workflow ที่ CLI ควรได้

```text
changeloop
   │
   ├── understand
   ├── plan
   ├── code
   ├── test
   ├── review
   ├── debug
   ├── research
   └── improve
```

ตัว Agent เลือกเองว่าแต่ละขั้นควรใช้ **model + skill + plugin + context** อะไร

เช่น

```text
Task: Implement Payment API

Understand → Gemini Flash
     ↓
Plan → Claude Sonnet
     ↓
Code → Claude / GPT
     ↓
Test → Local/Cheap Model
     ↓
Review → Strong Model
     ↓
OpsX → GitHub + Logs + Knowledge
     ↓
Evaluation
     ↓
Improvement Loop
```

### เป้าหมาย V1

ผมแนะนำให้ตัด Multiplayer / Dashboard ใหญ่ / Advanced DAG ออกจาก V1 ก่อน

**V1 ต้องพิสูจน์สิ่งเดียว:**

> `Task → Context → เลือก Model → ใช้ Skill/Plugin → Execute → Verify`

ถ้า flow นี้แข็งแรง Changeloop จะไม่ใช่แค่ OpenCode fork แต่เริ่มเป็น **AI Operation Harness** จริง

และทั้งหมดสอดคล้องกับ Foundation ที่เรากำหนดไว้:

**Vision:** *To become the global operating harness for AI.*

**Principles:** Everything Can Improve / In the Loop / Model Agnostic / Single Source of Truth.
