#!/usr/bin/env node

import {
  appendFileSync, existsSync, mkdirSync
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMetricsRuntime } from "./runtime/observability/metrics-runtime.mjs";
import { createExecRuntime } from "./runtime/observability/exec-runtime.mjs";
import { createTelemetryRuntime } from "./runtime/observability/telemetry-runtime.mjs";
import { createJsonlReader } from "./runtime/observability/telemetry.mjs";
import {
  createHostExecutionStore, createModelDriftInspector, hostExecutionTelemetryRows
} from "./runtime/observability/host-execution-contract.mjs";
import { createHostAttestationRuntime } from "./runtime/evidence/attestation.mjs";
import { validateSignedCiEnvelope } from "./runtime/evidence/signed-ci.mjs";
import { createAuthorityStore } from "./runtime/workflow/authority.mjs";
import { createBudgetRuntime } from "./runtime/workflow/budget.mjs";
import {
  createBudgetContinuation, createBudgetReporter
} from "./runtime/workflow/budget-commands.mjs";
import {
  adapterResources as resultAdapterResources,
  configuredCommand,
  mutationProtocolResult,
  numericReportValue,
  parseJsonOutput,
  parseTapOutput,
  playwrightReportSummary,
  resourcesConflict
} from "./runtime/evidence/evidence-results.mjs";
import { createFlagParser } from "./runtime/core/cli-flags.mjs";
import { createCommandRegistry } from "./runtime/core/command-registry.mjs";
import { createRuntimeEnvironment } from "./runtime/core/runtime-environment.mjs";
import {
  phaseForCommand, telemetryPhaseForCommand
} from "./runtime/core/lifecycle-phase.mjs";
import { createProcessRuntime } from "./runtime/core/process-runtime.mjs";
import { createInstructionRecorder } from "./runtime/core/instruction-recorder.mjs";
import { createAgentPlanner, createModelRouter } from "./runtime/workflow/agent-planning.mjs";
import { createSandboxRuntime } from "./runtime/workflow/sandbox-runtime.mjs";
import { createSandboxCleanup } from "./runtime/workflow/sandbox-cleanup.mjs";
import {
  createLandJournal, transactionJournals as readTransactionJournals
} from "./runtime/workflow/land-journal.mjs";
import { createProofRuntime } from "./runtime/evidence/proof-runtime.mjs";
import { createRepositoryTopology } from "./runtime/workflow/repository-topology.mjs";
import { createRepositorySnapshot } from "./runtime/workflow/repository-snapshot.mjs";
import { createPacketRuntime } from "./runtime/workflow/packet-runtime.mjs";
import { createChangePolicy } from "./runtime/workflow/change-policy.mjs";
import { taskBlocks, taskMetadata } from "./runtime/contracts/change-artifacts.mjs";
import { createChangeLifecycle } from "./runtime/workflow/change-lifecycle.mjs";
import { createLeaseRuntime } from "./runtime/workflow/lease-runtime.mjs";
import { createAuthorityRuntime } from "./runtime/workflow/authority-runtime.mjs";
import { createHandoffRuntime } from "./runtime/workflow/handoff-runtime.mjs";
import {
  assertOpenSpecCli, createLandRuntime, openSpecCliStatus
} from "./runtime/workflow/land-runtime.mjs";
import { createApplyRuntime } from "./runtime/workflow/apply-runtime.mjs";
import { createApplyRecovery } from "./runtime/workflow/apply-recovery.mjs";
import { createDiagnosticsRuntime } from "./runtime/core/diagnostics-runtime.mjs";
import { createStateRuntime } from "./runtime/core/state-runtime.mjs";
import {
  createEvidenceContract,
  REVIEW_FORCING_CAPABILITIES,
  REVIEW_DIVERSITY_CAPABILITIES
} from "./runtime/evidence/evidence-contract.mjs";
import { createChangeValidationRuntime } from "./runtime/workflow/change-validation.mjs";
import { routeRuntimeCommand } from "./runtime/core/cli-router.mjs";
import { createProviderScheduler } from "./runtime/evidence/provider-scheduler.mjs";
import { createReviewProtocol } from "./runtime/evidence/review-protocol.mjs";
import { createArtifactStore } from "./runtime/evidence/artifact-store.mjs";
import { createReviewAttemptStore } from "./runtime/evidence/review-attempt-store.mjs";
import { createProofReadinessRuntime } from "./runtime/evidence/proof-readiness.mjs";
import { createReceiptRuntime } from "./runtime/evidence/receipt-runtime.mjs";
import { createReceiptValidity } from "./runtime/evidence/receipt-validity.mjs";
import { createAdapterRuntime } from "./runtime/evidence/adapter-runtime.mjs";
import { createProofExecutionRuntime } from "./runtime/evidence/proof-execution-runtime.mjs";
import { createConfiguredReviewerRuntime } from "./runtime/evidence/codex-reviewer.mjs";
import { createBlockedDecision } from "./runtime/core/blocked-decision.mjs";
import { createAbandonRuntime } from "./runtime/workflow/abandon-runtime.mjs";
import { RUNTIME_MODULE_API } from "./runtime/version.mjs";
import { createBootstrap } from "./runtime/composition/bootstrap.mjs";
import {
  EXCLUDED_WORKSPACE_DIRS, SANDBOX_COPY_EXCLUDED_DIRS
} from "./runtime/core/workspace-policy.mjs";
import {
  ADAPTERS, INPUT_MODES, PROVIDER_CONTRACTS, PROVIDERS, providerCapability
} from "./runtime/evidence/provider-catalog.mjs";
import { SECURITY_TERMS } from "./runtime/workflow/security-policy.mjs";

