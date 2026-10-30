# foundation-webui-documents Specification

## Purpose
Port Documents, Tasks, Investigations และ Markdown ปลอดภัยของ web UI ไป app v2.
## Requirements
### Requirement: document-reader

ตัวอ่านเอกสาร SHALL เรียก foundation.documents/document/investigations/investigation สำหรับ location ที่เลือก ตรวจ response ด้วย schema Foundation.DocumentPage/Document และแปลง error ของ server เป็น code โดยไม่ส่งข้อมูลบางส่วน

#### Scenario: index ของ change

- **WHEN** อ่าน index ด้วย changeID, search และ offset 50
- **THEN** request ไปที่ /experimental/foundation/changes/{id}/documents พร้อม location, search, offset 50 และ limit 50 และคืน DocumentPage ที่ decode แล้ว

#### Scenario: index ของโน้ต

- **WHEN** อ่าน index โดยไม่มี changeID
- **THEN** request ไปที่ /experimental/foundation/investigations

#### Scenario: เนื้อหาเอกสารและโน้ต

- **WHEN** อ่านเนื้อหาด้วย documentID ของ change และด้วย investigationID
- **THEN** request ไปที่ .../documents/{documentID} และ .../investigations/{investigationID} ตามลำดับ และคืน Document

#### Scenario: เอกสารใหญ่หรือเสีย

- **WHEN** server ตอบ FoundationDocumentSizeError (413) หรือ FoundationDocumentInvalidError (422)
- **THEN** ล้มด้วย code document_too_large และ invalid_document ตามลำดับ

#### Scenario: body ผิด schema

- **WHEN** response ของ document ไม่ตรงกับ Foundation.Document
- **THEN** ล้มด้วย code invalid_response

### Requirement: document-refresh

document refresh SHALL เลือกเอกสารตาม id หรือ preferred, cache เนื้อหาตาม modifiedAt และ size, ทิ้ง response ของ selection เก่า, แยกความล้มเหลวของ index กับ body และ poll ทุก 10 วินาทีเฉพาะเมื่อมองเห็น

#### Scenario: เลือก proposal

- **WHEN** target มี changeID และ preferred เป็น proposal.md
- **THEN** controller อ่านเนื้อหาของ proposal.md จาก index

#### Scenario: ใช้ cache

- **WHEN** refresh ซ้ำและ index ยังมี modifiedAt และ size เดิม
- **THEN** ไม่อ่านเนื้อหาซ้ำ

#### Scenario: ไม่พบเอกสาร

- **WHEN** id ที่ขอไม่อยู่ใน index
- **THEN** state มี bodyError document_not_found และไม่มี document

#### Scenario: body ล้มแต่ index ใช้ได้

- **WHEN** index สำเร็จแต่การอ่านเนื้อหาล้มด้วย invalid_document
- **THEN** state เก็บ page ไว้ ตั้ง bodyError เป็น invalid_document และไม่ตั้ง error ของ index

#### Scenario: ทิ้ง response เก่า

- **WHEN** เปลี่ยน selection ขณะ request เดิมยังไม่กลับ
- **THEN** ผลของ request เดิมไม่ถูกเขียนลง state

### Requirement: document-excerpt

excerpt SHALL เลือกส่วนของโน้ตที่โฟกัส (anchor, Summary/Findings, หรือหัวข้อระดับ 2 แรก) รวมหัวข้อย่อย ไม่รวมหัวข้อพี่น้อง และเลือกเฉพาะส่วน Why สำหรับ Overview

#### Scenario: เปิดส่วน Findings

