# วิธีอัปเดต Foundation ใน Changeloop

Changeloop ฝัง Foundation runtime มากับตัวโปรแกรม ไม่ต้องติดตั้ง
`claude-foundation` แยก เมื่ออัปเดตตัวโปรแกรมแล้ว ต้องอัปเดต harness
ในแต่ละโปรเจกต์ด้วย การเปิดโปรเจกต์จะไม่อัปเดตไฟล์ให้อัตโนมัติ

Bundle ที่บันทึกใน repo ณ การอัปเดตนี้คือ **v3.5.14 / runtime API 33**
ตรวจค่าจริงของ binary ที่ใช้อยู่ด้วย `foundation status --json` เสมอ

## สำหรับผู้ใช้

### 1. อัปเดตตัวโปรแกรม Changeloop

ติดตั้ง binary รุ่นใหม่จากช่องทางแจกจ่าย Changeloop ที่ทีมใช้อยู่
แล้วปิดและเปิด Changeloop ใหม่ เพื่อโหลด runtime และ agent contract รุ่นใหม่

ในโค้ดปัจจุบัน `changeloop upgrade` ยังอ้าง package และ release ของ
OpenCode upstream จึงยังไม่ใช่เส้นทางอัปเดต binary ของ fork นี้
การอัปเดต `claude-foundation` ที่ติดตั้งแยกในเครื่องก็ไม่เปลี่ยน bundled runtime

### 2. ตรวจเวอร์ชันในโปรเจกต์

รันจาก root ของโปรเจกต์:

```sh
changeloop foundation status --json
```

ดู `bundle.version` และ `installed.runtime` ตัวอย่างหลังอัปเดตสำเร็จ
(แสดงเฉพาะ field ที่เกี่ยวข้อง):

```json
{
  "bundle": { "version": "3.5.14", "release": "v3.5.14" },
  "installed": { "state": "installed", "runtime": "3.5.14", "runtimeApi": "33" }
}
```

`installed.state: "installed"` บอกว่ามี harness แล้ว ไม่ได้ยืนยันว่า API
เข้ากันได้ ต้องตรวจด้วย `doctor` ด้วย

### 3. อัปเดต harness ของโปรเจกต์

```sh
changeloop foundation upgrade
```

คำสั่งจะขอยืนยันก่อนแก้ไฟล์ หากอนุมัติไว้แล้วหรือใช้ใน automation:

```sh
changeloop foundation upgrade --yes
```

`upgrade` ใช้ release ที่ bundle มากับ binary ปัจจุบัน ไม่ได้ดาวน์โหลด
Foundation รุ่นล่าสุดจากอินเทอร์เน็ต และไม่รับหมายเลขเวอร์ชันเป้าหมาย
คำสั่งติดตั้งไฟล์ที่ Foundation จัดการ รวมถึง OpenCode adapter แล้วรัน doctor
โดย installer เป็นผู้จัดการ merge, backup และ rollback เมื่อการติดตั้งล้มเหลว
ตรวจ diff ของโปรเจกต์หลังอัปเดต ก่อนบันทึกเข้าระบบควบคุมเวอร์ชัน

ถ้า `installed.state` เป็น `missing` ให้ติดตั้งครั้งแรกแทน:

```sh
changeloop foundation init
```

ทุกคำสั่งรองรับ path ของโปรเจกต์ เช่น:

```sh
changeloop foundation upgrade /path/to/project --yes
```

### 4. ตรวจผลและเริ่ม session ใหม่

```sh
changeloop foundation status --json
changeloop foundation doctor
```

เมื่อ doctor ผ่าน ให้เปิด session ใหม่แล้วใช้ `/changes`, `/change`,
`/build` หรือ `/prove` ต่อได้ ทำขั้นตอนอัปเดต harness แยกสำหรับแต่ละโปรเจกต์

## เมื่อมีปัญหา

