# v1-user-compatibility

## ADDED Requirements

### Requirement: global-app-path-fallback

Global SHALL เลือกโฟลเดอร์ data, cache, config และ state ทีละ base ตามลำดับ BASE/changeloop ถ้ามี, ไม่งั้น BASE/opencode ถ้ามี, ไม่งั้น BASE/changeloop และ SHALL ไม่ย้ายหรือลบ dir ที่มีอยู่ และ home SHALL อ่าน CHANGELOOP_TEST_HOME ก่อน OPENCODE_TEST_HOME

#### Scenario: ติดตั้งใหม่

- **WHEN** XDG base ทั้งสี่ไม่มี dir changeloop หรือ opencode
- **THEN** data config cache state เป็น BASE/changeloop

#### Scenario: ผู้ใช้ opencode เดิม

- **WHEN** มี BASE/opencode อยู่และไม่มี BASE/changeloop
- **THEN** path ชี้ BASE/opencode และ dir นั้นไม่ถูกย้ายหรือเปลี่ยนเนื้อหา

#### Scenario: มีทั้งสอง

- **WHEN** มีทั้ง BASE/changeloop และ BASE/opencode
- **THEN** path ชี้ BASE/changeloop

#### Scenario: ตัดสินแยกต่อ base

- **WHEN** config มีเฉพาะ opencode แต่ data มี changeloop
- **THEN** config ชี้ opencode และ data ชี้ changeloop

#### Scenario: ลำดับ test home

- **WHEN** ตั้งทั้ง CHANGELOOP_TEST_HOME และ OPENCODE_TEST_HOME
- **THEN** home คือค่าของ CHANGELOOP_TEST_HOME

#### Scenario: เห็นผ่าน debug paths จริง

- **WHEN** รัน changeloop debug paths ใน XDG ชั่วคราวที่มีเฉพาะ BASE/opencode และอีกชุดที่ว่าง
- **THEN** ชุดแรกแสดง opencode ชุดที่สองแสดง changeloop และไม่สร้าง dir opencode ในชุดที่สอง

### Requirement: env-changeloop-alias

โปรเซสที่ import ชั้นเริ่มต้นของ CLI SHALL ทำให้ทุกตัวแปรที่ขึ้นต้นด้วย CHANGELOOP_ ที่ตั้งไว้เป็นค่าของตัวแปรชื่อเดียวกันที่ขึ้นต้นด้วย OPENCODE_ และเมื่อตั้งทั้งคู่ฝั่ง CHANGELOOP_ SHALL ชนะ ส่วนตัวแปรที่ไม่มีคู่ changeloop SHALL ไม่เปลี่ยน

#### Scenario: alias ชนะ

- **WHEN** ตั้ง CHANGELOOP_CONFIG_DIR และ OPENCODE_CONFIG_DIR ต่างกัน
- **THEN** config ที่ debug paths แสดงคือ CHANGELOOP_CONFIG_DIR

#### Scenario: fallback

- **WHEN** ตั้งแค่ OPENCODE_CONFIG_DIR
- **THEN** config ที่ debug paths แสดงคือค่านั้น

#### Scenario: ตัวแปรอื่นไม่ถูกแตะ

- **WHEN** ตั้ง CHANGELOOP_X ที่ไม่ใช่ตัวแปรของระบบ
- **THEN** OPENCODE_X ถูกตั้ง และตัวแปร ที่ไม่ขึ้นต้น CHANGELOOP_ ไม่เปลี่ยน

### Requirement: config-file-names

ConfigDiscovery SHALL โหลดไฟล์ในแต่ละโฟลเดอร์ (global, ระดับโปรเจกต์ที่เดินขึ้น, และ dir .opencode/.changeloop) ตามลำดับ opencode.json, opencode.jsonc, changeloop.json, changeloop.jsonc โดยไฟล์หลังชนะ และ Config.update SHALL เขียนกลับไฟล์ที่มีอยู่ที่ชนะ หรือสร้าง changeloop.jsonc เมื่อไม่มีไฟล์ใด ผู้ใช้ที่มีแค่ opencode.json SHALL เห็นพฤติกรรมเดิมทุกอย่าง