- **WHEN** เอกสารมี Findings (มี ### ย่อย) และ Options
- **THEN** text มี Findings พร้อมหัวข้อย่อย ไม่มี Options และ line ของ sections ถูกเลื่อนให้เริ่มที่ 1

#### Scenario: anchor ไม่ถูกต้อง

- **WHEN** anchor ไม่ตรงกับ section ใด
- **THEN** ใช้ส่วนเริ่มต้นแทน

#### Scenario: Why

- **WHEN** ขอ purpose why
- **THEN** ได้เฉพาะเนื้อหาใต้ Why และเมื่อไม่มีหัวข้อ Why ได้ข้อความ Why section unavailable.

#### Scenario: โน้ตไม่มีหัวข้อ

- **WHEN** เอกสารไม่มี sections
- **THEN** คืนข้อความทั้งหมด

### Requirement: safe-markdown

ตัวแสดง Markdown SHALL ไม่แสดง raw HTML (escape), ละรูปภาพ, รับลิงก์ภายนอกเฉพาะ https และลิงก์ภายในเฉพาะเอกสารที่ index แล้วหรือ section ของเอกสาร และต้องกรองผลด้วย allowlist

#### Scenario: raw HTML

- **WHEN** ข้อความมี <script>alert(1)</script> และ <img onerror=x>
- **THEN** ผลลัพธ์ไม่มี element script หรือ img และข้อความถูก escape

#### Scenario: ลิงก์อันตราย

- **WHEN** ลิงก์เป็น javascript:, data: หรือ http:
- **THEN** ไม่เป็น a href แต่แสดงป้าย link unavailable

#### Scenario: ลิงก์ https

- **WHEN** ลิงก์เป็น https://example.com
- **THEN** เป็น a href พร้อม target _blank และ rel noopener noreferrer

#### Scenario: ลิงก์ไปเอกสารที่ index

- **WHEN** ลิงก์สัมพัทธ์ชี้ไป sourcePath ของเอกสารใน index
- **THEN** เป็น a ที่มี data-document-id ของเอกสารนั้น และชี้นอก index ได้ป้าย link unavailable

#### Scenario: รูปภาพ

- **WHEN** ข้อความมี ![alt](https://tracker.example/x.png)
- **THEN** ไม่มี element img และแสดง alt พร้อมป้าย image omitted

#### Scenario: anchor ของหัวข้อ

- **WHEN** ลิงก์ #slug ตรงกับ section id หรือชื่อหัวข้อ
- **THEN** เป็นลิงก์ #id ของ section และหัวข้อระดับบนสุดได้ id จาก sections ของ server

### Requirement: investigations-library

Changes SHALL มีหมวด Investigations คู่กับ Active/Archived แสดงโน้ตจาก index พร้อมค้นหา แบ่งหน้า และหน้าอ่านโน้ตที่มี section nav, Full source text, references ที่ตรงเป๊ะ และปุ่ม Continue investigation / Draft change ที่เปิด draft พร้อม reference ของโน้ต

#### Scenario: รายการโน้ต

- **WHEN** index มีโน้ต 2 รายการ
- **THEN** แสดงหัวข้อ (ตัดคำนำ Investigation:), sourcePath, ป้าย Note saved และเวลาแก้ไข

#### Scenario: ว่างแยกกรณี

- **WHEN** total เป็น 0 โดยมีและไม่มี search
- **THEN** แสดง No saved notes match your search และ No saved investigations ตามลำดับ

#### Scenario: ไม่มี reference

- **WHEN** โน้ตไม่มี references
- **THEN** แสดงข้อความ No explicit change reference found โดยไม่เดา relation จากชื่อ

#### Scenario: ตาม reference

- **WHEN** กด reference ของ change ใน openspec/changes/archive/
- **THEN** ไปที่ scope archive ของ change นั้นในแท็บ Documents

#### Scenario: draft จากโน้ต

- **WHEN** กด Continue investigation และ Draft change บนโน้ตที่มี sourcePath
- **THEN** ขอ draft /investigate <sourcePath> และ /change <sourcePath> ตามลำดับ และ investigateDraft/noteDraft คืน undefined เมื่อ command นั้นไม่มี

#### Scenario: นับหมวด

- **WHEN** การนับของหมวดหนึ่งล้ม
- **THEN** ป้ายหมวดนั้นแสดง — แทนตัวเลข ไม่แสดง 0

### Requirement: change-documents

รายละเอียด change SHALL มีแท็บ Documents และ Tasks และ Overview แสดง Why จาก proposal.md, ข้อเท็จจริงจาก snapshot และทางลัดไปเอกสาร โดย checkbox ของ tasks.md และ claims ของ evidence.yaml เป็นคำประกาศที่ไม่ใช่ proof และความล้มเหลวของเอกสารต้องไม่ทำให้ข้อมูล runtime หาย

#### Scenario: ชื่อจาก proposal

- **WHEN** proposal.md มีหัวข้อระดับ 1
- **THEN** หัวข้อหน้ารายละเอียดใช้ชื่อนั้น (ตัดคำนำ Change:) และถ้าอ่านไม่ได้ใช้ title หรือ ID

#### Scenario: tasks เป็น checklist

- **WHEN** tasks.md มี 3 tasks ติ๊กแล้ว 1
- **THEN** แสดง 1/3 checked · Checklist only, not proof และรายการ task พร้อมสถานะ ☑/☐

#### Scenario: tasks ไม่รู้จัก

- **WHEN** เอกสารไม่มี checkbox ที่รู้จัก
- **THEN** แสดง No recognizable task checkboxes. Inspect the original source.

#### Scenario: claims ที่ประกาศ

- **WHEN** เปิดแท็บ Evidence ของ change ที่มี evidence.yaml
- **THEN** แสดงรายการ claims ที่ประกาศใน evidence.yaml ใต้ค่า evidence จาก snapshot
- **AND** มีข้อความว่า claims เป็นคำประกาศ ไม่ใช่ผลทดสอบที่บันทึก

#### Scenario: เอกสารอ่านไม่ได้

- **WHEN** การอ่าน proposal.md ล้มด้วย document_too_large
- **THEN** Overview แสดง Proposal summary unavailable และข้อเท็จจริงจาก snapshot (phase, status, evidence) ยังแสดงอยู่

#### Scenario: ทางลัดเอกสาร

- **WHEN** index ของ change มี proposal.md และ design.md
- **THEN** Overview มีปุ่มชื่อไฟล์ทั้งสองที่เปิดแท็บ Documents ที่เอกสารนั้น

#### Scenario: ข้อมูลที่ไม่มี

- **WHEN** snapshot ไม่มี branch
- **THEN** ข้อเท็จจริง Branch แสดง Unavailable ไม่เดาค่า

### Requirement: markdown-dependencies

packages/app SHALL ประกาศ marked และ dompurify เป็น dependency และ bun.lock SHALL ตรงกับ package.json

#### Scenario: lockfile ตรง

- **WHEN** รัน bun install --frozen-lockfile
- **THEN** สำเร็จโดยไม่แก้ bun.lock
