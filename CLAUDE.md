# CLAUDE.md

<!-- claude-foundation:change-loop:start -->
## Foundation change loop

Use `/investigate` when the problem is unclear, otherwise use `/change`.
The delivery loop is `/change → /build → /prove → /land`; `/dev` is a
compatibility composition that stops after proof.

@.claude/harness/AGENT.md
<!-- claude-foundation:change-loop:end -->

## Delivery (ส่งงานให้ผู้ใช้)

งานที่แก้ CLI ถือว่า "ส่งแล้ว" ต่อเมื่อคำสั่ง `changeloop` ในเครื่องผู้ใช้
เป็นเวอร์ชันใหม่ ไม่ใช่แค่ land ผ่าน หลัง land (และ commit เมื่อได้รับ
อนุญาต) ให้ทำต่อจนจบ:

1. Build เฉพาะ target เครื่องนี้ (ต้องใช้ bun >= 1.4.4 ตัว build ตรวจเอง):
   `cd packages/cli && bun run build --single --skip-install`
   (รวม web UI; `--skip-web-ui` ใช้เฉพาะตอนทดสอบเร็ว binary ที่ได้จะไม่มี UI)
   ผลลัพธ์อยู่ที่ `packages/cli/dist/cli-darwin-arm64/bin/changeloop`
   (ใส่ `--outdir=<path>` เพื่อ build ไปที่อื่นได้ เช่นตอนทดสอบ)
2. ติดตั้งทับ binary ที่ผู้ใช้ wiring ไว้ ปลายทางของ v2 ผู้ใช้ต้องเป็นคน
   กำหนด (เดิมของ v1 คือ `/opt/homebrew/bin/changeloop` ชี้ไปที่
   `packages/opencode/bin/.opencode` ซึ่งไม่มีใน v2) ต้อง **ลบก่อนแล้วค่อย
   copy** เสมอ เพราะ macOS จะ SIGKILL executable ที่ถูกเขียนทับ inode เดิม:
   `rm <ปลายทาง> && cp packages/cli/dist/cli-darwin-arm64/bin/changeloop <ปลายทาง>`
   อย่าติดตั้งทับก่อนผู้ใช้ยืนยันปลายทาง
3. Verify จาก PATH จริง: `changeloop --version` ต้องเป็น build ใหม่,
   `changeloop --help` ต้องไม่มีคำว่า OpenCode, และ smoke ด้วย `changeloop
   serve` (ใช้ HOME/XDG ชั่วคราว): `/` ตอบหน้าเว็บ, `/experimental/foundation/capability`
   ตอบ `available:true`, `/api/command` มีคำสั่ง Foundation ครบ 8 ตัวใน
   การเรียกครั้งแรก (endpoint รอ plugin activate แล้ว ถ้าเกิน 5 วินาทีตอบ 503)
   ปิด server ที่เปิดเองหลังทดสอบ
4. รายงานผู้ใช้: เวอร์ชัน, สิ่งที่เปลี่ยน, สถานะ git (push ต้องขออนุญาตแยก)

## การรัน test

อย่ารัน `bun test` เปล่าๆ ใน package ที่มี UI ใช้สคริปต์ของ package นั้น:

- `bun run --cwd packages/app test:unit` และ `test:browser` (สคริปต์ใส่
  `--preload ../ui/test/solid-jsx.ts` และ `--conditions=solid`/`browser`
  ที่จำเป็นต่อการ render JSX; ถ้าไม่มีจะล้มด้วย `jsxDEV not found`)
- `bun run --cwd packages/ui test`
- package อื่น: `bun test --cwd packages/<pkg>` (bunfig ราก ห้ามรัน test จากราก)
- `bun --cwd X run Y` ไม่รันสคริปต์ มันแค่แสดงรายการสคริปต์แล้ว exit 0 ใช้
  `bun run --cwd X Y` เสมอ โดยเฉพาะใน verify ของ task

ที่ล้มอยู่แล้วบน upstream v2.2.0 ในเครื่องนี้ (ไม่ใช่ของ fork): cli
`acp additional directories subprocess` และ `acp prompt content subprocess`,
tui `go-upsell-art` "the art stops every frame"

ข้อควรระวังจาก sandbox ของ harness: `bun install` ใน sandbox จะแก้
`bun.lock` แล้วทำให้ land ติด conflict/stale-proof — ก่อน prove รอบสุดท้าย
ให้คืนค่า `git show HEAD:bun.lock > <sandbox>/bun.lock` ถ้าไม่ได้ตั้งใจ
เปลี่ยน dependency
