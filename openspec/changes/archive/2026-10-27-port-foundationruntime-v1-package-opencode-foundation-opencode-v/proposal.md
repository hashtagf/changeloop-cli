# Change: port FoundationRuntime จาก v1 มาเป็น package @opencode/foundation บน opencode v2

- **Change:** `port-foundationruntime-v1-package-opencode-foundation-opencode-v` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-27

## เหตุผล

เฟส 2 ของการ port fork ไปบน opencode v2.2.x: ย้าย `FoundationRuntime` (bundle, materialize, status, environment, command, hasManagedOpenCodeAdapter) จาก v1 มาเป็น package `@opencode/foundation` เพื่อให้ plugin และคำสั่ง Foundation ในเฟสถัดไปมี runtime ที่ตรวจสอบ checksum และ materialize ลง cache ได้เหมือน v1 โดยใช้ namespace `@opencode/*` และ effect 4.0.1

## ขอบเขต

- **In scope (`foundation-runtime`):** ตรวจ manifest และ checksum ของทุกไฟล์ใน payload ก่อนสร้าง source; ตรวจ checksum แล้วเขียน runtime ลง cache แบบ content-addressed และล็อกเป็น read-only; คืนคำสั่งและ PATH ตาม mode ที่เลือก; รายงานสถานะการติดตั้งในโปรเจกต์โดยไม่แก้ไขไฟล์ใดๆ; ยืนยันว่าไฟล์ adapter ที่ manifest บันทึกไว้ตรงกับ checksum ของ bundle; ปฏิเสธเป้าหมายที่ไม่ปลอดภัยก่อนแก้ไขโปรเจกต์; ติดตั้ง Foundation ลงโปรเจกต์ด้วย runtime ที่ vendor มาแบบ idempotent และเก็บไฟล์อื่นของผู้ใช้
- **Out of scope:** edits outside `packages/foundation/package.json`, `packages/foundation/tsconfig.json`, `packages/foundation/vendor`, `packages/foundation/src/foundation-bundle.ts`, `packages/foundation/script/sync-foundation.ts`, `packages/foundation/script/verify-foundation.ts`, … +4 more

## Work type

feature

