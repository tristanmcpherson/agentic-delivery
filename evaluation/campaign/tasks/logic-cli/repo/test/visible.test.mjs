import assert from "node:assert/strict";
import test from "node:test";
import { selectNextAction } from "../src/next-action.mjs";

test("a failed required check is diagnosed before any new implementation", () => {
  assert.deepEqual(selectNextAction({
    current_status: "implemented-not-verified",
    completion_target: "locally-verified",
    checks: [{ id: "unit", status: "fail", required: true }],
  }), { kind: "diagnose", check_id: "unit" });
});

test("a missing required check is selected", () => {
  assert.deepEqual(selectNextAction({
    current_status: "implemented-not-verified",
    completion_target: "locally-verified",
    checks: [{ id: "unit", status: "missing", required: true }],
  }), { kind: "run-check", check_id: "unit" });
});

test("a reached completion target terminates", () => {
  assert.deepEqual(selectNextAction({
    current_status: "locally-verified",
    completion_target: "locally-verified",
    checks: [{ id: "unit", status: "pass", required: true }],
  }), { kind: "complete" });
});
