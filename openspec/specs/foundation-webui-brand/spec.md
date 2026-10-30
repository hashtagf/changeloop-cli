# foundation-webui-brand Specification

## Purpose
Port wordmark Changeloop และปรับ nav กับตัวอ่านโน้ตของ web UI บน v2.
## Requirements
### Requirement: session-brand

หน้าเริ่ม session SHALL แสดง wordmark Changeloop แบบ SVG ที่สร้างจากตาราง glyph ของ CLI/TUI ที่มีชื่อ accessible Changeloop สัดส่วน 310:25 กว้างไม่เกิน 720px และห่าง composer 32px โดยไม่เปลี่ยนพฤติกรรมของ composer

#### Scenario: ตาราง glyph

- **WHEN** แปลง rows ของ wordmark เป็นพิกเซล
- **THEN** ทุกแถวกว้าง 62 คอลัมน์ มี 5 แถว และทุกพิกเซลอยู่ในกรอบ 310x25 โดยไม่มีพิกเซลซ้ำตำแหน่ง

#### Scenario: น้ำหนัก CHANGE และ LOOP

- **WHEN** แยกพิกเซลที่คอลัมน์ต่ำกว่า 36 (CHANGE) กับตั้งแต่ 36 (LOOP)
- **THEN** พิกเซลของ CHANGE มี opacity 0.6 และของ LOOP มี opacity 1

#### Scenario: ช่องคั่นระหว่างสองคำ

- **WHEN** อ่านคอลัมน์ที่ 35 ของทุกแถว
- **THEN** เป็นช่องว่างในทุกแถว เพื่อคั่น CHANGE (คอลัมน์ 0-34) กับ LOOP (คอลัมน์ 36 เป็นต้นไป)

#### Scenario: ชื่อและสัดส่วนบนหน้า

- **WHEN** เปิดหน้าเริ่ม session ที่ viewport 1440 กว้าง
- **THEN** wordmark เป็น role img ชื่อ Changeloop กว้าง 720px สูงประมาณ 58px และ composer เริ่มห่างจากขอบล่าง wordmark 32px

#### Scenario: จอแคบ

- **WHEN** เปิดหน้าเริ่ม session ที่ viewport 390 กว้าง
- **THEN** wordmark ย่อตามความกว้างคงสัดส่วน 310:25 และไม่ล้นแนวนอน

### Requirement: scopeless-change-link

route Changes SHALL ถือ scope เป็น archive เมื่อ change ใน address ไม่มี scope และ status เป็น archived และเป็น active เมื่อเป็นอย่างอื่น แล้วเขียน scope ลง address แบบ replace

#### Scenario: archived

- **WHEN** address มี change แต่ไม่มี scope และ change มี status archived
- **THEN** categoryOf คืน archive

#### Scenario: ยังไม่ทราบ status

- **WHEN** address มี change แต่ไม่มี scope และยังไม่ได้อ่าน change
- **THEN** categoryOf คืน active ไม่ใช่ investigations

#### Scenario: ไม่มี change

- **WHEN** address ไม่มีทั้ง change และ scope
- **THEN** categoryOf คืน investigations

#### Scenario: scope ชัดเจนชนะ

- **WHEN** address มี scope active แต่ change มี status archived
- **THEN** categoryOf คืน active

### Requirement: narrow-entry

Home บนจอแคบกว่า 768px SHALL แสดงปุ่ม Changes เดี่ยวที่นำไป /changes โดยไม่มีปุ่ม Settings หรือ Help เพิ่ม

#### Scenario: ปุ่มบนจอแคบ

- **WHEN** Home แสดงที่ความกว้าง 390px
- **THEN** มีปุ่ม Changes เพียงปุ่มเดียวจากกลุ่ม utility และกดแล้วไปที่ /changes

#### Scenario: กลุ่ม utility เต็ม

- **WHEN** Home แสดงที่ความกว้าง 1440px
- **THEN** กลุ่ม utility เดิมมี Changes, Settings และ Help ครบโดยไม่ซ้ำปุ่มของจอแคบ

### Requirement: note-links

ตัวอ่านโน้ต SHALL ตามลิงก์ #slug ไปส่วนอื่นของโน้ตด้วยการเปลี่ยน excerpt, เปิดเอกสารหรือโน้ตที่ id ไม่อยู่ใน index หน้าปัจจุบันด้วยการอ่านตรงด้วย id และคง fragment ของลิงก์ไปเอกสารอื่นเพื่อเปิดที่หัวข้อนั้น

#### Scenario: slug ไปส่วนอื่นของโน้ต

- **WHEN** excerpt แสดงส่วน Findings และลิงก์ #options ชี้ส่วน Options ของโน้ตเดียวกัน
- **THEN** ลิงก์เป็น a href ไป id ของ Options และการกดเรียก onAnchor ด้วย id นั้น

#### Scenario: slug ที่ไม่มี

- **WHEN** ลิงก์ #missing ไม่ตรงส่วนใดของโน้ต
- **THEN** ไม่เป็นลิงก์และแสดงป้าย link unavailable

#### Scenario: id นอกหน้า index

- **WHEN** target มี id ที่ไม่อยู่ใน items ของหน้าปัจจุบัน
- **THEN** controller อ่านเอกสารตรงด้วย id นั้นและแสดงเนื้อหาโดยไม่ตั้ง document_not_found

#### Scenario: id ที่ไม่มีจริง

- **WHEN** การอ่านตรงด้วย id นอกหน้า index ล้มด้วย invalid_input
- **THEN** state มี bodyError document_not_found และ index ยังใช้ได้

#### Scenario: fragment ของเอกสาร

- **WHEN** ลิงก์ design.md#why-now ชี้เอกสารใน index
- **THEN** ลิงก์มี data-document-id ของ design.md และ data-fragment เป็น why-now และ sectionForSlug คืน section ที่ชื่อ Why now

### Requirement: prototype-geometry

หน้า Changes SHALL รักษา hierarchy และ geometry ของ prototype ที่อนุมัติ: คอลัมน์เนื้อหากว้างไม่เกิน 720px, ช่องค้นหาสูง 36px, หัวข้อ Changes ขนาด 20px, หมวดและแท็บเป็นปุ่มขีดเส้นใต้ และหน้ารายละเอียดไม่มีตัวควบคุมของรายการ

#### Scenario: ส่วนหัวของรายการ

- **WHEN** แสดงหัวข้อและรายการ change ของ story
- **THEN** ช่องค้นหาสูง 36px, หัวข้อ Changes ขนาด 20px และหมวดแต่ละปุ่มมี border-bottom 2px

#### Scenario: รายละเอียดไม่มีตัวควบคุมรายการ

- **WHEN** เปิดรายละเอียดของ change
- **THEN** ไม่มีช่องค้นหา และไม่มีปุ่มหมวด Active/Archived ในหน้านั้น

#### Scenario: ความกว้างเนื้อหา

- **WHEN** แสดง story ที่ viewport 1440 กว้าง
- **THEN** คอลัมน์เนื้อหากว้างไม่เกิน 720px
