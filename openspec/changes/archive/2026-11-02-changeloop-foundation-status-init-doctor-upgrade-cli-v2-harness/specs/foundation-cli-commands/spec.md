# foundation-cli-commands

## Purpose

เพิ่มคำสั่ง changeloop foundation (status, init, doctor, upgrade) บน CLI v2 ให้ผู้ใช้โปรเจกต์ที่ยังไม่มี harness ติดตั้ง ตรวจ และอัปเกรด Foundation ได้ตามที่ plugin และเอกสารสัญญาไว้ โดยไม่แก้ไฟล์ถ้าไม่ได้รับอนุมัติ.

## ADDED Requirements

### Requirement: foundation-status-reports-versions

changeloop foundation status [path] SHALL รายงานเวอร์ชันและ release ที่ bundle กับสถานะที่ติดตั้ง (missing, installed, invalid) โดยไม่เขียนไฟล์ใด และ --json SHALL พิมพ์ JSON ออบเจ็กต์เดียวที่มี root, bundle (schema, release, commit, version, tagged, hostProtocols) และ installed ส่วน exit code SHALL เป็น 1 เมื่อสถานะ installed เป็น invalid และ 0 กรณีอื่น

#### Scenario: โปรเจกต์ยังไม่มี harness

- **WHEN** รัน status --json ในโปรเจกต์ว่าง
- **THEN** JSON มี installed.state เป็น missing, bundle.release ตรงกับ manifest ที่ฝัง, exit code 0 และโปรเจกต์ไม่มีไฟล์เพิ่ม

#### Scenario: หลัง init

- **WHEN** รัน init --yes แล้ว status --json
- **THEN** installed.state เป็น installed พร้อม runtime และ runtimeApi ของที่ติดตั้ง

#### Scenario: protocol.json เสีย

- **WHEN** .claude/harness/protocol.json ไม่ใช่ JSON ที่ถูกต้อง
- **THEN** installed.state เป็น invalid และ exit code 1

#### Scenario: ข้อความอ่านง่าย

- **WHEN** รัน status โดยไม่มี --json
- **THEN** พิมพ์บรรทัดเดียวที่ระบุ bundled version, release และ installed state

### Requirement: foundation-write-requires-approval

changeloop foundation init และ upgrade SHALL ไม่เรียก installer และไม่เขียนไฟล์ในโปรเจกต์จนกว่าจะได้รับอนุมัติด้วย --yes หรือการยืนยันใน terminal จริง; เมื่อไม่ได้อนุมัติ SHALL จบด้วย exit code 1 พร้อมข้อความที่บอกให้ใช้ --yes

#### Scenario: ไม่มี --yes และไม่ใช่ terminal

- **WHEN** รัน init ในโปรเจกต์ว่างโดย stdin ไม่ใช่ terminal
- **THEN** exit code 1, ข้อความระบุ --yes และโปรเจกต์ไม่มีไฟล์เพิ่ม

#### Scenario: ผู้ใช้ปฏิเสธการยืนยัน

- **WHEN** ผ่านตัวฉีด confirm ที่ตอบไม่ใช่
- **THEN** ไม่เรียก installer และคืนผล cancelled

#### Scenario: upgrade ก็ต้องอนุมัติ

- **WHEN** รัน upgrade โดยไม่มี --yes ในโปรเจกต์ที่ติดตั้งแล้ว
- **THEN** exit code 1 และไฟล์ที่ติดตั้งไม่เปลี่ยน

### Requirement: foundation-init-installs-bundled-harness

changeloop foundation init --yes [path] SHALL ติดตั้ง harness ของ Foundation ด้วย installer ที่ฝังใน binary ผ่าน init --host opencode แล้วรายงาน release ที่ติดตั้งและผล doctor โดยไม่ต้องมี claude-foundation ใน PATH และ SHALL ทำซ้ำได้โดยผลเหมือนเดิมโดยไม่เปลี่ยนไฟล์ที่ไม่ใช่ของ Foundation

#### Scenario: โปรเจกต์ใหม่

- **WHEN** รัน init --yes ในโปรเจกต์ git ว่างที่มีไฟล์ของผู้ใช้หนึ่งไฟล์
- **THEN** exit code 0, มี .claude/harness/protocol.json, .opencode/commands, .opencode/plugins/foundation.js และ .foundation/adapter-manifests/opencode.txt, status เป็น installed, doctor ผ่าน และไฟล์ของผู้ใช้ไม่เปลี่ยน

#### Scenario: ไม่มี claude-foundation ใน PATH

- **WHEN** รัน init --yes โดย PATH ไม่มี claude-foundation
- **THEN** ติดตั้งสำเร็จด้วย runtime ที่ฝัง

#### Scenario: รันซ้ำ

- **WHEN** รัน init --yes สองครั้ง
- **THEN** ทั้งสองครั้ง exit code 0 และไฟล์ที่ Foundation เป็นเจ้าของมีเนื้อหาเท่าเดิม

#### Scenario: ระบุ path

- **WHEN** รัน init --yes <directory> จาก cwd อื่น
- **THEN** ติดตั้งใน directory นั้น ไม่ใช่ cwd

#### Scenario: installer ล้ม