#### Scenario: global changeloop ชนะ opencode

- **WHEN** config dir มี opencode.json และ changeloop.json ตั้งค่า shell ต่างกัน
- **THEN** ค่า shell คือของ changeloop.json

#### Scenario: jsonc ชนะ json

- **WHEN** มี changeloop.json และ changeloop.jsonc
- **THEN** ค่าของ changeloop.jsonc ชนะ และ opencode.jsonc แพ้ changeloop.json

#### Scenario: โปรเจกต์

- **WHEN** root โปรเจกต์มี opencode.json และ changeloop.json และ global มี changeloop.json
- **THEN** ค่าโปรเจกต์ changeloop ชนะ opencode ของโปรเจกต์ และชนะ global

#### Scenario: เฉพาะ opencode เหมือนเดิม

- **WHEN** มีแค่ opencode.json
- **THEN** ผลลัพธ์เหมือนก่อนการเปลี่ยนแปลง

#### Scenario: update เลือกไฟล์ที่ชนะ

- **WHEN** config dir มี opencode.json และ changeloop.json แล้วเรียก Config.update
- **THEN** เขียนลง changeloop.json และ opencode.json ไม่เปลี่ยน

#### Scenario: update seed

- **WHEN** config dir ไม่มีไฟล์ config แล้วเรียก Config.update
- **THEN** สร้าง changeloop.jsonc

#### Scenario: ไฟล์เสีย

- **WHEN** changeloop.json เป็น JSON ที่ไม่ถูกต้อง และ opencode.json ถูกต้อง
- **THEN** โหลดต่อได้ ค่าจาก opencode.json ยังอยู่ และมี diagnostic ของ changeloop.json

### Requirement: project-changeloop-directory

ConfigDiscovery SHALL ปฏิบัติต่อโฟลเดอร์ .changeloop เหมือน .opencode ในทุกระดับที่เดินขึ้น (config ภายในและ Directory entry ที่ใช้หา commands, plugins, skills) โดย .opencode โหลดก่อน .changeloop ในระดับเดียวกัน และ SHALL ไม่นับ .changeloop เป็นไฟล์ direct

#### Scenario: ลำดับ directory

- **WHEN** ระดับเดียวกันมีทั้ง .opencode และ .changeloop
- **THEN** Directory entry เรียง .opencode แล้ว .changeloop และ config ใน .changeloop ชนะ

#### Scenario: เฉพาะ .changeloop

- **WHEN** โปรเจกต์มีแค่ .changeloop/opencode.json
- **THEN** ค่านั้นถูกโหลดและ .changeloop ปรากฏเป็น Directory

#### Scenario: ซ้อนหลายระดับ

- **WHEN** root มี .changeloop และโฟลเดอร์ลูกมี .opencode
- **THEN** ลำดับ outermost ก่อน innermost คงเดิม

#### Scenario: command ใน .changeloop ใช้ได้จริง

- **WHEN** โปรเจกต์มี .changeloop/commands/hello.md และเปิดผ่าน instance จริง
- **THEN** command hello อยู่ในรายการ command ของ location นั้น

### Requirement: plan-changeloop-directory

agent plan SHALL ได้สิทธิ์ edit ภายใน ~/.changeloop/plan คู่กับ ~/.opencode/plan และ SHALL ปฏิเสธ edit ที่อื่นเหมือนเดิม

#### Scenario: อนุญาต changeloop plan

- **WHEN** plan agent แก้ ~/.changeloop/plan/work.md
- **THEN** permission คือ allow

#### Scenario: opencode plan เดิมยังได้

- **WHEN** plan agent แก้ ~/.opencode/plan/work.md
- **THEN** permission คือ allow

#### Scenario: ที่อื่นถูกปฏิเสธ

- **WHEN** plan agent แก้ไฟล์ในโปรเจกต์
- **THEN** permission คือ deny
