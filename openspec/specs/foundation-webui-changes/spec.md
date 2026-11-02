# foundation-webui-changes Specification

## Purpose
Port หน้า Changes ของ Foundation web UI ไปบน app v2.
## Requirements
### Requirement: changes-list

หน้า Changes SHALL แสดง change ของ server และโปรเจกต์ที่เลือกจาก foundation.list แยก active กับ archived พร้อมค้นหา, pagination ครั้งละ 50 และ Snapshot generatedAt โดยไม่คำนวณ title หรือสถานะเอง

#### Scenario: แสดงรายการ

- **WHEN** foundation.list คืน 2 items ที่มี phase, status และ evidenceStatus
- **THEN** view แสดงสองแถวโดยใช้ title หรือ ID เป็นชื่อ และแสดง Phase, Status, Evidence ของแต่ละแถวพร้อม Snapshot generatedAt

#### Scenario: ไม่มี evidence

- **WHEN** item ไม่มี evidenceStatus และ evidence เป็น null
- **THEN** แถวแสดง Evidence เป็น Unavailable ไม่ใช่ค่าว่างหรือ pass

#### Scenario: archived เป็นประวัติ

- **WHEN** scope เป็น archive
- **THEN** แสดงข้อความ Delivered history ว่าหลักฐานที่ตรวจสอบไม่ได้ไม่ยกเลิกการส่งมอบ และรายการไม่ถูกนับเป็น active

#### Scenario: ว่างแยกตามเงื่อนไข

- **WHEN** รายการว่างใน scope active, ใน scope archive และเมื่อมี search
- **THEN** แสดงข้อความ No active changes, No archived changes และ No changes match your search ตามลำดับ

#### Scenario: pagination

- **WHEN** total มากกว่า 50 และ nextOffset ไม่เป็น null
- **THEN** แสดง Previous/Next โดย Next ใช้ nextOffset และ Previous ปิดเมื่อ offset เป็น 0

### Requirement: failure-states

หน้า Changes SHALL แยกแสดง unsupported, not_initialized, denied, timeout, invalid_response และ disconnected เป็นข้อความต่างกัน พร้อม Retry และห้ามถือความล้มเหลวเป็นรายการว่าง

#### Scenario: server ไม่รองรับ

- **WHEN** foundation.list ตอบ FoundationUnavailableError code unsupported หรือ server เก่าตอบ 404
- **THEN** reader ล้มด้วย code unsupported และ view แสดงข้อความว่าไม่รองรับ Changes พร้อม Retry ไม่แสดง No active changes

#### Scenario: ยังไม่ init

- **WHEN** foundation.list ตอบ FoundationUninitializedError code not_initialized
- **THEN** view แสดงว่า Foundation ยังไม่ถูก init ในโปรเจกต์นี้ และไม่ส่ง request ที่เขียนหรือ init ใด ๆ

#### Scenario: ไม่มีสิทธิ์หรือ transport ล้ม

- **WHEN** response เป็น 401 หรือ 403 และเมื่อ fetch ล้มด้วย Transport error
- **THEN** reader คืน code denied และ disconnected ตามลำดับ และ view แสดงข้อความของแต่ละ code

#### Scenario: response ผิด schema

- **WHEN** foundation.list คืน body ที่ decode ด้วย Foundation.Page ไม่ได้
- **THEN** reader ล้มด้วย code invalid_response และไม่ส่งข้อมูลบางส่วนให้ view

#### Scenario: คงข้อมูลเดิม

- **WHEN** refresh ล้มหลังเคยอ่านสำเร็จ
- **THEN** view ยังแสดงรายการเดิมพร้อม generatedAt เดิมและข้อความ Showing stale data from the last successful read

### Requirement: change-detail

รายละเอียด change SHALL มี Overview, Evidence และ Usage โดยแสดง recordedStatus, status ปัจจุบันและ freshness แยกกัน และแสดง usage ที่เป็น null ว่า Unavailable

#### Scenario: evidence แยกสามค่า

- **WHEN** change มี evidence recordedStatus pass, status unverified, freshness unavailable
- **THEN** แท็บ Evidence แสดง Recorded status pass, Current status unverified และ Freshness unavailable เป็นสามค่า ไม่รวมเป็นสีเขียวเดียว

#### Scenario: usage เป็น null

