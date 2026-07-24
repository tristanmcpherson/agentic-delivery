import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { buildGoalSpec } from "../plugins/vision/scripts/agentic-harness.mjs";
import { classifyVisionOffer, evaluateContinuation, hashValue, validateOrchestrationPolicy } from "../plugins/vision/scripts/agentic-lifecycle.mjs";
import { withLifecycleStateLock } from "../plugins/vision/scripts/lifecycle-state-store.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lifecycle = path.join(repositoryRoot, "plugins", "vision", "scripts", "agentic-lifecycle.mjs");
const policy = {
  max_scouts: 3,
  max_parallel_nodes: 3,
  max_review_retries: 2,
  max_no_progress_resumes: 2,
  max_authorization_failures: 3,
  max_context_percent: 80,
  allow_recursive_subagents: false,
  telemetry: false,
  auto_update: false,
  auto_merge: false,
};

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd || repositoryRoot,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function contract() {
  return {
    schema_version: 3,
    contract_version: 1,
    task_id: "T-LIFE",
    planning: { size: "M", size_source: "inferred", confidence: "high" },
    intake: {
      status: "ready",
      research_mode: "direct",
      mode_reason: "One local behavior question is sufficient.",
      capabilities: { subagents: "available", goal: "authorized" },
      questions: [{
        id: "RQ-1",
        question: "Which behavior must the lifecycle preserve?",
        material: true,
        status: "resolved",
        conclusion: "The lifecycle must reconcile the frozen contract and goal.",
        confidence: "high",
        evidence_refs: ["repo:test/agentic-lifecycle.test.mjs"],
      }],
      scouts: [],
      conflicts: [],
      assumptions: [],
      unresolved_material: [],
      synthesis: {
        outcome: "Resume the exact task deterministically.",
        requirements: ["Return one bounded next slice."],
        constraints: ["Keep derived state authority-neutral."],
        non_goals: ["Grant approval or verification authority."],
        risk_flags: ["logic"],
        acceptance_ids: ["AC-1"],
      },
    },
    goal_spec: {
      objective: "Resume the exact task deterministically.",
      acceptance_ids: ["AC-1"],
      completion_target: "locally-verified",
      persistence: "goal-tool",
      mechanism: "create_goal",
    },
    risk_flags: ["logic"],
    acceptance: [{ id: "AC-1", surface: "logic", behavior: "Resume returns exactly one next slice." }],
    checks: [{ id: "focused", criterion_ids: ["AC-1"], claim_scope: "Lifecycle behavior.", stage: "fast", command: "node --test", required: true, artifacts: {} }],
    approval_boundaries: [],
    evidence_expires_on: ["candidate-change", "contract-change"],
  };
}

async function makeFakeBeads(directory) {
  await fs.mkdir(directory, { recursive: true });
  if (process.platform === "win32") {
    await fs.writeFile(path.join(directory, "bd.cmd"), "@echo off\r\nif not defined FAKE_BEAD_STATUS set FAKE_BEAD_STATUS=in_progress\r\necho [{\"id\":\"T-LIFE\",\"status\":\"%FAKE_BEAD_STATUS%\",\"title\":\"Lifecycle fixture\"}]\r\n", "utf8");
  } else {
    const file = path.join(directory, "bd");
    await fs.writeFile(file, "#!/bin/sh\nstatus=\"$FAKE_BEAD_STATUS\"\n[ -n \"$status\" ] || status=in_progress\nprintf '[{\"id\":\"T-LIFE\",\"status\":\"%s\",\"title\":\"Lifecycle fixture\"}]\\n' \"$status\"\n", "utf8");
    await fs.chmod(file, 0o755);
  }
}