const VERSION = "3.2.29";
const RUNTIME_API_VERSION = "21";
// Checked here, at load, rather than only inside `doctor`: a torn install —
// this file from one revision, runtime/** from another — otherwise passed
// every command up to `archive` and then threw partway through Land.
if (RUNTIME_MODULE_API !== RUNTIME_API_VERSION) {
  console.error(
    `BLOCKED: harness entrypoint API ${RUNTIME_API_VERSION} does not match ` +
    `runtime modules API ${RUNTIME_MODULE_API}; the installed .claude/harness ` +
    "is a mixture of two revisions. Reinstall it with 'claude-foundation init <project>'.");
  process.exit(1);
}
const PROVIDER_PROTOCOL_VERSION = "9";
const ADAPTER_PROTOCOL_VERSION = "5";
const PROOF_PROTOCOL_VERSION = "6";
const PACKET_SCHEMA_VERSION = "6";
const AGENT_PLAN_SCHEMA_VERSION = "3";
const CONTEXT_EVENT_SCHEMA_VERSION = "2";
const REVIEW_PROTOCOL_VERSION = "3";
const ACCEPTANCE_PROTOCOL_VERSION = "2";
const REVIEW_PACKET_SCHEMA_VERSION = "4";
const ATTESTATION_PROTOCOL_VERSION = "1";
const AUTHORITY_PROTOCOL_VERSION = "2";
const CI_EVIDENCE_PROTOCOL_VERSION = "1";
// A refusal is a lifecycle stop, not a crash. Recording it as a failure would
// bury real breakage under the guards that are working as designed.
let operationBlocked = false;
// A command that prints a structured non-ready result and returns has also
// ended in a refusal, not a crash — but it never reaches `die`. `block()` is
// that second spelling: it records the decision without exiting, so the exit
// handler reports what the command decided instead of inferring it.
function markBlocked() { operationBlocked = true; }
function die(message, code = 1) {
  markBlocked();
  console.error(`BLOCKED: ${message}`);
  process.exit(code);
}
const { parseFlags, parseStrictCommandFlags } = createFlagParser({ fail: die });
const { blockedDecisionValue, blockWithDecision } = createBlockedDecision({ fail: die });

const {
  root: ROOT,
  paths: {
    runtime: RUNTIME, receipts: RECEIPTS, logs: LOGS, evidenceVault: EVIDENCE_VAULT,
    snapshots: SNAPSHOTS, transactions: TRANSACTIONS, plans: PLANS, leases: LEASES,
    prototypes: PROTOTYPES, attestations: ATTESTATIONS, authority: AUTHORITY,
    handoffs: HANDOFFS, instructionManifests: INSTRUCTION_MANIFESTS,
    recovery: RECOVERY, changes: CHANGES
  },
  readJson, readJsonOrNull, writeJson, canonicalPath, pathInside, now
} = createBootstrap({
  start: process.cwd(),
  pinned: process.env.CLAUDE_FOUNDATION_PROJECT,
  fail: die,
  warn: console.error
});

const { readJsonLines, readJsonLinesTolerant } = createJsonlReader({
  root: ROOT,
  fail: die
});