- **WHEN** budget.lifetime.usedRequests เป็น null
- **THEN** แท็บ Usage แสดง Unavailable ในช่องนั้น ไม่แสดง 0

#### Scenario: ไม่มี budget

- **WHEN** budget เป็น null
- **THEN** แท็บ Usage แสดงว่า Usage is unavailable

#### Scenario: workflow track

- **WHEN** change มี phase build
- **THEN** workflow track มี aria-current step บน Build เท่านั้น

#### Scenario: เลื่อนแท็บด้วยคีย์บอร์ด

- **WHEN** focus อยู่ที่แท็บและกด ArrowRight
- **THEN** focus และการเลือกย้ายไปแท็บถัดไป และ ArrowLeft ที่แท็บแรกวนไปแท็บสุดท้าย

### Requirement: selection-refresh

ตัวอ่านข้อมูล SHALL key ตาม server และ directory ทิ้ง response ของ selection เก่า poll ทุก 10 วินาทีเฉพาะเมื่อหน้ามองเห็น และหยุดเมื่อซ่อนหรือ dispose

#### Scenario: ทิ้ง response เก่า

- **WHEN** เปลี่ยน selection ระหว่างที่ request ก่อนหน้ายังไม่กลับ แล้ว request เก่ากลับมาทีหลัง
- **THEN** state ไม่ถูกเขียนด้วย response เก่า

#### Scenario: poll เมื่อมองเห็น

- **WHEN** visibility เป็น true แล้วเวลาผ่านไป 10 วินาที
- **THEN** controller เรียก reader อีกครั้ง และหยุดเรียกเมื่อ visibility เป็น false หรือ dispose

#### Scenario: รวม request

- **WHEN** เรียก refresh สองครั้งติดกันขณะที่ request แรกยังไม่เสร็จ
- **THEN** reader ถูกเรียกครั้งเดียว

#### Scenario: ข้อมูลเดิมเมื่อล้ม

- **WHEN** reader ล้มหลังมีข้อมูลสำเร็จ
- **THEN** state เก็บข้อมูลเดิมไว้ ตั้ง stale เป็น true และตั้ง error เป็น code ของความล้มเหลว

### Requirement: session-draft-handoff

ปุ่ม Continue in session และ New investigate SHALL เปิด draft ในโปรเจกต์ที่เลือกด้วยคำสั่งที่มีอยู่จริงโดยไม่ submit และไม่สั่ง lifecycle

#### Scenario: เลือกคำสั่งตาม phase

- **WHEN** change มี phase build และ command build มีอยู่
- **THEN** changeDraft คืน /build ตามด้วย change ID

#### Scenario: archived ใช้ /changes

- **WHEN** change มี status archived หรือ phase ที่ไม่อยู่ใน change/build/prove/land
- **THEN** changeDraft คืน /changes

#### Scenario: ไม่มีคำสั่ง

- **WHEN** ไม่มีทั้ง command ของ phase และ changes
- **THEN** changeDraft คืน undefined และ view แสดงข้อความ Foundation commands ไม่พร้อมโดยไม่เปิด draft

#### Scenario: โหลด commands ไม่ได้

- **WHEN** การโหลดรายการ command ของโปรเจกต์ล้ม
- **THEN** view แสดงข้อความ Unable to load project commands และไม่เปิด draft

### Requirement: route-and-entry

app SHALL ลงทะเบียน route /changes เป็น LayoutRoute changes ที่ไม่เป็น tab และ Home SHALL มีปุ่มทางเข้า Changes โดยหน้านี้ใช้ server/โปรเจกต์จาก Home selection

#### Scenario: จำแนก route

- **WHEN** currentRoute รับ pathname /changes
- **THEN** คืน { type: changes } และ pathname อื่นที่รู้จักเดิม (/, /settings, /new-session, session) คืนค่าเดิม

#### Scenario: ไม่มีโปรเจกต์

- **WHEN** Home selection ไม่มีโปรเจกต์
- **THEN** หน้า Changes แสดงข้อความให้เลือกโปรเจกต์และไม่ส่ง request

#### Scenario: typecheck ทั้ง app

- **WHEN** รัน typecheck ของ packages/app หลังเพิ่ม LayoutRoute changes
- **THEN** ไม่มี type error และทุก switch เหนือ LayoutRoute ครอบคลุม changes
