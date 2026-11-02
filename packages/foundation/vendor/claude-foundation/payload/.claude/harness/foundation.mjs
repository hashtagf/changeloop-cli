#!/usr/bin/env node
import { assertSpecApproval, preserveSpecApprovalAcross } from "./runtime/core/user-decisions.mjs";

import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMetricsRuntime, createSourceCohortProvider
} from "./runtime/observability/metrics-runtime.mjs";
import { createExecRuntime } from "./runtime/observability/exec-runtime.mjs";
import { createOutcomesRuntime } from "./runtime/observability/outcomes-runtime.mjs";
import { createLessonsRuntime } from "./runtime/observability/lessons-runtime.mjs";
import { createApprovalPackageRuntime, routeForState } from "./runtime/workflow/approval-package.mjs";
import {
  createFeedbackRuntime, FEEDBACK_SCHEMA_VERSION
} from "./runtime/observability/feedback-runtime.mjs";
import {
  blockerTelemetryValue, createTelemetryRuntime, createCommandPhaseRecorder
} from "./runtime/observability/telemetry-runtime.mjs";
import { createJsonlReader } from "./runtime/observability/telemetry.mjs";
import { operationInputFingerprint } from "./runtime/observability/operation-profile.mjs";
import {
  createHostExecutionImporter, createHostExecutionStore, createModelDriftInspector,
  resolveHostExecutionSource
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
  parseNodeTestSpecOutput,
  parseJsonOutput,
  parseTapOutput,
  playwrightReportSummary,
  resourcesConflict
} from "./runtime/evidence/evidence-results.mjs";
import { createFlagParser } from "./runtime/core/cli-flags.mjs";
import { createCommandRegistry } from "./runtime/core/command-registry.mjs";
import {
  createRuntimeEnvironment, policyExecutionLimit
} from "./runtime/core/runtime-environment.mjs";
import {
  phaseForCommand, telemetryPhaseForCommand
} from "./runtime/core/lifecycle-phase.mjs";
import { createProcessRuntime, serviceWorkspace } from "./runtime/core/process-runtime.mjs";
import { createInstructionRecorder } from "./runtime/core/instruction-recorder.mjs";
import { createAgentPlanner, createModelRouter } from "./runtime/workflow/agent-planning.mjs";
import { createAgentDispatchRuntime } from "./runtime/workflow/agent-dispatch.mjs";
import {
  ADVANCE_PROTOCOL_VERSION, advanceFailureAction, createAdvanceRuntime, hasValidLandGrant,
  prepareAdvanceBuild, runAdvanceProof
} from "./runtime/workflow/advance-runtime.mjs";
import { automaticReviewRun, currentDeliveryProof } from "./runtime/workflow/advance-recovery.mjs";
import {
  copySandboxEntries, createSandboxRuntime, sandboxCopyPlan
} from "./runtime/workflow/sandbox-runtime.mjs";
import { createPreviewRuntime } from "./runtime/workflow/preview-runtime.mjs";
import { createSandboxCleanup } from "./runtime/workflow/sandbox-cleanup.mjs";
import { assertLandedProjection } from "./runtime/workflow/land-verification.mjs";
import {
  createLandJournal, transactionJournals as readTransactionJournals
} from "./runtime/workflow/land-journal.mjs";
import {
  createProofRuntime, taskPacketWasPrecompletedOperation
} from "./runtime/evidence/proof-runtime.mjs";
import { createRepositoryTopology } from "./runtime/workflow/repository-topology.mjs";
import { nestedRepositoryRelativePaths } from "./runtime/core/repository-binding.mjs";
import { createRepositorySnapshot } from "./runtime/workflow/repository-snapshot.mjs";
import { createPacketRuntime } from "./runtime/workflow/packet-runtime.mjs";
import { createChangePolicy } from "./runtime/workflow/change-policy.mjs";
import { taskBlocks, taskMetadata } from "./runtime/contracts/change-artifacts.mjs";
import { createChangeLifecycle } from "./runtime/workflow/change-lifecycle.mjs";
import { amendTaskVerifyOperation } from "./runtime/workflow/semantic-amendment.mjs";
import { createInvestigationRuntime } from "./runtime/workflow/investigation-runtime.mjs";
import { createLeaseRuntime } from "./runtime/workflow/lease-runtime.mjs";
import { createAuthorityRuntime } from "./runtime/workflow/authority-runtime.mjs";
import { createHandoffRuntime } from "./runtime/workflow/handoff-runtime.mjs";
import {
  advanceLandOperation, assertOpenSpecCli, createLandRuntime, openSpecCliStatus,
  recordedDeliveryReferences, targetProjectionObservationValue
} from "./runtime/workflow/land-runtime.mjs";
import { createApplyRuntime } from "./runtime/workflow/apply-runtime.mjs";
import { createApplyRecovery } from "./runtime/workflow/apply-recovery.mjs";
import { createDiagnosticsRuntime } from "./runtime/core/diagnostics-runtime.mjs";
import { authorityPreflightValue } from "./runtime/core/authority-policy.mjs";
import { compileExecutionContractValue } from "./runtime/core/execution-contract.mjs";
import { createStateRuntime } from "./runtime/core/state-runtime.mjs";
import {
  createEvidenceContract,
  REVIEW_FORCING_CAPABILITIES,
  REVIEW_DIVERSITY_CAPABILITIES
} from "./runtime/evidence/evidence-contract.mjs";
import {
  createChangeValidationRuntime, postReleaseRolloutGates
} from "./runtime/workflow/change-validation.mjs";
import { routeRuntimeCommand } from "./runtime/core/cli-router.mjs";
import { impliedChangeValues } from "./runtime/core/implied-change.mjs";
import { createProviderScheduler } from "./runtime/evidence/provider-scheduler.mjs";
import { createReviewProtocol } from "./runtime/evidence/review-protocol.mjs";
import { createArtifactStore } from "./runtime/evidence/artifact-store.mjs";
import { createReviewAttemptStore } from "./runtime/evidence/review-attempt-store.mjs";
import {
  createProofReadinessRuntime, upgradeEvidenceOperation
} from "./runtime/evidence/proof-readiness.mjs";
import { createReceiptRuntime } from "./runtime/evidence/receipt-runtime.mjs";
import { createReceiptValidity } from "./runtime/evidence/receipt-validity.mjs";
import { createAdapterRuntime } from "./runtime/evidence/adapter-runtime.mjs";
import { createProofExecutionRuntime } from "./runtime/evidence/proof-execution-runtime.mjs";
import {
  createTestDiscriminationRuntime, prepareBaseTree
} from "./runtime/evidence/test-discrimination.mjs";
import {
  createBenchmarkRuntime, receiptRegressionFinding
} from "./runtime/evidence/benchmark-runtime.mjs";
import { changeWorkTypes, taskChangeIssue } from "./runtime/workflow/task-change.mjs";
import { lightKind } from "./runtime/workflow/validation/dev-document.mjs";
import { repositoryBaseHead } from "./runtime/core/repository-binding.mjs";
import { createConfiguredReviewerRuntime } from "./runtime/evidence/codex-reviewer.mjs";
import { createBlockedDecision, createDetachedBlockScope } from "./runtime/core/blocked-decision.mjs";
import { createLandGrantRuntime } from "./runtime/core/land-grant.mjs";
import {
  assertExecutionPreparationReady, ensureProjectOpenSpec,
  executionPreparationValue, prependFoundationToolPath
} from "./runtime/core/tool-preparation.mjs";
import { createAbandonRuntime } from "./runtime/workflow/abandon-runtime.mjs";
import { createLandUndo } from "./runtime/workflow/land-undo.mjs";
import { RUNTIME_MODULE_API } from "./runtime/version.mjs";
import { createBootstrap } from "./runtime/composition/bootstrap.mjs";
import {
  EXCLUDED_WORKSPACE_DIRS, SANDBOX_COPY_EXCLUDED_DIRS
} from "./runtime/core/workspace-policy.mjs";
import {
  ADAPTERS, INPUT_MODES, PROVIDER_CONTRACTS, PROVIDERS, providerCapability
} from "./runtime/evidence/provider-catalog.mjs";
import { SECURITY_TERMS } from "./runtime/workflow/security-policy.mjs";
import {
  landAppliedOutput, otherLandedOutput, targetEditIssues as targetEditFindings
} from "./runtime/workflow/target-edits.mjs";
import {
  createSessionLeaseRuntime, isSessionOwner, runTaskCheck
} from "./runtime/workflow/session-lease.mjs";
import { createQualityRuntime } from "./runtime/quality/quality-runtime.mjs";
import {
  createPullRequestRuntime, DELIVERY_PROTOCOL_VERSION, DELIVERY_RECEIPT_SCHEMA_VERSION
} from "./runtime/workflow/pull-request-runtime.mjs";

