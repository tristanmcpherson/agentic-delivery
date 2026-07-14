import assert from "node:assert/strict";
import test from "node:test";
import { summarizePilot } from "../scripts/run-evaluation.mjs";

const manifest = {
  cases: [
    { id: "defect", kind: "defect", critical: true },
    { id: "healthy", kind: "healthy", critical: false }
  ],
  thresholds: {
    critical_false_completions_max: 0,
    defect_detection_recall_min: 1,
    healthy_false_block_rate_max: 0,
    case_coverage_min: 1
  }
};

test("pilot summary accepts complete detection without false blocking", () => {
  const summary = summarizePilot(manifest, [{ outcomes: [
    { id: "defect", matched_expectation: true },
    { id: "healthy", matched_expectation: true }
  ] }]);
  assert.equal(summary.passed, true);
  assert.equal(summary.metrics.defect_detection_recall, 1);
  assert.equal(summary.metrics.healthy_false_block_rate, 0);
});

test("pilot summary rejects a critical false completion", () => {
  const summary = summarizePilot(manifest, [{ outcomes: [
    { id: "defect", matched_expectation: false },
    { id: "healthy", matched_expectation: true }
  ] }]);
  assert.equal(summary.passed, false);
  assert.equal(summary.metrics.critical_false_completions, 1);
});
