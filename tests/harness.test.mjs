import assert from "node:assert/strict";
import test from "node:test";
import { buildGoalSpec, validateTask } from "../plugins/agentic-delivery/scripts/agentic-harness.mjs";

const config = {
  profiles: {
    mocked: { kind: "mocked", mock_policy: "allow-first-party" },
    real: {
      kind: "mixed",
      mock_policy: "forbid-first-party",
      api_origin: "https://api.example.test",
      provenance: { correlation_url: "https://verify.example.test/run/${AGENTIC_RUN_NONCE}", deployment_id: "api-123" }
    }
  }
};

function taskWith(checks) {
  return {
    schema_version: 2,
    contract_version: 1,
    task_id: "T-1",
    planning: { size: "S", size_source: "inferred", confidence: "high" },
    risk_flags: ["api-contract", "ui-behavior"],
    acceptance: [{ id: "AC-1", surface: "ui", behavior: "The user sees the service result." }],
    checks
  };
}

function realUiCheck() {
  return {
    id: "real", criterion_ids: ["AC-1"], claim_scope: "Real service compatibility.", stage: "ui", profile: "real", command: "test", expected_tests: ["journey"], business_request: { method: "GET", path: "/profile" }, required: true,
    artifacts: { attestation: true, test_integrity: true, business_flow_provenance: true }
  };
}

function discoveryTask() {
  return {
    ...taskWith([realUiCheck()]),
    schema_version: 3,
    intake: {
      status: "ready",
      research_mode: "direct",
      mode_reason: "One bounded repository question is sufficient.",
      capabilities: { subagents: "available", goal: "authorized" },
      questions: [{
        id: "RQ-1",
        question: "Which path implements the profile journey?",
        material: true,
        status: "resolved",
        conclusion: "The profile route supplies the rendered value.",
        confidence: "high",
        evidence_refs: ["repo:src/profile.ts:10"]
      }],
      scouts: [],
      conflicts: [],
      assumptions: [],
      unresolved_material: [],
      synthesis: {
        outcome: "The user sees the service result.",
        requirements: ["Render the service result."],
        constraints: ["Keep first-party provenance real."],
        non_goals: ["Unrelated redesign."],
        risk_flags: ["api-contract", "ui-behavior"],
        acceptance_ids: ["AC-1"]
      }
    },
    goal_spec: {
      objective: "The user sees the service result.",
      acceptance_ids: ["AC-1"],
      completion_target: "locally-verified",
      persistence: "goal-tool",
      mechanism: "create_goal"
    }
  };
}

test("mock-only UI acceptance is invalid", () => {
  const errors = validateTask(taskWith([{
    id: "mock", criterion_ids: ["AC-1"], claim_scope: "Mocked rendering only.", stage: "ui", profile: "mocked", command: "test", expected_tests: ["journey"], required: true,
    artifacts: { attestation: true, test_integrity: true }
  }]), config);
  assert.ok(errors.some((error) => error.includes("real-service UI check")));
});

test("real-service UI acceptance with attestation is valid", () => {
  const errors = validateTask(taskWith([realUiCheck()]), config);
  assert.deepEqual(errors, []);
});

