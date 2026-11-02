# Tasks

> This is the sole implementation ledger.

- [x] **T001** handler command.list รอ awaitPlugins พิสูจน์ด้วย test ที่เริ่ม server จริงและเรียก /api/command เป็นคำขอแรก ต้องได้คำสั่งจาก config กับ Foundation ครบ 8 ตัว (ล้มก่อนแก้ด้วยรายการว่าง) และสัญญา endpoint กับ openapi.json ประกาศ 503 [key:await-activation] [kind:implementation] [paths:packages/server/src/handlers/command.ts,packages/protocol/src/groups/command.ts,packages/protocol/openapi.json,packages/server/test/command.test.ts] [claims:command-list-awaits-activation-get-api-command-location-config-f,command-list-awaits-activation-plugin-activation-location-5,command-list-contract-503] — verify: `o=$(bun test --cwd packages/server --timeout 60000 test/command.test.ts 2>&1); r=$?; echo "$o"; p=$(echo "$o" | sed -n 's/^ *\([0-9]*\) pass$/\1/p'); f=$(echo "$o" | sed -n 's/^ *\([0-9]*\) fail$/\1/p'); echo "Tests: ${f:-0} failed, ${p:-0} passed, $((${p:-0}+${f:-0})) total"; exit $r`
