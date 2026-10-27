# Tasks

> This is the sole implementation ledger.

- [x] **T001** vendor และ manifest เป็น 3.6.8 ผ่าน script/verify-foundation.ts พร้อม test ที่พิสูจน์รุ่นและ checksum [key:sync-vendor-368] [kind:implementation] [paths:packages/foundation/vendor,packages/foundation/test/foundation-bundle.test.ts] [claims:vendor-release-pin-vendor-claude-foundation-manifest-json,vendor-release-pin-payload-claude-harness-protocol-json,vendor-integrity-createembeddedfoundationbundle-vendor,vendor-integrity-payload-checksum] — verify: `bun test --cwd packages/foundation test/foundation-bundle.test.ts`
- [x] **T002** sync-foundation.ts กรอง harness tests/fixtures, vendor/manifest ถูก sync ใหม่โดยไม่มีไฟล์เหล่านั้น และมี test พิสูจน์ว่าไม่มี tests/ และความลึกไม่เกิน 12 [key:exclude-harness-tests] [paths:packages/foundation/script/sync-foundation.ts,packages/foundation/vendor,packages/foundation/test/foundation-bundle.test.ts] [claims:vendor-excludes-harness-tests-manifest-json-vendor,vendor-excludes-harness-tests-packages-foundation-vendor-repo,vendor-excludes-harness-tests-sync-foundation-ts] — verify: `bun test --cwd packages/foundation test/foundation-bundle.test.ts test/foundation-runtime.test.ts`
