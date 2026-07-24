#!/usr/bin/env node

// A deliberately one-shot, authority-neutral control-plane view. The platform
// adapter below is the only seam that should eventually learn how to resume a
// Codex task; this module never schedules, mutates lifecycle state, merges, or
// deploys.
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const COMPLETION_RANK = new Map([
  ["implemented-not-verified", 0],
  ["locally-verified", 1],
  ["closure-verified", 2],
  ["delivered-and-verified", 3],
]);
const WORKER_STATES = new Set(["active", "stalled", "waiting-external", "completed", "failed", "unknown"]);
const AUTOMATION_STATES = new Set(["active", "paused", "deleted"]);

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read JSON ${file}: ${error.message}`); }
}

function slug(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function parse(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return args;
}

function completionReached(target, status) {
  return COMPLETION_RANK.has(target) && COMPLETION_RANK.has(status)
    && COMPLETION_RANK.get(status) >= COMPLETION_RANK.get(target);
}

function route(kind, action, command = null) {
  return { kind, action, command, schedulable: false };
}

// This is intentionally a detection contract, not an adapter implementation.
// The repository does not ship a Codex thread or automation API, so an absent
// concrete platform adapter must remain a visible blocker.
export function detectPlatformCapabilities({ adapter = null } = {}) {
  if (!adapter) return {
    status: "unavailable",
    blocker: "codex-platform-adapter-unavailable",
    capabilities: { schedule_followup: false, inspect_worker: false, submit_merge: false },
    detail: "No concrete Codex thread or automation adapter is installed in this runtime.",
  };
  const valid = adapter.schema_version === 1 && adapter.kind === "codex-platform-adapter"
    && adapter.authority === "platform" && adapter.runtime_available === true;
  if (!valid) return {
    status: "unavailable",
    blocker: "codex-platform-adapter-invalid",
    capabilities: { schedule_followup: false, inspect_worker: false, submit_merge: false },
    detail: "The supplied platform adapter declaration is not an available concrete Codex adapter.",
  };
  return {
    status: "available",
    blocker: null,
    capabilities: {
      schedule_followup: adapter.capabilities?.schedule_followup === true,
      inspect_worker: adapter.capabilities?.inspect_worker === true,
      submit_merge: adapter.capabilities?.submit_merge === true,
    },
    detail: "A concrete platform adapter declared runtime availability; requests remain previews until that adapter accepts them.",
  };
}

export function validateWorkerState(worker) {
  if (!worker) return { valid: true, value: null, errors: [] };
  const errors = [];
  if (worker.schema_version !== 1 || worker.kind !== "codex-worker-state") errors.push("worker state must use schema_version 1 and kind codex-worker-state");
  if (typeof worker.worker_id !== "string" || !worker.worker_id.trim()) errors.push("worker state requires worker_id");
  if (!WORKER_STATES.has(worker.state)) errors.push("worker state has an unsupported state");
  if (typeof worker.observed_at !== "string" || Number.isNaN(Date.parse(worker.observed_at))) errors.push("worker state requires an observed_at timestamp");
  if (worker.task_id !== undefined && (typeof worker.task_id !== "string" || !worker.task_id.trim())) errors.push("worker task_id must be a non-empty string when present");
  return { valid: errors.length === 0, value: errors.length ? null : worker, errors };
}

export function validateProtectedMergeApproval(approval, candidateId) {
  if (!approval) return { valid: false, reason: "protected merge approval is missing" };
  const valid = approval.schema_version === 1 && approval.kind === "protected-merge-approval"
    && approval.authority === "protected-controller" && typeof approval.approval_id === "string"
    && approval.approval_id.trim() && typeof approval.approved_at === "string" && !Number.isNaN(Date.parse(approval.approved_at))
    && typeof approval.candidate_id === "string" && approval.candidate_id === candidateId;
  return valid ? { valid: true } : { valid: false, reason: "protected merge approval is missing, malformed, or not bound to the candidate" };
}

export function validateAutomationOwnership(ownership, taskId) {
  if (!ownership) return { valid: true, value: null, errors: [] };
  const errors = [];
  if (ownership.schema_version !== 1 || ownership.kind !== "vision-manager-automation" || ownership.authority !== "none") errors.push("automation ownership must be schema_version 1, kind vision-manager-automation, and authority none");
  if (ownership.task_id !== taskId) errors.push("automation ownership must be bound to the active task");
  if (!AUTOMATION_STATES.has(ownership.status)) errors.push("automation ownership has an unsupported status");
  if (ownership.status !== "deleted" && (typeof ownership.automation_id !== "string" || !ownership.automation_id.trim())) errors.push("active or paused automation ownership requires automation_id");
  if (ownership.notification_mode !== "failed-runs-only") errors.push("automation ownership must use failed-runs-only notifications");
  return { valid: errors.length === 0, value: errors.length ? null : ownership, errors };
}

export function detectManagerAgentAutomationCapability({ tool_names: toolNames = [] } = {}) {
  const available = Array.isArray(toolNames) && toolNames.includes("codex_app.automation_update");
  return available
    ? { status: "available", required_tool: "codex_app.automation_update", detail: "The manager agent can submit the requested automation lifecycle operation." }
    : { status: "unavailable", required_tool: "codex_app.automation_update", blocker: "manager-agent-automation-tool-unavailable", detail: "Node/plugin code cannot create Codex automations; a manager agent with the Codex automation_update tool is required." };
}

function validProjectTarget(target) {
  return target && target.schema_version === 1 && target.kind === "registered-codex-project"
    && typeof target.project_id === "string" && target.project_id.trim();
}

export function planSafetySweep(report, { ownership = null, project_target: projectTarget = null, manager_tools: managerTools = [] } = {}) {
  const capability = detectManagerAgentAutomationCapability({ tool_names: managerTools });
  const existing = validateAutomationOwnership(ownership, report.task_id);
  if (!report.task_id) return { state: "not-applicable", capability, ownership: existing.value, ownership_errors: existing.errors, tool_request: null };
  if (!existing.valid) return { state: "ownership-invalid", capability, ownership: null, ownership_errors: existing.errors, tool_request: null };
  const terminal = ["terminal", "complete", "idle", "invalid-state"].includes(report.decision.kind);
  if (terminal && existing.value?.status === "active") return automationOperation("delete", report, projectTarget, existing.value, capability);
  if (!terminal && existing.value?.status === "active") return { state: "tracked", capability, ownership: existing.value, ownership_errors: [], tool_request: null, reason: "An active safety sweep already belongs to this task; do not create a duplicate." };
  if (!terminal && !validProjectTarget(projectTarget)) return { state: "project-target-required", capability, ownership: existing.value, ownership_errors: [], tool_request: null, reason: "Use the registered Codex project target before creating a task safety sweep." };
  if (terminal && existing.value?.status === "paused") return automationOperation("delete", report, projectTarget, existing.value, capability);
  if (terminal) return { state: "retired", capability, ownership: existing.value, ownership_errors: [], tool_request: null };
  return automationOperation(existing.value?.status === "paused" ? "resume" : "create", report, projectTarget, existing.value, capability);
}

function automationOperation(operation, report, projectTarget, ownership, capability) {
  const action = operation === "create" ? "create" : operation === "resume" ? "update" : "delete";
  const toolRequest = {
    tool: "codex_app.automation_update",
    operation: action,
    project_target: projectTarget,
    automation_id: ownership?.automation_id || null,
    schedule: operation === "delete" ? null : { kind: "interval", every_minutes: 15 },
    notification_mode: operation === "delete" ? null : "failed-runs-only",
    prompt: operation === "delete" ? null : "Run the Vision safety sweep for this active task. Inspect current lifecycle, worker state, and bound evidence. Create only bounded recovery or real-verification follow-ups. Do not merge, deploy, approve actions, or change protected evidence.",
    requested_by: "vision-manager",
    submission: "manager-agent-runtime-call-required",
  };
  return {
    state: capability.status === "available" ? `${operation}-requested` : `${operation}-blocked`,
    capability,
    ownership: ownership || null,
    ownership_errors: [],
    tool_request: toolRequest,
  };
}

function followupRequest(report, worker) {
  if (!worker || !["stalled", "waiting-external", "failed"].includes(worker.state)) return null;
  return {
    schema_version: 1,
    kind: "codex-followup-request",
    authority: "none",
    task_id: report.task_id,
    worker_id: worker.worker_id,
    reason: worker.state,
    bounded_route: report.decision.command || "human-review",
    action: report.decision.action,
    submission: "preview-only",
  };
}

function handoff(report, approval) {
  const candidateId = report.evidence.candidate_id || null;
  if (["evidence-missing", "evidence-stale", "evidence-incomplete", "verification-failed"].includes(report.decision.kind)) {
    return { state: "dev-verification-required", action: "Run the bound real checks in the development environment and ingest fresh evidence.", protected: false };
  }
  if (report.decision.kind === "protected-verification-required") return { state: "protected-verification-required", action: report.decision.action, protected: true };
  if (report.decision.kind === "protected-delivery-required") return { state: "protected-delivery-required", action: report.decision.action, protected: true };
  if (report.evidence.overall_status === "closure-verified") {
    const mergeApproval = validateProtectedMergeApproval(approval, candidateId);
    return mergeApproval.valid
      ? { state: "approval-gated-auto-merge", action: "Submit the bound merge proposal to the protected controller; this manager cannot merge.", protected: true, approval: "bound" }
      : { state: "merge-proposal-protected", action: "Prepare a merge proposal, then obtain protected approval bound to this candidate.", protected: true, approval: mergeApproval.reason };
  }
  return { state: "none", action: "No protected handoff is ready.", protected: false };
}

function stateDecision(state, contract, evidence) {
  if (!state) return route("idle", "No active Vision task is registered.");
  if (state.schema_version !== 1 || state.kind !== "derived-cache" || state.authority !== "none") {
    return route("invalid-state", "Do not continue from this cache. Reconcile the frozen contract, then reactivate the authority-neutral lifecycle cache.", "activate");
  }
  if (!state.active) return route("idle", "The registered Vision task is inactive.");
  if (state.terminal_state) return route("terminal", state.terminal_state.reason || "The active task is terminal.");
  if (state.guards?.halted) return route("blocked", state.guards.halt_message || "The lifecycle safety guard halted continuation.", "human-review");
  if (state.pending_approval) return route("approval-required", `Wait for the declared approval: ${state.pending_approval}.`);
  if (state.guards?.authorization_failure_count > 0) {
    return route("external-access", "Restore the recorded external access, then resume the same verification gate.", "resume");
  }
  if (!contract) return route("contract-missing", "Recover the frozen task contract before selecting work; the cache alone is not authoritative.", "resume");
  if (!evidence) {
    return state.phase === "implement"
      ? route("supervise", state.current_slice ? `Continue the bounded slice ${state.current_slice.id}, then collect required evidence.` : "Run lifecycle resume to select one bounded slice.", "resume")
      : route("evidence-missing", "Run the required real verification for the current candidate before advancing.", "resume");
  }
  if (evidence.task_id !== state.task_id || evidence.contract_version !== state.contract_version || evidence.contract_hash !== state.contract_hash) {
    return route("evidence-stale", "Evidence is not bound to the active contract. Re-run the required real verification.", "resume");
  }
  if (state.candidate_id && evidence.candidate_id && state.candidate_id !== evidence.candidate_id) {
    return route("evidence-stale", "Evidence is bound to a different candidate. Re-run the required real verification.", "resume");
  }
  if (evidence.overall_status === "failed") return route("verification-failed", "Route the failing evidence to bounded diagnosis before another attempt.", "resume");
  const required = new Map((evidence.checks || []).map((check) => [check.id, check.state]));
  const incomplete = (contract.checks || []).filter((check) => check.required !== false && required.get(check.id) !== "pass");
  if (incomplete.length) return route("evidence-incomplete", `Run real verification for required check ${incomplete[0].id} before advancing.`, "resume");
  if (completionReached(state.completion_target, evidence.overall_status)) return route("complete", `Preserve the current ${evidence.overall_status} evidence; the target is met.`);
  if (["closure-verified", "delivered-and-verified"].includes(state.completion_target) && evidence.overall_status === "locally-verified") {
    return route("protected-verification-required", "Request protected verification for the exact candidate and bound evidence. The manager cannot perform it.", "protected-verifier");
  }
  if (state.completion_target === "delivered-and-verified" && evidence.overall_status === "closure-verified") {
    return route("protected-delivery-required", "Request the protected delivery controller and its post-deploy verification. The manager cannot merge or deploy.", "protected-delivery-controller");
  }
  return route("supervise", state.current_slice ? `Inspect and continue bounded slice ${state.current_slice.id}.` : "Run lifecycle resume to select one bounded slice.", "resume");
}

async function inspectFiles(root) {
  const namespaces = [".vision", ".agentic"];
  for (const namespace of namespaces) {
    const stateFile = path.join(root, namespace, "state", "active-task.json");
    if (await exists(stateFile)) return { namespace, stateFile, state: await readJson(stateFile) };
  }
  return { namespace: null, stateFile: null, state: null };
}

async function inspectBoundArtifacts(root, namespace, state) {
  if (!state?.task_id || !namespace) return { contract: null, evidence: null, contract_file: null, evidence_file: null };
  const taskFile = state.task_path ? path.resolve(root, state.task_path) : path.join(root, namespace, "tasks", `${state.task_id}.json`);
  const configFile = path.join(root, namespace, "config.json");
  const [contract, config] = await Promise.all([exists(taskFile).then((present) => present ? readJson(taskFile) : null), exists(configFile).then((present) => present ? readJson(configFile) : {})]);
  const evidenceRoot = config.evidence_root || `${namespace}/evidence`;
  const evidenceFile = path.resolve(root, evidenceRoot, slug(state.task_id), "latest.json");
  return { contract, evidence: (await exists(evidenceFile)) ? await readJson(evidenceFile) : null, contract_file: taskFile, evidence_file: evidenceFile };
}

export async function inspectManager({ root = process.cwd() } = {}) {
  const resolvedRoot = path.resolve(root);
  const source = await inspectFiles(resolvedRoot);
  const artifacts = await inspectBoundArtifacts(resolvedRoot, source.namespace, source.state);
  const decision = stateDecision(source.state, artifacts.contract, artifacts.evidence);
  return {
    schema_version: 1,
    authority: "none",
    root: resolvedRoot,
    namespace: source.namespace,
    state_file: source.stateFile,
    task_id: source.state?.task_id || null,
    evidence: artifacts.evidence ? { file: artifacts.evidence_file, overall_status: artifacts.evidence.overall_status || null, candidate_id: artifacts.evidence.candidate_id || null } : { file: artifacts.evidence_file, overall_status: null, candidate_id: null },
    decision,
    platform_adapter: {
      status: "future-boundary",
      contract: "A platform-owned Codex adapter may translate only the recommended bounded route into task resume or recovery work after checking live thread state. It must not merge, deploy, grant approvals, or promote evidence.",
    },
  };
}

export async function planManager({ root = process.cwd(), worker_state: workerState = null, approval = null, adapter = null, automation_ownership: automationOwnership = null, project_target: projectTarget = null, manager_tools: managerTools = [] } = {}) {
  const report = await inspectManager({ root });
  const worker = validateWorkerState(workerState);
  const capabilities = detectPlatformCapabilities({ adapter });
  const followup = worker.valid ? followupRequest(report, worker.value) : null;
  const automation = planSafetySweep(report, { ownership: automationOwnership, project_target: projectTarget, manager_tools: managerTools });
  return {
    schema_version: 1,
    kind: "vision-manager-plan",
    authority: "none",
    report,
    worker_state: worker.valid ? worker.value : null,
    worker_state_errors: worker.errors,
    platform: capabilities,
    followup,
    handoff: handoff(report, approval),
    automation,
    execution: followup && capabilities.capabilities.schedule_followup
      ? "adapter-required-preview"
      : followup ? "blocked-no-platform-adapter" : "no-followup-request",
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parse(argv);
  const command = argv.find((item) => !item.startsWith("--")) || "status";
  if (!["status", "inspect", "plan"].includes(command)) throw new Error("Vision manager supports only status, inspect, and preview plan; scheduling, merge, and deployment require platform adapters.");
  const worker = args["worker-state"] && args["worker-state"] !== true ? await readJson(path.resolve(String(args["worker-state"]))) : null;
  const approval = args.approval && args.approval !== true ? await readJson(path.resolve(String(args.approval))) : null;
  const ownership = args["automation-ownership"] && args["automation-ownership"] !== true ? await readJson(path.resolve(String(args["automation-ownership"]))) : null;
  const projectTarget = args["project-target"] && args["project-target"] !== true ? await readJson(path.resolve(String(args["project-target"]))) : null;
  const report = command === "plan" ? await planManager({ root: args.root, worker_state: worker, approval, automation_ownership: ownership, project_target: projectTarget }) : await inspectManager({ root: args.root });
  console.log(args.json === true ? JSON.stringify(report, null, 2) : `${command === "plan" ? report.execution : report.decision.kind}: ${command === "plan" ? report.handoff.action : report.decision.action}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
