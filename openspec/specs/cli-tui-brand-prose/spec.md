# cli-tui-brand-prose Specification

## Purpose
Rebrand ข้อความ prose ที่ผู้ใช้เห็นของ CLI และ TUI จาก OpenCode เป็น Changeloop (help, usage, ข้อความอัปเกรด/ถอนการติดตั้ง/error, คำสั่งแนะนำ, TUI dialog/title, wordmark) โดยไม่แตะ identifier ที่เป็นสัญญา.
## Requirements
### Requirement: help-no-opencode-prose

ข้อความ help ของ root และทุก subcommand ที่ผู้ใช้เห็น SHALL ไม่มีคำว่า OpenCode หรือ opencode ยกเว้นบรรทัด USAGE ที่ชื่อมาจากการ build

#### Scenario: root help

- **WHEN** รัน --help ที่ root
- **THEN** คำอธิบาย อาร์กิวเมนต์ และรายการ subcommand ใช้คำว่า Changeloop และไม่มีคำว่า OpenCode หรือ opencode นอกบรรทัด USAGE

#### Scenario: subcommand help

- **WHEN** รัน --help ของ upgrade, uninstall, run, acp, mcp, plugin, service, pair
- **THEN** ข้อความไม่มี OpenCode หรือ opencode นอกบรรทัด USAGE

### Requirement: runtime-messages-rebranded

ข้อความ runtime ของ CLI (upgrade, uninstall, pair, service, mini, stats, acp, update preflight) SHALL เรียกโปรแกรมว่า Changeloop และแนะนำคำสั่ง changeloop ที่มีอยู่จริง

#### Scenario: คำสั่งแนะนำ

- **WHEN** แสดงข้อความ conflict ของ port, pair, retry ของ upgrade, usage ของ service, error ของ mini
- **THEN** ข้อความแนะนำ `changeloop <คำสั่ง>` และไม่มี `opencode <คำสั่ง>`

#### Scenario: acp

- **WHEN** ลงทะเบียน auth method และ agentInfo ของ ACP
- **THEN** คำสั่ง terminal-auth เป็น changeloop auth login, ชื่อที่แสดงเป็น Changeloop และ agent id ภายใน (`opencode`) เหมือนเดิม

#### Scenario: ชื่อบริการคงเดิม

- **WHEN** แสดงข้อความเกี่ยวกับ OpenCode Console หรือ OpenCode Go
- **THEN** ข้อความยังใช้ชื่อบริการเดิม

### Requirement: tui-prose-rebranded

ข้อความ TUI ที่ผู้ใช้เห็น (ชื่อหน้าต่าง terminal, dialog อัปเดต, หน้า crash, คำแนะนำ error, placeholder ของ permission, sidebar footer, stats) SHALL ใช้ชื่อ Changeloop และคำสั่ง changeloop

#### Scenario: ชื่อหน้าต่างและ dialog

- **WHEN** TUI เริ่มและเปิด dialog อัปเดต
- **THEN** ชื่อ terminal เป็น Changeloop และ dialog ใช้ Changeloop ในข้อความทั้งหมด

#### Scenario: epilogue

- **WHEN** TUI ปิดพร้อมข้อมูล session
- **THEN** คำใบ้ continue เป็น `changeloop -s <session>`

### Requirement: wordmark-changeloop

wordmark ของ TUI และ epilogue SHALL สะกด CHANGELOOP แบบ pixel โดยไอคอน loop แทนตัว O ทั้งสองและไม่ถูกตัดแถวที่ความกว้างใดๆ

#### Scenario: ตารางแถว

- **WHEN** อ่านตาราง logo
- **THEN** left มี 5 แถวสะกด CHANGE, right มี 5 แถวสะกด LOOP และไอคอน loop ปรากฏสองครั้งในแถวบนของ right

#### Scenario: epilogue

- **WHEN** สร้าง epilogue
- **THEN** ผลลัพธ์มีแถวของ wordmark ใหม่และไม่มีแถวของ wordmark เดิมที่สะกด opencode

### Requirement: contract-identifiers-unchanged

identifier ที่เป็นสัญญา SHALL คงค่าเดิมหลัง rebrand และ guard test SHALL ตรวจว่า string ที่เหลือใน cli/tui src ที่มี OpenCode เป็นรายการใน allowlist เท่านั้น

#### Scenario: guard ไม่พบ prose

- **WHEN** สแกน string literal ใน packages/cli/src และ packages/tui/src
- **THEN** ไม่มี prose 'OpenCode' หรือคำสั่ง `opencode <คำสั่ง>` นอก allowlist (OpenCode Console/Go/Zen, Web Search via OpenCode, symbol SDK)

#### Scenario: identifier คงเดิม

- **WHEN** ตรวจ id ของ plugin/command, env OPENCODE_*, ชื่อ config opencode.json, username basic-auth และ URL opencode.ai
- **THEN** ทุกค่ายังตรงกับของเดิม
