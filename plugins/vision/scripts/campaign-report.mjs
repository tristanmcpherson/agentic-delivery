const USAGE_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "uncached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

function emptyUsage() {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
}

function emptyAggregate() {
  return {
    attempts: 0,
    full_solves: 0,
    valid_failures: 0,
    infrastructure_failures: 0,
    clean_passes: 0,
    retry_only_passes: 0,
    usage: emptyUsage(),
    model_duration_ns: "0",
    verifier_duration_ns: "0",
  };
}

function addOutcome(aggregate, outcome) {
  aggregate.attempts += 1;
  if (outcome.classification === "VALID_PASS") aggregate.full_solves += 1;
  else if (outcome.classification === "VALID_FAIL") aggregate.valid_failures += 1;
  else aggregate.infrastructure_failures += 1;
  if (outcome.execution?.pass_quality === "clean") aggregate.clean_passes += 1;
  if (outcome.execution?.pass_quality === "retry-only") aggregate.retry_only_passes += 1;
  for (const field of USAGE_FIELDS) aggregate.usage[field] += Number(outcome.usage?.[field] || 0);
  aggregate.model_duration_ns = String(BigInt(aggregate.model_duration_ns) + BigInt(outcome.execution?.model_duration_ns || "0"));
  aggregate.verifier_duration_ns = String(BigInt(aggregate.verifier_duration_ns) + BigInt(outcome.execution?.verifier_duration_ns || "0"));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function costSummary(manifest, usage) {
  const pricing = manifest.pricing;
  const fields = ["uncached_input_usd_per_million", "cached_input_usd_per_million", "output_usd_per_million"];
  if (!pricing || fields.some((field) => !Number.isFinite(Number(pricing[field])) || Number(pricing[field]) < 0)) {
    return {
      available: false,
      estimated_usd: null,
      reason: "No complete model-pricing schedule was frozen in the campaign manifest.",
    };
  }
  const estimated = (
    usage.uncached_input_tokens * Number(pricing.uncached_input_usd_per_million)
    + usage.cached_input_tokens * Number(pricing.cached_input_usd_per_million)
    + usage.output_tokens * Number(pricing.output_usd_per_million)
  ) / 1_000_000;
  return { available: true, estimated_usd: Number(estimated.toFixed(8)), pricing };
}

function smallTaskOverhead(manifest, outcomes) {
  const tasks = new Map(manifest.tasks.map((task) => [task.id, task]));
  const observations = outcomes.filter((outcome) => {
    const size = String(tasks.get(outcome.task_id)?.size || "").toLowerCase();
    return size === "s" || size === "small";
  });
  const armIds = manifest.arms.map((arm) => arm.id);
  if (armIds.length !== 2 || armIds.some((armId) => !observations.some((outcome) => outcome.arm_id === armId))) {
    return { available: false, reason: "Both arms lack a completed small-task observation." };
  }
  const byArm = {};
  for (const armId of armIds) {
    const arm = observations.filter((outcome) => outcome.arm_id === armId);
    byArm[armId] = {
      observations: arm.length,
      median_model_duration_ns: String(Math.round(median(arm.map((outcome) => Number(outcome.execution?.model_duration_ns || 0))))),
      median_total_tokens: median(arm.map((outcome) => Number(outcome.usage?.input_tokens || 0) + Number(outcome.usage?.output_tokens || 0))),
    };
  }
  const [baselineId, companionId] = armIds;
  const baselineDuration = Number(byArm[baselineId].median_model_duration_ns);
  const baselineTokens = Number(byArm[baselineId].median_total_tokens);
  return {
    available: true,
    baseline_arm: baselineId,
    companion_arm: companionId,
    by_arm: byArm,
    duration_ratio: baselineDuration > 0 ? Number((Number(byArm[companionId].median_model_duration_ns) / baselineDuration).toFixed(4)) : null,
    token_ratio: baselineTokens > 0 ? Number((Number(byArm[companionId].median_total_tokens) / baselineTokens).toFixed(4)) : null,
  };
}

export function buildCampaignCalibration({ manifest, outcomes, preflight }) {
  const byArm = Object.fromEntries(manifest.arms.map((arm) => [arm.id, emptyAggregate()]));
  const byTaskArm = {};
  const total = emptyAggregate();
  for (const outcome of outcomes) {
    byArm[outcome.arm_id] ||= emptyAggregate();
    byTaskArm[outcome.task_id] ||= {};
    byTaskArm[outcome.task_id][outcome.arm_id] ||= emptyAggregate();
    addOutcome(total, outcome);
    addOutcome(byArm[outcome.arm_id], outcome);
    addOutcome(byTaskArm[outcome.task_id][outcome.arm_id], outcome);
  }
  return {
    schema_version: 1,
    by_arm: byArm,
    by_task_arm: byTaskArm,
    reliability: {
      clean_passes: total.clean_passes,
      retry_only_passes: total.retry_only_passes,
      valid_failures: total.valid_failures,
    },
    infrastructure_failures: total.infrastructure_failures,
    invalid_tasks: (preflight?.tasks || []).filter((task) => task.classification !== "VALID_TASK").map((task) => task.id),
    total_usage: total.usage,
    runtime: {
      model_duration_ns: total.model_duration_ns,
      verifier_duration_ns: total.verifier_duration_ns,
    },
    cost: costSummary(manifest, total.usage),
    small_task_overhead: smallTaskOverhead(manifest, outcomes),
    interpretation: {
      synthetic_weighted_score: null,
      significance_claim: null,
      note: "Report raw paired outcomes and resource observations; do not infer significance from this tuning corpus.",
    },
  };
}