const VERSION = "3.6.8";
const RUNTIME_API_VERSION = "42";
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
const PROVIDER_PROTOCOL_VERSION = "13";
const ADAPTER_PROTOCOL_VERSION = "7";
const PROOF_PROTOCOL_VERSION = "7";
const PACKET_SCHEMA_VERSION = "12";
const AGENT_PLAN_SCHEMA_VERSION = "6";
const CONTEXT_EVENT_SCHEMA_VERSION = "2";
const METRICS_SCHEMA_VERSION = "10";
const COMMAND_TELEMETRY_SCHEMA_VERSION = "5";
const REVIEW_PROTOCOL_VERSION = "4";
const ACCEPTANCE_PROTOCOL_VERSION = "2";
const SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION = "1";
const REVIEW_PACKET_SCHEMA_VERSION = "6";
const ATTESTATION_PROTOCOL_VERSION = "1";
const AUTHORITY_PROTOCOL_VERSION = "2";
const CI_EVIDENCE_PROTOCOL_VERSION = "1";
const QUALITY_CAPABILITIES_PROTOCOL_VERSION = "1";
const CRAP_PROTOCOL_VERSION = "1";
const AUTOMATED_MUTATION_PROTOCOL_VERSION = "1";
// A refusal is a lifecycle stop, not a crash. Recording it as a failure would
// bury real breakage under the guards that are working as designed.
let operationBlocked = false;
let operationBlocker = null;
let trappedFailureDepth = 0;
// Work that runs beside an operation (the concurrent review in `advance`)
// records its own refusal here instead of marking the whole process blocked:
// its failure is an open request the next pass routes, not this command's stop.
const detachedBlockScope = createDetachedBlockScope();
// A command that prints a structured non-ready result and returns has also
// ended in a refusal, not a crash — but it never reaches `die`. `block()` is
// that second spelling: it records the decision without exiting, so the exit
// handler reports what the command decided instead of inferring it.
function markBlocked(message) {
  if (detachedBlockScope.capture(message)) return;
  operationBlocked = true;
  operationBlocker = blockerTelemetryValue(message, {
    changeId: operationChangeId,
    operationName,
    phase: process.env.FOUNDATION_PUBLIC_OPERATION || operationPhase
  });
}
function die(message, code = 1, details = null) {
  markBlocked(message);
  if (trappedFailureDepth > 0) {
    const error = new Error(String(message));
    error.exitCode = code;
    error.foundationBlocked = true;
    if (details?.decision) error.decision = details.decision;
    if (details?.boundary) error.boundary = details.boundary;
    if (details?.owner) error.owner = details.owner;
    if (details?.code) error.code = details.code;
    throw error;
  }
  console.error(`BLOCKED: ${message}`);
  process.exit(code);
}
function trapFailures(operation) {
  trappedFailureDepth += 1;
  try { return operation(); }
  finally { trappedFailureDepth -= 1; }
}
async function trapFailuresAsync(operation) {
  trappedFailureDepth += 1;
  try { return await operation(); }
  finally { trappedFailureDepth -= 1; }
}
const { parseFlags, parseStrictCommandFlags } = createFlagParser({ fail: die });
const { blockedDecisionValue, blockWithDecision } = createBlockedDecision({ fail: die });

const {
  root: ROOT,
  paths: {
    runtime: RUNTIME, receipts: RECEIPTS, logs: LOGS, evidenceVault: EVIDENCE_VAULT,
    snapshots: SNAPSHOTS, transactions: TRANSACTIONS, plans: PLANS, leases: LEASES,
    prototypes: PROTOTYPES, packages: PACKAGES, previews: PREVIEWS,
    attestations: ATTESTATIONS, authority: AUTHORITY,
    handoffs: HANDOFFS, instructionManifests: INSTRUCTION_MANIFESTS,
    recovery: RECOVERY, deliveries: DELIVERIES, changes: CHANGES, reviews: REVIEWS
  },
  readJson, readJsonOrNull, writeJson, canonicalPath, pathInside, now
} = createBootstrap({
  start: process.cwd(),
  pinned: process.env.CLAUDE_FOUNDATION_PROJECT,
  fail: die,
  warn: console.error
});

// Project-local tools are machine-owned and survive between lifecycle
// invocations. Put them on PATH before any validation or Land check probes a
// binary; the user's global environment is never modified.
prependFoundationToolPath(ROOT);

const { readJsonLines, readJsonLinesTolerant } = createJsonlReader({
  root: ROOT,
  fail: die
});

const operationStartedAt = Date.now();
let operationChangeId = null;
let operationName = null;
let operationPhase = null;
let operationStatusAtStart = null;
let operationFingerprint = null;
// Commands that only read. They are observed in inspections.jsonl so the
// benchmark can measure agent probing, but never enter operations.jsonl:
// `showMetrics` treats that ledger as work the change performed for rework and
// phase accounting. Archived evidence remains immutable and records neither.
// Lifecycle commands stay: metrics derives rework and typed-stop signals from
// their rows, so proof-* and land-* are measurements, not inspections.
const READ_ONLY_OPERATIONS = new Set([
  "metrics", "feedback", "outcomes", "lessons", "hash", "changes", "current", "providers", "repos", "models", "describe",
  "package", "budget-checkpoint",
  "packet", "agent-task", "audit-change", "authority-status",
  "handoff-list", "handoff-status", "handoff-packet", "evidence-detect", "evidence-doctor",
  "doctor", "quality-discover", "quality-doctor", "quality-report",
  "api-version", "version"
]);
const commandPhaseRecorder = createCommandPhaseRecorder(() => ({
    telemetryDisabled: process.env.FOUNDATION_TELEMETRY === "0",
    telemetryDebug: process.env.FOUNDATION_TELEMETRY_DEBUG === "1",
    changeId: operationChangeId,
    operationName,
    operationPhase,
    operationStatusAtStart,
    operationInputFingerprint: operationFingerprint,
    publicOperation: process.env.FOUNDATION_PUBLIC_OPERATION,
    blocked: operationBlocked,
    blocker: operationBlocker,
    operationStartedAt,
    readOnlyOperations: READ_ONLY_OPERATIONS,
    logs: LOGS,
    mkdir: mkdirSync,
    append: appendFileSync,
    now,
    timestamp: Date.now,
    warn: console.error
}));
process.on("exit", (code) => commandPhaseRecorder.finish(code));

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
  foundationPolicy,
  reviewAssurancePosture
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
    metricsSchema: METRICS_SCHEMA_VERSION,
    advanceProtocol: String(ADVANCE_PROTOCOL_VERSION),
    feedbackSchema: String(FEEDBACK_SCHEMA_VERSION),
    commandTelemetrySchema: COMMAND_TELEMETRY_SCHEMA_VERSION,
    reviewProtocol: REVIEW_PROTOCOL_VERSION,
    acceptanceProtocol: ACCEPTANCE_PROTOCOL_VERSION,
    semanticAcceptanceProtocol: SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION,
    reviewPacketSchema: REVIEW_PACKET_SCHEMA_VERSION,
    attestationProtocol: ATTESTATION_PROTOCOL_VERSION,
    authorityProtocol: AUTHORITY_PROTOCOL_VERSION,
    ciEvidenceProtocol: CI_EVIDENCE_PROTOCOL_VERSION,
    qualityCapabilitiesProtocol: QUALITY_CAPABILITIES_PROTOCOL_VERSION,
    crapProtocol: CRAP_PROTOCOL_VERSION,
    automatedMutationProtocol: AUTOMATED_MUTATION_PROTOCOL_VERSION,
    deliveryProtocol: String(DELIVERY_PROTOCOL_VERSION),
    deliveryReceiptSchema: String(DELIVERY_RECEIPT_SCHEMA_VERSION)
  },
  readJson,
  fail: die
});
const maxParallelProviders = policyExecutionLimit.bind(
  null, foundationPolicy, "maxParallelProviders");

