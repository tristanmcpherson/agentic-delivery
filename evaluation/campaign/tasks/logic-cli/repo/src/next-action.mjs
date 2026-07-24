const STATUS_RANK = new Map([
  ["implemented-not-verified", 0],
  ["locally-verified", 1],
  ["closure-verified", 2],
  ["delivered-and-verified", 3],
]);

export function selectNextAction(input) {
  if (!STATUS_RANK.has(input?.current_status) || !STATUS_RANK.has(input?.completion_target)) {
    throw new TypeError("current_status and completion_target must be valid completion states");
  }
  if (!Array.isArray(input.checks)) throw new TypeError("checks must be an array");
  const failed = input.checks.find((check) => check.required !== false && check.status === "fail");
  if (failed) return { kind: "diagnose", check_id: failed.id };
  const missing = input.checks.find((check) => check.required !== false && check.status !== "pass");
  if (missing) return { kind: "run-check", check_id: missing.id };
  if (STATUS_RANK.get(input.current_status) >= STATUS_RANK.get(input.completion_target)) return { kind: "complete" };
  return { kind: "implement", reason: "acceptance work remains" };
}
