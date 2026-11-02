# v1-user-compatibility Specification

## Purpose
ทำให้ config เดิม foundation_workflow และ foundation_runtime ของ v1 ยังมีผลบน v2 และพิสูจน์ความเข้ากันได้อีกสามเรื่องของผู้ใช้เดิม คือ managedAdapter, คำสั่ง service และข้อมูล session เดิม.
## Requirements
### Requirement: foundation-workflow-config

config ที่ตั้ง foundation_workflow เป็น false (ในโปรเจกต์หรือ global) SHALL ทำให้คำสั่ง Foundation 8 ตัวไม่ถูกลงทะเบียนในอินสแตนซ์จริง และ config ที่ไม่มี key นี้ SHALL ได้ 8 คำสั่งเหมือนเดิม

#### Scenario: ปิดในโปรเจกต์

- **WHEN** opencode.json ของโปรเจกต์มี foundation_workflow: false แล้วอินสแตนซ์เริ่มทำงาน
- **THEN** ไม่มีคำสั่ง investigate, change, build, prove, land, changes, feature, dev และ plugin opencode.foundation ไม่อยู่ใน inventory

#### Scenario: ปิดใน global

- **WHEN** opencode.json ใน global config มี foundation_workflow: false และโปรเจกต์ไม่มี key
- **THEN** ไม่มีคำสั่ง 8 ตัว

#### Scenario: โปรเจกต์เปิดทับ global

- **WHEN** global ตั้ง false และโปรเจกต์ตั้ง foundation_workflow: true
- **THEN** คำสั่ง 8 ตัวลงทะเบียน

#### Scenario: ไม่มี key

- **WHEN** config ไม่มี foundation_workflow และ foundation_runtime
- **THEN** คำสั่ง 8 ตัวลงทะเบียนและ plugin active

#### Scenario: ค่าไม่ถูกต้อง

- **WHEN** foundation_workflow เป็น "no" และ foundation_runtime เป็น "system" พร้อมค่าอื่นที่ถูกต้องใน config เดียวกัน
- **THEN** config โหลดสำเร็จ ค่าอื่นยังมีผล และคำสั่ง 8 ตัวลงทะเบียนตามค่าเริ่มต้น

### Requirement: foundation-runtime-config

foundation_runtime SHALL เลือก runtime ของ plugin เหมือน v1: path ไม่เติม PATH ของ bundle เข้า shell ส่วน bundled (ค่าเริ่มต้น) เติม

#### Scenario: runtime path

- **WHEN** config ตั้ง foundation_runtime: "path" แล้วสร้าง shell
- **THEN** คำสั่ง 8 ตัวลงทะเบียน และ PATH ของ shell ไม่ถูกเติมโฟลเดอร์ bin ของ bundle

#### Scenario: runtime bundled

- **WHEN** config ไม่ตั้ง runtime หรือตั้งเป็น bundled แล้วสร้าง shell
- **THEN** PATH ของ shell ขึ้นต้นด้วยโฟลเดอร์ bin ของ bundle

#### Scenario: เปลี่ยนค่าแล้ว activate ใหม่

- **WHEN** operation เพิ่มของ builtin เปลี่ยน options จาก bundled เป็น path ระหว่างที่อินสแตนซ์ทำงาน
- **THEN** plugin ถูก activate ใหม่ด้วย runtime path

### Requirement: legacy-config-translation

ConfigNormalize SHALL แปลง foundation_workflow และ foundation_runtime เป็น plugin operation ในเอกสารเดียวกัน โดยวางก่อน plugin และ plugins ที่ผู้ใช้เขียนเอง และข้ามค่าไม่ถูกต้องพร้อม diagnostic

#### Scenario: แปลง workflow

- **WHEN** normalize config ที่มี foundation_workflow: false และ plugins ["-x"]
- **THEN** plugins คือ ["-opencode.foundation", "-x"] และไม่มี diagnostic

#### Scenario: แปลง runtime

- **WHEN** normalize config ที่มี foundation_runtime: "path"
- **THEN** plugins คือ [{ package: "opencode.foundation", options: { runtime: "path" } }]

#### Scenario: ค่าไม่ถูกต้อง

- **WHEN** normalize config ที่มี foundation_workflow: "no"
- **THEN** ไม่มี plugins จาก key นี้ และมี diagnostic ชนิด invalid ที่ path foundation_workflow

#### Scenario: ไม่มี key

- **WHEN** normalize config ที่ไม่มีทั้งสอง key
- **THEN** ผลลัพธ์เหมือนก่อนเปลี่ยน ไม่มี field plugins เพิ่ม

### Requirement: service-command-self

คำสั่งที่ ServiceConfig.options ส่งให้ Service.ensure SHALL ใช้ executable ที่กำลังรันตามด้วย serve --service ไม่ใช่ชื่อ opencode

#### Scenario: command ของ CLI

- **WHEN** เรียก ServiceConfig.options()
- **THEN** command ขึ้นต้นด้วย selfCommand() และลงท้ายด้วย serve และ --service และไม่มีสมาชิกที่เป็นชื่อ opencode

### Requirement: v1-session-migration