| อาการ | วิธีตรวจและแก้ |
| --- | --- |
| `bundle.version` ยังเป็นรุ่นเก่า | ตรวจว่า shell เรียก binary ใหม่ด้วย `command -v changeloop` แล้วติดตั้ง binary ที่ถูกต้อง |
| แจ้ง runtime API ไม่ตรงกัน | ตรวจเวอร์ชันทั้งสองฝั่ง อัปเดต binary ให้มี bundle ที่ต้องการ แล้วรัน `foundation upgrade` |
| `foundation_bundle_invalid` | ติดตั้ง Changeloop release เดิมหรือรุ่นใหม่อีกครั้ง ไม่แก้ payload หรือ checksum ใน cache เอง |
| ตั้ง `foundation_runtime: "path"` อยู่ | Workflow ใช้ CLI ภายนอก ส่วน `changeloop foundation ...` จัดการ bundled runtime; ลบ setting นี้หรือเปลี่ยนเป็น `"bundled"` แล้วเปิด session ใหม่เพื่อใช้ตามคู่มือนี้ |
| ใช้ Windows native | Bootstrap ปัจจุบันยังไม่รองรับ `win32`; ใช้สภาพแวดล้อม Linux เช่น WSL พร้อม binary สำหรับ Linux |

ถ้าต้องย้อนรุ่น ให้ใช้ binary Changeloop รุ่นก่อนและรัน `foundation upgrade`
เพื่อปรับ managed files ให้ตรงกับ bundle นั้น ตรวจ doctor และ diff อีกครั้ง
ขั้นตอนนี้ไม่ใช่การย้อนข้อมูลหรือประวัติงานของโปรเจกต์ทั้งหมด

## สำหรับผู้ดูแล repo: อัปเดต bundled release

สำหรับ coding agent ให้ทำตาม [ขั้นตอนอัปเดต bundle สำหรับ agent](FOUNDATION_UPDATE_AGENT.md)
ซึ่งครอบคลุมการตรวจ source, วิเคราะห์ test ที่ล้มเหลว และรายงานผลก่อนส่งมอบ

ใช้ checkout สะอาดของ repository `Maximumsoft-Co-LTD/claude-foundation`
ที่ checkout release tag เป้าหมายแล้ว ตัวอย่างนี้ใช้ `v3.5.14`
สคริปต์อ่านไฟล์จาก working tree จึงต้องไม่มีการแก้ไฟล์ค้างใน source checkout

รันจาก `packages/opencode`:

```sh
bun script/sync-foundation.ts --source /path/to/claude-foundation --release v3.5.14
bun script/verify-foundation.ts
bun test test/plugin/foundation.test.ts test/plugin/foundation-runtime.test.ts test/plugin/foundation-bundle.test.ts
bun typecheck
```

สคริปต์สร้าง payload และ manifest ที่มี release, commit และ checksum รายไฟล์
อย่าแก้ vendor payload หรือ manifest ด้วยมือ และอย่าใช้ `--allow-untagged`
สำหรับ release ที่จะแจกจ่าย หาก upstream เปลี่ยนข้อความหรือ installer
ให้ตรวจและอัปเดตค่าคาดหวังใน integration tests ตาม source ของ release นั้น

หลัง checks ผ่าน ให้ build binary สำหรับเครื่องปัจจุบัน:

```sh
bun script/build.ts --single
```

Build จะตรวจ bundle และฝังไฟล์เข้า binary ผลลัพธ์อยู่ที่
`packages/opencode/dist/<target>/bin/opencode` (ชื่อไฟล์ build ยังเป็น `opencode`)
ทดสอบ `foundation status --json`, `foundation init` ในโปรเจกต์ทดสอบ และ
`foundation doctor` ด้วย binary ที่ build จริงก่อนแจกจ่ายผ่านช่องทาง Changeloop
การ sync source อย่างเดียวไม่เปลี่ยน binary ที่ผู้ใช้ติดตั้งไว้

ดูรายละเอียด setting และ ownership ของคำสั่งใน
[Configuration — Foundation workflow commands](CONFIGURATION.md#foundation-workflow-commands-foundation_workflow)
