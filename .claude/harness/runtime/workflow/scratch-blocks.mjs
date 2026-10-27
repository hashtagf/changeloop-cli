// Static HTML for the approval page's scratch: page text in Thai or English
// and one renderer per typed example. Every draft value passes through esc();
// nothing here emits a script, an event handler, or a URL from the draft
// except prototype and artifact links the caller has already confined.

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TEXT = {
  en: {
    get: "What you get", change: "What changes", ifFail: "If it fails", before: "Before", after: "After",
    noSummary: "No plain-language summary yet; the agent can add 'scratch' to the draft.",
    examples: "Examples", agreed: "Agreed", actual: "After Build",
    proof: "proof", fail: "failed", preview: "preview", stale: "preview (stale)", none: "no result yet",
    noResult: "No result yet.", willCompare: "After Build this compares:", openArtifact: "Open the artifact",
    success: "success", boundary: "boundary", failure: "failure", given: "Given", when: "When", then: "Then",
    rule: "Rule", request: "Request", response: "Response", rollback: "Rollback", phases: "Release order",
    downtime: "Downtime", now: "now", target: "target", noNumber: "no number yet", chosen: "chosen",
    reversible: "Reversible", stop: "Stop if", kill: "Emergency off", yes: "allowed", no: "denied",
    good: "Good output", bad: "Fails if", rubric: "Rubric", code: "Code", missingPrototype: "The prototype file is not there yet.",
    openFull: "Open full screen", roles: "By approver role", domains: "Technical domains", diagrams: "Diagrams",
    noDiagrams: "This change declares no diagrams.", summary: "Summary", suggestions: "Suggested previews",
    risk: "Risk level", intent: "intent", revision: "contract revision", readOnly:
      "Read-only projection. Only labels marked proof come from a valid passing receipt; previews and design statements are not proof.",
    legacy: "This change has no typed draft for its current revision, so the package shows packet information only and its detail is limited.",
    diagramText: "Shown as Mermaid text when the local renderer is unavailable.",
    system: "System does", user: "User sees", stage: "Stage", who: "Who / share", whenCol: "When",
    noEvidence: "no evidence yet", artifactCol: "Artifact", domainsCol: "Domains", evidenceCol: "Evidence",
    allChanges: "all changes", noRole: "No approval needed from this role for this change.", noDomain: "No specific domain.",
    packet: "Packet:", suggestionsNote: "Optional. A suggestion never blocks approval or Build.",
    capabilityWord: "capability", noProvider: "no provider yet; declare a provider with capability",
    noProviderTail: "in evidence.yaml", externalRef: "external: needs a decision-ref",
    undeclared: "Not declared in the agreement.", noFailure: "No failure scenario in the agreement concerns this.",
    previewWord: "Preview", previewOnly: "(preview only; never proof)", openPreview: "Open the preview artifact",
    head: {}, artifactNames: {},
    decisionNeeded: "Decision needed: approve this spec before Build starts.",
    riskLevels: { Low: "▽ Low", Medium: "◇ Medium", High: "▲ High", Critical: "▲▲ Critical" },
    riskWhy: "Why this level", scope: "Scope", filesWord: "files touched", questionsWord: "open questions",
    failuresWord: "failure cases", unknown: "unknown",
    scratchMissing: "No plain-language summary yet. Ask the agent to add 'scratch' to the draft before you decide.",
    moreExamples: "More examples", reviewerDetails: "Reviewer details",
    reviewerSummary: "artifacts, domains, diagrams, and suggested previews", approvedBanner:
      "Approved for this revision.",
    pendingLanes: "Still waiting for approval from:",
    // Risk scale, open questions, failure cards, and the type cards' text.
    riskScale: "level {n} of 4", riskBasis: "Computed from what this change touches",
    questionsBox: "Questions to answer before approving", questionsHint: "Answer together with the approval, for example: go ahead, no partial refunds.",
    failureCards: "If it goes wrong", whenWord: "When", seesWord: "What happens", recoverWord: "Recovery",
    reasons: {
      impact: { high: "High impact", medium: "Medium impact", low: "Low impact", unspecified: "Impact not stated" },
      risk: {
        "access-control": "Controls who may do what", "persisted-data-change": "Changes stored data", "external-integration": "Talks to an outside system",
        "performance-slo": "Has a speed target", "user-interface": "Changes what users see", "high-operational-risk": "Risky to run",
        "external-side-effect": "Acts outside this system", financial: "Involves money", "input-domain": "Accepts outside input"
      },
      path: "Touches"
    },
    riskWords: { Low: "Low", Medium: "Medium", High: "High", Critical: "Critical" },
    cardsFailed: "Part of this page could not be built; read the packet for that part",
    noPrototype: "No prototype yet.",
    fontNote: "", pathLabel: "path",
    cards: {
      ask: "Question to decide", undo: "How to undo", who: "Who is affected", derived: "from", noneWord: "none",
      names: { A: "What users see", B: "Fixing a problem", C: "No behavior change", D: "Contract with others", E: "Data", F: "Back end and infrastructure", G: "People and compliance" },
      asks: {
        A: "What will users see and be able to do, and is that acceptable?", B: "What is the problem, and how will we know it is fixed?",
        C: "Is it safe, and what must stay the same?", D: "Who uses this contract, and what happens to them?",
        E: "Can data be damaged, and can it be undone?", F: "What happens when it breaks, what does it cost, and is the target met?",
        G: "Whose data is used, for how long, and what if it goes wrong?"
      },
      panels: {
        userFlow: "User path", uiStates: "Screen states", experimentDesign: "Experiment", releasePlan: "Release plan", bugfix: "The problem",
        incident: "Incident", disclosure: "Disclosure", refactor: "What must stay the same", dependencyChange: "Package change",
        configContract: "Config values", apiContracts: "Contract", boundaries: "Connections", libraryContract: "Library contract",
        deprecationPlan: "Deprecation plan", dataModel: "Data before and after", migrationPlan: "Migration plan", rollout: "Rollout",
        infraPlan: "Infrastructure", nfr: "Quality targets", performanceAnalysis: "Performance", jobContract: "If it breaks (jobs)",
        integrations: "External systems", observability: "Signals and alerts", privacyAssessment: "Personal data", privacyData: "Personal data fields", threatModel: "Threats", modelCard: "Model",
        dataFix: "Data fix", hardening: "Security hardening", pipelinePlan: "Pipeline change"
      },
      f: {
        purpose: "Purpose", reproduction: "How to reproduce", rootCause: "Root cause", regression: "Guards against return", link: "Link",
        mitigation: "Stopgap", minimumScope: "Smallest scope", followUp: "Follow-up", backport: "Also fixed on", class: "Class",
        affectedVersions: "Versions hit", owner: "Owner", invariants: "Must stay the same", characterization: "Proof of sameness",
        package: "Package", from: "From", to: "To", breaking: "Breaking", cves: "CVE", rollbackPin: "Pin to go back", key: "Key", default: "Default",
        validation: "Accepted values", method: "Method", path: "Path", auth: "Access", errors: "Errors", mode: "Mode", timeout: "Timeout",
        retry: "Retry", semver: "Version bump", changelog: "Changelog", what: "What", replacement: "Replacement", warning: "Warning",
        removalCondition: "Removed when", consumers: "Consumers", entity: "Entity", fields: "Fields", migration: "Migration", rollback: "Rollback",
        cutover: "Cutover", rollbackWindow: "Can go back within", parity: "Parity check", strategy: "How", deployOrder: "Order", rollbackProof: "Proof of rollback",
        planDiff: "What changes", environments: "Environments", blastRadius: "Blast radius", costDelta: "Cost", characteristic: "Quality", measure: "Measure",
        baseline: "Now", target: "Target", hypothesis: "Hypothesis", states: "States", idempotency: "Duplicate guard", kind: "Kind", failure: "Failure",
        signal: "Signal", slo: "Goal", alert: "Alert", data: "Data", field: "Field", retention: "Kept for", threat: "Threat", likelihood: "Likelihood",
        impact: "Impact", control: "Control", residual: "Remaining", intendedUse: "Used for", model: "Model", fallback: "If wrong", evaluation: "Evaluation set",
        primaryMetric: "Main metric", allocation: "Split", decisionRule: "Decision rule", guardrails: "Guardrails", stopRules: "Stop rules",
        minimumVersion: "Minimum version", stagedRollout: "Staged", crashGate: "Crash gate", screen: "Screen", accessibility: "Accessibility", exports: "Exports",
        scope: "Scope", snapshot: "Snapshot before", dryRun: "Dry run", rerunSafe: "Safe to rerun", weakness: "Weakness", verification: "How it is verified",
        changes: "What changes", permissions: "Permissions and secrets"
      },
      checkTitle: "Required sections", checkOf: "of", missingWord: "missing", recommendedWord: "recommended",
      checkLegend: "✓ present · ✕ required section missing · ! recommended (not a rule yet)", checkNone: "Nothing is required for this kind of work.",
      sections: {
        summary: "Summary (why)", failureMatrix: "Failure table", userFlow: "User flow", uiStates: "Screen states", componentMap: "Component map",
        releaseNote: "Release note", bugfix: "Bug analysis", "bugfix.disclosure": "Security disclosure", "bugfix.incident": "Incident",
        "bugfix.backport": "Backport branches", refactor: "Refactor invariants", apiContracts: "API contract", boundaries: "Connections",
        libraryContract: "Library contract", dataModel: "Data model", migrationPlan: "Migration plan", rollout: "Rollout and rollback",
        jobContract: "Job contract", diagrams: "Diagram", integrations: "External systems", configContract: "Config contract", nfr: "Quality targets",
        performanceAnalysis: "Performance analysis", dependencyChange: "Package change", deprecationPlan: "Deprecation plan", infraPlan: "Infrastructure plan",
        observability: "Observability", privacyAssessment: "Privacy assessment", threatModel: "Threat model", experimentDesign: "Experiment design",
        releasePlan: "Release plan", modelCard: "Model card", dataFix: "Data fix plan", hardening: "Security hardening", pipelinePlan: "Pipeline plan"
      }
    }
  },
  th: {
    get: "จะได้อะไร", change: "ของเดิมเปลี่ยนอะไร", ifFail: "ถ้าพลาดเป็นยังไง", before: "ก่อน", after: "หลัง",
    noSummary: "ยังไม่ได้เขียนสรุปภาษาคน agent เติม scratch ใน draft ได้",
    examples: "ตัวอย่าง", agreed: "ตกลงไว้", actual: "ผลจริงหลัง Build",
    proof: "proof", fail: "ไม่ผ่าน", preview: "preview", stale: "preview เก่า", none: "ยังไม่มีผล",
    noResult: "ยังไม่มีผล", willCompare: "หลัง Build จะเทียบ:", openArtifact: "เปิดไฟล์ผลลัพธ์",
    success: "ปกติ", boundary: "กรณีขอบ", failure: "ผิดพลาด", given: "ก่อน", when: "เมื่อ", then: "ได้",
    rule: "กฎ", request: "Request", response: "Response", rollback: "Rollback", phases: "ลำดับปล่อย",
    downtime: "Downtime", now: "ตอนนี้", target: "เป้า", noNumber: "ยังไม่มีตัวเลข", chosen: "เลือก",
    reversible: "ย้อนกลับ", stop: "หยุดถ้า", kill: "ปิดฉุกเฉิน", yes: "ได้", no: "ไม่ได้",
    good: "output ที่ดี", bad: "ไม่ผ่านถ้า", rubric: "เกณฑ์", code: "โค้ด", missingPrototype: "ยังไม่มีไฟล์ prototype",
    openFull: "เปิดเต็มจอ", roles: "ตามบทบาทผู้อนุมัติ", domains: "Technical domains", diagrams: "แผนภาพ",
    noDiagrams: "change นี้ไม่มีแผนภาพ", summary: "สรุป", suggestions: "Preview ที่แนะนำ",
    risk: "ความเสี่ยง", intent: "intent", revision: "ฉบับที่", readOnly:
      "หน้านี้อ่านอย่างเดียว เฉพาะป้าย proof ที่มาจาก receipt ที่ผ่านจริง preview และเอกสารออกแบบไม่ใช่ proof",
    legacy: "change นี้ไม่มี typed draft ของฉบับปัจจุบัน หน้านี้จึงแสดงจาก packet และรายละเอียดมีจำกัด",
    diagramText: "แสดงเป็นข้อความ Mermaid เมื่อเปิด renderer ในเครื่องไม่ได้",
    system: "ระบบทำ", user: "ผู้ใช้เห็น", stage: "ขั้น", who: "ใคร / สัดส่วน", whenCol: "เมื่อไร",
    noEvidence: "ยังไม่มีหลักฐาน", artifactCol: "Artifact", domainsCol: "Domain", evidenceCol: "หลักฐาน",
    allChanges: "ทุก change", noRole: "บทบาทนี้ไม่ต้องอนุมัติ change นี้", noDomain: "ไม่มี domain เฉพาะ",
    decisionNeeded: "ต้องตัดสินใจ: อนุมัติ spec นี้ก่อนเริ่ม Build",
    riskLevels: { Low: "▽ ต่ำ", Medium: "◇ ปานกลาง", High: "▲ สูง", Critical: "▲▲ วิกฤต" },
    riskWhy: "ทำไมระดับนี้", scope: "ขอบเขต", filesWord: "ไฟล์ที่แตะ", questionsWord: "คำถามที่ยังเปิด",
    failuresWord: "กรณีที่อาจพลาด", unknown: "ไม่ทราบ",
    scratchMissing: "ยังไม่มีสรุปภาษาคน ให้ agent เติม 'scratch' ใน draft ก่อนตัดสินใจ",
    moreExamples: "ตัวอย่างอื่น", reviewerDetails: "รายละเอียดสำหรับผู้ตรวจ",
    reviewerSummary: "artifact, domain, แผนภาพ และ preview ที่แนะนำ", approvedBanner:
      "อนุมัติแล้วสำหรับฉบับนี้",
    pendingLanes: "ยังรออนุมัติจาก:",
    // แถบความเสี่ยง คำถามที่ค้าง การ์ดกรณีพลาด และข้อความของการ์ดตามชนิดงาน
    riskScale: "ระดับที่ {n} จาก 4", riskBasis: "ระบบคำนวณจากสิ่งที่ change นี้แตะ",
    questionsBox: "คำถามที่ต้องตอบก่อนอนุมัติ", questionsHint: "ตอบรวมไปกับการอนุมัติได้ เช่น ลุยเลย ไม่ต้องคืนบางส่วน",
    failureCards: "ถ้าพลาด เกิดอะไรขึ้น", whenWord: "เมื่อ", seesWord: "ผลที่เห็น", recoverWord: "กู้คืน",
    reasons: {
      impact: { high: "ผลกระทบสูง", medium: "ผลกระทบปานกลาง", low: "ผลกระทบต่ำ", unspecified: "ไม่ได้ระบุผลกระทบ" },
      risk: {
        "access-control": "ควบคุมว่าใครทำอะไรได้", "persisted-data-change": "แก้ข้อมูลที่เก็บถาวร", "external-integration": "เชื่อมระบบภายนอก",
        "performance-slo": "มีเป้าความเร็ว", "user-interface": "เปลี่ยนสิ่งที่ผู้ใช้เห็น", "high-operational-risk": "เสี่ยงตอนใช้งานจริง",
        "external-side-effect": "ทำสิ่งนอกระบบนี้", financial: "เกี่ยวกับเงิน", "input-domain": "รับข้อมูลจากภายนอก"
      },
      path: "แตะ"
    },
    riskWords: { Low: "ต่ำ", Medium: "ปานกลาง", High: "สูง", Critical: "วิกฤต" },
    cardsFailed: "สร้างบางส่วนของหน้านี้ไม่ได้ ให้อ่านส่วนนั้นจาก packet",
    noPrototype: "ยังไม่มี prototype",
    fontNote: "", pathLabel: "path",
    cards: {
      ask: "คำถามที่ต้องตัดสิน", undo: "ย้อนกลับได้ไหม", who: "ใครได้รับผลกระทบ", derived: "จาก", noneWord: "ไม่มี",
      names: { A: "สิ่งที่ผู้ใช้เห็น", B: "แก้ปัญหา", C: "ไม่เปลี่ยนพฤติกรรม", D: "สัญญากับคนอื่น", E: "ข้อมูล", F: "หลังบ้านและโครงสร้าง", G: "คนและกฎหมาย" },
      asks: {
        A: "ผู้ใช้จะเห็นและทำอะไรได้ใหม่ และรับได้ไหม", B: "ปัญหาคืออะไร และจะรู้ได้อย่างไรว่าหายแล้ว",
        C: "ปลอดภัยไหม และอะไรต้องคงเดิม", D: "ใครใช้สัญญานี้อยู่ และพวกเขาจะโดนอะไร",
        E: "ข้อมูลเสียหายไหม และย้อนกลับได้ไหม", F: "พังแล้วเป็นอย่างไร ค่าใช้จ่ายเท่าไร และได้ตามเป้าไหม",
        G: "ข้อมูลของใครถูกใช้ เก็บนานแค่ไหน และถ้าผิดทำอย่างไร"
      },
      panels: {
        userFlow: "เส้นทางของผู้ใช้", uiStates: "สถานะหน้าจอ", experimentDesign: "การทดลอง", releasePlan: "แผนปล่อย", bugfix: "ปัญหา",
        incident: "เหตุการณ์", disclosure: "การเปิดเผยช่องโหว่", refactor: "สิ่งที่ต้องคงเดิม", dependencyChange: "การเปลี่ยนแพ็กเกจ",
        configContract: "ค่า config", apiContracts: "สัญญา", boundaries: "การเชื่อมต่อ", libraryContract: "สัญญาของไลบรารี",
        deprecationPlan: "แผนเลิกใช้", dataModel: "ข้อมูลก่อน → หลัง", migrationPlan: "แผนย้าย", rollout: "การปล่อย",
        infraPlan: "โครงสร้างที่เปลี่ยน", nfr: "เป้าคุณภาพ", performanceAnalysis: "ประสิทธิภาพ", jobContract: "ถ้าพัง (งานเบื้องหลัง)",
        integrations: "ระบบภายนอก", observability: "สัญญาณและการแจ้งเตือน", privacyAssessment: "ข้อมูลส่วนบุคคล", privacyData: "ฟิลด์ข้อมูลส่วนบุคคล", threatModel: "ภัยคุกคาม", modelCard: "โมเดล",
        dataFix: "การแก้ข้อมูล", hardening: "การเสริมความปลอดภัย", pipelinePlan: "การเปลี่ยน pipeline"
      },
      f: {
        purpose: "วัตถุประสงค์", reproduction: "ทำซ้ำอย่างไร", rootCause: "สาเหตุ", regression: "กันกลับมา", link: "ลิงก์",
        mitigation: "มาตรการชั่วคราว", minimumScope: "ขอบเขตต่ำสุด", followUp: "ติดตามต่อ", backport: "แก้ใน branch", class: "ชนิด",
        affectedVersions: "เวอร์ชันที่โดน", owner: "ผู้รับผิดชอบ", invariants: "ต้องคงเดิม", characterization: "หลักฐานว่าเหมือนเดิม",
        package: "แพ็กเกจ", from: "จาก", to: "เป็น", breaking: "breaking", cves: "CVE", rollbackPin: "pin ถอยกลับ", key: "key", default: "ค่าเริ่มต้น",
        validation: "ค่าที่รับ", method: "เมธอด", path: "path", auth: "สิทธิ์", errors: "error", mode: "โหมด", timeout: "timeout",
        retry: "ลองใหม่", semver: "ระดับเวอร์ชัน", changelog: "changelog", what: "อะไร", replacement: "ตัวแทน", warning: "คำเตือน",
        removalCondition: "ลบเมื่อ", consumers: "ผู้ใช้", entity: "ตาราง", fields: "ฟิลด์", migration: "การย้าย", rollback: "ย้อนกลับ",
        cutover: "ตัดสลับ", rollbackWindow: "ถอยได้ภายใน", parity: "ตรวจเทียบ", strategy: "วิธี", deployOrder: "ลำดับ", rollbackProof: "หลักฐานว่าถอยได้",
        planDiff: "สิ่งที่เปลี่ยน", environments: "สภาพแวดล้อม", blastRadius: "รัศมีผลกระทบ", costDelta: "ค่าใช้จ่าย", characteristic: "คุณภาพ", measure: "ตัววัด",
        baseline: "ตอนนี้", target: "เป้า", hypothesis: "สมมติฐาน", states: "สถานะ", idempotency: "กันซ้ำ", kind: "ชนิด", failure: "ความล้มเหลว",
        signal: "สัญญาณ", slo: "เป้า", alert: "แจ้งเตือน", data: "ข้อมูล", field: "ฟิลด์", retention: "เก็บนาน", threat: "ภัย", likelihood: "โอกาส",
        impact: "ผลกระทบ", control: "มาตรการ", residual: "ที่เหลือ", intendedUse: "ใช้ทำอะไร", model: "โมเดล", fallback: "ถ้าผิด", evaluation: "ชุดประเมิน",
        primaryMetric: "ตัววัดหลัก", allocation: "สัดส่วน", decisionRule: "กฎตัดสิน", guardrails: "ราวกั้น", stopRules: "เงื่อนไขหยุด",
        minimumVersion: "เวอร์ชันต่ำสุด", stagedRollout: "ทีละขั้น", crashGate: "เกณฑ์ crash", screen: "หน้าจอ", accessibility: "การเข้าถึง", exports: "สิ่งที่ส่งออก",
        scope: "ขอบเขต", snapshot: "สำเนาก่อนแก้", dryRun: "ลองรันแบบไม่เขียนจริง", rerunSafe: "รันซ้ำได้ปลอดภัย", weakness: "จุดอ่อน", verification: "วิธีพิสูจน์",
        changes: "สิ่งที่เปลี่ยน", permissions: "สิทธิ์และ secret ที่ใช้"
      },
      checkTitle: "ส่วนที่ต้องมี", checkOf: "จาก", missingWord: "ขาด", recommendedWord: "แนะนำ",
      checkLegend: "✓ มีครบ · ✕ ขาดส่วนบังคับ · ! แนะนำ (ยังไม่ใช่กฎ)", checkNone: "งานชนิดนี้ไม่ต้องมีส่วนเพิ่ม",
      sections: {
        summary: "สรุป (why)", failureMatrix: "ตาราง failure", userFlow: "เส้นทางผู้ใช้", uiStates: "สถานะหน้าจอ", componentMap: "แผนผังส่วนประกอบ",
        releaseNote: "release note", bugfix: "วิเคราะห์บั๊ก", "bugfix.disclosure": "การเปิดเผยช่องโหว่", "bugfix.incident": "เหตุการณ์",
        "bugfix.backport": "branch ที่รับการแก้", refactor: "สิ่งที่ต้องคงเดิมใน refactor", apiContracts: "สัญญา API", boundaries: "การเชื่อมต่อ",
        libraryContract: "สัญญาไลบรารี", dataModel: "โมเดลข้อมูล", migrationPlan: "แผนย้าย", rollout: "การปล่อยและการถอย",
        jobContract: "สัญญางานเบื้องหลัง", diagrams: "แผนภาพ", integrations: "ระบบภายนอก", configContract: "สัญญา config", nfr: "เป้าคุณภาพ",
        performanceAnalysis: "วิเคราะห์ประสิทธิภาพ", dependencyChange: "การเปลี่ยนแพ็กเกจ", deprecationPlan: "แผนเลิกใช้", infraPlan: "แผนโครงสร้าง",
        observability: "การสังเกตระบบ", privacyAssessment: "ประเมินความเป็นส่วนตัว", threatModel: "threat model", experimentDesign: "ออกแบบการทดลอง",
        releasePlan: "แผนปล่อย", modelCard: "model card", dataFix: "แผนแก้ข้อมูล", hardening: "การเสริมความปลอดภัย", pipelinePlan: "แผน pipeline"
      }
    },
    packet: "Packet:", suggestionsNote: "ไม่บังคับ คำแนะนำไม่บล็อกการอนุมัติหรือ Build",
    capabilityWord: "capability", noProvider: "ยังไม่มี provider ประกาศ provider ที่มี capability",
    noProviderTail: "ใน evidence.yaml", externalRef: "ภายนอก: ต้องมี decision-ref",
    undeclared: "ไม่ได้ประกาศใน agreement", noFailure: "ไม่มี failure scenario ใน agreement ที่เกี่ยวกับเรื่องนี้",
    previewWord: "Preview", previewOnly: "(preview เท่านั้น ไม่ใช่ proof)", openPreview: "เปิดไฟล์ preview",
    head: {
      Requirement: "Requirement", Scenario: "Scenario", Kind: "ชนิด", Given: "ก่อน", When: "เมื่อ", Then: "ผล",
      Task: "Task", Outcome: "ผลลัพธ์", Files: "ไฟล์", Priority: "ลำดับ", "As a": "ในฐานะ", "I want": "ต้องการ",
      "So that": "เพื่อ", "Success criteria": "เกณฑ์ผ่าน", "Non-goals": "ไม่อยู่ในขอบเขต", Auth: "สิทธิ์",
      Errors: "Error", Fields: "ฟิลด์", Access: "สิทธิ์", Screen: "หน้าจอ", States: "สถานะ", Default: "ค่าเริ่มต้น",
      Validation: "ค่าที่รับ", Reproduction: "วิธีทำซ้ำ", "Root cause": "สาเหตุ", Regression: "กันเกิดซ้ำ",
      Invariants: "สิ่งที่ต้องคงเดิม", Detail: "รายละเอียด", Decision: "การตัดสินใจ", Reason: "เหตุผล",
      Failure: "ความล้มเหลว", "User sees": "ผู้ใช้เห็น", Recovery: "แก้คืน"
    },
    artifactNames: {
      impact: "ไฟล์และงานที่จะเปลี่ยน", testmap: "ตาราง test", flow: "User story และเกณฑ์ผ่าน", ui: "สถานะหน้าจอ",
      shot: "Prototype หรือภาพหน้าจอ", nav: "การนำทางบนอุปกรณ์", a11y: "ตรวจ accessibility", api: "สัญญา API และ sequence",
      playground: "ลองเรียก API (mock)", state: "State machine", integ: "การเชื่อมระบบภายนอกและตาราง failure",
      retry: "จำลอง retry timeout และ dead-letter", perm: "ตารางสิทธิ์", concur: "ทดสอบกดซ้ำพร้อมกัน",
      ledger: "Ledger และ idempotency", timeline: "ลำดับเวลาของ job", compat: "ความเข้ากันได้ของ contract",
      erd: "ERD และ schema diff", dryrun: "ซ้อม migration และ rollback", lineage: "ที่มาของข้อมูล",
      sample: "ตัวอย่างผลลัพธ์หรือ dashboard", c4: "แผนภาพสถาปัตยกรรม", plan: "แผนเปลี่ยน topology",
      pipe: "ซ้อม deploy", alert: "ตัวอย่าง alert และ dashboard", bench: "Benchmark ก่อนและหลัง", threat: "Threat model",
      repro: "วิธีทำซ้ำและสาเหตุ", equiv: "พฤติกรรมเหมือนเดิม", evaluation: "ประเมินผล AI agent",
      config: "ค่า config และ rollout", guard: "Guardrail ของการทดลอง"
    }
  }
};

