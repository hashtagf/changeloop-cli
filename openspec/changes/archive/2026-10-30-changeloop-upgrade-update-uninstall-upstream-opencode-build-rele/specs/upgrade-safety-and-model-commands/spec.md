# upgrade-safety-and-model-commands

## Purpose

ป้องกัน changeloop upgrade/update/uninstall และการแจ้งเตือนอัปเดตไม่ให้ติดตั้งหรือชี้ไป upstream OpenCode เมื่อ build นี้ยังไม่มี release channel ของ Changeloop (ค่าเดียว CHANGELOOP_UPDATE_URL) และเปลี่ยนคำสั่ง `opencode {subcommand}` ในคู่มือ skill ที่ส่งให้โมเดลเป็น `changeloop {subcommand}`.

## ADDED Requirements

### Requirement: no-channel-no-upstream

เมื่อ build ไม่มี release channel ของ Changeloop ตัว updater SHALL NOT ส่ง network request ใดและ SHALL NOT spawn คำสั่ง package manager หรือ installer ไม่ว่าจากการตรวจตอนเปิดแอป การแจ้งเตือนใน TUI การ apply หรือ upgrade

#### Scenario: ตรวจตอนเปิดแอป

- **WHEN** เรียก run และ check ของ updater โดยไม่มี channel โดย fetch และ spawn ถูกจำลองให้ล้มถ้าเรียก
- **THEN** run คืน undefined, check คืน unavailable พร้อมข้อความไม่มี release channel และไม่มี fetch หรือ spawn

#### Scenario: apply/latest/upgrade

- **WHEN** เรียก apply, latest และ upgrade ทุก method โดยไม่มี channel
- **THEN** ล้มด้วย UpgradeError ข้อความไม่มี release channel ของ Changeloop และไม่มี fetch หรือ spawn

#### Scenario: ตรวจวิธีติดตั้ง

- **WHEN** เรียก method และ removal โดยไม่มี channel
- **THEN** method คืน undefined โดยไม่ spawn npm/pnpm/bun/yarn/vp และ removal คืน undefined จึง uninstall ไม่ลบ package ใด

#### Scenario: ใส่ channel ภายหลัง

- **WHEN** สร้าง updater ด้วย layerWith(url) ที่มีค่า
- **THEN** request ไปที่ url นั้นตามรูปแบบเดิมและ flow ติดตั้งเดิมทำงานต่อได้

### Requirement: upgrade-command-explains

คำสั่ง changeloop upgrade เมื่อไม่มี release channel SHALL จบด้วยข้อความ 'ยังไม่มี release channel ของ Changeloop' (ภาษาอังกฤษเดียวกับ UI: Changeloop has no release channel yet) พร้อมวิธีอัปเดตด้วยการ build จาก source และ SHALL ออกด้วย exit code ที่ไม่ใช่ 0

#### Scenario: ไม่ระบุ method

- **WHEN** รัน handler upgrade โดย updater ไม่มี channel
- **THEN** exit code 1 ข้อความมี release channel และคำสั่ง build จาก source และไม่เรียก method/latest/upgrade

#### Scenario: ระบุ method และ target

- **WHEN** รัน upgrade 2.0.0 --method npm โดยไม่มี channel
- **THEN** exit code 1 ข้อความเดียวกัน ไม่มีการติดตั้ง

#### Scenario: binary จริง

- **WHEN** รัน changeloop upgrade จาก binary ที่ build จริงใน HOME ชั่วคราวโดย proxy ชี้พอร์ตเสีย
- **THEN** exit code ไม่ใช่ 0 ข้อความไม่มี release channel และไม่มีความพยายามเชื่อมต่อ

### Requirement: model-facing-commands

คู่มือ skill และ system prompt ที่ส่งให้โมเดล SHALL ใช้ `changeloop {subcommand}` ในทุกคำสั่งที่ให้โมเดลรัน และ SHALL NOT มี `opencode <subcommand>` นอก allowlist (บรรทัดตัวตน, URL, ชื่อบริการ, path config/log, env)

#### Scenario: คำสั่งใน skill

- **WHEN** สแกน skill opencode.md และ report.md
- **THEN** คำสั่ง mcp add/list/auth, service restart/status, api, --standalone, --version ใช้ changeloop

#### Scenario: บรรทัดตัวตนคงเดิม

- **WHEN** สแกน system prompt ทุกไฟล์
- **THEN** บรรทัดตัวตน You are opencode และ running in OpenCode ยังอยู่ และไม่มีคำสั่ง opencode ให้รัน

#### Scenario: path และ env คงเดิม

- **WHEN** อ่านส่วน troubleshooting ของ skill
- **THEN** path ~/.local/share/opencode/log และ env OPENCODE_LOG_LEVEL ยังเหมือนเดิม
