# model-router

## ADDED Requirements

### Requirement: router-config-normalize

ConfigNormalize SHALL แปลง section router เป็น plugin operation แบบ configure-only ของ opencode.router โดยข้ามรายการผิดรูปพร้อม diagnostic ชนิด invalid และ config ที่ไม่มี router SHALL ไม่เปลี่ยน

#### Scenario: แปลงตารางที่ถูกต้อง

- **WHEN** normalize config ที่มี router ครบ tiers agents small_model
- **THEN** plugins มีรายการ package opencode.router ที่ options เก็บ router ครบและ $configureOnly เป็น true และไม่มี diagnostic

#### Scenario: รายการผิดรูปถูกข้าม

- **WHEN** normalize config ที่ router มี tier ที่ไม่ใช่อาร์เรย์ agents ที่ค่าไม่ใช่ string และรายการที่ถูกต้องอื่น พร้อม username
- **THEN** diagnostic ชนิด invalid ที่ path ของแต่ละรายการเสีย รายการที่ถูกต้องยังอยู่ใน options และ username ยังอยู่ใน encoded

#### Scenario: router ไม่ใช่ object

- **WHEN** normalize config ที่ router เป็น string
- **THEN** diagnostic invalid ที่ path router ไม่มี plugin จาก key นี้ และ config ส่วนที่เหลือโหลดได้

#### Scenario: ไม่มี router

- **WHEN** normalize config ที่ไม่มี router
- **THEN** encoded เหมือนก่อนเปลี่ยน ไม่มี field plugins เพิ่ม และเอกสารที่ normalize แล้ว decode เป็น Info ได้

### Requirement: router-resolution

resolveRouting SHALL ตั้ง model ของ agent และช่อง small-model เป็น candidate ตัวแรกที่ใช้ได้ของ tier (หรือ model ตรงๆ) เติมเฉพาะช่องที่ว่าง และเมื่อไม่มี candidate ใช้ได้ SHALL ไม่ pin และ SHALL คืนคำเตือนหนึ่งข้อความต่อช่อง

#### Scenario: pin candidate แรกที่พร้อม

- **WHEN** provider anthropic พร้อมใช้และตาราง map plan ไป tier deep, test ไป tier fast, debug ไป openai/gpt-5 และ small_model เป็น fast
- **THEN** plan และ test และ small model ได้ candidate ของ anthropic, debug ไม่ถูก pin และมีคำเตือนหนึ่งข้อความ

#### Scenario: ข้ามไป candidate ถัดไป

- **WHEN** provider ของ candidate แรกไม่พร้อมแต่ตัวที่สองพร้อม
- **THEN** ช่องนั้นได้ candidate ตัวที่สอง

#### Scenario: ไม่มี candidate พร้อม

- **WHEN** ไม่มี provider พร้อมใช้เลย
- **THEN** ไม่มีช่องใดถูก pin และมีคำเตือนหนึ่งข้อความต่อช่องที่ map ไว้

#### Scenario: pin ของผู้ใช้ชนะ

- **WHEN** agent plan และ small model มี model ตั้งไว้แล้ว และทุก provider พร้อมใช้
- **THEN** ไม่มีการเปลี่ยนช่องเหล่านั้น

#### Scenario: ชื่อ tier ไม่มี candidate

- **WHEN** agents ชี้ไปชื่อที่ไม่ใช่ tier และไม่ใช่รูป provider/model
- **THEN** ไม่ pin และมีคำเตือนหนึ่งข้อความ

### Requirement: router-instance

อินสแตนซ์จริงที่โหลด config ที่มี router SHALL ตั้ง model ของ agent ที่ map ไว้และ agent title ตามความพร้อมของ provider, ไม่ทับ pin ของผู้ใช้, ไม่ pin เมื่อไม่มี candidate พร้อม และ SHALL ไม่เปลี่ยนอะไรเมื่อไม่มี router

#### Scenario: provider พร้อม

- **WHEN** config กำหนด provider พร้อม model ในโปรเจกต์และ router map agent build ไป tier ที่ candidate แรกเป็น model นั้น และ small_model เป็น tier เดียวกัน
- **THEN** agent build และ agent title มี model เป็น candidate นั้นเมื่ออ่านจาก Agent service

#### Scenario: provider ไม่พร้อม

- **WHEN** router map agent build ไป tier ที่ไม่มี candidate ของ provider ที่พร้อมใช้
- **THEN** agent build ไม่มี model ที่ router ตั้ง และอินสแตนซ์ boot สำเร็จ

#### Scenario: pin ของผู้ใช้ชนะ

- **WHEN** config ตั้ง model ของ agent build เองและ router map agent เดียวกัน
- **THEN** model ของ agent build ยังเป็นค่าที่ผู้ใช้ตั้ง

#### Scenario: ไม่มี router

- **WHEN** config ไม่มี router
- **THEN** ไม่มี agent ใดมี model ที่ router ตั้ง และ plugin opencode.router อยู่ใน inventory สถานะ active

#### Scenario: ค่าผิดรูป

- **WHEN** router มีรายการผิดรูปควบคู่กับ username ที่ถูกต้อง
- **THEN** อินสแตนซ์ boot สำเร็จ และรายการที่ถูกต้องยังมีผล

#### Scenario: ปิด plugin

- **WHEN** config มี router และ plugins ที่ลบ opencode.router
- **THEN** ไม่มี agent ถูก router ตั้ง model