test("schema 3 direct discovery produces a canonical goal specification", () => {
  const task = discoveryTask();
  assert.deepEqual(validateTask(task, config), []);
  const goal = buildGoalSpec(task);
  assert.match(goal.objective, /task T-1 contract v1/);
  assert.match(goal.objective, /stop only at locally-verified/);
  assert.deepEqual(goal.acceptance_ids, ["AC-1"]);
  assert.match(goal.intent_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(buildGoalSpec(task), goal);
});

test("schema 3 accepts completed read-only scouts", () => {
  const task = discoveryTask();
  task.intake.research_mode = "scouted";
  task.intake.mode_reason = "Independent repository and verification questions benefit from delegation.";
  task.intake.scouts = [{
    id: "repo-scout",
    question_ids: ["RQ-1"],
    scope: "read-only",
    status: "complete",
    summary: "Located the profile route and response-dependent UI.",
    evidence_refs: ["repo:src/profile.ts:10"]
  }];
  assert.deepEqual(validateTask(task, config), []);
});

test("schema 3 accepts equivalent direct research when subagents are unavailable", () => {
  const task = discoveryTask();
  task.intake.research_mode = "fallback";
  task.intake.mode_reason = "Delegation would help, but the surface has no subagent capability.";
  task.intake.capabilities.subagents = "unavailable";
  task.intake.fallback_reason = "No subagent tools are exposed in this surface.";
  assert.deepEqual(validateTask(task, config), []);
});

test("schema 3 rejects unresolved material discovery and write-capable scouts", () => {
  const task = discoveryTask();
  task.intake.research_mode = "scouted";
  task.intake.questions[0].status = "deferred";
  task.intake.scouts = [{
    id: "unsafe-scout",
    question_ids: ["RQ-1"],
    scope: "write",
    status: "complete",
    summary: "Changed code while researching.",
    evidence_refs: ["repo:src/profile.ts:10"],
    transcript: "raw output"
  }];
  const errors = validateTask(task, config);
  assert.ok(errors.some((error) => error.includes("material intake question RQ-1 must be resolved")));
  assert.ok(errors.some((error) => error.includes("scope must be read-only")));
  assert.ok(errors.some((error) => error.includes("must not embed transcript")));
});

test("schema 3 rejects fake fallbacks and goal-contract drift", () => {
  const task = discoveryTask();
  task.intake.research_mode = "fallback";
  task.intake.fallback_reason = "Pretend delegation is unavailable.";
  task.goal_spec.acceptance_ids = ["AC-UNKNOWN"];
  const errors = validateTask(task, config);
  assert.ok(errors.some((error) => error.includes("fallback intake requires unavailable subagents")));
  assert.ok(errors.some((error) => error.includes("goal_spec.acceptance_ids must exactly match")));
});

test("schema 3 requires contract fallback when goal creation is not authorized", () => {
  const task = discoveryTask();
  task.intake.capabilities.goal = "not-authorized";
  let errors = validateTask(task, config);
  assert.ok(errors.some((error) => error.includes("requires contract-fallback persistence")));
  task.goal_spec.persistence = "contract-fallback";
  task.goal_spec.mechanism = "task-contract";
  task.goal_spec.fallback_reason = "The invoking prompt did not authorize persistent goal creation.";
  errors = validateTask(task, config);
  assert.deepEqual(errors, []);
});

test("migration risk requires nonce-bound system evidence", () => {
  const task = {
    schema_version: 2,
    contract_version: 1,
    task_id: "T-MIGRATION",
    planning: { size: "S", size_source: "inferred", confidence: "high" },
    risk_flags: ["persistence", "migration"],
    acceptance: [{ id: "AC-DATA", surface: "data", behavior: "Existing records survive the migration." }],
    checks: [{ id: "migration", criterion_ids: ["AC-DATA"], claim_scope: "Migration behavior.", stage: "integration", command: "test", required: true, artifacts: {} }]
  };
  const errors = validateTask(task, { profiles: {} });
  assert.ok(errors.some((error) => error.includes("migration system-attestation")));
});

test("migration and async system-attestation gates are accepted", () => {
  const task = {
    schema_version: 2,
    contract_version: 1,
    task_id: "T-SYSTEM",
    planning: { size: "M", size_source: "inferred", confidence: "high" },
    risk_flags: ["migration", "async"],
    acceptance: [
      { id: "AC-DATA", surface: "data", behavior: "The schema and records are current." },
      { id: "AC-ASYNC", surface: "async", behavior: "The worker postcondition is observed." }
    ],
    checks: [
      {
        id: "migration", criterion_ids: ["AC-DATA"], claim_scope: "Migration behavior.", stage: "integration", command: "test", required: true,
        artifacts: { system_attestation: { kind: "migration", required_assertions: ["schema-current"] } }
      },
      {
        id: "worker", criterion_ids: ["AC-ASYNC"], claim_scope: "Worker behavior.", stage: "integration", command: "test", required: true,
        artifacts: { system_attestation: { kind: "async", required_assertions: ["postcondition-observed"] } }
      }
    ]
  };
  assert.deepEqual(validateTask(task, { profiles: {} }), []);
});