async function makeLifecycleWorkspace(temporaryRoot, evidenceRoot = ".agentic/evidence") {
  const fakeBin = path.join(temporaryRoot, "fake-bin");
  const workspace = path.join(temporaryRoot, "workspace");
  const task = contract();
  const goal = buildGoalSpec(task);
  const environment = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` };
  await makeFakeBeads(fakeBin);
  await fs.mkdir(path.join(workspace, ".agentic", "tasks"), { recursive: true });
  await fs.writeFile(path.join(workspace, ".agentic", "config.json"), `${JSON.stringify({ schema_version: 2, authority: { mode: "local" }, evidence_root: evidenceRoot, orchestration: policy, profiles: {} }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(workspace, ".agentic", "tasks", "T-LIFE.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  return { workspace, task, goal, environment };
}

function passingEvidence(task) {
  return {
    schema_version: 2,
    task_id: task.task_id,
    contract_version: task.contract_version,
    authority: "local",
    overall_status: "locally-verified",
    candidate_id: null,
    contract_hash: hashValue(task),
    workspace_fingerprint: "workspace-fixture",
    config_hash: "config-fixture",
    harness_hash: "harness-fixture",
    criteria: [{ id: "AC-1", status: "pass" }],
    checks: [{ id: "focused", required: true, state: "pass" }],
  };
}

test("orchestration policy rejects telemetry, recursive fanout, and unsafe limits", () => {
  assert.deepEqual(validateOrchestrationPolicy(policy), []);
  const errors = validateOrchestrationPolicy({ ...policy, telemetry: true, allow_recursive_subagents: true, max_scouts: 60 });
  assert.ok(errors.some((error) => error.includes("telemetry")));
  assert.ok(errors.some((error) => error.includes("allow_recursive_subagents")));
  assert.ok(errors.some((error) => error.includes("max_scouts")));
});

test("Vision offer routing selects untagged outcomes without nagging explicit or phase-limited prompts", () => {
  assert.deepEqual(classifyVisionOffer("Fix the invoice export bug."), { offer: true, reason: "engineering-outcome" });
  assert.deepEqual(classifyVisionOffer("Research the existing flow, then implement saved filters."), { offer: true, reason: "engineering-outcome" });
  assert.equal(classifyVisionOffer("Please analyze this and fix the race.").offer, true);

  assert.deepEqual(classifyVisionOffer("$vision:vision Fix the invoice export bug."), { offer: false, reason: "vision-explicit" });
  assert.deepEqual(classifyVisionOffer("$github:gh-fix-ci Fix the failing pipeline."), { offer: false, reason: "other-skill-explicit" });
  assert.deepEqual(classifyVisionOffer("Plan how to implement saved filters. Do not edit."), { offer: false, reason: "phase-limited" });
  assert.deepEqual(classifyVisionOffer("Explain why the build failed."), { offer: false, reason: "phase-limited" });
  assert.deepEqual(classifyVisionOffer("Don't use Vision; fix this manually."), { offer: false, reason: "vision-opt-out" });
  assert.deepEqual(classifyVisionOffer("What does this module do?"), { offer: false, reason: "phase-limited" });
});

test("UserPromptSubmit offers Vision once without writing state or echoing the prompt", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-vision-offer-"));
  try {
    const { workspace, environment } = await makeLifecycleWorkspace(temporaryRoot);
    const stateFile = path.join(workspace, ".agentic", "state", "active-task.json");
    const offered = await runNode([lifecycle, "hook"], {
      cwd: workspace,
      env: environment,
      stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: workspace, prompt: "Fix the invoice export bug with customer secret 123." }),
    });
    assert.equal(offered.code, 0, offered.stderr);
    const output = JSON.parse(offered.stdout);
    assert.match(output.systemMessage, /ask once/i);
    assert.match(output.hookSpecificOutput.additionalContext, /Use Vision to drive this end to end to locally-verified/);
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /customer secret 123/);
    await assert.rejects(fs.access(stateFile));

    const explicit = await runNode([lifecycle, "hook"], {
      cwd: workspace,
      env: environment,
      stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: workspace, prompt: "$vision:vision Fix the invoice export bug." }),
    });
    assert.equal(explicit.code, 0, explicit.stderr);
    assert.equal(explicit.stdout, "");

    const configFile = path.join(workspace, ".agentic", "config.json");
    const config = JSON.parse(await fs.readFile(configFile, "utf8"));
    config.orchestration.hooks = { enabled: true, authority: "advisory", network: "disabled", offer_vision_on_engineering_outcome: false };
    await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const disabled = await runNode([lifecycle, "hook"], {
      cwd: workspace,
      env: environment,
      stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: workspace, prompt: "Fix the invoice export bug." }),
    });
    assert.equal(disabled.code, 0, disabled.stderr);
    assert.equal(disabled.stdout, "");
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("plugin-wide prompt offer works before project harness installation", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-vision-plugin-offer-"));
  try {
    const offered = await runNode([lifecycle, "hook"], {
      cwd: temporaryRoot,
      stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: temporaryRoot, prompt: "Build a small CLI for the report." }),
    });
    assert.equal(offered.code, 0, offered.stderr);
    const output = JSON.parse(offered.stdout);
    assert.match(output.systemMessage, /Vision is available/);
    assert.match(output.hookSpecificOutput.additionalContext, /Use Vision to drive this end to end/);
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /small CLI for the report/);

    const phaseOnly = await runNode([lifecycle, "hook"], {
      cwd: temporaryRoot,
      stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: temporaryRoot, prompt: "Review this CLI without editing." }),
    });
    assert.equal(phaseOnly.code, 0, phaseOnly.stderr);
    assert.equal(phaseOnly.stdout, "");
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("continuation halts on no progress, repeated authorization failure, reentrancy, and context pressure", () => {
  const progress = hashValue("unchanged candidate");
  let guards = evaluateContinuation(null, { progress_sha256: progress }, policy);
  guards = evaluateContinuation(guards, { progress_sha256: progress }, policy);
  assert.equal(guards.halted, false);
  guards = evaluateContinuation(guards, { progress_sha256: progress }, policy);
  assert.equal(guards.halt_reason, "no-progress");

  const authorization = hashValue("approval:production");
  guards = null;
  for (let attempt = 0; attempt < 3; attempt += 1) guards = evaluateContinuation(guards, { authorization_failure_sha256: authorization }, policy);
  assert.equal(guards.halt_reason, "authorization-blocked");

  guards = evaluateContinuation(null, { run_id: "run-a" }, policy);
  guards = evaluateContinuation(guards, { run_id: "run-b" }, policy);
  assert.equal(guards.halt_reason, "reentrant-run");

  guards = evaluateContinuation(null, { context_percent: 80 }, policy);
  assert.equal(guards.halt_reason, "context-pressure");
});

