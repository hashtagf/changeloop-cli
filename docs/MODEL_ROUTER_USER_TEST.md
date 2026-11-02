# คู่มือทดสอบ Auto Model Routing แบบใช้งานจริง

คู่มือนี้ใช้สำหรับทดสอบ Model Router v1 ผ่าน Changeloop CLI โดยไม่ต้องรันชุด
unit test ภายใน repository

> Model Router v1 เลือกโมเดลตาม `agent → tier` ตอนเปิดโปรแกรม และเลือก
> candidate ตัวแรกที่ provider พร้อมใช้งาน ยังไม่ได้วิเคราะห์ prompt เพื่อเลือก
> โมเดลใหม่ในแต่ละข้อความ

## 1. ตรวจ provider, model และ agent ที่พร้อมใช้งาน

```sh
changeloop auth list
changeloop models
changeloop agent list
```

เลือก provider ที่ login แล้วหนึ่งตัว และคัดลอกชื่อโมเดลจริงจากผลลัพธ์ของ
`changeloop models` เช่น:

```text
anthropic/claude-haiku-4-5
```

หากยังไม่ได้ login ให้รัน:

```sh
changeloop auth login
```

## 2. ตั้งค่า Router

เพิ่ม `router` ใน `changeloop.jsonc` ที่ root ของโปรเจกต์ โดย merge เข้ากับ
config เดิมและไม่ลบ setting อื่น:

```jsonc
{
  "router": {
    "tiers": {
      "smoke": [
        "provider-that-is-not-configured/never-used",
        "anthropic/claude-haiku-4-5"
      ]
    },
    "agents": {
      "plan": "smoke"
    }
  }
}
```

เปลี่ยน `anthropic/claude-haiku-4-5` เป็นโมเดลที่มีอยู่จริงในเครื่อง

ตัวอย่างนี้ตั้งใจให้ candidate แรกใช้ไม่ได้ เพื่อทดสอบว่า router ข้ามไปใช้
candidate ที่สองได้

## 3. ตรวจผลหลัง Routing

Router ทำงานครั้งเดียวตอน boot หลังแก้ config ให้ปิด Changeloop process เดิม
แล้วเปิดใหม่ จากนั้นรัน:

```sh
changeloop debug config
```

มองหาค่าประมาณนี้:

```json
{
  "agent": {
    "plan": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

ถ้ามี `jq` สามารถดูเฉพาะค่าที่ต้องการได้:

```sh
changeloop debug config | jq -r '.agent.plan.model'
```

ผลที่คาดหวัง:

```text
anthropic/claude-haiku-4-5
```

## 4. ส่งคำขอจริง

```sh
changeloop run --agent plan "ตอบเพียงคำว่า ROUTER_OK"
```

ตรวจสอบว่า:

- ได้คำตอบ `ROUTER_OK`
- ไม่มี error ว่า model หรือ provider ใช้งานไม่ได้
- บรรทัดสรุปท้าย turn แสดง agent และโมเดลที่ router เลือก เช่น
  `▣ Plan · Claude Haiku 4.5 · 2s`

อย่าใส่ `--model` ระหว่างทดสอบ เพราะจะเป็นการเลือกโมเดลโดยตรงแทนการทดสอบ
router

## 5. ทดสอบว่า User Pin ชนะ Router

เลือกโมเดลจริงอีกตัวหนึ่งแล้วเพิ่ม `agent.plan.model` โดยตรง:

```jsonc
{
  "agent": {
    "plan": {
      "model": "anthropic/ANOTHER_VALID_MODEL"
    }
  },
  "router": {
    "tiers": {
      "smoke": ["anthropic/claude-haiku-4-5"]
    },
    "agents": {
      "plan": "smoke"
    }
  }
}
```

ปิดแล้วเปิด Changeloop ใหม่ จากนั้นรัน:

```sh
changeloop debug config
changeloop run --agent plan "ตอบเพียงคำว่า PIN_OK"
```

ผลที่คาดหวัง: `plan` ใช้ `anthropic/ANOTHER_VALID_MODEL` เพราะ model ที่ผู้ใช้
pin เองต้องชนะ router

## 6. ทดสอบ Fallback เมื่อไม่มี Provider

เอา `agent.plan.model` ออก แล้วตั้ง candidate ที่ไม่มี provider พร้อมใช้งาน:

```jsonc
{
  "router": {
    "tiers": {
      "smoke": ["provider-that-is-not-configured/never-used"]
    },
    "agents": {
      "plan": "smoke"
    }
  }
}
```

หลังเปิด Changeloop ใหม่ ให้รัน:

```sh
changeloop debug config
```

ผลที่คาดหวัง:

- เห็น warning ขึ้นต้นด้วย `[changeloop-router]`
- โปรแกรมไม่ crash
- `plan` ไม่ถูก pin ด้วยค่าจาก router
- ระบบกลับไปใช้ default model chain เดิม

## เกณฑ์ผ่าน

- Candidate แรกไม่พร้อมแล้วเลือก candidate ถัดไปได้
- `changeloop run --agent plan` เรียกโมเดลที่เลือกได้จริง
- Model ที่ผู้ใช้ pin เองไม่ถูก router เขียนทับ
- ไม่มี candidate พร้อมแล้วเกิด warning แต่โปรแกรมยังทำงานต่อได้
- ทุกครั้งที่แก้ `router` ต้องเริ่ม Changeloop process ใหม่ก่อนตรวจผล

## คืนค่า Config หลังทดสอบ

นำ `router` และ `agent.plan.model` ที่เพิ่มเพื่อทดสอบออกจาก
`changeloop.jsonc` แล้วเริ่ม Changeloop process ใหม่อีกครั้ง