- **WHEN** ตัวฉีด install คืน exit code ไม่ใช่ศูนย์
- **THEN** คืน exit code นั้นพร้อมพิมพ์ stderr และไม่รายงานว่าติดตั้งแล้ว

### Requirement: foundation-upgrade-converges-managed-files

changeloop foundation upgrade --yes [path] SHALL ทำให้ไฟล์ที่ Foundation เป็นเจ้าของตรงกับ release ที่ bundle กับ binary นี้ และ SHALL ไม่ลบหรือแก้ไฟล์นอก manifest ของ Foundation รวมถึงไฟล์ของผู้ใช้ที่ชื่อชนกับ command ของ Foundation

#### Scenario: ซ่อมไฟล์ที่ถูกแก้

- **WHEN** ติดตั้งแล้วไฟล์ .opencode/commands/<คำสั่ง>.md ที่ Foundation เป็นเจ้าของถูกแก้ แล้วรัน upgrade --yes
- **THEN** ไฟล์กลับเป็นเนื้อหา canonical ของ release ที่ฝัง

#### Scenario: ไฟล์นอก manifest

- **WHEN** โปรเจกต์มีไฟล์ของผู้ใช้ใน .opencode/commands ที่ชื่อไม่ชนและไฟล์อื่นที่ราก แล้วรัน upgrade --yes
- **THEN** ไฟล์เหล่านั้นยังอยู่และเนื้อหาไม่เปลี่ยน

#### Scenario: ไฟล์ชื่อชนที่ manifest ไม่ได้เป็นเจ้าของ

- **WHEN** ผู้ใช้มี .opencode/commands/<ชื่อเดียวกับ Foundation>.md ของตนเองก่อน init
- **THEN** ไฟล์ของผู้ใช้ถูกเก็บไว้ไม่ถูกเขียนทับ

### Requirement: foundation-doctor-reports-health

changeloop foundation doctor [path] SHALL รัน diagnostics ของ Foundation ที่ฝังใน binary กับโปรเจกต์โดยไม่เขียนไฟล์ในโปรเจกต์ พิมพ์ stdout และ stderr ของ diagnostics และจบด้วย exit code ของมัน

#### Scenario: โปรเจกต์ที่ติดตั้งดี

- **WHEN** รัน doctor หลัง init --yes
- **THEN** exit code 0 และมีผลวินิจฉัยใน stdout

#### Scenario: doctor ล้ม

- **WHEN** ตัวฉีด doctor คืน exit code 7 พร้อม stderr
- **THEN** พิมพ์ stderr และคืน exit code 7

#### Scenario: ก่อน init

- **WHEN** รัน doctor ในโปรเจกต์ที่ยังไม่มี harness
- **THEN** จบโดยไม่เขียนไฟล์ใหม่ในโปรเจกต์ และรายงานผลของ diagnostics ด้วย exit code ของมัน

### Requirement: foundation-rejects-unsafe-target

ทุกคำสั่ง foundation SHALL ปฏิเสธ target ที่ไม่ปลอดภัยด้วยข้อความ error และ exit code 1 ก่อนเรียก installer: path ที่ไม่มีอยู่หรือไม่ใช่ directory, โปรเจกต์ที่ path ซึ่ง Foundation จัดการ (เช่น .claude/commands หรือ .opencode/plugins) เป็น symlink หรือมี symlink อยู่ข้างใน, และแพลตฟอร์ม win32

#### Scenario: path ไม่มีอยู่

- **WHEN** รัน init --yes ที่ path ที่ไม่มี
- **THEN** exit code 1 พร้อมข้อความ error และไม่มี directory ถูกสร้าง

#### Scenario: path เป็นไฟล์

- **WHEN** รัน status ที่ path ซึ่งเป็นไฟล์ปกติ
- **THEN** exit code 1 พร้อมข้อความว่าไม่ใช่ directory

#### Scenario: managed path เป็น symlink

- **WHEN** .claude/commands เป็น symlink ไปนอกโปรเจกต์ แล้วรัน init --yes
- **THEN** exit code 1 ระบุ symlinked managed path, ไม่มีไฟล์ถูกเขียนผ่าน symlink และ installer ไม่ถูกเรียก

#### Scenario: แพลตฟอร์ม win32

- **WHEN** install ถูกเรียกด้วย platform win32
- **THEN** คืน exit code 1 พร้อมข้อความไม่รองรับ และไม่เขียนไฟล์

### Requirement: foundation-commands-registered

CLI SHALL ลงทะเบียน changeloop foundation พร้อม subcommand status, init, doctor และ upgrade ใน help และ handler map; ข้อความ help SHALL ใช้ชื่อ Changeloop และไม่มี OpenCode; ทุกคำสั่งรับ argument path ที่เป็น directory ของโปรเจกต์ โดย default คือ directory ปัจจุบัน

#### Scenario: help ของ foundation

- **WHEN** รัน foundation --help
- **THEN** exit code 0 รายการมีสี่ subcommand และข้อความนอกบรรทัด USAGE ไม่มี opencode

#### Scenario: root help

- **WHEN** รัน --help
- **THEN** มีคำสั่ง foundation พร้อมคำอธิบาย

#### Scenario: path เริ่มต้น

- **WHEN** รัน status --json จากภายในโปรเจกต์โดยไม่ระบุ path
- **THEN** root ใน JSON คือ directory ปัจจุบัน