migration ของ upstream SHALL ย้าย session รูปแบบ v1 ที่มีข้อความคำสั่ง Foundation และ tool call ของ harness โดยไม่ข้ามแถวและไม่ล้ม

#### Scenario: session ที่มีคำสั่ง Foundation

- **WHEN** ฐานข้อมูล v1 สังเคราะห์มี session ที่ผู้ใช้เรียก /change และ assistant เรียก bash ด้วย claude-foundation
- **THEN** V1Migration.run สำเร็จ ข้อความผู้ใช้และ assistant ถูกย้ายครบ ไม่มี warning ของแถวที่ถูกข้าม

### Requirement: runtime-key-keeps-disabled

foundation_runtime SHALL ตั้ง runtime ของ plugin opencode.foundation โดยไม่เปลี่ยนสถานะเปิดปิด ส่วน plugin entry ที่เป็น add พร้อม options ของ package ทั่วไปและของ builtin ที่ผู้ใช้เขียนเองใน plugins SHALL ยังเปิด plugin ตามเดิม

#### Scenario: global ปิด และโปรเจกต์มี runtime เท่านั้น

- **WHEN** global config มี foundation_workflow: false และโปรเจกต์มี foundation_runtime: "path"
- **THEN** plugin opencode.foundation ไม่อยู่ใน inventory และไม่มีคำสั่ง 8 ตัว

#### Scenario: global ปิด และโปรเจกต์เปิดชัด

- **WHEN** global มี foundation_workflow: false และโปรเจกต์มี foundation_workflow: true
- **THEN** plugin active และมีคำสั่ง 8 ตัว

#### Scenario: ไม่มี key

- **WHEN** config ไม่มี foundation_workflow และ foundation_runtime
- **THEN** plugin active และมีคำสั่ง 8 ตัว

#### Scenario: โปรเจกต์ปิดเอง

- **WHEN** โปรเจกต์มี foundation_workflow: false และ foundation_runtime: "path"
- **THEN** plugin ไม่อยู่ใน inventory

#### Scenario: runtime พร้อม workflow true

- **WHEN** โปรเจกต์มี foundation_workflow: true และ foundation_runtime: "path" ขณะ global ปิด
- **THEN** plugin active ด้วย runtime path (PATH ของ shell ไม่ถูกเติม bundle)

### Requirement: runtime-key-configure-only-translation

ConfigNormalize SHALL แปลง foundation_runtime เป็น operation เพิ่มของ opencode.foundation พร้อม option runtime และ option สงวน $configureOnly เป็น true ส่วน foundation_workflow แปลงเหมือนเดิม และค่าไม่ถูกต้องของทั้งสอง key SHALL ถูกข้ามพร้อม diagnostic ชนิด invalid

#### Scenario: แปลง runtime

- **WHEN** normalize config ที่มี foundation_runtime: "path"
- **THEN** plugins คือ [{ package: "opencode.foundation", options: { runtime: "path", "$configureOnly": true } }]

#### Scenario: ค่าไม่ถูกต้องในอินสแตนซ์จริง

- **WHEN** โปรเจกต์มี foundation_workflow: "no" และ foundation_runtime: "system"
- **THEN** config โหลดได้ plugin active ด้วย runtime ค่าเริ่มต้น (PATH ถูกเติม) และ normalize รายงาน diagnostic invalid ทั้งสอง path

### Requirement: native-plugins-precedence

entry ใน plugins ของผู้ใช้ที่ระบุ opencode.foundation SHALL ชนะ operation ที่แปลงจาก foundation_workflow และ foundation_runtime ในเอกสารเดียวกัน

#### Scenario: options ใน plugins ชนะ runtime

- **WHEN** เอกสารเดียวมี foundation_runtime: "path" และ plugins: [{ package: "opencode.foundation", options: { runtime: "bundled" } }]
- **THEN** plugin active และ PATH ของ shell ถูกเติม bundle (bundled ชนะ)

#### Scenario: ลบใน plugins ชนะ workflow true

- **WHEN** เอกสารเดียวมี foundation_workflow: true และ plugins: ["-opencode.foundation"]
- **THEN** plugin ไม่อยู่ใน inventory

### Requirement: foundation-read-gated-by-plugin

endpoint /experimental/foundation/* (capability, list, get, investigations, documents) SHALL ตอบ unsupported เมื่อ plugin opencode.foundation ไม่อยู่ใน inventory ของ location ของคำขอ และตอบตามปกติเมื่ออยู่

#### Scenario: ปิดด้วย config

- **WHEN** config ของ location มี foundation_workflow: false แล้วเรียก list, capability และ documents
- **THEN** list และ documents ตอบ error รหัส unsupported ด้วยโครงเดียวกับ fallback และ capability ตอบ available: false พร้อม code unsupported โดยไม่เรียก runtime

#### Scenario: เปิดอยู่

- **WHEN** config ไม่มี foundation_workflow แล้วเรียก list
- **THEN** ตอบ snapshot ตามปกติ

#### Scenario: คนละ location

- **WHEN** สอง location ในเซิร์ฟเวอร์เดียว location แรกปิด workflow อีกอันไม่ปิด
- **THEN** location แรกได้ unsupported อีกอันได้ข้อมูลปกติ

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
