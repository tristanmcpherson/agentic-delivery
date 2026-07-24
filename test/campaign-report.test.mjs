import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignCalibration } from "../plugins/vision/scripts/campaign-report.mjs";

function outcome(overrides) {
  return {
    task_id: "small-task",
    arm_id: "lean",
    classification: "VALID_PASS",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 40,
      uncached_input_tokens: 60,
      output_tokens: 20,
      reasoning_output_tokens: 5,
    },
    execution: {
      model_duration_ns: "1000000",
      verifier_duration_ns: "100000",
      tool_failure_count: 0,
      pass_quality: "clean",
    },
    ...overrides,
  };
}

test("calibration reports paired solves, clean versus retry-only reliability, resources, cost, and small-task overhead without a synthetic score", () => {
  const manifest = {
    arms: [{ id: "lean" }, { id: "vision" }],
    tasks: [{ id: "small-task", size: "small" }],
    pricing: {
      uncached_input_usd_per_million: 10,
      cached_input_usd_per_million: 2,
      output_usd_per_million: 30,
    },
  };
  const report = buildCampaignCalibration({
    manifest,
    outcomes: [
      outcome({}),
      outcome({
        arm_id: "vision",
        usage: { input_tokens: 200, cached_input_tokens: 50, uncached_input_tokens: 150, output_tokens: 40, reasoning_output_tokens: 10 },
        execution: { model_duration_ns: "2000000", verifier_duration_ns: "200000", tool_failure_count: 1, pass_quality: "retry-only" },
      }),
    ],
    preflight: { tasks: [{ id: "small-task", classification: "VALID_TASK" }] },
  });
  assert.equal(report.by_arm.lean.full_solves, 1);
  assert.equal(report.by_arm.vision.full_solves, 1);
  assert.deepEqual(report.reliability, { clean_passes: 1, retry_only_passes: 1, valid_failures: 0 });
  assert.equal(report.total_usage.uncached_input_tokens, 210);
  assert.equal(report.runtime.model_duration_ns, "3000000");
  assert.equal(report.cost.available, true);
  assert.equal(report.cost.estimated_usd, 0.00408);
  assert.equal(report.small_task_overhead.duration_ratio, 2);
  assert.equal(report.small_task_overhead.token_ratio, 2);
  assert.equal(report.interpretation.synthetic_weighted_score, null);
  assert.equal(report.interpretation.significance_claim, null);
});

test("calibration keeps invalid tasks and unavailable pricing explicit", () => {
  const report = buildCampaignCalibration({
    manifest: { arms: [{ id: "lean" }, { id: "vision" }], tasks: [{ id: "medium", size: "medium" }] },
    outcomes: [outcome({ task_id: "medium", classification: "INCONCLUSIVE_INFRA", usage: null, execution: null })],
    preflight: { tasks: [{ id: "medium", classification: "INVALID_TASK" }] },
  });
  assert.equal(report.infrastructure_failures, 1);
  assert.deepEqual(report.invalid_tasks, ["medium"]);
  assert.equal(report.cost.available, false);
  assert.equal(report.cost.estimated_usd, null);
  assert.equal(report.small_task_overhead.available, false);
});
