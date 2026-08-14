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

1. Build เฉพาะ target เครื่องนี้:
   `cd packages/opencode && bun run build --single`
   (ผลลัพธ์อยู่ที่ `dist/opencode-darwin-arm64/bin/opencode`)
2. ติดตั้งทับ binary ที่ผู้ใช้ wiring ไว้ — `/opt/homebrew/bin/changeloop`
   เป็น symlink ชี้ไปที่ `packages/opencode/bin/.opencode` (ไฟล์ untracked,
   ห้าม commit) ต้อง **ลบก่อนแล้วค่อย copy** เพราะ macOS จะ SIGKILL
   executable ที่ถูกเขียนทับ inode เดิม:
   `rm packages/opencode/bin/.opencode && cp packages/opencode/dist/opencode-darwin-arm64/bin/opencode packages/opencode/bin/.opencode`
3. Verify จาก PATH จริง: `changeloop --version` ต้องเป็น build ใหม่ และ
   สุ่มดู `changeloop --help` ว่า branding ถูกต้อง
4. รายงานผู้ใช้: เวอร์ชัน, สิ่งที่เปลี่ยน, สถานะ git (push ต้องขออนุญาตแยก)

ข้อควรระวังจาก sandbox ของ harness: `bun install` ใน sandbox จะแก้
`bun.lock` แล้วทำให้ land ติด conflict/stale-proof — ก่อน prove รอบสุดท้าย
ให้คืนค่า `git show HEAD:bun.lock > <sandbox>/bun.lock` ถ้าไม่ได้ตั้งใจ
เปลี่ยน dependency