export function packageText(language) {
  return String(language || "").toLowerCase().split("-")[0] === "th" ? TEXT.th : TEXT.en;
}

const list = (value) => Array.isArray(value) ? value : [];
const cell = (value) => value === undefined || value === null ? ""
  : typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
const table = (cols, rows, mark = () => "") => `<div class="scroll"><table><thead><tr>${
  cols.map((col) => `<th scope="col">${esc(cell(col))}</th>`).join("")}</tr></thead><tbody>${
  rows.map((row, i) => `<tr>${list(row).map((value, j) => `<td class="${mark(i, j)}">${esc(cell(value))}</td>`).join("")}</tr>`).join("")
}</tbody></table></div>`;
const box = (label, value) => `<div class="box"><p class="box-h">${esc(label)}</p><pre>${esc(cell(value))}</pre></div>`;
const OP = { "+": "add", "~": "chg", "-": "del", "-/+": "del" };

function scenarioCard(row, t) {
  const kind = ["success", "boundary", "failure"].includes(row.kind) ? row.kind : "success";
  return `<div class="ex k-${kind}"><p class="ex-h"><b>${esc(row.name)}</b><span>${esc(t[kind])}</span></p>` +
    (row.given ? `<p><span class="l">${esc(t.given)}</span>${esc(row.given)}</p>` : "") +
    `<p><span class="l">${esc(t.when)}</span>${esc(row.when)}</p><p><span class="l">${esc(t.then)}</span><b>${esc(row.then)}</b></p></div>`;
}
function timelineList(events) {
  return `<ol class="tl">${list(events).map((row) => `<li class="${row.kind === "failure" ? "k-failure" : row.kind === "ok" ? "k-success" : ""}">` +
    `<span class="tl-t">${esc(row.t)}</span><span class="tl-d" aria-hidden="true"></span><div>${esc(row.event)}` +
    `${row.state ? ` <span class="st">${esc(row.state)}</span>` : ""}${row.note ? `<p class="muted">${esc(row.note)}</p>` : ""}</div></li>`).join("")}</ol>`;
}

