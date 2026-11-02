# Design

## Work type

api

## สถาปัตยกรรม

| ขอบเขต | รูปแบบ | เหตุผล | Timeout/การลองใหม่ | ความสอดคล้อง | เจ้าของ |
|---|---|---|---|---|---|
| server handler → Foundation.Service | sync | อ่าน snapshot ของโปรเจกต์ตอนรับ request | ตาม implement ของเฟสถัดไป; standalone ตอบทันที; ลองใหม่: none | strong | foundation-runtime |

## สัญญา API

### GET /experimental/foundation/capability

| ส่วน | สัญญา |
|---|---|
| การยืนยันสิทธิ์ | เหมือน route อื่นของ server (authorization middleware) |
| Request | location: directory ทางเลือก |
| Response | available: boolean, code: string\|null, runtime: object\|null |

### GET /experimental/foundation/changes

| ส่วน | สัญญา |
|---|---|
| การยืนยันสิทธิ์ | เหมือน route อื่นของ server (authorization middleware) |
| Request | scope: active\|archive, search: string, offset: string, limit: string |
| Response | generatedAt: string, items: Change[], total: number, nextOffset: number\|null, diagnostics: string[] |

**Error:**

| Status | Code | เมื่อ | ลองใหม่ได้ |
|---|---|---|---|
| 400 | — | offset หรือ limit หรือ scope หรือ search ไม่ถูกต้อง | — |
| 503 | — | ไม่มี runtime (unsupported) | — |

### GET /experimental/foundation/changes/:changeID

| ส่วน | สัญญา |
|---|---|
| การยืนยันสิทธิ์ | เหมือน route อื่นของ server (authorization middleware) |
| Request | changeID: string |
| Response | id: string, status: string, phase: string |

**Error:**

| Status | Code | เมื่อ | ลองใหม่ได้ |
|---|---|---|---|
| 400 | — | changeID ผิดรูปแบบ | — |
| 404 | — | ไม่พบ change | — |
| 503 | — | ไม่มี runtime (unsupported) | — |

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| ตอบ 503 พร้อม error data code unsupported | ตอบ 503 พร้อม error data code unsupported | No separate step; the outcome is the handling | endpoint-experimental-foundation |
| ตอบ 400 พร้อม error data code invalid_input โดยไม่เรียก | ตอบ 400 พร้อม error data code invalid_input โดยไม่เรียก Foundation.Service.read | No separate step; the outcome is the handling | endpoint-experimental-foundation |
| GET /experimental/foundation/changes/:changeID ด้วย id | ตอบ 400 พร้อม error data code invalid_input | No separate step; the outcome is the handling | endpoint-experimental-foundation |
| GET /experimental/foundation/changes/x/documents บน | ตอบ 503 พร้อม error data code unsupported | No separate step; the outcome is the handling | endpoint-experimental-foundation |
| เรียก prepare ของ standalone CommandPreparation โดยไม่มี | ล้มด้วย CommandPreparation.Error code command_not_found | No separate step; the outcome is the handling | passthrough-standalone-server |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `packages/schema/src/foundation.ts` (add), `packages/schema/src/index.ts`, `packages/core/src/foundation.ts` (add), `packages/core/src/foundation-documents.ts` (add), `packages/core/src/command-preparation.ts` (add), `packages/core/test/foundation.test.ts` (add) |
| T002 | `packages/protocol/src/groups/foundation.ts` (add), `packages/protocol/src/api.ts`, `packages/protocol/src/client.ts`, `packages/server/src/handlers/foundation.ts` (add), `packages/server/src/handlers/command.ts`, `packages/server/src/handlers.ts`, `packages/server/src/routes.ts`, `packages/server/test/foundation.test.ts` (add) |
| T003 | `packages/client/test/foundation.test.ts` (add), `packages/client/src/promise/generated`, `packages/client/src/effect/generated`, `packages/client/src/effect/api`, `packages/client/script/generate.ts` |

`+` add · `~` change · `-` remove

```text
.
└── packages/
    ├── client/
    │   ├── script/
    │   │   └── ~ generate.ts
    │   ├── src/
    │   │   ├── effect/
    │   │   │   ├── ~ api
    │   │   │   └── ~ generated
    │   │   └── promise/
    │   │       └── ~ generated
    │   └── test/
    │       └── + foundation.test.ts
    ├── core/
    │   ├── src/
    │   │   ├── + command-preparation.ts
    │   │   ├── + foundation-documents.ts
    │   │   └── + foundation.ts
    │   └── test/
    │       └── + foundation.test.ts
    ├── protocol/
    │   └── src/
    │       ├── ~ api.ts
    │       ├── ~ client.ts
    │       └── groups/
    │           └── + foundation.ts
    ├── schema/
    │   └── src/
    │       ├── + foundation.ts
    │       └── ~ index.ts
    └── server/
        ├── src/
        │   ├── ~ handlers.ts
        │   ├── handlers/
        │   │   ├── ~ command.ts
        │   │   └── + foundation.ts
        │   └── ~ routes.ts
        └── test/
            └── + foundation.test.ts
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| เรียก Foundation.selection ด้วย offset; เรียก Foundation.identifier ด้วย id ที่มี path separator; เรียก Foundation.project กับ envelope ที่ schemaVersion; เรียก Foundation.project กับ envelope ที่มี change ซ้ำ, row | task check | `bun test --cwd packages/core test/foundation.test.ts` | T001 |
| ตอบ 200 โดย available เป็น false และ code เป็น unsupported; ตอบ 503 พร้อม error data code unsupported; ตอบ 400 พร้อม error data code invalid_input โดยไม่เรียก; GET /experimental/foundation/changes/:changeID ด้วย id; GET /experimental/foundation/changes/x/documents บน; คืนรายการ command ที่ Command ค้นพบโดยไม่เพิ่มหรือตัดรายการ; เรียก prepare ของ standalone CommandPreparation โดยไม่มี; เรียก prepare ของ standalone CommandPreparation พร้อม | task check | `bun test --cwd packages/server test/foundation.test.ts` | T002 |
| ไม่มีส่วนต่างหลังจาก generated output ถูก commit รวมกับ | task check | `bun test --cwd packages/client test/foundation.test.ts` | T003 |