const sourceCohort = createSourceCohortProvider({
  runtimeVersion: VERSION,
  protocolBundle: protocolDescriptor(),
  directory: dirname(fileURLToPath(import.meta.url))
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
  reviewerInstalled,
  runReview: runConfiguredReview,
  runReviewAsync: runConfiguredReviewAsync
} = createConfiguredReviewerRuntime({
  root: ROOT,
  foundationPolicy,
  commandExists,
  now,
  recordUsage: (id, rows) => appendTelemetryRows(id, rows, "configured-reviewer", {
    operationId: "prove"
  }),
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
  inspectSnapshots,
  writeSnapshot,
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
  acknowledgeInfrastructureAttempts,
  grantExtraAiWave,
  acknowledgeBaseMoveAttempts,
  autoReleaseReviewBudget
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
  calibrationForState,
  activateBudgetWindow,
  budgetDecision,
  applyBudgetDecision,
  eventUsage,
  synchronizeBudgetUsage
} = createBudgetRuntime({ policy: foundationPolicy, now });
const { reportBudget } = createBudgetReporter({
  applyBudgetDecision,
  watchdogEnabled: () => foundationPolicy().execution.budgetWatchdog === true
});
const { metricsValue, showMetrics } = createMetricsRuntime({
  logs: LOGS,
  receipts: RECEIPTS,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  calibrationForState,
  instructionManifests: INSTRUCTION_MANIFESTS,
  activeChangePath,
  policy: foundationPolicy,
  taskBlocks,
  taskMetadata,
  metricsSchemaVersion: Number(METRICS_SCHEMA_VERSION),
  sourceCohort
});
const { execObserved } = createExecRuntime({
  assertApproval: (id, state) => assertSpecApproval(ROOT, id, state),
  root: ROOT,
  // Task repositories decide which sandbox an exec child starts in.
  changeTasks: (id, state) => {
    const path = join(activeChangePath(id, state), "tasks.md");
    return existsSync(path)
      ? taskBlocks(readFileSync(path, "utf8")).filter((task) => task.id).map(taskMetadata)
      : [];
  },
  logs: LOGS,
  loadRuntime,
  now,
  prepareWorkspace: (id) => projectRootRepositories(id),
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
// Every declared nested repository's root-relative path; its gitlink in the
// root workspace is that repository's pointer, never root task content.
const declaredRepositoryPaths = () => nestedRepositoryRelativePaths(repositoryCatalog());
const { relevantSnapshot, relevantHash } = createRepositorySnapshot({
  root: ROOT,
  runtimePath,
  snapshotPath,
  readJson,
  writeJson: writeSnapshot,
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
  policyRolloutCapabilities,
  policyCapabilityTrigger,
  capabilitiesForPaths,
  forecastCapabilities,
  policyProviderSetupActions,
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
  fail: die,
  declaredRepositoryPaths
});
// clearSnapshotCache is what every surface mutation already calls; the policy
// cache invalidates with it or not at all.
registerPolicyCacheClearer(clearPolicyCache);
const {
  showDiscovery: showQualityDiscovery,
  initialize: initializeQuality,
  doctor: qualityDoctor,
  run: runQuality,
  report: showQualityReport,
  baseline: updateQualityBaseline,
  debt: showQualityDebt
} = createQualityRuntime({
  root: ROOT,
  repositoryCatalog,
  selectedRepositories,
  canonicalChangedSurface,
  declaredSurfaceMatcher,
  loadRuntime,
  git,
  gitHead,
  readJson,
  writeJson,
  pathInside,
  workspaceManifest,
  fail: die
});
const {
  appendTelemetryRows,
  bindClaudeSession,
  claudeHostContext,
  importTelemetry,
  modelUsageRecorded,
  telemetryReadiness,
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
const importHostExecution = createHostExecutionImporter({
  loadRuntime,
  resolveSource: resolveHostExecutionSource.bind(null, process.cwd()),
  exists: existsSync,
  store: hostExecutionStore,
  readJson,
  appendTelemetryRows,
  snapshotPath,
  fail: die,
  log: console.log
});
const handoffRuntime = createHandoffRuntime({
  root: ROOT,
  handoffsRoot: HANDOFFS,
  activeChangePath,
  loadRuntime,
  readJson,
  writeJson,
  stableHash,
  defaultOwner: () => foundationPolicy().workflow.handoffDefaultOwner,
  now,
  fail: die,
  capture: trapFailures
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
  filesystemEntryIdentity,
  stableHash,
  policyCapabilities,
  policyCapabilityTrigger,
  foundationPolicy,
  handoffContract,
  git,
  declaredSurfaceMatcher,
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
  providerRepositories,
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
  relevantHash,
  relevantSnapshot,
  // Late-bound: the sandbox runtime is composed after evidence, and receipt
  // validity only consults diff identity at command time, long after both.
  changeDiffIdentity: (id, state) => sandboxRuntime.changeDiffIdentity(id, state)
});
const changeValidationRuntime = createChangeValidationRuntime({
  policyProviderSetupActions,
  relevantHash,
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
  reviewAssurancePosture,
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
  foundationPolicy,
  authorityPreflight,
  executionContract,
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

function authorityPreflight(id) {
  const state = loadRuntime(id);
  const contract = evidence(id, activeChangePath(id, state));
  return authorityPreflightValue({
    changeId: id,
    state,
    reviewRisk: changedSurfaceResolvable(id, state)
      ? reviewPolicy(id, state, contract)
      : null,
    providers: Object.keys(contract.providers || {}),
    providerConfig: (provider) => providerConfig(id, provider),
    providerCapability,
    acceptance: resolvedAcceptance(id, state, contract),
    grounding: {
      required: state.groundingRequired === true,
      locked: Boolean(state.groundingDigest),
      reopenPending: Boolean(state.groundingReopenPending)
    },
    handoffs: handoffReadiness(id, { state })
  });
}

function executionContract(id) {
  const state = loadRuntime(id);
  const contract = evidence(id, activeChangePath(id, state));
  const resolvable = changedSurfaceResolvable(id, state);
  const review = resolvable ? reviewPolicy(id, state, contract) : null;
  const configured = Object.keys(contract.providers || {});
  const providerNames = resolvable ? requiredProviders(id) : configured;
  let repositories = [];
  try { repositories = selectedRepositories(id, state); } catch { repositories = []; }
  const handoffs = handoffReadiness(id, { state });
  return compileExecutionContractValue({
    changeId: id,
    state,
    review,
    providers: providerNames,
    providerCapabilities: Object.fromEntries(providerNames.map((provider) => [
      provider, providerCapability(provider, providerConfig(id, provider))
    ])),
    authority: authorityPreflight(id),
    repositories,
    handoffs
  });
}
const { runCommand, startServiceSession } = createProcessRuntime({
  root: ROOT,
  logs: LOGS,
  now,
  resolveServiceCwd: serviceWorkspace.bind(null, {
    root: ROOT, loadRuntime, repositoryById
  })
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
  providerRepositories,
  rejectPrototypeEvidenceInputs,
  durableArtifact,
  providerInputIdentity,
  contractFingerprint,
  executionFingerprint,
  stableHash,
  relevantSnapshot,
  // Late-bound for the same composition-order reason as receipt validity.
  changeDiffIdentity: (id, state) => sandboxRuntime.changeDiffIdentity(id, state),
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
  rebindDiffBoundReceipt,
  recordReceipt,
  recordDeterministicReviewClosure
} = receiptRuntime;
const { measure: measureBenchmark } = createBenchmarkRuntime({
  prepareBaseTree,
  isProductPath: (path) => !lightKind(path),
  fileDigest,
  runCommand,
  removeTree: (path) => rmSync(path, { recursive: true, force: true }),
  stableHash
});
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
  providerRepositories,
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
  parseNodeTestSpecOutput,
  numericReportValue,
  playwrightReportSummary,
  requiredProviders,
  mutationProtocolResult,
  now,
  serviceResourcesConflict: resourcesConflict,
  maxParallelServices: maxParallelProviders,
  recordScheduler: commandPhaseRecorder.scheduler,
  timestamp: Date.now,
  measureBenchmark,
  die,
  clearSnapshotCache
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
  maxParallelProviders,
  recordScheduler: commandPhaseRecorder.scheduler,
  timestamp: Date.now,
  fail: die
});
const { modelForTask } = createModelRouter({
  loadRuntime,
  policy: foundationPolicy,
  fail: die
});
const packetRuntime = createPacketRuntime({
  inspectSnapshots,
  ROOT,
  PACKET_SCHEMA_VERSION,
  REVIEW_PACKET_SCHEMA_VERSION,
  foundationVersion: VERSION,
  installedCliVersion: process.env.FOUNDATION_INSTALLED_CLI_VERSION || VERSION,
  leasesRoot: LEASES,
  resumeAction: (id) => advanceValue(id, { inspect: true }),
  activeLeases: (id) => activeChangeLeases(id),
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
  providerRepositories,
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
  deliveredAiAttempts,
  authorityPreflight,
  executionContract,
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
  runAuthorityReviewerAsync,
  abortAuthority,
  resetInfrastructureAuthority,
  extendReviewAuthority,
  recoverReviewBindings,
  resetBaseMoveAuthority,
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
  saveRuntime,
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
  reviewerInstalled,
  runConfiguredReview,
  runConfiguredReviewAsync,
  acknowledgeInfrastructureAttempts,
  grantExtraAiWave,
  acknowledgeBaseMoveAttempts,
  autoReleaseReviewBudget,
  clearSnapshotCache,
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
  fail: die,
  reviewDiffContext: {
    git,
    pathExists: existsSync,
    readFile: readFileSync,
    readDirectory: readdirSync,
    isDirectory: (path) => lstatSync(path).isDirectory()
  }
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
  providerCapability,
  claimsForProvider,
  requiredProviders,
  providerConfig,
  providerRepositories,
  resourcesConflict,
  authorityPreflight,
  executionContract,
  taskResult: (id, taskId) => {
    const path = join(LEASES, "results", id, `${taskId}.json`);
    return existsSync(path) ? { path, value: readJson(path, null) } : null;
  },
  taskLease: (id, taskId) => {
    const path = join(LEASES, "tasks", id, `${taskId}.json`);
    return existsSync(path) ? readJson(path, null) : null;
  },
  taskPacketWasPrecompleted: (id) => taskPacketWasPrecompletedOperation({
    loadRuntime, activeChangePath, exists: existsSync, fileDigest
  }, id),
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
  recordScheduler: commandPhaseRecorder.scheduler,
  fail: die
});
const {
  leasePath,
  acquire: acquireAgentLease,
  release: releaseAgentLease,
  discard: discardAgentLease,
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
  observedTaskSurface: (id, task) => {
    const state = loadRuntime(id);
    const repository = repositoryById(id, task.repository || "root", state);
    return canonicalChangedSurface(id, state)
      .filter((row) => row.repositoryId === repository.id)
      .map((row) => {
        const path = join(repository.workspacePath, row.path);
        return {
          path: row.path,
          identity: lstatSync(path, { throwIfNoEntry: false })
            ? filesystemEntryIdentity(path) : "deleted"
        };
      });
  },
  fail: die
});
const {
  dispatchValue: agentDispatchValue,
  showDispatch: showAgentDispatch
} = createAgentDispatchRuntime({
  agentPlanValue,
  // A lease `advance` holds for its session task is not a live worker: the
  // same task is still the frontier and dispatch returns it again.
  activeChangeLeases: (id) => activeChangeLeases(id)
    .filter((lease) => !isSessionOwner(lease.owner)),
  stableHash,
  policy: foundationPolicy,
  serializedJson,
  fail: die
});

// Issues and notices must judge the same edits: bytes a Land wrote (this
// change's, or another change's landed but uncommitted diff) are not edits
// made outside the sandbox. Both views read this one computation.
function targetEditsFor(state) {
  const landedElsewhere = Object.fromEntries(Object.entries(otherLandedOutput({
    transactions: TRANSACTIONS, changeId: state.id, readJson
  })).map(([path, row]) => [path, row.after]));
  return targetEditFindings({
    root: ROOT, state, dirtyNow: preexistingDirty(ROOT),
    landOutput: { ...landedElsewhere,
      ...landAppliedOutput(readTransactionJournals(TRANSACTIONS, state.id, readJson)) },
    // Only the paths this change's Land would apply can stop it.
    // An unresolvable surface throws (trapped) and the stop stays fail-closed.
    projectionPaths: () => trapFailures(() => new Set(canonicalChangedSurface(state.id, state)
      .filter((row) => (row.repositoryId || "root") === "root").map((row) => row.path)))
  });
}

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
  workspaceIsolationIssues,
  upgradeEvidence: upgradeTargetEvidence
} = createProofReadinessRuntime({
  root: ROOT,
  targetEditIssues: (state) => targetEditsFor(state).issues,
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
  providerRepositories,
  requiredProviders,
  git,
  gitHead,
  advisoryCapabilities,
  evidenceDetectionValue,
  validate,
  relevantHash,
  executionNodes,
  pendingTasks,
  handoffReadiness,
  activeChangeLeases,
  activeRepositoryConflicts,
  agentPlanValue,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  authorityPreflight,
  executionContract,
  clearSnapshotCache,
  fail: die
});
// Evidence upgrade is wiring-only: it rewrites the target packet, mirrors the
// same rewrite into an isolated packet (which Prove reads), and keeps spec
// approval that was valid before it.
function upgradeEvidence(id) {
  preserveSpecApprovalAcross(ROOT, id, { loadRuntime, saveRuntime, now }, () => {
    const workspace = loadRuntime(id).workspace?.path;
    upgradeTargetEvidence(id);
    if (!workspace || workspace === ROOT ||
        !existsSync(join(workspace, "openspec", "changes", id))) return;
    upgradeEvidenceOperation({
      loadRuntime: () => ({ status: "active" }),
      fail: die,
      changePath: (change) => join(workspace, "openspec", "changes", change),
      proofPath: () => null,
      readJson,
      writeJson,
      saveRuntime: () => {},
      pathExists: (path) => Boolean(path) && existsSync(path),
      remove: () => {},
      output: { log: () => {} }
    }, id);
  }, "evidence-upgrade");
}
const { continueBudget, checkpointBudget } = createBudgetContinuation({
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
} = createSandboxCleanup({ root: ROOT, canonicalPath, git, now });
const sandboxRuntime = createSandboxRuntime({
  markBlocked,
  recordScheduler: commandPhaseRecorder.scheduler,
  declaredSurfaceMatcher,
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
  repositoryCatalog,
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
  now,
  fail: die
});
const {
  createChallenge: createAttestationChallenge,
  workspaceInspection: workspaceIsolationInspection,
  inspect: isolationInspection,
  showInspection: showSandboxInspection,
  createSingle: createSingleSandbox,
  create: createSandbox,
  prepareBuild: prepareBuildSandbox,
  retryFailedSetups,
  mergeTaskProgress,
  sync: syncSandbox
} = sandboxRuntime;
// Root checks consume declared nested repositories through their root path.
// Every exec, task check, and proof run first brings those paths current, and
// reinstalls Build dependencies whose manifest or lockfile changed since setup.
function projectRootRepositories(id) {
  const projected = sandboxRuntime.projectRepositories(id);
  sandboxRuntime.refreshChangedDependencies(id);
  return projected;
}
function rollbackAtomicStart(id) {
  const issues = [];
  const state = readJson(runtimePath(id), {
    id,
    workspace: { mode: "current", path: ROOT }
  });
  const repositories = cleanupRepositorySandboxes(id, state);
  for (const [repositoryId, result] of Object.entries(repositories))
    if (["failed", "refused"].includes(result.status))
      issues.push(`repository sandbox '${repositoryId}': ${result.reason || result.status}`);
  // Multi-repository setup can fail after worktrees were created but before
  // their in-memory records were saved. Re-resolve the already-validated
  // selection and clean only its fixed Foundation-owned paths.
  let selected = [];
  const repositorySandboxRoot = join(
    ROOT, ".foundation", "repository-sandboxes", id);
  if (existsSync(repositorySandboxRoot)) {
    try {
      trapFailures(() => { selected = selectedRepositories(id, state); });
    } catch (error) {
      issues.push(`repository sandbox discovery: ${error.message || error}`);
    }
  }
  const unrecordedRepositories = {};
  for (const repository of selected) {
    if (repository.id === "root") continue;
    const path = join(ROOT, ".foundation", "repository-sandboxes", id, repository.id);
    if (!existsSync(path)) continue;
    unrecordedRepositories[repository.id] = {
      mode: "worktree", path, targetPath: repository.path
    };
  }
  const unrecorded = cleanupRepositorySandboxes(id, {
    repositories: unrecordedRepositories
  });
  for (const [repositoryId, result] of Object.entries(unrecorded))
    if (["failed", "refused"].includes(result.status))
      issues.push(`unrecorded repository sandbox '${repositoryId}': ${
        result.reason || result.status}`);
  const applied = cleanupAppliedSandbox(id, state);
  if (["failed", "refused"].includes(applied.status))
    issues.push(`sandbox: ${applied.reason || applied.status}`);

  // A worktree/copy can exist before createSingle persists it in runtime state
  // (for example when copying the packet into a new worktree fails). Clean the
  // one fixed Foundation-owned path as a fallback; never infer a broad target.
  const expectedSandbox = join(ROOT, ".foundation", "sandboxes", id);
  if (existsSync(expectedSandbox) && state.workspace?.path !== expectedSandbox) {
    const metadata = join(expectedSandbox, ".git");
    let mode = "copy";
    try {
      if (existsSync(metadata) && lstatSync(metadata).isFile()) mode = "worktree";
    } catch { /* cleanup as a bounded copy when metadata disappeared */ }
    const fallback = cleanupAppliedSandbox(id, {
      workspace: { mode, path: expectedSandbox }
    });
    if (["failed", "refused"].includes(fallback.status))
      issues.push(`unrecorded sandbox: ${fallback.reason || fallback.status}`);
  }

  for (const path of [
    changePath(id), runtimePath(id), join(RECEIPTS, id),
    join(EVIDENCE_VAULT, id), join(HANDOFFS, id), snapshotPath(id)
  ]) {
    try { rmSync(path, { recursive: true, force: true }); }
    catch (error) { issues.push(`${path}: ${error.message}`); }
  }
  return issues;
}
const approvalPackage = createApprovalPackageRuntime({
  root: ROOT,
  runtimeDir: RUNTIME,
  packagesDir: PACKAGES,
  previewsDir: PREVIEWS,
  receiptsDir: RECEIPTS,
  loadRuntime,
  activeChangePath,
  changeWorkTypes,
  evidence,
  providerCapability,
  receiptValidity,
  fail: die,
  trap: trapFailures
});
const approvalPackageLink = (id) => trapFailures(() => approvalPackage.tryWritePackage(id));
const preview = createPreviewRuntime({
  root: ROOT,
  runtimeDir: RUNTIME,
  previewsDir: PREVIEWS,
  loadRuntime,
  evidence,
  providerCapability,
  // A preview copy never carries Git or harness state: it is a scratch tree.
  copyWorkspace: (source, destination) => copySandboxEntries({
    root: source, requestedPath: destination, fail: die,
    plan: sandboxCopyPlan({
      root: source, carriesGit: false, git,
      sandboxCopyExcludedDirs: SANDBOX_COPY_EXCLUDED_DIRS,
      excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS
    })
  }),
  now,
  fail: die
});
const {
  templateDir,
  instantiate,
  loadDraft,
  materializeDraft,
  createChange,
  rapidStartTemplate,
  amendmentTemplate,
  inspectDraft,
  inspectAmendment,
  startAtomic,
  inspectRevision,
  reviseChange,
  amendChange,
  resolveChange,
  openQuestionsDecision
} = createChangeLifecycle({
  root: ROOT,
  policy: foundationPolicy,
  approvalPackageLink,
  approvalLanes: (id, state) => {
    const configured = foundationPolicy().approval?.roles || [];
    if (!configured.length) return { configured, required: [] };
    const routed = routeForState(state, changeWorkTypes(activeChangePath(id, state))).roles;
    return { configured, required: configured.filter((role) => routed.includes(role)) };
  },
  securityTerms: SECURITY_TERMS,
  fail: die,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  activeChangePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId(id) { operationChangeId = id; },
  initialBudget,
  git,
  gitHead,
  preexistingDirty,
  now,
  bindClaudeSession,
  validate,
  showPacket,
  measureStage: commandPhaseRecorder.measure,
  receiptPath,
  receiptValidity,
  contractFingerprint,
  requiredProviders,
  providerConfig,
  claimsForProvider,
  providerWorkspaceHash,
  providerInputIdentity,
  relevantHash,
  stableHash,
  trapFailures,
  rollbackStart: rollbackAtomicStart,
  repositoryCatalog
});
const amendTaskVerify = amendTaskVerifyOperation.bind(null, { root: ROOT, amendChange });
const { inspectInvestigation, investigationRecordTemplate } = createInvestigationRuntime({
  root: ROOT,
  readJson,
  writeJson,
  now,
  git,
  setOperationChangeId(id) { operationChangeId = id; },
  fail: die
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
  showCurrent,
  showProviders,
  usage
} = createDiagnosticsRuntime({
  root: ROOT,
  unresolvedApplyTransactions,
  deliveryObservation: (_id, state) => ({
    ...targetProjectionObservationValue({ root: ROOT, state, git, fileDigest }),
    references: recordedDeliveryReferences(state)
  }),
  authorityPreflight,
  executionContract,
  version: VERSION,
  runtimeApiVersion: RUNTIME_API_VERSION,
  providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
  adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
  proofProtocolVersion: PROOF_PROTOCOL_VERSION,
  packetSchemaVersion: PACKET_SCHEMA_VERSION,
  agentPlanSchemaVersion: AGENT_PLAN_SCHEMA_VERSION,
  contextEventSchemaVersion: CONTEXT_EVENT_SCHEMA_VERSION,
  metricsSchemaVersion: METRICS_SCHEMA_VERSION,
  commandTelemetrySchemaVersion: COMMAND_TELEMETRY_SCHEMA_VERSION,
  reviewProtocolVersion: REVIEW_PROTOCOL_VERSION,
  acceptanceProtocolVersion: ACCEPTANCE_PROTOCOL_VERSION,
  semanticAcceptanceProtocolVersion: SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION,
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
  reviewAssurancePosture,
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
  evidenceDetection: evidenceDetectionValue,
  parseFlags,
  parseStrictCommandFlags,
  fail: die
});
const {
  pathIdentity,
  pathMode,
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
const taskPacketWasPrecompleted = taskPacketWasPrecompletedOperation.bind(null, {
  loadRuntime, activeChangePath, exists: existsSync, fileDigest
});
// One set of deferred post-release gates for Prove and the archive appendix.
function changeRolloutGates(id) {
  return postReleaseRolloutGates(
    { evidence, providerCapability, policyRolloutCapabilities, loadRuntime, relevantHash }, id);
}
const { finalize: prove, audit: proofAudit } = createProofRuntime({
  rolloutGates: changeRolloutGates,
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
  agentPlanValue,
  executionContract,
  savedAgentPlan: (id) => readJson(join(PLANS, `${id}.json`), {}),
  taskResult: (id, taskId) => {
    const path = join(LEASES, "results", id, `${taskId}.json`);
    return existsSync(path) ? { path, value: readJson(path, null) } : null;
  },
  taskLease: (id, taskId) => {
    const path = join(LEASES, "tasks", id, `${taskId}.json`);
    return existsSync(path) ? readJson(path, null) : null;
  },
  taskPacketWasPrecompleted,
  selectedRepositories,
  git,
  now,
  fail: die
});
const testDiscrimination = createTestDiscriminationRuntime({
  LOGS, requiredProviders, providerConfig, providerCapability, providerRepository,
  selectedRepositories, repositoryBaseHead,
  changedSurface: (id, state) => canonicalChangedSurface(id, state),
  pathKind: lightKind,
  changeWorkTypes: (id) => changeWorkTypes(activeChangePath(id)),
  receiptValidity, configuredCommand, fileDigest, stableHash, loadRuntime
});
const {
  authorityNext,
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
  rebindDiffBoundReceipt,
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
  // Only the exact placeholder-free `authority run` route `advance` would run
  // inline qualifies; it runs under the proof lock the caller already holds.
  startConcurrentReview: (id, _request, command, proofRun = null) => {
    const flags = automaticReviewRun(id, command);
    return flags ? detachedBlockScope.run(() => trapFailuresAsync(() =>
      runAuthorityReviewerAsync(id, { ...flags, ...(proofRun ? { proofRun } : {}) })))
      : null;
  },
  stableHash,
  prepareWorkspace: projectRootRepositories,
  // An unresolvable surface or repository is no verdict: it never blocks.
  testDiscrimination: async (id, workspaceHash) => {
    try {
      if (!changedSurfaceResolvable(id)) return null;
      return await trapFailuresAsync(() => testDiscrimination.evaluateAsync(id, workspaceHash));
    } catch { return null; }
  },
  performanceRegression: (id, provider) =>
    receiptRegressionFinding(provider, readJsonOrNull(receiptPath(id, provider))),
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
const guardedExtendReviewAuthority = guardPublicProofMutation(
  "authority extend-review", extendReviewAuthority);
const guardedResetBaseMoveAuthority = guardPublicProofMutation(
  "authority reset-base-move", resetBaseMoveAuthority);
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
  workspaceIsolationIssues,
  targetEditNotices: (state) => targetEditsFor(state).notices,
  reviewPolicy,
  requiredProviders,
  receiptValidity,
  fileDigest,
  receiptPath,
  handoffReadiness,
  telemetryReadiness,
  verifyAppliedProjection,
  selectedRepositories,
  repositoryById,
  git,
  gitHead,
  ciEvidenceProtocolVersion: CI_EVIDENCE_PROTOCOL_VERSION,
  stableHash,
  agentPlanValue,
  executionContract,
  now,
  blockWithDecision,
  deliveryObservation: (_id, state) =>
    targetProjectionObservationValue({ root: ROOT, state, git, fileDigest }),
  // One preflight for `land check` and Land: the landed-projection binding
  // first (an uninitialized submodule answers Git for its superproject), then
  // every Apply, repository-delivery, and spec-sync refusal.
  landPreflight: (id, state, options) => {
    assertLandedProjection({ root: ROOT, id, state, fail: die, preflight: true });
    applyRuntime.landPreflight(id, state, options);
  },
  assertApproval: (id, state, options) => assertSpecApproval(ROOT, id, state, options),
  fail: die
});
const landGrantRuntime = createLandGrantRuntime({
  transactions: TRANSACTIONS,
  loadRuntime,
  selectedRepositories,
  proofPath,
  readJson,
  writeJson,
  stableHash,
  now,
  landCheck,
  workspaceHash: (id) => relevantHash(id, null, true),
  archiveRecoveryReady: (id) => applyRuntime.archiveRecoveryReady(id)
});
const applyRuntime = createApplyRuntime({
  // Archive appendices: review rounds and post-release rollout gates.
  reviewAttemptRecords: (id) => reviewAttemptRecords(id),
  rolloutGates: changeRolloutGates,
  root: ROOT,
  transactions: TRANSACTIONS,
  loadRuntime,
  saveRuntime,
  selectedRepositories,
  mergeTaskProgress,
  workspaceManifest,
  declaredSurfaceMatcher,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  pathMode,
  directoryHash,
  fileDigest,
  pathInside,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  writeJson,
  stableHash,
  syncClaudeTelemetry,
  modelUsageRecorded,
  telemetryReadiness,
  foundationPolicy,
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
  // Records say what Land applied; the target says what landed. Both must agree.
  assertMultiRepositoryArchiveReady: (id, state) => {
    assertMultiRepositoryArchiveReady(id, state);
    assertLandedProjection({ root: ROOT, id, state, fail: die });
  },
  archivedChangeRelativePath,
  pendingTasks,
  assertOpenSpecCli,
  proofAudit,
  cleanupChangeLeases,
  now,
  measure: commandPhaseRecorder.measure,
  assertLandGrant: landGrantRuntime.assert,
  consumeLandGrant: landGrantRuntime.consume,
  blockWithDecision,
  fail: die,
  declaredRepositoryPaths
});
const {
  gitApplyInputs,
  recordTargetRestore,
  buildApplyEntries,
  prepareApplyTransaction,
  refreshAppliedProjection,
  applySandbox,
  archive
} = applyRuntime;
const pullRequestRuntime = createPullRequestRuntime({
  root: ROOT,
  deliveriesRoot: DELIVERIES,
  loadRuntime,
  activeChangePath,
  proofPath,
  transactionJournalPath,
  pathIdentity,
  readJson,
  writeJson,
  stableHash,
  git,
  transactions: TRANSACTIONS,
  selectedRepositories,
  foundationPolicy,
  // `/deliver` on a proven change is Land authority: the normal Land route.
  landChange: (id) => advanceThrough(id, "archived"),
  now,
  fail: die
});
const { showAdvance: showDeliveryAdvance } = pullRequestRuntime;
const advanceLand = advanceLandOperation.bind(null, {
  loadRuntime, landCheck, archive, resumeLand, landPlanValue,
  selectedRepositories,
  prepareExecution: (id, options) => prepareExecution(id, options)
});

function preparationPlanPath(id) {
  return join(PLANS, `${id}-preparation.json`);
}

function preparationProviders(id) {
  return requiredProviders(id).map((provider) => {
    const config = providerConfig(id, provider) || {};
    return {
      id: provider,
      repository: config.repository || null,
      adapter: config.adapter || "external",
      command: config.command || null
    };
  });
}

function prepareExecution(id, { stage = "build" } = {}) {
  if (stage !== "land") projectRootRepositories(id);
  const state = loadRuntime(id);
  const repositories = selectedRepositories(id, state);
  const openSpec = ensureProjectOpenSpec({
    root: ROOT,
    status: openSpecCliStatus,
    spawn: spawnSync,
    stage
  });
  const prior = readJsonOrNull(preparationPlanPath(id));
  const plan = executionPreparationValue({
    id,
    state,
    repositories,
    providers: preparationProviders(id),
    openSpec,
    stableHash,
    prior,
    now
  });
  plan.stage = stage;
  writeJson(preparationPlanPath(id), plan);
  return assertExecutionPreparationReady(plan);
}
async function runAdvanceQuietly(operation) {
  const priorLog = console.log;
  const priorExitCode = process.exitCode;
  console.log = () => {};
  try {
    const result = await operation();
    // Primitive proof commands retain their diagnostic non-zero exits. The
    // unified lifecycle transports the same structured boundary successfully
    // so the host consumes it instead of retrying a command it thinks crashed.
    process.exitCode = priorExitCode;
    return result;
  } finally {
    console.log = priorLog;
  }
}
const sessionLeases = createSessionLeaseRuntime({
  loadRuntime, activeChangeLeases, stableHash, saveRuntime,
  // D5: advance runs the handed-off task's own verify check and ticks it.
  runCheck: (id, check) => commandPhaseRecorder.measure("build.task-check", () => {
    projectRootRepositories(id);
    return adapterRuntime.runTaskCheckAsEvidence(id, check) ||
      runTaskCheck({ loadRuntime }, id, check);
  }),
  taskChangeIssue: (id, taskId) => {
    try {
      const state = loadRuntime(id);
      const task = (agentPlanValue(id)?.tasks || []).find((row) => row.id === taskId);
      if (!task || !changedSurfaceResolvable(id, state)) return null;
      const repositoryId = trapFailures(() =>
        repositoryById(id, task.repository || "root", state).id);
      return taskChangeIssue({
        workTypes: changeWorkTypes(activeChangePath(id)), task, changeId: id,
        changedPaths: trapFailures(() => canonicalChangedSurface(id, state))
          .filter((row) => row.repositoryId === repositoryId).map((row) => row.path)
      });
    } catch { return null; }
  },
  acquire: acquireAgentLease, release: releaseAgentLease, discard: discardAgentLease
});
const { advanceValue, advanceThrough, showAdvance } = createAdvanceRuntime({
  approvalPackageLink,
  pendingApprovalDecisions: (id) => trapFailures(() => {
    const preflight = authorityPreflight(id);
    const authority = preflight.status === "READY" ? [] : preflight.blockers.map((blocker) => ({
      code: blocker.code, summary: blocker.summary, next: blocker.next
    }));
    // External evidence nobody can wire automatically is the same Prove-time
    // question; review and acceptance have their own routes.
    const state = loadRuntime(id);
    const providers = changedSurfaceResolvable(id, state) ? requiredProviders(id) : [];
    const external = providers.flatMap((provider) => {
      const config = providerConfig(id, provider);
      if (config && config.adapter !== "external") return [];
      if (["review", "acceptance"].includes(providerCapability(provider, config))) return [];
      const recovery = externalEvidenceRecovery(id, provider);
      if (recovery.kind !== "user-decision" ||
          recovery.wiring?.kind === "configure-provider") return [];
      return [{
        code: "EXTERNAL_EVIDENCE_REQUIRED", summary: recovery.decision.summary,
        next: `wire provider '${provider}' in openspec/changes/${id}/execution.yaml or agree how its external result will be supplied`
      }];
    });
    return [...authority, ...external];
  }),
  settleSessionLeases: sessionLeases.settle,
  reverifyCompletedTasks: (id) => {
    sessionLeases.tickAccepted(id, agentPlanValue(id, { inspect: true }).resultReady || []);
    return sessionLeases.reverify(id, agentPlanValue(id, { inspect: true }).verification || []);
  },
  issueSessionLease: sessionLeases.issue,
  changePath,
  projectRoot: ROOT,
  assertApproval: (id, state, options) => assertSpecApproval(ROOT, id, state, options),
  inspectSnapshots,
  capture: trapFailures,
  captureAsync: trapFailuresAsync,
  markBlocked,
  loadRuntime,
  saveRuntime,
  recoverSandbox: (id) => commandPhaseRecorder.measureAsync("advance.sandbox-sync",
    () => runAdvanceQuietly(() => syncSandbox(id))),
  // Non-destructive interrupted-apply resolutions only (settle|keep-current),
  // recorded under the Land route that started the apply.
  recoverApply: (id, resolution) => runAdvanceQuietly(() => recoverLand(id, {
    "decision-ref": `harness:automatic-apply-recovery:${resolution}`,
    ...(resolution === "settle" ? {} : { resolution })
  })),
  synchronizeAgreement: async (id, flags = {}) => flags.resolve || sandboxRuntime.agreementStale(id)
    ? commandPhaseRecorder.measureAsync("advance.sandbox-sync",
      () => runAdvanceQuietly(() => sandboxRuntime.synchronizeAgreement(id, flags)))
    : false,
  // Detected provider wiring is a write, not a question: upgrade a legacy
  // packet, write the recommended providers, then sync the revised agreement
  // into Build so Land never sees an edited-after-sync packet.
  wireEvidence: (id) => commandPhaseRecorder.measureAsync("advance.evidence-wiring",
    () => runAdvanceQuietly(async () => {
      if (readJson(join(changePath(id), "evidence.yaml"), {}).version === 1) upgradeEvidence(id);
      // Wiring-only, like `evidence upgrade`: an approval valid before the
      // write stays valid; the agreement's behavior did not change.
      preserveSpecApprovalAcross(ROOT, id, { loadRuntime, saveRuntime, now },
        () => initializeEvidence(id, { write: true }), "evidence-wiring");
      if (loadRuntime(id).status === "building") prepareBuildSandbox(id);
      else await sandboxRuntime.synchronizeAgreement(id);
    })),
  runReview: (id, flags) => commandPhaseRecorder.measureAsync("advance.review-run",
    () => runAdvanceQuietly(() => guardedRunAuthorityReviewer(id, { ...flags }))),
  recoverWorkspace: (id) => runAdvanceQuietly(() => sandboxRuntime.recoverReplay(id)),
  recoverArchive: (id) => runAdvanceQuietly(() =>
    applyRuntime.recoverArchive(id, landGrantRuntime.issue)),
  proofIsCurrent: currentDeliveryProof.bind(null, {
    proofAudit, relevantHash, requiredProviders, receiptValidity, receiptPath, fileDigest
  }),
  agentDispatchValue,
  agentPlanValue,
  relevantHash,
  deliveredAiAttempts,
  authorityStatusValue,
  authorityNext,
  proofReadinessValue,
  hasLandGrant: hasValidLandGrant.bind(null, landGrantRuntime),
  authorizeLand: (id) => runAdvanceQuietly(() => landGrantRuntime.issue(id)),
  prepareBuild: prepareAdvanceBuild.bind(null, {
    measureAsync: commandPhaseRecorder.measureAsync,
    runQuietly: runAdvanceQuietly, prepareBuildSandbox, prepareExecution
  }),
  runProof: runAdvanceProof.bind(null, {
    measureAsync: commandPhaseRecorder.measureAsync,
    runQuietly: runAdvanceQuietly, prepareExecution, proofAdvance
  }),
  recoverReviewBindings,
  runLand: (id) => runAdvanceQuietly(() => advanceLand(id)),
  recordPhase: (id, phase) => {
    commandPhaseRecorder.transition(phase);
    recordPhaseContext(id, phase);
  },
  readJson,
  proofAdvancePath: (id) => join(EVIDENCE_VAULT, id, "proof-advance.json"),
  stableHash
});
const { showFeedback } = createFeedbackRuntime({
  inspectSnapshots,
  logs: LOGS,
  evidenceVault: EVIDENCE_VAULT,
  readJson,
  readJsonLines,
  metricsValue,
  packetValue: packetRuntime.inspectionPacketValue,
  nextAction: (id) => advanceValue(id, { inspect: true })
});
// Cross-change rollups read the store directly and never write it: the
// attempt reader below bypasses reviewHistoryState, which may migrate state.
const reviewAttemptRecords = (id) => {
  const dir = join(EVIDENCE_VAULT, id, "review-attempts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
    .map((name) => readJsonOrNull(join(dir, name)))
    .filter((value) => value && typeof value === "object");
};
const { showOutcomes } = createOutcomesRuntime({
  runtimeDir: RUNTIME,
  evidenceDir: EVIDENCE_VAULT,
  logsDir: LOGS,
  changeWorkTypes: (id, state) => changeWorkTypes(activeChangePath(id, state)),
  reviewAttemptRecords
});
const { showLessons } = createLessonsRuntime({
  runtimeDir: RUNTIME,
  evidenceDir: EVIDENCE_VAULT,
  logsDir: LOGS,
  reviewAttemptRecords,
  fail: die
});
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
    authority: AUTHORITY,
    reviews: REVIEWS,
    instructionManifests: INSTRUCTION_MANIFESTS,
    attestations: ATTESTATIONS,
    deliveries: DELIVERIES,
    previews: PREVIEWS,
    packages: PACKAGES,
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
const { undoLand } = createLandUndo({
  root: ROOT,
  paths: {
    recovery: RECOVERY, runtime: RUNTIME, receipts: RECEIPTS, evidenceVault: EVIDENCE_VAULT,
    transactions: TRANSACTIONS, snapshots: SNAPSHOTS, plans: PLANS, handoffs: HANDOFFS,
    logs: LOGS, authority: AUTHORITY, reviews: REVIEWS,
    instructionManifests: INSTRUCTION_MANIFESTS, attestations: ATTESTATIONS,
    deliveries: DELIVERIES, previews: PREVIEWS, packages: PACKAGES
  },
  loadRuntime, saveRuntime, readJson, writeJson, now, gitHead, git, gitBuffer,
  pathIdentity, pathMode, safeRootPath, copyPath,
  transactionRoot: applyTransactionRoot, journalPath: transactionJournalPath,
  cleanupChangeLeases, fail: die
});
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
// An omitted `<change>` resolves to the one active change before telemetry and
// the operation ledger read the id.
values.splice(0, values.length, ...impliedChangeValues(command, values, activeChanges, die));
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
const qualityChange = () => {
  const index = values.findIndex((value) => value === "--change");
  return namedChange(index >= 0 ? values[index + 1] : process.env.FOUNDATION_CHANGE_ID);
};
operationChangeId = command === "sandbox" ? namedChange(values[1]) :
  ["resolve", "validate", "audit-change", "hash", "packet", "agent-plan", "agent-dispatch", "agent-task", "agent-acquire", "agent-release", "metrics", "feedback", "advance", "budget-checkpoint", "budget-continue", "proof-plan", "proof-readiness", "proof-advance", "proof-run", "proof-collect", "proof-preflight", "proof-execute", "proof-audit", "evidence-upgrade", "evidence-verify-ci", "authority-request", "authority-dispatch", "authority-run", "authority-abort", "authority-status", "authority-record", "authority-reset-infra", "authority-extend-review", "authority-reset-base-move", "receipt", "run-provider", "prove",
    "evidence-detect", "evidence-init", "evidence-doctor", "handoff-status", "handoff-packet", "handoff-record", "land-check", "land-advance", "land-plan", "land-record", "land-pointers", "land-resume", "archive", "delivery-advance", "event", "telemetry-sync", "telemetry-import"].includes(command) ? namedChange(values[0]) :
    command?.startsWith("quality-")
      ? qualityChange()
      : null;
const operationStateAtStart = operationChangeId
  ? readJson(runtimePath(operationChangeId), {}) : {};
operationStatusAtStart = operationStateAtStart.status ?? null;
if (operationChangeId) {
  try {
    const changeRoot = activeChangePath(operationChangeId, operationStateAtStart);
    operationFingerprint = operationInputFingerprint({
      operation: command,
      values,
      state: operationStateAtStart,
      changeDigest: existsSync(changeRoot) ? directoryHash(changeRoot) : null,
      foundationConfigDigest: existsSync(join(ROOT, "foundation.json"))
        ? fileDigest(join(ROOT, "foundation.json")) : null,
      projectPolicyDigest: existsSync(join(ROOT, ".foundation", "policy.json"))
        ? fileDigest(join(ROOT, ".foundation", "policy.json")) : null
    });
  } catch {
    // Profiling is observational. A damaged change must still reach the
    // command that diagnoses or retires it; the row reports unavailable input
    // identity rather than turning instrumentation into a new blocker.
    operationFingerprint = null;
  }
}

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
if (command === "budget-checkpoint" && telemetryWritable(operationChangeId))
  syncClaudeTelemetry(operationChangeId, { quiet: true });
if (command === "budget-continue" && telemetryWritable(operationChangeId))
  syncClaudeTelemetry(operationChangeId, { quiet: true });

await routeRuntimeCommand(command, values, {
  parseFlags,
  parseStrictCommandFlags,
  fail: die,
  createChange,
  inspectInvestigation,
  investigationRecordTemplate,
  rapidStartTemplate,
  amendmentTemplate,
  inspectDraft,
  inspectAmendment,
  startAtomic,
  inspectRevision,
  reviseChange,
  amendChange,
  amendTaskVerify,
  resolveChange,
  // An approval over open questions becomes the user's questions, not a refusal.
  approvalQuestionAction: (id, through = null) => {
    const decision = openQuestionsDecision(id);
    return decision ? advanceFailureAction(id, decision, { stage: "build", through }) : null;
  },
  abandonChange,
  waiveGate,
  showChanges,
  showCurrent,
  showProviders,
  showRepositories,
  foundationPolicy,
  showAgentPlan,
  showAgentDispatch,
  showAgentTask,
  acquireAgentLease: (id, taskId, flags) => {
    sessionLeases.yieldTo(id);
    return acquireAgentLease(id, taskId, flags);
  },
  releaseAgentLease,
  prepareClaudeTelemetry,
  recordPhaseContext,
  showPacket,
  showMetrics,
  showAdvance,
  recordTargetRestore,
  undoLand,
  showFeedback,
  showOutcomes,
  showLessons,
  showPackage: approvalPackage.showPackage,
  showPreview: preview.showPreview,
  execObserved,
  checkpointBudget,
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
  extendReviewAuthority: guardedExtendReviewAuthority,
  resetBaseMoveAuthority: guardedResetBaseMoveAuthority,
  showAuthorityStatus,
  recordAuthority: guardedRecordAuthority,
  upgradeEvidence,
  recordReceipt: guardedRecordReceipt,
  runProvider: guardedRunProvider,
  prove,
  landCheck,
  grantLand: landGrantRuntime.issue,
  advanceLand,
  recoverLand,
  showLandPlan,
  recordRepositoryLand,
  stageRootPointers,
  resumeLand,
  showDeliveryAdvance,
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
  version: VERSION,
  showQualityDiscovery,
  initializeQuality,
  qualityDoctor,
  runQuality: (options) => trapFailures(() => runQuality(options)),
  showQualityReport,
  updateQualityBaseline,
  showQualityDebt
});
