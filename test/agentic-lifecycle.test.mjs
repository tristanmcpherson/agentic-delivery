import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { buildGoalSpec } from "../plugins/vision/scripts/agentic-harness.mjs";
import { evaluateContinuation, hashValue, validateOrchestrationPolicy } from "../plugins/vision/scripts/agentic-lifecycle.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lifecycle = path.join(repositoryRoot, "plugins", "vision", "scripts", "agentic-lifecycle.mjs");
const policy = {
  max_scouts: 3,
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
  const payload = JSON.stringify([{ id: "T-LIFE", status: "in_progress", title: "Lifecycle fixture" }]);
  if (process.platform === "win32") {
    await fs.writeFile(path.join(directory, "bd.cmd"), `@echo off\r\necho ${payload}\r\n`, "utf8");
  } else {
    const file = path.join(directory, "bd");
    await fs.writeFile(file, `#!/bin/sh\nprintf '%s\\n' '${payload}'\n`, "utf8");
    await fs.chmod(file, 0o755);
  }
}

test("orchestration policy rejects telemetry, recursive fanout, and unsafe limits", () => {
  assert.deepEqual(validateOrchestrationPolicy(policy), []);
  const errors = validateOrchestrationPolicy({ ...policy, telemetry: true, allow_recursive_subagents: true, max_scouts: 60 });
  assert.ok(errors.some((error) => error.includes("telemetry")));
  assert.ok(errors.some((error) => error.includes("allow_recursive_subagents")));
  assert.ok(errors.some((error) => error.includes("max_scouts")));
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
