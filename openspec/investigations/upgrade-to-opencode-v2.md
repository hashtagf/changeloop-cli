# Evidence: อัพเกรด fork ไป opencode v2

วันที่: 2026-10-27 · เก็บด้วย `git fetch upstream dev` แล้วอ่านแบบ read-only
(ไม่แก้ product code) ทุกบรรทัดทำซ้ำได้ด้วยคำสั่งที่ระบุ
`B` = `92d29ba4a3` (merge-base ของ `HEAD` กับ `upstream/dev`)

## E1 ระยะห่าง

- `git rev-list --count B..upstream/dev` → 6038 commits
- `git ls-remote --tags upstream` → tag ล่าสุด `v2.2.0` (มี `v2.0.0`–`v2.2.0`);
  fork อยู่ที่ `packages/opencode/package.json` = `1.18.18`

## E2 upstream ลบ v1 runtime ทั้ง package

- `git log upstream/dev -- packages/opencode/package.json` → `44b6938b2a "removed packages/opencode"`
  (Dax Raad, 2026-07-20)
- `git ls-tree -r upstream/dev packages/opencode` → 0 ไฟล์ (fork: 1,301 ไฟล์; base: 762)
- commit ก่อนลบเป็นเวอร์ชัน `1.18.4`, `@opencode-ai/core`, `effect 4.0.0-beta.98`
- จำนวน commit จาก base ถึงก่อนลบ: `git rev-list --count B..44b6938b2a^` → 699
- upstream ที่แตะ `packages/opencode` หลัง base: 84 commits (ทั้งหมดก่อน/ที่การลบ)
- upstream/dev มี branch เดียว ไม่มี v1 maintenance branch (`git branch -r | grep upstream`)

## E3 toolchain และ namespace ใน upstream/dev

| รายการ | fork (HEAD) | upstream/dev |
|---|---|---|
| ชื่อ package | `@opencode-ai/core` | `@opencode/core` |
| effect | `4.0.0-beta.83` | `4.0.1` |
| typescript | `5.8.2` | `npm:@typescript/typescript6@6.0.2` |
| bun | `1.3.14` | `1.4.4` |
| packages ใหม่ | – | `util`, `ai`, `plugins`, `plugin-browser`, `gui-plugins`, `theme`, `latex`, `merman`, `patchmark`, `simulation`, `posts`, `stories` |
| packages ที่หาย | `opencode`, `llm`, `sdk-next`, `containers`, `docs`, `enterprise`, `slack`, `storybook` | – |

อ้างอิง: `git show <ref>:package.json`, `git show <ref>:packages/core/package.json`,
`git ls-tree --name-only <ref> packages/`

## E4 v2.1 breaking change `acdcdb8dd9` (2026-10-20)

แตะ `packages/core/src/session/{compaction,history,projector,message-updater,to-llm-message}`,
`schema/{session-event,credential,session-legacy}`, `protocol/openapi.json`,
`client/.../generated/types.ts` (-1,081 บรรทัด) และ `cli` auth/session import

## E5 Dry-run merge (`git merge-tree --write-tree HEAD upstream/dev`)

- ผลลัพธ์: ไม่สะอาด, **99 ไฟล์ conflict**: `app` 40, `opencode` 32 (modify/delete),
  `core` 8, `client` 5, `server` 4, `sdk` 2, `protocol` 2, `ui`/`tui`/`gui-plugins` 1,
  `bun.lock`, `AGENTS.md`, `.gitignore`
- ไฟล์ที่ทั้งสองฝั่งแก้: 80 (นับรวมไฟล์ harness)
- conflict นี้เป็นขั้นต่ำ: ไม่นับไฟล์ที่ merge สะอาดแต่คอมไพล์ไม่ผ่านเพราะ rename
  `@opencode-ai/*` → `@opencode/*`

## E6 งานของ fork (diff `B..HEAD`)

- แตะ 1,364 ไฟล์; ใน `packages/opencode` 571 ไฟล์ แต่ **502 เป็น `vendor/`**
  (Foundation runtime ที่ bundle, สร้างซ้ำได้ด้วย `script/foundation-bundle.ts`)
- ที่เหลือใน `packages/opencode`: ~60 ไฟล์ คือ `src/plugin/foundation*.ts` (7),
  `router.ts`, template 8 ไฟล์ `plugin/foundation/*.txt`, `src/cli/cmd/*` (rebrand/branding 13),
  `script/*` (build + verify ของ Foundation), tests
- นอก `packages/opencode`: `app` 49 ไฟล์ (Foundation web UI), `core` 17, `client` 5,
  `server` 4, `ui` 3, `tui` 2, `sdk` 2, `protocol` 2, `cli` 1
- ไฟล์นอก `packages/opencode` ที่ import `@opencode-ai/*`: 47 ไฟล์ / 173 บรรทัด
  (ต้องแก้เป็น `@opencode/*`)
- core/server ของ fork มี service เฉพาะ fork: `Foundation`, `FoundationDocuments`,
  `CommandPreparation` (provide จริงใน `packages/opencode/src/plugin/foundation-*.ts`)

## E7 v1 plugin hook ที่ fork ใช้ ไม่มีใน v2

- fork ใช้ hook: `config`, `command.execute.before`, `shell.env`,
  `experimental.chat.system.transform` (`packages/opencode/src/plugin/foundation.ts`),
  `config` (`router.ts`)
- `git grep` ใน `upstream/dev` `packages/*/src` หา `command.execute.before`,
  `experimental.chat.system.transform`, `shell.env` → ไม่พบ
- v2 plugin API (`packages/plugin/src/effect/`) เป็น Effect-based มี domain:
  `command` (`transform` + `CommandDefinition`), `shell` (`hook["create.before"]` มี `env`),
  `agent`, `session` (มี `system: Array<SystemPart>`), `skill`, `tool`, `provider`, `mcp`, `permission`

## E8 v2 CLI และ build

- `packages/cli` (`@opencode/cli`) เป็น entry ของ v2: bin `opencode`, `opencode2`;
  script `build`, `build:node`, `pack`; มี `src/run/v1.ts` (bridge สำหรับ `run` แบบ v1)
- literal ที่มีคำว่า opencode ใน `packages/cli/src` + `packages/tui/src`: 633 บรรทัดใน 257 ไฟล์
  (ขอบเขต rebrand ตอนนี้ของ v2 ที่ต้องทำใหม่)
- ผู้ใช้ v1: upstream มี migration `packages/core/src/database/v1-migration*` และ
  `V1 config` compat หลายตัว (`51889`, `54911`, `52327`, `57618`)

## ขีดจำกัด

- ไม่ได้ build/run upstream v2.2.0 จริง, ไม่ได้ทดลอง port plugin, ไม่ได้นับ conflict
  หลัง resolve namespace rename จึงประเมินงานเป็นช่วง ไม่ใช่ตัวเลขแน่นอน
- ไม่ได้ตรวจว่า bug fix แต่ละตัวใน `core`/`tui`/`app` apply กับโค้ด v1 ของ fork ได้หรือไม่
- ไม่ได้อ่าน release notes อย่างเป็นทางการของ v2.0.0 (อ่านจาก commit/โครงสร้างเท่านั้น)
