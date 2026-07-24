import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectManagerAgentAutomationCapability, detectPlatformCapabilities, inspectManager, planManager, planSafetySweep, validateWorkerState } from "../plugins/vision/scripts/vision-manager.mjs";

async function workspace(t, { namespace = ".vision", state = {}, evidence = undefined } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const task = {
    schema_version: 3,
    task_id: "TASK-1",
    contract_version: 2,
    checks: [{ id: "real-api", required: true }, { id: "optional", required: false }],
  };
  const active = {
    schema_version: 1,
    kind: "derived-cache",
    authority: "none",
    active: true,
    task_id: task.task_id,
    task_path: `${namespace}/tasks/${task.task_id}.json`,
    contract_version: task.contract_version,
    contract_hash: "contract-hash",
    completion_target: "locally-verified",
    phase: "verify",
    current_slice: { id: "verify-api" },
    ...state,
  };
  await fs.mkdir(path.join(root, namespace, "state"), { recursive: true });
  await fs.mkdir(path.join(root, namespace, "tasks"), { recursive: true });
  await fs.writeFile(path.join(root, namespace, "config.json"), `${JSON.stringify({ evidence_root: `${namespace}/evidence` })}\n`);
  await fs.writeFile(path.join(root, namespace, "tasks", "TASK-1.json"), `${JSON.stringify(task)}\n`);
  await fs.writeFile(path.join(root, namespace, "state", "active-task.json"), `${JSON.stringify(active)}\n`);
  if (evidence !== undefined) {
    const file = path.join(root, namespace, "evidence", "TASK-1", "latest.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(evidence)}\n`);
  }
  return root;
}

function passingEvidence(overrides = {}) {
  return {
    task_id: "TASK-1",
    contract_version: 2,
    contract_hash: "contract-hash",
    overall_status: "locally-verified",
    checks: [{ id: "real-api", state: "pass" }],
    ...overrides,
  };
}

test("manager recommends real verification when active verify phase has no evidence", async (t) => {
  const root = await workspace(t);
  const report = await inspectManager({ root });
  assert.equal(report.authority, "none");
  assert.equal(report.decision.kind, "evidence-missing");
  assert.equal(report.decision.command, "resume");
  assert.equal(report.decision.schedulable, false);
  assert.match(report.platform_adapter.contract, /must not merge, deploy/i);
});

test("manager recognizes external access blocks and lifecycle stalls before selecting a slice", async (t) => {
  const root = await workspace(t, { state: { guards: { authorization_failure_count: 1 } } });
  const report = await inspectManager({ root });
  assert.equal(report.decision.kind, "external-access");

  const stalled = await workspace(t, { state: { guards: { halted: true, halt_message: "No material progress was observed." } } });
  const stalledReport = await inspectManager({ root: stalled });
  assert.equal(stalledReport.decision.kind, "blocked");
  assert.match(stalledReport.decision.action, /No material progress/);
});

test("manager rejects stale and incomplete evidence and never promotes it", async (t) => {
  const staleRoot = await workspace(t, { evidence: passingEvidence({ contract_hash: "old-contract" }) });
  assert.equal((await inspectManager({ root: staleRoot })).decision.kind, "evidence-stale");

  const incompleteRoot = await workspace(t, { evidence: passingEvidence({ checks: [] }) });
  const report = await inspectManager({ root: incompleteRoot });
  assert.equal(report.decision.kind, "evidence-incomplete");
  assert.match(report.decision.action, /real-api/);
});

test("manager routes protected steps as requests and supports legacy artifact roots", async (t) => {
  const closureRoot = await workspace(t, {
    state: { completion_target: "closure-verified" },
    evidence: passingEvidence(),
  });
  assert.equal((await inspectManager({ root: closureRoot })).decision.kind, "protected-verification-required");

  const deliveryRoot = await workspace(t, {
    state: { completion_target: "delivered-and-verified" },
    evidence: passingEvidence({ overall_status: "closure-verified" }),
  });
  assert.equal((await inspectManager({ root: deliveryRoot })).decision.kind, "protected-delivery-required");

  const legacyRoot = await workspace(t, { namespace: ".agentic", evidence: passingEvidence() });
  const legacy = await inspectManager({ root: legacyRoot });
  assert.equal(legacy.namespace, ".agentic");
  assert.equal(legacy.decision.kind, "complete");
});

test("manager prefers the .vision active state over a legacy cache", async (t) => {
  const root = await workspace(t, { evidence: passingEvidence() });
  await fs.mkdir(path.join(root, ".agentic", "state"), { recursive: true });
  await fs.writeFile(path.join(root, ".agentic", "state", "active-task.json"), JSON.stringify({ active: true, task_id: "legacy" }));
  const report = await inspectManager({ root });
  assert.equal(report.namespace, ".vision");
  assert.equal(report.task_id, "TASK-1");
});

test("manager plans bounded stalled-worker follow-up but blocks it without a real platform adapter", async (t) => {
  const root = await workspace(t, { evidence: passingEvidence({ checks: [] }) });
  const plan = await planManager({
    root,
    worker_state: { schema_version: 1, kind: "codex-worker-state", worker_id: "worker-1", task_id: "TASK-1", state: "stalled", observed_at: "2026-07-23T12:00:00.000Z" },
  });
  assert.equal(plan.followup.kind, "codex-followup-request");
  assert.equal(plan.followup.submission, "preview-only");
  assert.equal(plan.platform.blocker, "codex-platform-adapter-unavailable");
  assert.equal(plan.execution, "blocked-no-platform-adapter");
  assert.equal(plan.handoff.state, "dev-verification-required");
});

test("manager validates worker ingestion and keeps merge approval protected and candidate-bound", async (t) => {
  assert.equal(validateWorkerState({ schema_version: 1, kind: "codex-worker-state", worker_id: "", state: "made-up", observed_at: "nope" }).valid, false);
  assert.equal(detectPlatformCapabilities().status, "unavailable");
  const root = await workspace(t, {
    state: { completion_target: "closure-verified" },
    evidence: passingEvidence({ overall_status: "closure-verified", candidate_id: "candidate-1" }),
  });
  const unapproved = await planManager({ root });
  assert.equal(unapproved.handoff.state, "merge-proposal-protected");
  const approved = await planManager({ root, approval: {
    schema_version: 1,
    kind: "protected-merge-approval",
    authority: "protected-controller",
    approval_id: "approval-1",
    candidate_id: "candidate-1",
    approved_at: "2026-07-23T12:00:00.000Z",
  } });
  assert.equal(approved.handoff.state, "approval-gated-auto-merge");
  assert.match(approved.handoff.action, /cannot merge/i);
});

test("manager safety sweep owns one registered-project automation and fails closed without the runtime tool", async (t) => {
  const root = await workspace(t, { state: { phase: "implement" } });
  const created = await planManager({ root, project_target: { schema_version: 1, kind: "registered-codex-project", project_id: "project-1" } });
  assert.equal(created.automation.state, "create-blocked");
  assert.equal(created.automation.capability.blocker, "manager-agent-automation-tool-unavailable");
  assert.equal(created.automation.tool_request.tool, "codex_app.automation_update");
  assert.equal(created.automation.tool_request.notification_mode, "failed-runs-only");

  const tracked = planSafetySweep(created.report, {
    project_target: { schema_version: 1, kind: "registered-codex-project", project_id: "project-1" },
    manager_tools: ["codex_app.automation_update"],
    ownership: { schema_version: 1, kind: "vision-manager-automation", authority: "none", task_id: "TASK-1", status: "active", automation_id: "sweep-1", notification_mode: "failed-runs-only" },
  });
  assert.equal(tracked.state, "tracked");
  assert.equal(tracked.tool_request, null);
  assert.equal(detectManagerAgentAutomationCapability({ tool_names: ["codex_app.automation_update"] }).status, "available");
});

test("manager retires an owned sweep when the task reaches a terminal state", async (t) => {
  const root = await workspace(t, { state: { terminal_state: { kind: "verified", reason: "Evidence target met." } }, evidence: passingEvidence() });
  const report = await inspectManager({ root });
  const retirement = planSafetySweep(report, {
    ownership: { schema_version: 1, kind: "vision-manager-automation", authority: "none", task_id: "TASK-1", status: "active", automation_id: "sweep-1", notification_mode: "failed-runs-only" },
    manager_tools: ["codex_app.automation_update"],
  });
  assert.equal(retirement.state, "delete-requested");
  assert.equal(retirement.tool_request.operation, "delete");
});
