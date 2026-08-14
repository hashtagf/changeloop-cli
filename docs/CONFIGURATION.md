# Changeloop configuration (การตั้งค่า)

changeloop เป็น fork ของ OpenCode ที่คง compatibility เต็มรูปแบบ:
**ชื่อ `changeloop` ชนะชื่อ `opencode` เสมอ แต่ของเดิมยังใช้ได้ทุกจุด**
เอกสารนี้สรุปว่า setting แต่ละชั้นอ่านจากไหน และ override อย่างไร

ดู path จริงที่ CLI ใช้อยู่ได้ทุกเมื่อด้วย:

```sh
changeloop debug paths    # data / config / cache / state directories
changeloop debug config   # ค่า config หลัง merge ทุกชั้นแล้ว
```

## Directory fallback (ทำไมยังเห็นเป็น opencode)

ตอนหา data/config/cache/state directory CLI จะเลือกตามลำดับ:

1. `<base>/changeloop` — ถ้ามีอยู่ ใช้ทันที
2. `<base>/opencode` — ถ้า changeloop ยังไม่มีแต่ opencode มี (เครื่องที่เคยติดตั้ง
   OpenCode มาก่อน) ใช้ของเดิมต่อ เพื่อรักษา sessions, auth, cache โดยไม่ต้อง
   migrate
3. ถ้าไม่มีทั้งคู่ สร้างเป็น `changeloop`

`<base>` คือ XDG base ปกติ: `~/.config`, `~/.local/share`, `~/.cache`,
`~/.local/state` (แต่ละ base ตัดสินใจแยกกัน)

ดังนั้นเครื่องที่มี `~/.config/opencode` อยู่แล้วจะยังเห็น path เป็น opencode —
เป็นพฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก

## จุดปรับ setting (changeloop ชนะเสมอ)

| ชั้น | ที่ปรับ | หมายเหตุ |
|---|---|---|
| Global (ใช้โฟลเดอร์เดิมร่วมกับ opencode) | สร้าง `changeloop.json` ใน config dir ปัจจุบัน (ดูจาก `debug paths`) | changeloop อ่านไฟล์นี้ทับค่า `opencode.json`; OpenCode ตัว official ไม่อ่านไฟล์นี้ — แยก setting สองโปรแกรมได้ในโฟลเดอร์เดียว |
| Global (แยกโปรไฟล์เต็มตัว) | สร้างโฟลเดอร์ `~/.config/changeloop/` แล้วใส่ `changeloop.json` | พอโฟลเดอร์นี้มีอยู่ CLI เลิก fallback ไป opencode ทันที ต้อง copy ค่า (และพิจารณา data dir) มาเอง |
| ต่อโปรเจกต์ | `changeloop.json`/`changeloop.jsonc` ที่ root หรือโฟลเดอร์ `.changeloop/` | ชนะ `opencode.json(c)` / `.opencode/` ในโปรเจกต์เดียวกัน ทั้งคู่ยังถูกอ่านเป็น fallback |

ไฟล์ config เริ่มต้นที่ระบบ seed ให้เมื่อยังไม่มีอะไรเลยคือ `changeloop.jsonc`

## ลำดับ merge (ทีหลังชนะ)

Global config dir:

```text
config.json → opencode.json → opencode.jsonc → changeloop.json → changeloop.jsonc
```

ในโปรเจกต์: ไฟล์ `opencode.*` ทุกระดับก่อน แล้วตามด้วย `changeloop.*`
(changeloop ชนะ); โฟลเดอร์ `.opencode` ก่อน `.changeloop` ในระดับเดียวกัน
(`.changeloop` ชนะ)

## Environment variables

ทุกตัวแปร `OPENCODE_*` มีคู่ `CHANGELOOP_*` ใช้แทนได้ เช่น
`CHANGELOOP_CONFIG`, `CHANGELOOP_CONFIG_DIR`, `CHANGELOOP_API_KEY`,
`CHANGELOOP_SERVER_USERNAME`, `CHANGELOOP_TEST_HOME`

กติกา: ถ้าตั้ง `CHANGELOOP_*` ใช้ค่านั้น; ถ้าไม่ตั้ง fallback ไปอ่าน
`OPENCODE_*` เดิม

## สิ่งที่ยังใช้ชื่อ opencode โดยเจตนา (Phase 3)

npm scope `@opencode-ai/*`, service tags, URL `opencode.ai` (config `$schema`,
zen gateway, auth), ชื่อ default username `'opencode'`, mDNS `opencode.local`,
managed path `/etc/opencode` — ดูนโยบายและเหตุผลใน `docs/sync/UPSTREAM.md`
