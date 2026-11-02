# Design

## Work type

feature, integration

## เส้นทางผู้ใช้

ผู้ใช้โปรเจกต์ที่ยังไม่มี harness ตรวจสถานะ อนุมัติ ติดตั้ง และตรวจสุขภาพ Foundation ด้วย changeloop เพียงตัวเดียว

```mermaid
flowchart TD
  A[ผู้ใช้เปิดโปรเจกต์ใหม่] --> B[changeloop foundation status]
  B -- missing --> C{ผู้ใช้อนุมัติ}
  C -- ไม่ --> D[จบ ไม่มีไฟล์เปลี่ยน]
  C -- ใช่ init --yes --> E{target ปลอดภัย}
  E -- ไม่ --> F[ปฏิเสธ exit 1 ไม่มีไฟล์เปลี่ยน]
  E -- ใช่ --> G[installer ที่ฝังใน binary ติดตั้ง]
  G --> H[แสดงเวอร์ชัน และ doctor]
  H --> I[คำสั่ง Foundation โผล่ใน command list]
```

## สัญญาการเชื่อมต่อระบบภายนอก

| ระบบภายนอก | ประเภท | เอกสาร | เวอร์ชัน | ข้อกังวล |
|---|---|---|---|---|
| bundled-foundation-installer | cli | packages/foundation/vendor/claude-foundation/manifest.json | bundled release in manifest.json | timeout, idempotency, authentication |

## ตารางความล้มเหลว

| Failure | User sees | Recovery |
|---|---|---|
| รัน init หรือ upgrade โดยไม่มี --yes และไม่ใช่ terminal จริง | ข้อความว่าต้องอนุมัติด้วย --yes และ exit code 1 ไม่มีไฟล์ถูกเปลี่ยน | รันซ้ำพร้อม --yes หลังตรวจว่ายอมให้เขียนไฟล์ |
| path ไม่มีอยู่หรือไม่ใช่ directory | ข้อความ error ระบุ target และ exit code 1 ไม่มีไฟล์ถูกเปลี่ยน | ระบุ directory ของโปรเจกต์ที่ถูกต้อง |
| path ที่ Foundation จัดการ (เช่น .claude/commands) เป็น symlink | ข้อความว่า target มี symlinked managed path และ exit code 1 ก่อนเรียก installer | แทน symlink ด้วย directory จริงหรือย้ายโปรเจกต์ แล้วรันซ้ำ |
| รันบน win32 | ข้อความว่า Foundation bootstrap ไม่รองรับ win32 และ exit code 1 | ใช้ macOS, Linux หรือ WSL |
| installer หรือ doctor ล้ม | stdout และ stderr ของ installer พร้อม exit code ของมัน ไม่รายงานว่าติดตั้งสำเร็จ | แก้ตามข้อความ แล้วรัน upgrade --yes ซ้ำ ซึ่งเป็น idempotent |
| bundle ที่ฝังในไบนารีเสียหรือโหลดไม่ได้ | ข้อความให้ติดตั้ง Changeloop รุ่นนี้ใหม่ และ exit code 1 | ติดตั้ง Changeloop ใหม่ |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `packages/foundation/src/foundation-command.ts` (add), `packages/foundation/src/index.ts`, `packages/foundation/test/foundation-command.test.ts` (add) |
| T002 | `packages/cli/src/commands/commands.ts`, `packages/cli/src/index.ts`, `packages/cli/src/commands/handlers/foundation/status.ts` (add), `packages/cli/src/commands/handlers/foundation/init.ts` (add), `packages/cli/src/commands/handlers/foundation/upgrade.ts` (add), `packages/cli/src/commands/handlers/foundation/doctor.ts` (add), `packages/cli/src/commands/handlers/foundation/shared.ts` (add), `packages/cli/test/foundation-command.test.ts` (add) |

`+` add · `~` change · `-` remove

```text
.
└── packages/
    ├── cli/
    │   ├── src/
    │   │   ├── commands/
    │   │   │   ├── ~ commands.ts
    │   │   │   └── handlers/
    │   │   │       └── foundation/
    │   │   │           ├── + doctor.ts
    │   │   │           ├── + init.ts
    │   │   │           ├── + shared.ts
    │   │   │           ├── + status.ts
    │   │   │           └── + upgrade.ts
    │   │   └── ~ index.ts
    │   └── test/
    │       └── + foundation-command.test.ts
    └── foundation/
        ├── src/
        │   ├── + foundation-command.ts
        │   └── ~ index.ts
        └── test/
            └── + foundation-command.test.ts
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| โปรเจกต์ยังไม่มี harness; หลัง init; protocol.json เสีย; ข้อความอ่านง่าย; ไม่มี --yes และไม่ใช่ terminal; ผู้ใช้ปฏิเสธการยืนยัน; upgrade ก็ต้องอนุมัติ; โปรเจกต์ใหม่; ไม่มี claude-foundation ใน PATH; รันซ้ำ; ระบุ path; installer ล้ม; ซ่อมไฟล์ที่ถูกแก้; ไฟล์นอก manifest; ไฟล์ชื่อชนที่ manifest ไม่ได้เป็นเจ้าของ; โปรเจกต์ที่ติดตั้งดี; doctor ล้ม; ก่อน init; path ไม่มีอยู่; path เป็นไฟล์; managed path เป็น symlink; แพลตฟอร์ม win32 | task check | `o=$(bun test --cwd packages/foundation test/foundation-command.test.ts 2>&1); r=$?; echo "$o"; p=$(echo "$o" \| sed -n 's/^ *\([0-9]*\) pass$/\1/p'); f=$(echo "$o" \| sed -n 's/^ *\([0-9]*\) fail$/\1/p'); echo "Tests: ${f:-0} failed, ${p:-0} passed, $((${p:-0}+${f:-0})) total"; exit $r` | T001 |
| help ของ foundation; root help; path เริ่มต้น; โปรเจกต์ยังไม่มี harness; หลัง init; protocol.json เสีย; ข้อความอ่านง่าย; ไม่มี --yes และไม่ใช่ terminal; ผู้ใช้ปฏิเสธการยืนยัน; upgrade ก็ต้องอนุมัติ; โปรเจกต์ใหม่; ไม่มี claude-foundation ใน PATH; รันซ้ำ; ระบุ path; installer ล้ม; path ไม่มีอยู่; path เป็นไฟล์; managed path เป็น symlink; แพลตฟอร์ม win32 | task check | `o=$(bun test --cwd packages/cli test/foundation-command.test.ts 2>&1); r=$?; echo "$o"; p=$(echo "$o" \| sed -n 's/^ *\([0-9]*\) pass$/\1/p'); f=$(echo "$o" \| sed -n 's/^ *\([0-9]*\) fail$/\1/p'); echo "Tests: ${f:-0} failed, ${p:-0} passed, $((${p:-0}+${f:-0})) total"; exit $r` | T002 |