const RENDER = {
  prototype: (b, t, ctx) => {
    const href = ctx.prototypeHref(b.path);
    if (!href) return `<p class="muted">${esc(t.missingPrototype)} <code>${esc(b.path)}</code></p>`;
    return `<iframe class="frame" title="${esc(b.title)}" sandbox="allow-scripts allow-forms" src="${esc(href)}"></iframe>` +
      `<p class="small"><a href="${esc(href)}">${esc(t.openFull)}</a>${b.note ? ` · ${esc(b.note)}` : ""}</p>`;
  },
  examples: (b, t) => list(b.rules).map((rule) => `<p class="rule">${esc(t.rule)}: ${esc(rule.rule)}</p>` +
    `<div class="cards">${list(rule.rows).map((row) => scenarioCard(row, t)).join("")}</div>`).join(""),
  api: (b, t) => list(b.endpoints).map((endpoint) => `<div class="ep"><p><span class="method">${esc(endpoint.method)}</span> ` +
    `<code>${esc(endpoint.path)}</code>${endpoint.auth ? ` <span class="chip">${esc(endpoint.auth)}</span>` : ""}</p>` +
    (endpoint.summary ? `<p class="muted">${esc(endpoint.summary)}</p>` : "") +
    list(endpoint.cases).map((row, i) => `<details class="case"${i ? "" : " open"}><summary><span class="status s${esc(String(row.status)[0])}">${esc(row.status)}</span> ${esc(row.label || "")}</summary>` +
      `<div class="grid2">${box(t.request, row.request)}${box(t.response, row.response)}</div></details>`).join("") + `</div>`).join(""),
  timeline: (b) => timelineList(b.events),
  dataDiff: (b, t) => {
    const added = list(b.after?.cols).filter((col) => !list(b.before?.cols).includes(col));
    const mark = (cols) => (i, j) => added.includes(cols[j]) ? "add" : "";
    return `<p class="small"><b>${esc(b.table)}</b></p><div class="grid2"><div><p class="small muted">${esc(t.before)}</p>${table(list(b.before?.cols), list(b.before?.rows))}</div>` +
      `<div><p class="small muted">${esc(t.after)}</p>${table(list(b.after?.cols), list(b.after?.rows), mark(list(b.after?.cols)))}</div></div>` +
      (list(b.phases).length ? `<p class="small"><b>${esc(t.phases)}</b></p><ol class="small">${list(b.phases).map((row) => `<li>${esc(row)}</li>`).join("")}</ol>` : "") +
      (b.rollback ? `<p class="small"><b>${esc(t.rollback)}:</b> <code>${esc(b.rollback)}</code></p>` : "") + (b.risk ? `<p class="small muted">${esc(b.risk)}</p>` : "");
  },
  lineage: (b) => `<div class="lin">${list(b.steps).map((row, i) => (i ? `<p class="arrow">↓ ${esc(row.how || "")}</p>` : "") +
    `<div class="stp"><b>${esc(row.name)}</b><pre>${esc(cell(row.sample))}</pre></div>`).join("")}</div>`,
  mermaid: (b, t) => `<pre class="mermaid">${esc(b.source)}</pre><p class="small muted">${esc(t.diagramText)}</p>`,
  failures: (b, t) => table([t.ifFail, t.system, t.user], list(b.rows).map((row) => [row.failure, row.system, row.user])),
  permission: (b, t) => `<div class="scroll"><table><thead><tr><th scope="col"></th>${list(b.roles).map((role) => `<th scope="col">${esc(role)}</th>`).join("")}</tr></thead><tbody>${
    list(b.actions).map((row) => `<tr><th scope="row">${esc(row.action)}</th>${list(b.roles).map((role) => list(row.allow).includes(role)
      ? `<td class="yes">✓ ${esc(t.yes)}</td>` : `<td class="no">✕ ${esc(t.no)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` +
    (b.note ? `<p class="small muted">${esc(b.note)}</p>` : ""),
  plan: (b, t) => (b.summary ? `<p class="small"><b>${esc(b.summary)}</b></p>` : "") +
    `<ul class="plan">${list(b.items).map((row) => `<li class="${OP[row.op] || ""}">${esc(row.op)} ${esc(row.resource)}${row.detail ? `  # ${esc(row.detail)}` : ""}</li>`).join("")}</ul>` +
    (b.downtime ? `<p class="small"><b>${esc(t.downtime)}:</b> ${esc(b.downtime)}</p>` : "") + (b.rollback ? `<p class="small"><b>${esc(t.rollback)}:</b> ${esc(b.rollback)}</p>` : ""),
  snapshot: (b, t) => `<div class="cards">${list(b.cases).map((row) => `<div class="ex"><p class="ex-h"><b>${esc(row.input)}</b></p>` +
    `<div class="grid2">${box(t.before, row.before)}${box(t.after, row.after)}</div></div>`).join("")}</div>`,
  repro: (b, t) => (b.env ? `<p class="small">${esc(b.env)}</p>` : "") + `<ol>${list(b.steps).map((row) => `<li>${esc(row)}</li>`).join("")}</ol>` +
    `<div class="grid2"><div class="ex k-failure"><p class="ex-h"><b>${esc(t.now)}</b></p><p>${esc(b.actual)}</p></div>` +
    `<div class="ex k-success"><p class="ex-h"><b>${esc(t.after)}</b></p><p>${esc(b.expected)}</p></div></div>` + (b.cause ? `<p class="small">${esc(b.cause)}</p>` : ""),
  perf: (b, t) => {
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    const max = Math.max(1, ...list(b.metrics).flatMap((m) => [m.now, m.target].filter(num))) * 1.15;
    const bar = (label, value, unit, cls) => `<div class="bar-row"><span>${esc(label)}</span>${num(value)
      ? `<span class="track"><span class="fill ${cls}" style="width:${(value / max * 100).toFixed(1)}%"></span></span><span>${esc(value)} ${esc(unit)}</span>`
      : `<span class="warn">${esc(t.noNumber)}</span><span></span>`}</div>`;
    return (b.load ? `<p class="small muted">${esc(b.load)}</p>` : "") + `<div class="bars">${list(b.metrics).map((m) =>
      bar(`${m.name} ${t.now}`, m.now, m.unit, "now") + bar(`${m.name} ${t.target}`, m.target, m.unit, "target")).join("")}</div>`;
  },
  golden: (b, t) => (b.rubric ? `<p class="small"><b>${esc(t.rubric)}:</b> ${esc(b.rubric)}</p>` : "") + `<div class="cards">${list(b.cases).map((row) =>
    `<div class="ex k-${["boundary", "failure"].includes(row.kind) ? row.kind : "success"}"><p class="ex-h"><b>${esc(row.name)}</b><span>${esc(row.tag || "")}</span></p>` +
    `${box("input", row.input)}${box(t.good, row.good)}${row.bad ? `<p class="small no">${esc(t.bad)}: ${esc(row.bad)}</p>` : ""}</div>`).join("")}</div>`,
  adr: (b, t) => `<p><b>${esc(b.question)}</b></p><div class="cards">${list(b.options).map((row) => `<div class="opt${row.chosen ? " chosen" : ""}">` +
    `<p class="ex-h"><b>${esc(row.name)}</b>${row.chosen ? `<span class="yes">${esc(t.chosen)}</span>` : ""}</p>` +
    (row.pros ? `<p class="small"><span class="yes">+</span> ${esc(row.pros)}</p>` : "") + (row.cons ? `<p class="small"><span class="no">−</span> ${esc(row.cons)}</p>` : "") + `</div>`).join("")}</div>` +
    (b.reversible ? `<p class="small"><b>${esc(t.reversible)}:</b> ${esc(b.reversible)}</p>` : ""),
  rollout: (b, t) => table([t.stage, t.who, t.whenCol, t.stop], list(b.stages).map((row) => [row.stage, row.who, row.when, row.stop])) +
    (b.kill ? `<p class="small"><b>${esc(t.kill)}:</b> ${esc(b.kill)}</p>` : ""),
  apiDiff: (b, t) => `<ul class="plan">${list(b.changes).map((row) => `<li class="${OP[row.op] || ""}">${esc(row.op)} ${esc(row.signature)}${row.note ? `  // ${esc(row.note)}` : ""}</li>`).join("")}</ul>` +
    (b.before || b.after ? `<div class="grid2">${box(t.before, b.before)}${box(t.after, b.after)}</div>` : ""),
  strings: (b) => table(["key", ...list(b.locales)], list(b.rows).map((row) => [row.key, ...list(b.locales).map((locale) => row[locale])])) +
    (b.note ? `<p class="small muted">${esc(b.note)}</p>` : ""),
  alert: (b) => box("rule", b.rule) + `<div class="push"><b>${esc(b.title)}</b><p class="small">${esc(b.message || "")}</p></div>` +
    (list(b.dashboard).length ? `<div class="kpis">${list(b.dashboard).map((row) => `<div class="kpi"><b>${esc(row.value)}</b><span>${esc(row.label)}</span></div>`).join("")}</div>` : ""),
  privacy: (b) => table(["field", "pii", "where", "retention"], list(b.fields).map((row) => [row.field, row.pii, row.where, row.retention])) +
    (list(b.threats).length ? table(["threat", "mitigation"], list(b.threats).map((row) => [row.threat, row.mitigation])) : ""),
  coverage: (b) => table(["scenario", "test", "level"], list(b.rows).map((row) => [row.scenario, row.test, row.level]),
    (i, j) => j === 1 && /^[—-]?$/.test(String(list(b.rows)[i]?.test || "").trim()) ? "del" : ""),
  consumers: (b) => table(["consumer", "usage", "action"], list(b.rows).map((row) => [row.consumer, row.usage, row.action])) +
    (list(b.timeline).length ? timelineList(b.timeline) : ""),
  messages: (b) => list(b.items).map((row) => (row.when ? `<p class="small muted">${esc(row.when)}</p>` : "") + `<div class="msg">` +
    (row.from ? `<p class="small muted">${esc(row.from)}</p>` : "") + `<p><b>${esc(row.subject)}</b></p>` +
    String(row.body ?? "").split("\n").map((line) => `<p>${esc(line)}</p>`).join("") + (row.cta ? `<p><span class="cta">${esc(row.cta)}</span></p>` : "") + `</div>`).join(""),
  terminal: (b) => `<pre class="term">${list(b.lines).map((line) => {
    const value = String(line);
    if (value.startsWith("$ ")) return `<span class="t-p">${esc(value)}</span>`;
    if (value.startsWith("! ")) return `<span class="t-e">${esc(value.slice(2))}</span>`;
    if (value.startsWith("+ ")) return `<span class="t-o">${esc(value.slice(2))}</span>`;
    return esc(value);
  }).join("\n")}</pre>`,
  doc: (b, t) => `<div class="doc">${list(b.sections).map((row) => typeof row === "string" ? `<p>${esc(row)}</p>`
    : (row.heading ? `<h4>${esc(row.heading)}</h4>` : "") + (row.text ? `<p>${esc(row.text)}</p>` : "") +
      (row.code ? `<pre>${esc(row.code)}</pre>` : "") + (row.expect ? `<p class="small muted">${esc(row.expect)}</p>` : "")).join("")}</div>`,
  pipeline: (b) => `<p class="pipe">${list(b.before).map((row) => `<span>${esc(row)}</span>`).join(" → ")}</p>` +
    `<p class="pipe">${list(b.after).map((row) => `<span class="${list(b.before).includes(row) ? "" : "add"}">${esc(row)}</span>`).join(" → ")}</p>` +
    (b.note ? `<p class="small">${esc(b.note)}</p>` : ""),
  search: (b) => list(b.queries).map((row) => `<div class="ex"><p class="ex-h"><b>“${esc(row.q)}”</b><span>${esc(row.tag || "")}</span></p>` +
    `<ol class="small">${list(row.results).map((value) => `<li>${esc(cell(value))}</li>`).join("")}</ol>${row.note ? `<p class="small muted">${esc(row.note)}</p>` : ""}</div>`).join(""),
  report: (b) => `<div class="kpis">${list(b.kpis).map((row) => `<div class="kpi"><b>${esc(row.value)}</b><span>${esc(row.label)}</span>` +
    `${row.delta ? ` <span class="${String(row.delta).startsWith("-") ? "no" : "yes"}">${esc(row.delta)}</span>` : ""}</div>`).join("")}</div>` +
    table(list(b.table?.cols), list(b.table?.rows)) + (b.defs ? `<p class="small">${esc(b.defs)}</p>` : ""),
  diffSummary: (b) => `<ul class="plan">${list(b.items).map((row) => `<li class="${OP[row.op] || ""}">${esc(row.op)} ${esc(row.path)}${row.note ? `  ${esc(row.note)}` : ""}</li>`).join("")}</ul>`
};

export const RENDERED_TYPES = Object.freeze(Object.keys(RENDER));

// The agreed view of one example. Unknown types render nothing; the draft
// validator already refuses them, so this only guards older states.
export function renderExample(example, t, ctx = {}) {
  const render = RENDER[example?.type];
  if (!render) return "";
  return render(example, t, { prototypeHref: () => null, ...ctx });
}