const operationStartedAt = Date.now();
let operationChangeId = null;
let operationName = null;
let operationPhase = null;
let operationStatusAtStart = null;
// Commands that only read. `showMetrics` buckets every row of operations.jsonl
// and then this handler appended a row for the read itself, so each inspection
// permanently inflated the next one — and an archived change, which is
// finished evidence, still accumulated rows from sessions that only looked at
// it. A read is not an operation the change performed.
// Lifecycle commands stay: metrics derives rework and typed-stop signals from
// their rows, so proof-* and land-* are measurements, not inspections.
const READ_ONLY_OPERATIONS = new Set([
  "metrics", "hash", "changes", "providers", "repos", "models", "describe",
  "packet", "agent-task", "audit-change", "authority-status",
  "handoff-status", "handoff-packet", "evidence-detect", "evidence-doctor",
  "doctor", "api-version", "version"
]);
process.on("exit", (code) => {
  if (process.env.FOUNDATION_TELEMETRY === "0" || !operationChangeId || !operationName) return;
  if (READ_ONLY_OPERATIONS.has(operationName)) return;
  // An archived change is finished. Nothing this session did belongs in it —
  // judged by the status the change had when the command started, so the
  // archive that finishes it still logs its own row while later sessions that
  // merely touch the finished change stay silent.
  if (operationStatusAtStart === "archived") return;
  try {
    const path = join(LOGS, operationChangeId, "operations.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 2, changeId: operationChangeId, operation: operationName,
      phase: process.env.FOUNDATION_PUBLIC_OPERATION || operationPhase || null,
      // Blocked is declared by the command through `block()`/`die()`, never
      // inferred here. The previous spelling guessed from (exit code 2,
      // operation name) against a hardcoded list, so any path that set an exit
      // code without going through `die` was filed as a failure: the same
      // `validate` refusal read `failed` in one change and `blocked` in
      // another, and `metrics` counted the difference as rework.
      status: code === 0 ? "completed"
        : operationBlocked ? "blocked" : "failed", exitCode: code,
      startedAt: new Date(operationStartedAt).toISOString(), finishedAt: now(),
      durationMs: Date.now() - operationStartedAt,
      requests: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, cacheTokens: null, cost: null,
      measurement: "command-observed; model usage requires host telemetry ingestion"
    })}\n`);
  } catch (error) {
    if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
      console.error(`WARNING: telemetry unavailable: ${error.message}`);
  }
});

const {
  commandRegistry,
  describeCommand,
  assertRegisteredRuntimeCommand
} = createCommandRegistry({
  path: join(dirname(fileURLToPath(import.meta.url)), "commands.json"),
  readJson,
  fail: die
});

const {
  protocolDescriptor,
  commandExists,
  playwrightAvailability,
  foundationPolicy
} = createRuntimeEnvironment({
  root: ROOT,
  // During Foundation's own Build, state remains pinned to the control root
  // while the candidate entrypoint runs from its sandbox. Protocol integrity
  // belongs to that executable bundle, not to the state root it operates on.
  protocolPath: join(dirname(fileURLToPath(import.meta.url)), "protocol.json"),
  policyPath: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "foundation.json"),
  protocols: {
    runtime: VERSION,
    runtimeApi: RUNTIME_API_VERSION,
    providerProtocol: PROVIDER_PROTOCOL_VERSION,
    adapterProtocol: ADAPTER_PROTOCOL_VERSION,
    proofProtocol: PROOF_PROTOCOL_VERSION,
    packetSchema: PACKET_SCHEMA_VERSION,
    agentPlanSchema: AGENT_PLAN_SCHEMA_VERSION,
    contextEventSchema: CONTEXT_EVENT_SCHEMA_VERSION,
    reviewProtocol: REVIEW_PROTOCOL_VERSION,
    acceptanceProtocol: ACCEPTANCE_PROTOCOL_VERSION,
    reviewPacketSchema: REVIEW_PACKET_SCHEMA_VERSION,
    attestationProtocol: ATTESTATION_PROTOCOL_VERSION,
    authorityProtocol: AUTHORITY_PROTOCOL_VERSION,
    ciEvidenceProtocol: CI_EVIDENCE_PROTOCOL_VERSION
  },
  readJson,
  fail: die
});
const { recordInstructionManifest } = createInstructionRecorder({
  root: ROOT,
  foundationVersion: VERSION,
  instructionManifests: INSTRUCTION_MANIFESTS,
  writeJson
});
const {
  reviewerConfig,
  reviewerStatus,
  runReview: runConfiguredReview
} = createConfiguredReviewerRuntime({
  root: ROOT,
  foundationPolicy,
  commandExists,
  now,
  fail: die
});
const stateRuntime = createStateRuntime({
  root: ROOT,
  runtime: RUNTIME,
  changes: CHANGES,
  receipts: RECEIPTS,
  evidenceVault: EVIDENCE_VAULT,
  snapshots: SNAPSHOTS,
  excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS,
  readJson,
  writeJson,
  canonicalPath,
  now,
  fail: die
});
const {
  runtimePath,
  changePath,
  receiptPath,
  proofPath,
  proofRunRoot,
  snapshotPath,
  currentChangeRelativePath,
  isCurrentChangePath,
  activeChangePath,
  archivedChangeRelativePath,
  slugify,
  loadRuntime,
  saveRuntime,
  activeChanges,
  orphanRuntimeChanges,
  walk,
  filesystemEntryIdentity,
  directoryHash,
  stableHash,
  serializedJson,
  compactList,
  compactStrings,
  expandList,
  listCount,
  fileDigest,
  singleRelevantSnapshot,
  clearSnapshotCache,
  registerPolicyCacheClearer,
  workspaceManifest,
  declaredSurfaceMatcher,
  preexistingDirty,
  porcelainStatusRecords,
  git,
  gitBuffer,
  gitHead
} = stateRuntime;
const {
  flagValues,
  provenanceResult: reviewProvenanceResult,
  receiptBinding: reviewReceiptBinding,
  subjectProvenance,
  attemptIsValid: reviewAttemptIsValid
} = createReviewProtocol({ stableHash, fail: die });
const {
  reviewHistoryState,
  reviewAttemptByDigest,
  reviewHistoryChainValid,
  assertReviewDispatchAllowed,
  reserveReviewAttempt,
  dispatchReviewAttempt,
  completeReviewAttempt,
  recordRepairClosureAttempt,
  reviewAttempts,
  deliveredAiAttempts,
  infrastructureAiAttempts,
  acknowledgeInfrastructureAttempts
} = createReviewAttemptStore({
  receiptsRoot: RECEIPTS,
  evidenceVault: EVIDENCE_VAULT,
  readJson,
  writeJson,
  loadRuntime,
  saveRuntime,
  stableHash,
  reviewReceiptBinding,
  now,
  blockWithDecision,
  fail: die
});
const hostAttestation = createHostAttestationRuntime({
  root: ROOT,
  attestations: ATTESTATIONS,
  protocolVersion: ATTESTATION_PROTOCOL_VERSION,
  loadRuntime,
  changePath,
  directoryHash,
  stableHash,
  readJson,
  writeJson,
  now
});
const authorityStore = createAuthorityStore({
  root: AUTHORITY,
  protocolVersion: AUTHORITY_PROTOCOL_VERSION,
  readJson,
  writeJson,
  now
});
const {
  eventTokenCount,
  budgetWindow,
  initialBudget,
  knownNumber,
  ensureBudgetState,
  activateBudgetWindow,
  budgetDecision,
  applyBudgetDecision,
  eventUsage,
  synchronizeBudgetUsage
} = createBudgetRuntime({ policy: foundationPolicy, now });
const { reportBudget } = createBudgetReporter({ applyBudgetDecision });
const { showMetrics } = createMetricsRuntime({
  logs: LOGS,
  receipts: RECEIPTS,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  instructionManifests: INSTRUCTION_MANIFESTS,
  activeChangePath,
  policy: foundationPolicy,
  taskBlocks,
  taskMetadata
});
const { execObserved } = createExecRuntime({
  logs: LOGS,
  loadRuntime,
  now,
  fail: die
});
const repositoryTopology = createRepositoryTopology({
  root: ROOT,
  slugify,
  readJson,
  canonicalPath,
  pathInside,
  activeChangePath,
  loadRuntime,
  git,
  gitHead,
  fail: die
});
const {
  catalog: repositoryCatalog,
  changeSelection: changeRepositorySelection,
  selectionIdsAt: repositorySelectionIdsAt,
  selected: selectedRepositories,
  byId: repositoryById,
  show: showRepositories
} = repositoryTopology;
const { relevantSnapshot, relevantHash } = createRepositorySnapshot({
  root: ROOT,
  runtimePath,
  snapshotPath,
  readJson,
  writeJson,
  singleRelevantSnapshot,
  selectedRepositories,
  gitHead,
  stableHash,
  now
});
const {
  changedFilesInWorkspace,
  changedFiles,
  canonicalChangedSurface,
  changedSurfaceResolvable,
  policyCapabilities,
  policyCapabilityTrigger,
  capabilitiesForPaths,
  forecastCapabilities,
  clearPolicyCache
} = createChangePolicy({
  root: ROOT,
  excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS,
  providers: PROVIDERS,
  gitHead,
  git,
  porcelainStatusRecords,
  workspaceManifest,
  loadRuntime,
  selectedRepositories,
  isCurrentChangePath,
  readJson,
  fileDigest,
  fail: die
});
// clearSnapshotCache is what every surface mutation already calls; the policy
// cache invalidates with it or not at all.
registerPolicyCacheClearer(clearPolicyCache);
const {
  appendTelemetryRows,
  bindClaudeSession,
  claudeHostContext,
  importTelemetry,
  modelUsageRecorded,
  prepareClaudeTelemetry,
  recordContextMetric,
  recordEvent,
  recordPhaseContext,
  syncClaudeTelemetry
} = createTelemetryRuntime({
  root: ROOT,
  logs: LOGS,
  contextEventSchemaVersion: CONTEXT_EVENT_SCHEMA_VERSION,
  stableHash,
  now,
  readJson,
  writeJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  saveRuntime,
  synchronizeBudgetUsage,
  reportBudget,
  snapshotPath,
  parseFlags,
  activeChangePath,
  repositoryById,
  taskBlocks,
  fail: die
});
const hostExecutionStore = createHostExecutionStore({ root: ROOT, now });
function importHostExecution(id, source) {
  loadRuntime(id);
  const path = resolve(process.cwd(), source);
  if (!existsSync(path)) die(`host execution result not found: ${source}`);
  // A malformed host file is the host's input being wrong, not the harness
  // breaking. Letting the throw escape reported it as a crash and logged the
  // operation "failed" rather than "blocked".
  let result;
  try {
    result = hostExecutionStore.importExecution(id, readJson(path));
  } catch (error) {
    die(`host execution result is invalid: ${error.message}`);
  }
  const imported = appendTelemetryRows(
    id,
    hostExecutionTelemetryRows(result.execution),
    "host-execution",
    { snapshot: readJson(snapshotPath(id), {}) }
  );
  console.log(`HOST EXECUTION ${id}: ${result.duplicate ? "duplicate" : "recorded"}; imported ${imported}`);
}
const handoffRuntime = createHandoffRuntime({
  root: ROOT,
  handoffsRoot: HANDOFFS,
  activeChangePath,
  loadRuntime,
  readJson,
  writeJson,
  stableHash,
  now,
  fail: die
});
const {
  handoffContract,
  handoffReadiness,
  showHandoffPacket,
  showHandoffStatus,
  recordHandoff
} = handoffRuntime;
const evidenceContract = createEvidenceContract({
  ROOT,
  PROVIDERS,
  ADAPTERS,
  INPUT_MODES,
  EXCLUDED_WORKSPACE_DIRS,
  ADAPTER_PROTOCOL_VERSION,
  PROVIDER_PROTOCOL_VERSION,
  activeChangePath,
  readJson,
  repositoryById,
  selectedRepositories,
  providerCapability,
  canonicalPath,
  loadRuntime,
  relevantHash,
  relevantSnapshot,
  singleRelevantSnapshot,
  fileDigest,
  stableHash,
  policyCapabilities,
  foundationPolicy,
  handoffContract,
  die
});
const {
  rawExecution,
  scopedReviewClaims,
  evidence,
  claimsForProvider,
  providerConfig,
  providerClaims,
  providerRepository,
  providerWorkspace,
  providerWorkspaceHash,
  providerInputIdentity,
  environmentDescriptor,
  adapterFingerprint,
  contractFingerprint,
  normalizedAcceptance,
  resolvedAcceptance,
  reviewPolicy,
  executionFingerprint
} = evidenceContract;
const {
  decodedEvidencePath,
  evidenceInputTargetsPrototype,
  rejectPrototypeEvidenceInputs,
  receiptPrototypeEvidence,
  durableArtifact,
  validateArtifact
} = createArtifactStore({
  root: ROOT,
  prototypesRoot: PROTOTYPES,
  evidenceVault: EVIDENCE_VAULT,
  canonicalPath,
  providerWorkspace,
  proofRunRoot,
  pathInside,
  fileDigest,
  fail: die
});
const { receiptValidity } = createReceiptValidity({
  evidenceVault: EVIDENCE_VAULT,
  providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
  adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
  reviewProtocolVersion: REVIEW_PROTOCOL_VERSION,
  acceptanceProtocolVersion: ACCEPTANCE_PROTOCOL_VERSION,
  receiptPath,
  readJson,
  receiptPrototypeEvidence,
  contractFingerprint,
  providerConfig,
  providerCapability,
  reviewProvenanceResult,
  reviewPolicy,
  reviewAttemptByDigest,
  reviewAttemptIsValid,
  resolvedAcceptance,
  claimsForProvider,
  stableHash,
  adapterFingerprint,
  providerWorkspaceHash,
  providerInputIdentity,
  validateArtifact,
  relevantHash
});
const changeValidationRuntime = createChangeValidationRuntime({
  markBlocked,
  root: ROOT,
  activeChangePath,
  changePath,
  walk,
  loadRuntime,
  saveRuntime,
  evidence,
  selectedRepositories,
  providerCapability,
  providerConfig,
  resolvedAcceptance,
  reviewPolicy,
  policyCapabilities,
  policyCapabilityTrigger,
  changedSurfaceResolvable,
  forecastCapabilities,
  rawExecution,
  handoffContract,
  contractFingerprint,
  commandExists,
  stableHash,
  fileDigest,
  pathInside,
  knownProviders: PROVIDERS,
  writeJson,
  now,
  fail: die
});
const {
  advisoryCapabilities,
  assertNoDroppedScenarios,
  changeArtifactGaps,
  changeSpecScenarios,
  groundingValue,
  evidenceDetectionValue,
  initializeEvidence,
  pendingTasks,
  requiredProviders,
  showEvidenceDetection,
  showEvidenceDoctor,
  showTraceabilityAudit,
  traceabilityAuditValue,
  validate,
  waiveGate
} = changeValidationRuntime;
const { runCommand, startServiceSession } = createProcessRuntime({
  root: ROOT,
  logs: LOGS,
  now,
  resolveServiceCwd(id, config) {
    const state = loadRuntime(id);
    return config.repository
      ? repositoryById(id, config.repository, state).workspacePath
      : state.workspace?.path || ROOT;
  }
});
const receiptRuntime = createReceiptRuntime({
  ROOT,
  LOGS,
  PROVIDERS,
  INPUT_MODES,
  providerWorkspace,
  ADAPTER_PROTOCOL_VERSION,
  PROVIDER_PROTOCOL_VERSION,
  REVIEW_PROTOCOL_VERSION,
  ACCEPTANCE_PROTOCOL_VERSION,
  validate,
  relevantHash,
  requiredProviders,
  advisoryCapabilities,
  receiptValidity,
  now,
  writeJson,
  receiptPath,
  providerConfig,
  providerCapability,
  loadRuntime,
  resolvedAcceptance,
  evidence,
  claimsForProvider,
  providerWorkspaceHash,
  providerRepository,
  rejectPrototypeEvidenceInputs,
  durableArtifact,
  providerInputIdentity,
  contractFingerprint,
  executionFingerprint,
  stableHash,
  adapterFingerprint,
  environmentDescriptor,
  reviewPolicy,
  subjectProvenance,
  reviewProvenanceResult,
  readJson,
  flagValues,
  reviewHistoryState,
  reserveReviewAttempt,
  reviewAttemptByDigest,
  reviewAttemptIsValid,
  reviewReceiptBinding,
  recordRepairClosureAttempt,
  deliveredAiAttempts,
  groundingForReview: (id) => {
    const state = loadRuntime(id);
    return groundingValue(id, state, activeChangePath(id, state))?.value || null;
  },
  foundationPolicy,
  die
});
const {
  proofPlan,
  rebindReusableReceipt,
  recordReceipt,
  recordDeterministicReviewClosure
} = receiptRuntime;
const adapterRuntime = createAdapterRuntime({
  ROOT,
  LOGS,
  PROVIDERS,
  providerCapability,
  providerConfig,
  parseFlags,
  providerWorkspace,
  recordReceipt,
  startServiceSession,
  evidence,
  resultAdapterResources,
  loadRuntime,
  providerRepository,
  repositoryById,
  fileDigest,
  pathInside,
  configuredCommand,
  stableHash,
  runCommand,
  providerWorkspaceHash,
  providerClaims,
  parseJsonOutput,
  parseTapOutput,
  numericReportValue,
  playwrightReportSummary,
  requiredProviders,
  mutationProtocolResult,
  now,
  die
});
const {
  runProvider,
  startRequiredServices,
  executionLog,
  adapterResources,
  executeAdapter
} = adapterRuntime;
const {
  executionNodes,
  runExecutionDag,
  collectableExecutionNodes
} = createProviderScheduler({
  requiredProviders,
  receiptValidity,
  providerConfig,
  commandExists,
  providerWorkspace,
  playwrightAvailability,
  evidence,
  stableHash,
  providerCapability,
  adapterResources,
  resourcesConflict,
  executeAdapter,
  fail: die
});
const { modelForTask } = createModelRouter({
  loadRuntime,
  policy: foundationPolicy,
  fail: die
});
const packetRuntime = createPacketRuntime({
  ROOT,
  PACKET_SCHEMA_VERSION,
  REVIEW_PACKET_SCHEMA_VERSION,
  loadRuntime,
  readJson,
  activeChangePath,
  canonicalChangedSurface,
  evidence,
  taskBlocks,
  taskMetadata,
  repositoryById,
  claimsForProvider,
  relevantSnapshot,
  snapshotPath,
  singleRelevantSnapshot,
  requiredProviders,
  receiptValidity,
  providerConfig,
  adapterResources,
  stableHash,
  compactStrings,
  modelForTask,
  compactList,
  fileDigest,
  directoryHash,
  ensureBudgetState,
  budgetDecision,
  scopedReviewClaims,
  relevantHash,
  providerCapability,
  receiptPath,
  contractFingerprint,
  reviewPolicy,
  resolvedAcceptance,
  handoffReadiness,
  serializedJson,
  foundationPolicy,
  recordContextMetric,
  recordInstructionManifest,
  fail: die
});
const {
  packetValue,
  reviewPacketValue,
  showPacket
} = packetRuntime;
const {
  authorityProvider,
  authorityPacket,
  requestAuthority,
  dispatchAuthority,
  runAuthorityReviewer,
  abortAuthority,
  resetInfrastructureAuthority,
  authorityStatusValue,
  showAuthorityStatus,
  recordAuthority,
  recordVerifiedCi
} = createAuthorityRuntime({
  root: ROOT,
  protocolVersion: AUTHORITY_PROTOCOL_VERSION,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  authorityStore,
  requiredProviders,
  providerCapability,
  providerConfig,
  reviewPacketValue,
  loadRuntime,
  evidence,
  resolvedAcceptance,
  relevantHash,
  validate,
  pendingTasks,
  claimsForProvider,
  stableHash,
  now,
  reviewPolicy,
  readJson,
  expandList,
  listCount,
  dispatchReviewAttempt,
  completeReviewAttempt,
  reviewHistoryState,
  reviewAttempts,
  deliveredAiAttempts,
  reviewAttemptByDigest,
  assertReviewDispatchAllowed,
  foundationPolicy,
  reviewerConfig,
  reviewerStatus,
  runConfiguredReview,
  acknowledgeInfrastructureAttempts,
  writeJson,
  receiptPath,
  recordReceipt,
  receiptValidity,
  fileDigest,
  providerWorkspaceHash,
  providerRepository,
  providerWorkspace,
  gitHead,
  validateSignedCiEnvelope,
  providerClaims,
  fail: die
});
const {
  planValue: agentPlanValue,
  showPlan: showAgentPlan,
  showTask: showAgentTask,
  activeRepositoryConflicts
} = createAgentPlanner({
  root: ROOT,
  plans: PLANS,
  runtime: RUNTIME,
  schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
  validate,
  loadRuntime,
  policy: foundationPolicy,
  selectedRepositories,
  // Reading *another* change's topology must not end this process when that
  // change's selection is stale — see activeRepositoryConflicts.
  safeSelectedRepositories: (id, state) => {
    try {
      return selectedRepositories(id, state, (message) => { throw new Error(message); });
    } catch { return null; }
  },
  taskBlocks,
  taskMetadata,
  activeChangePath,
  evidence,
  resourcesConflict,
  relevantHash,
  contractFingerprint,
  stableHash,
  now,
  readJson,
  writeJson,
  compactStrings,
  serializedJson,
  recordContextMetric,
  recordInstructionManifest,
  modelForTask,
  showPacket,
  fail: die
});
const {
  leasePath,
  acquire: acquireAgentLease,
  release: releaseAgentLease,
  active: activeChangeLeases,
  cleanup: cleanupChangeLeases
} = createLeaseRuntime({
  leases: LEASES,
  stableHash,
  agentPlanValue,
  policy: foundationPolicy,
  readJson,
  writeJson,
  now,
  fail: die
});
const {
  activeWorkRecovery,
  changedSurfaceIssues,
  codeChangeRecovery,
  configurationRecovery,
  externalEvidenceRecovery,
  proofPreflight,
  proofReadiness,
  proofReadinessValue,
  readinessBudgetPolicy,
  recoveryLines,
  topologyIssues,
  unavailableProviderRecovery,
  upgradeEvidence
} = createProofReadinessRuntime({
  markBlocked,
  evidence,
  loadRuntime,
  taskBlocks,
  activeChangePath,
  taskMetadata,
  canonicalChangedSurface,
  selectedRepositories,
  providerCapability,
  providerConfig,
  advisoryCapabilities,
  evidenceDetectionValue,
  validate,
  relevantHash,
  executionNodes,
  pendingTasks,
  handoffReadiness,
  activeChangeLeases,
  activeRepositoryConflicts,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  fail: die
});
const { continueBudget } = createBudgetContinuation({
  logs: LOGS,
  loadRuntime,
  saveRuntime,
  ensureBudgetState,
  applyBudgetDecision,
  changeArtifactGaps,
  activeChangePath,
  pendingTasks,
  readinessBudgetPolicy,
  proofReadinessValue,
  eventUsage,
  budgetWindow,
  readJsonLines,
  now,
  blockWithDecision,
  fail: die
});
const {
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes
} = createSandboxCleanup({ root: ROOT, canonicalPath, git });
const sandboxRuntime = createSandboxRuntime({
  markBlocked,
  root: ROOT,
  policy: foundationPolicy,
  excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS,
  sandboxCopyExcludedDirs: SANDBOX_COPY_EXCLUDED_DIRS,
  hostAttestation,
  loadRuntime,
  saveRuntime,
  canonicalPath,
  workspaceManifest,
  directoryHash,
  fileDigest,
  changePath,
  gitHead,
  git,
  gitBuffer,
  porcelainStatusRecords,
  selectedRepositories,
  cleanupRepositorySandboxes,
  cleanupAppliedSandbox,
  clearSnapshotCache,
  validate,
  repositorySelectionIdsAt,
  contractFingerprint,
  executionFingerprint,
  taskBlocks,
  proofPath,
  relevantHash,
  fail: die
});
const {
  createChallenge: createAttestationChallenge,
  workspaceInspection: workspaceIsolationInspection,
  inspect: isolationInspection,
  showInspection: showSandboxInspection,
  createSingle: createSingleSandbox,
  create: createSandbox,
  mergeTaskProgress,
  sync: syncSandbox
} = sandboxRuntime;
const {
  templateDir,
  instantiate,
  loadDraft,
  materializeDraft,
  createChange,
  rapidStartTemplate,
  startAtomic,
  resolveChange
} = createChangeLifecycle({
  root: ROOT,
  policy: foundationPolicy,
  securityTerms: SECURITY_TERMS,
  fail: die,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId(id) { operationChangeId = id; },
  initialBudget,
  gitHead,
  preexistingDirty,
  now,
  bindClaudeSession,
  validate,
  createSandbox,
  showPacket
});
function unresolvedApplyTransactions(id) {
  return readTransactionJournals(TRANSACTIONS, id, readJson).filter((journal) =>
    ["prepared", "applying", "rolling-back", "manual-recovery", "recovering-backup",
      "settling-current"]
      .includes(journal.status));
}
const {
  doctor,
  migrate,
  showChanges,
  showProviders,
  usage
} = createDiagnosticsRuntime({
  root: ROOT,
  unresolvedApplyTransactions,
  version: VERSION,
  runtimeApiVersion: RUNTIME_API_VERSION,
  providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
  adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
  proofProtocolVersion: PROOF_PROTOCOL_VERSION,
  packetSchemaVersion: PACKET_SCHEMA_VERSION,
  agentPlanSchemaVersion: AGENT_PLAN_SCHEMA_VERSION,
  contextEventSchemaVersion: CONTEXT_EVENT_SCHEMA_VERSION,
  reviewProtocolVersion: REVIEW_PROTOCOL_VERSION,
  acceptanceProtocolVersion: ACCEPTANCE_PROTOCOL_VERSION,
  reviewPacketSchemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
  attestationProtocolVersion: ATTESTATION_PROTOCOL_VERSION,
  authorityProtocolVersion: AUTHORITY_PROTOCOL_VERSION,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  providerContracts: PROVIDER_CONTRACTS,
  activeChanges,
  orphanRuntimeChanges,
  runtimePath,
  proofPath,
  readJson,
  readJsonOrNull,
  relevantHash,
  protocolDescriptor,
  repositoryCatalog,
  foundationPolicy,
  isolationInspection,
  openSpecCliStatus,
  loadRuntime,
  evidence,
  selectedRepositories,
  gitHead,
  playwrightAvailability,
  requiredProviders,
  providerConfig,
  receiptValidity,
  providerWorkspace,
  commandExists,
  topologyIssues,
  policyCapabilities,
  policyCapabilityTrigger,
  forecastCapabilities,
  reviewForcingCapabilities: REVIEW_FORCING_CAPABILITIES,
  reviewDiversityCapabilities: REVIEW_DIVERSITY_CAPABILITIES,
  providerCapability,
  reviewerStatus,
  unverifiedDrift: (id) => modelDriftInspector.changeDrift(id).unverified,
  parseFlags,
  parseStrictCommandFlags,
  fail: die
});
const {
  pathIdentity,
  safeRootPath,
  copyPath,
  transactionRoot: applyTransactionRoot,
  journalPath: transactionJournalPath,
  save: saveApplyJournal,
  applyEntry: applyTransactionEntry,
  rollback: rollbackApplyTransaction,
  settle: settleApplyTransaction,
  verify: verifyAppliedProjection,
  cleanup: cleanupApplyTransaction
} = createLandJournal({
  root: ROOT,
  transactions: TRANSACTIONS,
  fileDigest,
  directoryHash,
  pathInside,
  readJson,
  writeJson,
  now
});
const { recoverPendingApply, pendingApplyTransactions } = createApplyRecovery({
  transactions: TRANSACTIONS,
  transactionJournalPath,
  readJson,
  verifyAppliedProjection,
  saveApplyJournal,
  rollbackApplyTransaction,
  settleApplyTransaction,
  saveRuntime,
  clearSnapshotCache,
  now,
  blockWithDecision,
  fail: die
});
const { finalize: prove, audit: proofAudit } = createProofRuntime({
  root: ROOT,
  protocolVersion: PROOF_PROTOCOL_VERSION,
  loadRuntime,
  saveRuntime,
  validate,
  changedSurfaceIssues,
  activeChangeLeases,
  pendingTasks,
  clearSnapshotCache,
  relevantSnapshot,
  requiredProviders,
  advisoryCapabilities,
  receiptValidity,
  proofRunRoot,
  receiptPath,
  fileDigest,
  protocolDescriptor,
  contractFingerprint,
  executionFingerprint,
  proofPath,
  writeJson,
  readJson,
  pathInside,
  validateArtifact,
  instructionProvenance: (id) => {
    const manifest = recordInstructionManifest(id, "prove", { scope: "proof" });
    return manifest ? {
      schemaVersion: manifest.schemaVersion,
      manifestDigest: manifest.manifestDigest
    } : null;
  },
  now,
  fail: die
});
const {
  guardProofMutation,
  proofAdvance,
  proofCollect,
  proofExecute,
  proofFinalize,
  proofRun
} = createProofExecutionRuntime({
  markBlocked,
  proofReadinessValue,
  relevantSnapshot,
  loadRuntime,
  saveRuntime,
  now,
  requiredProviders,
  receiptValidity,
  rebindReusableReceipt,
  executionNodes,
  collectableExecutionNodes,
  startRequiredServices,
  runExecutionDag,
  durableArtifact,
  pendingTasks,
  proofPreflight,
  prove,
  proofAudit,
  readJson,
  writeJson,
  proofPath,
  proofAdvancePath: (id) => join(EVIDENCE_VAULT, id, "proof-advance.json"),
  proofAdvanceLockPath: (id) => join(ROOT, ".foundation", "locks", `proof-${id}.lock`),
  providerCapability,
  providerConfig,
  providerWorkspaceHash,
  reviewPolicy,
  deliveredAiAttempts,
  recordDeterministicReviewClosure,
  authorityStatusValue,
  requestAuthority,
  die
});
const guardPublicProofMutation = (command, operation) =>
  (id, ...args) => guardProofMutation(id, command, () => operation(id, ...args));
const guardedRecordVerifiedCi = guardPublicProofMutation(
  "evidence verify-ci", recordVerifiedCi);
const guardedRequestAuthority = guardPublicProofMutation(
  "authority request", requestAuthority);
const guardedDispatchAuthority = guardPublicProofMutation(
  "authority dispatch", dispatchAuthority);
const guardedRunAuthorityReviewer = guardPublicProofMutation(
  "authority run", runAuthorityReviewer);
const guardedAbortAuthority = guardPublicProofMutation(
  "authority abort", abortAuthority);
const guardedResetInfrastructureAuthority = guardPublicProofMutation(
  "authority reset-infra", resetInfrastructureAuthority);
const guardedRecordAuthority = guardPublicProofMutation(
  "authority record", recordAuthority);
const guardedRecordReceipt = guardPublicProofMutation(
  "evidence receipt", recordReceipt);
const guardedRunProvider = guardPublicProofMutation(
  "evidence run-provider", runProvider);
const modelDriftInspector = createModelDriftInspector({
  logs: LOGS,
  instructionManifests: INSTRUCTION_MANIFESTS,
  activeChangePath,
  policy: foundationPolicy,
  taskBlocks,
  taskMetadata
});
const {
  landCheck,
  recoverLand,
  orderedRepositories,
  repositoryCommitLanded,
  rootGitlink,
  landPlanValue,
  showLandPlan,
  recordRepositoryLand,
  stageRootPointers,
  resumeLand,
  assertMultiRepositoryArchiveReady
} = createLandRuntime({
  root: ROOT,
  transactions: TRANSACTIONS,
  loadRuntime,
  saveRuntime,
  pendingApplyTransactions,
  recoverPendingApply,
  assertNoDroppedScenarios,
  blockingDrift: (...args) => modelDriftInspector.blockingDrift(...args),
  proofAudit,
  proofPath,
  readJson,
  writeJson,
  clearSnapshotCache,
  relevantHash,
  requiredProviders,
  receiptValidity,
  fileDigest,
  receiptPath,
  handoffReadiness,
  verifyAppliedProjection,
  selectedRepositories,
  repositoryById,
  git,
  gitHead,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  now,
  blockWithDecision,
  fail: die
});
const applyRuntime = createApplyRuntime({
  root: ROOT,
  transactions: TRANSACTIONS,
  loadRuntime,
  saveRuntime,
  selectedRepositories,
  workspaceManifest,
  declaredSurfaceMatcher,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  directoryHash,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  stableHash,
  syncClaudeTelemetry,
  modelUsageRecorded,
  saveApplyJournal,
  transactionJournalPath,
  verifyAppliedProjection,
  rollbackApplyTransaction,
  applyTransactionEntry,
  cleanupApplyTransaction,
  git,
  gitBuffer,
  gitHead,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  recoverPendingApply,
  landCheck,
  assertMultiRepositoryArchiveReady,
  archivedChangeRelativePath,
  pendingTasks,
  assertOpenSpecCli,
  proofAudit,
  cleanupChangeLeases,
  now,
  blockWithDecision,
  fail: die
});
const {
  gitApplyInputs,
  buildApplyEntries,
  prepareApplyTransaction,
  refreshAppliedProjection,
  applySandbox,
  archive
} = applyRuntime;
const abandonRuntime = createAbandonRuntime({
  root: ROOT,
  paths: {
    recovery: RECOVERY,
    runtime: RUNTIME,
    receipts: RECEIPTS,
    evidenceVault: EVIDENCE_VAULT,
    transactions: TRANSACTIONS,
    snapshots: SNAPSHOTS,
    plans: PLANS,
    handoffs: HANDOFFS,
    logs: LOGS,
    changes: CHANGES
  },
  loadRuntime,
  cleanupChangeLeases,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  transactionJournals: (id) => readTransactionJournals(TRANSACTIONS, id, readJson),
  rollbackApplyTransaction,
  readJson,
  writeJson,
  now,
  blockWithDecision,
  fail: die
});
const { abandonChange } = abandonRuntime;
const [command, ...values] = process.argv.slice(2);
// Help is answered before anything else. It must never be parsed as a change
// id, and it must never depend on the command's arguments being valid.
if (command === "--help" || command === "-h" || command === "help") {
  describeCommand(values.find((value) => !value.startsWith("-")) || null,
    { json: values.includes("--json") });
  process.exit(0);
}
assertRegisteredRuntimeCommand(command, values);
if (values.includes("--help") || values.includes("-h")) {
  describeCommand(command, { json: values.includes("--json") });
  process.exit(0);
}
const unattendedMentioned = command === "sandbox" &&
  ["create", "inspect"].includes(values[0]) &&
  values.slice(1).some((value) =>
    value === "--unattended" || value.startsWith("--unattended="));
const telemetrySuppressed = command === "sandbox" && (
  values[0] === "inspect" ||
  (values[0] === "create" && unattendedMentioned)
);
if (telemetrySuppressed) process.env.FOUNDATION_TELEMETRY = "0";
operationName = command || null;
// Positional, so a flag in the change slot became a directory name:
// `sandbox create --all <change>` created `.foundation/logs/--all/`.
const namedChange = (value) =>
  typeof value === "string" && !value.startsWith("-") ? value : null;
operationChangeId = command === "sandbox" ? namedChange(values[1]) :
  ["resolve", "validate", "audit-change", "hash", "packet", "agent-plan", "agent-task", "agent-acquire", "agent-release", "metrics", "budget-continue", "proof-plan", "proof-readiness", "proof-advance", "proof-run", "proof-collect", "proof-preflight", "proof-execute", "proof-audit", "evidence-upgrade", "evidence-verify-ci", "authority-request", "authority-dispatch", "authority-run", "authority-abort", "authority-status", "authority-record", "authority-reset-infra", "receipt", "run-provider", "prove",
    "evidence-detect", "evidence-init", "evidence-doctor", "handoff-status", "handoff-packet", "handoff-record", "land-check", "land-plan", "land-record", "land-pointers", "land-resume", "archive", "event", "telemetry-sync", "telemetry-import"].includes(command) ? namedChange(values[0]) : null;
operationStatusAtStart = operationChangeId
  ? readJson(runtimePath(operationChangeId), {}).status ?? null : null;

// One table, in `runtime/core/lifecycle-phase.mjs`, shared with the operations
// row written on exit. The phase is derived here rather than read only from
// FOUNDATION_PUBLIC_OPERATION so a direct runtime invocation buckets the same
// way a `cli.sh` one does.
operationPhase = phaseForCommand(command);
const telemetryPhase = telemetryPhaseForCommand(command);
// An archived change is finished evidence. Reading it back — `metrics` on a
// landed run, say — must never append this session's telemetry to its log.
const telemetryWritable = (id) => Boolean(id) && existsSync(runtimePath(id)) &&
  readJson(runtimePath(id), {}).status !== "archived";
if (!telemetrySuppressed && telemetryPhase && telemetryWritable(operationChangeId))
  prepareClaudeTelemetry(operationChangeId, telemetryPhase);
if (command === "metrics" && telemetryWritable(operationChangeId))
  syncClaudeTelemetry(operationChangeId, { quiet: true });
if (command === "budget-continue" && telemetryWritable(operationChangeId))
  syncClaudeTelemetry(operationChangeId, { quiet: true });

await routeRuntimeCommand(command, values, {
  parseFlags,
  parseStrictCommandFlags,
  fail: die,
  createChange,
  rapidStartTemplate,
  startAtomic,
  resolveChange,
  abandonChange,
  waiveGate,
  showChanges,
  showProviders,
  showRepositories,
  foundationPolicy,
  showAgentPlan,
  showAgentTask,
  acquireAgentLease,
  releaseAgentLease,
  prepareClaudeTelemetry,
  recordPhaseContext,
  showPacket,
  showMetrics,
  execObserved,
  continueBudget,
  doctor,
  validate,
  showTraceabilityAudit,
  relevantHash,
  providerWorkspaceHash,
  proofPlan,
  proofReadiness,
  proofAdvance,
  proofRun,
  proofCollect,
  proofPreflight,
  proofExecute,
  proofAudit,
  proofFinalize,
  showEvidenceDetection,
  initializeEvidence,
  showEvidenceDoctor,
  recordVerifiedCi: guardedRecordVerifiedCi,
  requestAuthority: guardedRequestAuthority,
  dispatchAuthority: guardedDispatchAuthority,
  runAuthorityReviewer: guardedRunAuthorityReviewer,
  abortAuthority: guardedAbortAuthority,
  resetInfrastructureAuthority: guardedResetInfrastructureAuthority,
  showAuthorityStatus,
  recordAuthority: guardedRecordAuthority,
  upgradeEvidence,
  recordReceipt: guardedRecordReceipt,
  runProvider: guardedRunProvider,
  prove,
  landCheck,
  recoverLand,
  showLandPlan,
  recordRepositoryLand,
  stageRootPointers,
  resumeLand,
  showHandoffStatus,
  showHandoffPacket,
  recordHandoff,
  createAttestationChallenge,
  showSandboxInspection,
  createSandbox,
  syncSandbox,
  applySandbox,
  archive,
  recordEvent,
  syncClaudeTelemetry,
  importTelemetry,
  importHostExecution,
  migrate,
  usage,
  describeCommand,
  runtimeApiVersion: RUNTIME_API_VERSION,
  version: VERSION
});
