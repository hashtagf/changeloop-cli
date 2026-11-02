# foundation-builtin-wiring Specification

## Purpose
ทำให้ binary changeloop ที่ build จาก packages/cli มี Foundation workflow ใช้ได้จริง: ลงทะเบียน plugin เป็น builtin ของ v2 และฝัง bundle ของ runtime เข้า binary โดยไม่อ่าน vendor จากดิสก์.
## Requirements
### Requirement: embedded-files-source

plugin SHALL ใช้ไฟล์ runtime ที่ฝังในบิลด์เมื่อมีโมดูล virtual:opencode-foundation-files และ SHALL ใช้ vendor บนดิสก์เมื่อไม่มี โดยไม่ล้มทั้ง plugin

#### Scenario: มีไฟล์ฝัง

- **WHEN** โมดูล embedded resolve ได้และให้ map ของไฟล์
- **THEN** runtimeOptions.files ที่ plugin ใช้เท่ากับ map นั้น และ FoundationRuntime อ่าน manifest จากไฟล์ใน map

#### Scenario: ไม่มีโมดูล

- **WHEN** import ของ embedded ล้มเหลว
- **THEN** plugin ยังลงทะเบียนครบ และ runtimeOptions.files เป็น undefined เพื่อใช้ vendor บนดิสก์

#### Scenario: ผู้เรียกกำหนด files เอง

- **WHEN** make ได้รับ runtimeOptions.files มาแล้ว
- **THEN** ค่าของผู้เรียกชนะ embedded

### Requirement: builtin-registration

core SHALL ลงทะเบียน FoundationPlugin เป็น builtin ใน PluginInternal ก่อน ConfigCommandPlugin เพื่อให้คำสั่งที่ผู้ใช้ตั้งชื่อซ้ำทับ builtin ได้ และผู้ใช้ SHALL ปิดได้ด้วยการลบ id opencode.foundation

#### Scenario: ลงทะเบียน builtin

- **WHEN** instance เริ่มทำงานตามปกติ
- **THEN** inventory มี opencode.foundation สถานะ active และ Command.Service มีคำสั่ง investigate, change, build, prove, land, changes, feature, dev ครบ 8 พร้อม description

#### Scenario: ลำดับก่อน config command

- **WHEN** ดูลำดับ activation ใน inventory
- **THEN** opencode.foundation อยู่ก่อน opencode.config.command

#### Scenario: ผู้ใช้ปิด

- **WHEN** config plugin มี operation remove ของ opencode.foundation
- **THEN** inventory ไม่มี opencode.foundation และ Command.Service ไม่มีคำสั่ง Foundation ทั้ง 8

### Requirement: build-embeds-runtime

สคริปต์ build ของ packages/cli SHALL สร้างโมดูล virtual:opencode-foundation-files จากไฟล์ vendor ที่ตรวจ manifest และ checksum แล้ว และฝังไฟล์ทุกตัวเข้า binary ส่วน build ปกติ (--single --skip-web-ui) SHALL ยังสำเร็จ

#### Scenario: โมดูลที่สร้างอ่านได้

- **WHEN** bundle โมดูล embedded ด้วย Bun plugin ของ build แล้วรัน
- **THEN** default export เป็น map ที่มี manifest.json และไฟล์ payload ทุกไฟล์ที่ manifest ประกาศ และทุก path ชี้ไปไฟล์ที่อ่านได้

#### Scenario: vendor เสีย

- **WHEN** payload ไม่ตรง manifest
- **THEN** การสร้างโมดูลล้มด้วยข้อความ checksum mismatch และ build หยุด

#### Scenario: binary จริง

- **WHEN** build --single --skip-web-ui แล้วรัน binary
- **THEN** คำสั่ง builtin ทั้ง 8 ปรากฏจาก binary และ runtime materialize จากไฟล์ที่ฝัง (พิสูจน์ด้วย smoke มือที่รายงานแยก ไม่ใช่ proof ของ harness)