test("activation rejects missing goal intent before reading workspace state", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-goal-boundary-"));
  try {
    const result = await runNode([lifecycle, "activate", "--root", temporaryRoot, "--task", "missing-task"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Pass --goal-intent/);
    assert.doesNotMatch(result.stderr, /Configuration not found/);
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("activation binds the canonical goal and resume returns one current slice while hooks remain read-only", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-"));
  const fakeBin = path.join(temporaryRoot, "fake-bin");
  const workspace = path.join(temporaryRoot, "workspace");
  const task = contract();
  const goal = buildGoalSpec(task);
  const environment = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` };
  await makeFakeBeads(fakeBin);
  await fs.mkdir(path.join(workspace, ".agentic", "tasks"), { recursive: true });
  await fs.writeFile(path.join(workspace, ".agentic", "config.json"), `${JSON.stringify({ schema_version: 2, authority: { mode: "local" }, evidence_root: ".agentic/evidence", orchestration: policy, profiles: {} }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(workspace, ".agentic", "tasks", "T-LIFE.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(workspace, ".agentic", "project-context.md"), "Public project rule.\nAPI_KEY=must-not-leak\n", "utf8");
  try {
    const missingGoal = await runNode([lifecycle, "activate", "--root", workspace, "--task", "T-LIFE"], { env: environment });
    assert.notEqual(missingGoal.code, 0);
    assert.match(missingGoal.stderr, /Pass --goal-intent/);

    const activation = await runNode([lifecycle, "activate", "--root", workspace, "--task", "T-LIFE", "--goal-intent", goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-1", "--slice-summary", "Implement the lifecycle fixture.", "--json"], { env: environment });
    assert.equal(activation.code, 0, activation.stderr);
    const activated = JSON.parse(activation.stdout);
    assert.equal(activated.kind, "derived-cache");
    assert.equal(activated.goal_intent_sha256, goal.intent_sha256);
    assert.equal(activated.bead.status, "in_progress");
    assert.equal(activated.current_slice.id, "slice-1");

    const resume = await runNode([lifecycle, "resume", "--root", workspace, "--json"], { env: environment });
    assert.equal(resume.code, 0, resume.stderr);
    const resumed = JSON.parse(resume.stdout);
    assert.equal(resumed.reconciliation.status, "ready");
    assert.deepEqual(Object.keys(resumed).filter((key) => key === "next_slice"), ["next_slice"]);
    assert.equal(resumed.next_slice.id, "slice-1");

    const stateFile = path.join(workspace, ".agentic", "state", "active-task.json");
    const beforeHook = await fs.readFile(stateFile);
    const hook = await runNode([lifecycle, "hook"], {
      cwd: workspace,
      env: environment,
      stdin: JSON.stringify({ hook_event_name: "SessionStart", cwd: workspace, source: "resume" }),
    });
    assert.equal(hook.code, 0, hook.stderr);
    const hookOutput = JSON.parse(hook.stdout);
    assert.match(hookOutput.hookSpecificOutput.additionalContext, /Public project rule/);
    assert.match(hookOutput.hookSpecificOutput.additionalContext, /REDACTED SECRET-LIKE LINE/);
    assert.doesNotMatch(hookOutput.hookSpecificOutput.additionalContext, /must-not-leak/);
    assert.deepEqual(await fs.readFile(stateFile), beforeHook, "hook mutated derived state");

    const tampered = JSON.parse(beforeHook.toString("utf8"));
    tampered.goal_intent_sha256 = "0".repeat(64);
    await fs.writeFile(stateFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    const blocked = await runNode([lifecycle, "resume", "--root", workspace, "--json"], { env: environment });
    assert.equal(blocked.code, 2, blocked.stderr);
    const blockedOutput = JSON.parse(blocked.stdout);
    assert.ok(blockedOutput.reconciliation.blockers.some((item) => item.code === "goal-drift"));
    assert.equal(blockedOutput.next_slice.kind, "blocker");
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("task-owned worktree creation is preview-first and activation rejects ownership drift", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-worktree-"));
  const source = path.join(temporaryRoot, "source");
  const target = path.join(temporaryRoot, "task-worktree");
  const fakeBin = path.join(temporaryRoot, "fake-bin");
  const task = contract();
  const goal = buildGoalSpec(task);
  const environment = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` };
  await makeFakeBeads(fakeBin);
  await fs.mkdir(path.join(source, ".agentic", "tasks"), { recursive: true });
  await fs.writeFile(path.join(source, ".agentic", "config.json"), `${JSON.stringify({ schema_version: 2, authority: { mode: "local" }, evidence_root: ".agentic/evidence", orchestration: policy, profiles: {} }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(source, ".agentic", "tasks", "T-LIFE.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  try {
    for (const [command, args] of [
      ["git", ["init", "-b", "master"]],
      ["git", ["config", "user.email", "fixture@example.test"]],
      ["git", ["config", "user.name", "Fixture"]],
      ["git", ["add", ".agentic/config.json", ".agentic/tasks/T-LIFE.json"]],
      ["git", ["commit", "-m", "fixture base"]],
    ]) {
      const result = await runProcess(command, args, { cwd: source });
      assert.equal(result.code, 0, result.stderr);
    }

    const preview = await runNode([lifecycle, "worktree-create", "--root", source, "--task", "T-LIFE", "--goal-intent", goal.intent_sha256, "--path", target, "--branch", "codex/t-life", "--json"], { env: environment });
    assert.equal(preview.code, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).mode, "preview");
    await assert.rejects(fs.stat(target));

    const created = await runNode([lifecycle, "worktree-create", "--root", source, "--task", "T-LIFE", "--goal-intent", goal.intent_sha256, "--path", target, "--branch", "codex/t-life", "--apply", "--json"], { env: environment });
    assert.equal(created.code, 0, created.stderr);
    const createdPayload = JSON.parse(created.stdout);
    assert.equal(createdPayload.marker.owner_task_id, "T-LIFE");
    assert.equal(createdPayload.marker.authority, "none");

    const activated = await runNode([lifecycle, "activate", "--root", target, "--task", "T-LIFE", "--goal-intent", goal.intent_sha256, "--bead", "T-LIFE", "--worktree", target, "--json"], { env: environment });
    assert.equal(activated.code, 0, activated.stderr);
    assert.equal(JSON.parse(activated.stdout).worktree.owner_task_id, "T-LIFE");

    const markerFile = path.join(target, ".agentic", "state", "worktree-owner.json");
    const marker = JSON.parse(await fs.readFile(markerFile, "utf8"));
    marker.branch = "codex/other";
    await fs.writeFile(markerFile, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    const blocked = await runNode([lifecycle, "resume", "--root", target, "--json"], { env: environment });
    assert.equal(blocked.code, 2, blocked.stderr);
    assert.ok(JSON.parse(blocked.stdout).reconciliation.blockers.some((item) => item.code === "worktree-owner-drift"));
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("custom evidence root, freshness, leases, and phase-aware completion are enforced", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-evidence-"));
  try {
    const fixture = await makeLifecycleWorkspace(temporaryRoot, "custom-evidence");
    const activation = await runNode([lifecycle, "activate", "--root", fixture.workspace, "--task", "T-LIFE", "--goal-intent", fixture.goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-1", "--json"], { env: fixture.environment });
    assert.equal(activation.code, 0, activation.stderr);
    assert.equal(JSON.parse(activation.stdout).revision, 0);
    assert.equal(JSON.parse(activation.stdout).phase, "implement");

    const lease = await runNode([lifecycle, "lease", "--root", fixture.workspace, "--owner", "controller-a", "--expected-revision", "0", "--ttl-ms", "60000", "--json"], { env: fixture.environment });
    assert.equal(lease.code, 0, lease.stderr);
    const leased = JSON.parse(lease.stdout);
    assert.equal(leased.revision, 1);
    assert.equal(leased.lease.owner, "controller-a");

    const evidenceFile = path.join(fixture.workspace, "custom-evidence", "T-LIFE", "latest.json");
    await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
    await fs.writeFile(evidenceFile, `${JSON.stringify(passingEvidence(fixture.task), null, 2)}\n`, "utf8");
    await fs.utimes(evidenceFile, new Date(0), new Date(0));
    const ignoredDefault = path.join(fixture.workspace, ".agentic", "evidence", "T-LIFE", "latest.json");
    await fs.mkdir(path.dirname(ignoredDefault), { recursive: true });
    await fs.writeFile(ignoredDefault, `${JSON.stringify({ ...passingEvidence(fixture.task), overall_status: "failed" }, null, 2)}\n`, "utf8");

    const checkpoint = await runNode([lifecycle, "checkpoint", "--root", fixture.workspace, "--expected-revision", "1", "--lease-owner", "controller-a", "--lease-token", leased.lease.token, "--complete-slice", "--release-lease", "--json"], { env: fixture.environment });
    assert.equal(checkpoint.code, 0, checkpoint.stderr);
    assert.equal(JSON.parse(checkpoint.stdout).revision, 2);
    assert.equal(JSON.parse(checkpoint.stdout).phase, "verify");

    const stale = await runNode([lifecycle, "resume", "--root", fixture.workspace, "--json"], { env: fixture.environment });
    assert.equal(stale.code, 2, stale.stderr);
    assert.ok(JSON.parse(stale.stdout).reconciliation.blockers.some((item) => item.code === "stale-evidence"));
    assert.match(JSON.parse(stale.stdout).evidence.file, /custom-evidence/);

    await fs.writeFile(evidenceFile, `${JSON.stringify(passingEvidence(fixture.task), null, 2)}\n`, "utf8");
    const completed = await runNode([lifecycle, "resume", "--root", fixture.workspace, "--json"], { env: fixture.environment });
    assert.equal(completed.code, 0, completed.stderr);
    const output = JSON.parse(completed.stdout);
    assert.equal(output.next_slice.kind, "complete");
    assert.equal(output.next_slice.terminal_state, "verified");
    assert.equal(output.evidence.overall_status, "locally-verified");
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("checkpoint rejects caller-authored progress and concurrent writers using one revision", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-cas-"));
  try {
    const fixture = await makeLifecycleWorkspace(temporaryRoot);
    const activation = await runNode([lifecycle, "activate", "--root", fixture.workspace, "--task", "T-LIFE", "--goal-intent", fixture.goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-1", "--json"], { env: fixture.environment });
    assert.equal(activation.code, 0, activation.stderr);
    const lease = await runNode([lifecycle, "lease", "--root", fixture.workspace, "--owner", "controller-a", "--expected-revision", "0", "--ttl-ms", "60000", "--json"], { env: fixture.environment });
    assert.equal(lease.code, 0, lease.stderr);
    const leased = JSON.parse(lease.stdout);

    const forgedProgress = await runNode([lifecycle, "checkpoint", "--root", fixture.workspace, "--expected-revision", "1", "--lease-owner", "controller-a", "--lease-token", leased.lease.token, "--progress", "pretend-progress"], { env: fixture.environment });
    assert.notEqual(forgedProgress.code, 0);
    assert.match(forgedProgress.stderr, /progress is derived/i);

    const base = [lifecycle, "checkpoint", "--root", fixture.workspace, "--expected-revision", "1", "--lease-owner", "controller-a", "--lease-token", leased.lease.token, "--json"];
    const [left, right] = await Promise.all([
      runNode([...base, "--slice", "left", "--slice-summary", "Left writer."], { env: fixture.environment }),
      runNode([...base, "--slice", "right", "--slice-summary", "Right writer."], { env: fixture.environment }),
    ]);
    assert.equal([left, right].filter((result) => result.code === 0).length, 1, `left=${left.stderr}\nright=${right.stderr}`);
    const rejected = [left, right].find((result) => result.code !== 0);
    assert.match(rejected.stderr, /concurrent lifecycle writer|stale lifecycle revision/i);
    const stateFile = path.join(fixture.workspace, ".agentic", "state", "active-task.json");
    assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).revision, 2);
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("an in-flight lock record is rejected as a concurrent lifecycle writer", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-inflight-lock-"));
  const stateFile = path.join(temporaryRoot, "active-task.json");
  const lockFile = `${stateFile}.lock`;
  let handle;
  try {
    await fs.writeFile(stateFile, "{}\n", "utf8");
    handle = await fs.open(lockFile, "wx", 0o600);
    await assert.rejects(
      withLifecycleStateLock(stateFile, async (current) => current),
      /concurrent lifecycle writer/i,
    );
  } finally {
    await handle?.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("resume reconciles blocked, paused, and cancelled durable Bead states without mutating cache", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-beads-"));
  try {
    const fixture = await makeLifecycleWorkspace(temporaryRoot);
    const activation = await runNode([lifecycle, "activate", "--root", fixture.workspace, "--task", "T-LIFE", "--goal-intent", fixture.goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-1", "--json"], { env: fixture.environment });
    assert.equal(activation.code, 0, activation.stderr);
    const stateFile = path.join(fixture.workspace, ".agentic", "state", "active-task.json");
    const initial = await fs.readFile(stateFile);
    for (const [status, expected] of [["blocked", "blocked"], ["paused", "paused"], ["cancelled", "cancelled"]]) {
      const result = await runNode([lifecycle, "resume", "--root", fixture.workspace, "--json"], { env: { ...fixture.environment, FAKE_BEAD_STATUS: status } });
      assert.equal(result.code, 2, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.reconciliation.terminal_state, expected);
      assert.ok(output.reconciliation.blockers.some((item) => item.code === `bead-${expected}`));
      assert.deepEqual(await fs.readFile(stateFile), initial, `resume mutated cache for ${status}`);
    }
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("verification phase blocks a dirty Git worktree", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-dirty-"));
  try {
    const fixture = await makeLifecycleWorkspace(temporaryRoot);
    await fs.writeFile(path.join(fixture.workspace, ".gitignore"), ".agentic/evidence/\n", "utf8");
    await fs.writeFile(path.join(fixture.workspace, "subject.txt"), "base\n", "utf8");
    for (const [command, args] of [
      ["git", ["init", "-b", "master"]],
      ["git", ["config", "user.email", "fixture@example.test"]],
      ["git", ["config", "user.name", "Fixture"]],
      ["git", ["add", "."]],
      ["git", ["commit", "-m", "fixture base"]],
    ]) {
      const result = await runProcess(command, args, { cwd: fixture.workspace });
      assert.equal(result.code, 0, result.stderr);
    }
    const activation = await runNode([lifecycle, "activate", "--root", fixture.workspace, "--task", "T-LIFE", "--goal-intent", fixture.goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-1", "--json"], { env: fixture.environment });
    assert.equal(activation.code, 0, activation.stderr);
    const lease = await runNode([lifecycle, "lease", "--root", fixture.workspace, "--owner", "controller-a", "--expected-revision", "0", "--ttl-ms", "60000", "--json"], { env: fixture.environment });
    assert.equal(lease.code, 0, lease.stderr);
    const leased = JSON.parse(lease.stdout);
    const checkpoint = await runNode([lifecycle, "checkpoint", "--root", fixture.workspace, "--expected-revision", "1", "--lease-owner", "controller-a", "--lease-token", leased.lease.token, "--complete-slice", "--release-lease", "--json"], { env: fixture.environment });
    assert.equal(checkpoint.code, 0, checkpoint.stderr);
    const cleanResume = await runNode([lifecycle, "resume", "--root", fixture.workspace, "--json"], { env: fixture.environment });
    assert.equal(cleanResume.code, 0, cleanResume.stderr);
    assert.ok(!JSON.parse(cleanResume.stdout).reconciliation.blockers.some((item) => item.code === "dirty-worktree"));
    await fs.appendFile(path.join(fixture.workspace, "subject.txt"), "dirty\n", "utf8");
    const resume = await runNode([lifecycle, "resume", "--root", fixture.workspace, "--json"], { env: fixture.environment });
    assert.equal(resume.code, 2, resume.stderr);
    assert.ok(JSON.parse(resume.stdout).reconciliation.blockers.some((item) => item.code === "dirty-worktree"));
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("typed terminal checkpoints stop resume until deliberate reactivation", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-lifecycle-terminal-"));
  try {
    const fixture = await makeLifecycleWorkspace(temporaryRoot);
    const activation = await runNode([lifecycle, "activate", "--root", fixture.workspace, "--task", "T-LIFE", "--goal-intent", fixture.goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-1", "--json"], { env: fixture.environment });
    assert.equal(activation.code, 0, activation.stderr);
    const lease = await runNode([lifecycle, "lease", "--root", fixture.workspace, "--owner", "controller-a", "--expected-revision", "0", "--ttl-ms", "60000", "--json"], { env: fixture.environment });
    assert.equal(lease.code, 0, lease.stderr);
    const leased = JSON.parse(lease.stdout);
    const terminal = await runNode([lifecycle, "checkpoint", "--root", fixture.workspace, "--expected-revision", "1", "--lease-owner", "controller-a", "--lease-token", leased.lease.token, "--terminal", "budget-exhausted", "--terminal-reason", "Attempt budget reached.", "--json"], { env: fixture.environment });
    assert.equal(terminal.code, 2, terminal.stderr);
    assert.equal(JSON.parse(terminal.stdout).terminal_state.kind, "budget-exhausted");

    const resumed = await runNode([lifecycle, "resume", "--root", fixture.workspace, "--json"], { env: fixture.environment });
    assert.equal(resumed.code, 2, resumed.stderr);
    const output = JSON.parse(resumed.stdout);
    assert.equal(output.reconciliation.status, "terminal");
    assert.equal(output.reconciliation.terminal_state, "budget-exhausted");
    assert.equal(output.next_slice.kind, "terminal");

    const reactivated = await runNode([lifecycle, "activate", "--root", fixture.workspace, "--task", "T-LIFE", "--goal-intent", fixture.goal.intent_sha256, "--bead", "T-LIFE", "--slice", "slice-2", "--json"], { env: fixture.environment });
    assert.equal(reactivated.code, 0, reactivated.stderr);
    assert.equal(JSON.parse(reactivated.stdout).terminal_state, null);
    assert.equal(JSON.parse(reactivated.stdout).phase, "implement");
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