## Failure matrix

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| shim ถูกแก้ไข | command ล้มเหลวด้วยข้อความ cache is invalid โดยไม่ fallback ไป PATH | No separate step; the outcome is the handling | materialize-cache |
| protocol เสียหาย | installed.state เป็น invalid | No separate step; the outcome is the handling | status-readonly |

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| bundle-verification | payload ถูกต้อง | unclassified | T001 | test: `packages/foundation/test/foundation-bundle.test.ts` | — |
|  | checksum ไม่ตรง | unclassified | T001 |  |  |
|  | ไม่ใช่ release ที่ tag | unclassified | T001 |  |  |
| materialize-cache | shim ถูกแก้ไข | failure | T002 | test: `packages/foundation/test/foundation-runtime.test.ts` | — |
|  | materialize สำเร็จ | unclassified | T002 |  |  |
|  | checksum ใน bundle ไม่ตรง | unclassified | T002 |  |  |
|  | cache ไม่ปลอดภัย | unclassified | T002 |  |  |
| command-environment | path mode ไม่ materialize | unclassified | T002 | test: `packages/foundation/test/foundation-runtime.test.ts` | — |
|  | bundled ต่อ PATH | unclassified | T002 |  |  |
| status-readonly | protocol เสียหาย | failure | T002 | test: `packages/foundation/test/foundation-runtime.test.ts` | — |
|  | ยังไม่ติดตั้ง | unclassified | T002 |  |  |
|  | ติดตั้งแล้ว | unclassified | T002 |  |  |
| managed-adapter | ไม่มี adapter manifest | unclassified | T002 | test: `packages/foundation/test/foundation-runtime.test.ts` | — |
|  | adapter ตรง checksum | unclassified | T002 |  |  |
|  | adapter ถูกแก้ไข | unclassified | T002 |  |  |
| install-guards | platform win32 | unclassified | T002 | test: `packages/foundation/test/foundation-runtime.test.ts` | — |
|  | managed path เป็น symlink | unclassified | T002 |  |  |
|  | bundle เสียหาย | unclassified | T002 |  |  |
| install-idempotent | install ซ้ำ | unclassified | T002 | test: `packages/foundation/test/foundation-runtime.test.ts` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (19).
- Changed tests fail on the original code.
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-opencode-adapter-paths-unguarded: The protectedRoots list does not include .opencode, .opencode/commands or .opencode/plugins, but install() (line 82, via install-opencode.sh lines 78-84) writes .opencode/commands/*.md and .opencode/plugins/foundation.js there with `mkdir -p` and `cp`. install-support.sh adapter_manifest_prepare_file only handles a symlink at the final file, not a symlinked folder above it. So if `.opencode` or `.opencode/commands` is a symlink to a folder outside the project, install passes the guard and writes through the link, which violates 'fail with symlinked managed path and leave the link target untouched'. A related gap in rejectSymlinks (line 287): it uses lstat on the full path, which follows symlinked folders above the last component. If `.claude`, `openspec` or `.foundation` is a symlink to a folder that already holds every protected child, no check ever looks at the symlinked parent, and nothing is rejected. Fix: add the .opencode adapter folders to protectedRoots, and lstat each path component from the project root down instead of only the leaf. Add tests for a symlinked `.opencode/commands` and a symlinked `.claude` whose target already has the children. (root/packages/foundation/src/foundation-runtime.ts:12) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-staging-cleanup-race: materialize writes files inside Promise.all(manifest.files.map(...)). Promise.all rejects on the first checksum mismatch, and the .catch then runs rm(staging) while the other entries' mkdir and Bun.write calls are still running. Those writes can recreate staging subfolders and files after rm has finished. Nothing later cleans up stale .staging-* folders, and the finally block sets the cache root back to 0o500, so the leftovers stay. That breaks 'materialize fails with checksum mismatch and the cache has no files left' for any real bundle with more than one file. The test at test/foundation-runtime.test.ts:120-127 cannot show this: its fixture has one file, which fails before any write, and its Bun.Glob scan leaves out dot-named entries, so leftovers under `.staging-*` would not be counted anyway. Fix: check every checksum before writing anything (or wait with Promise.allSettled before rm), and add `dot: true` and a multi-file fixture to the test. (root/packages/foundation/src/foundation-runtime.ts:167) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F3-writable-cache-root-bricks-valid-target: validMaterialization returns false whenever the cache root is writable (it checks `mode & 0o222`). materialize() then throws 'cache is invalid' if the target folder already exists (lines 146-152). The cache root is writable at 0o700 while any materialize is running (line 154), and stays writable if the process dies between rename and the finally chmod. So a valid, untouched target fails when another process is materializing a different release into the same cache, or permanently after such a crash, until someone fixes the permissions by hand. Consider checking writability only on the target tree, or re-locking the root before validating. (root/packages/foundation/src/foundation-runtime.ts:145) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | F4-write-phase-staging-leak: When the checksum check and the writes were in one Promise.all, its .catch removed staging on any error. Now only the checksum pass (lines 159-169) has that cleanup. If something fails in the write pass or after it — mkdir, Bun.write, chmod, the marker or shim write, or lockDirectories (lines 170-183), for example with ENOSPC or EACCES — the error goes straight to the finally block. That block only sets the cache root back to 0o500, so the `.staging-*` folder is left in a cache that is now read-only, and nothing ever removes it. This is not a checksum-mismatch case, so the scenario's guarantee still holds. To fix it, wrap everything from the write pass through rename in a try/catch that runs `rm(staging)` (Promise.all may need allSettled first, so no write is still running when rm starts). (root/packages/foundation/src/foundation-runtime.ts:170) | minor | ยังเปิดอยู่ | claude-opus |
